//! Media-complete session over browser WebTransport via `web_sys`.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::rc::Rc;

use fod::{decode_fod_msg, encode_fod_msg, FodMsg};
use frame_envelope::unwrap as unwrap_envelope;
use futures::channel::{mpsc, oneshot};
use futures::future::Fuse;
use futures::{select, FutureExt, StreamExt};
use gloo_timers::future::TimeoutFuture;
use js_sys::{Object, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::{
    ReadableStream, ReadableStreamDefaultReader, ReadableStreamReadResult, WebTransport,
    WebTransportCloseInfo, WebTransportHash, WebTransportOptions, WritableStreamDefaultWriter,
};

const FRAME_TIMEOUT_MS: u32 = 15_000;

#[wasm_bindgen]
extern "C" {
    /// `connect`'s options, named as the TypeScript client names them. docs/CLIENTS.md §The seam
    pub type ConnectOptions;
    #[wasm_bindgen(method, getter, js_name = wireBuffers)]
    fn wire_buffers(this: &ConnectOptions) -> Option<u32>;
    #[wasm_bindgen(method, getter, js_name = dialMs)]
    fn dial_ms(this: &ConnectOptions) -> Option<u32>;
    #[wasm_bindgen(method, getter)]
    fn fill(this: &ConnectOptions) -> Option<OpeningFill>;

    pub type OpeningFill;
    #[wasm_bindgen(method, getter)]
    fn from(this: &OpeningFill) -> u32;
    #[wasm_bindgen(method, getter)]
    fn to(this: &OpeningFill) -> u32;
    #[wasm_bindgen(method, getter, js_name = onFrame)]
    fn on_frame(this: &OpeningFill) -> js_sys::Function;
    #[wasm_bindgen(method, getter, js_name = onError)]
    fn on_error(this: &OpeningFill) -> Option<js_sys::Function>;
}

thread_local! {
    /// The global scope's clock: `window.performance` on a page, `self.performance` in a worker.
    static PERFORMANCE: Option<web_sys::Performance> =
        Reflect::get(&js_sys::global(), &JsValue::from_str("performance"))
            .ok()
            .and_then(|p| p.dyn_into::<web_sys::Performance>().ok());
}

fn perf_now_ms() -> f64 {
    PERFORMANCE.with(|p| p.as_ref().map(web_sys::Performance::now).unwrap_or(0.0))
}

/// The ring: a frame lands in a buffer the consumer hands back, so a fill's peak is the pool and
/// not the series. `cap` 0 keeps none, which is one buffer per frame.
/// docs/decode/README.md §The wire buffer ring
#[derive(Default)]
struct WireBuffers {
    free: Vec<js_sys::ArrayBuffer>,
    cap: usize,
}

impl WireBuffers {
    fn take(&mut self, len: u32) -> js_sys::ArrayBuffer {
        match self.free.pop() {
            Some(buf) if buf.byte_length() >= len => buf,
            _ => js_sys::ArrayBuffer::new(len),
        }
    }

    fn release(&mut self, buffer: js_sys::ArrayBuffer) {
        if self.free.len() < self.cap {
            self.free.push(buffer);
        }
    }
}

fn js_buffer_from(src: &[u8], wire: &mut WireBuffers) -> Uint8Array {
    let len = src.len() as u32;
    let view = Uint8Array::new_with_byte_offset_and_length(&wire.take(len), 0, len);
    view.copy_from(src);
    view
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    if !hex.len().is_multiple_of(2) {
        return Err("cert hash hex length must be even".into());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16)
                .map_err(|_| format!("bad hex at {i}"))
        })
        .collect()
}

/// One `reader.read()`; `None` at end of stream. Read through the typed getters: a `Reflect::get`
/// with a fresh key string re-encodes that key across the boundary on every read.
async fn reader_read_value(
    reader: &ReadableStreamDefaultReader,
) -> Result<Option<JsValue>, JsValue> {
    let result: ReadableStreamReadResult = JsFuture::from(reader.read()).await?.unchecked_into();
    if result.get_done().unwrap_or(false) {
        return Ok(None);
    }
    Ok(Some(result.get_value()))
}

/// Receive buffer with a read cursor — avoids per-frame `to_vec` + `drain` memmove.
#[derive(Default)]
struct RecvBuf {
    data: Vec<u8>,
    pos: usize,
}

impl RecvBuf {
    fn available(&self) -> usize {
        self.data.len() - self.pos
    }

    fn as_slice(&self) -> &[u8] {
        &self.data[self.pos..]
    }

    fn consume(&mut self, n: usize) {
        self.pos += n;
        // Compact only when the discarded prefix is large — not every frame.
        if self.pos >= 64 * 1024 && self.pos * 2 >= self.data.len() {
            self.data.drain(..self.pos);
            self.pos = 0;
        }
    }

    /// Room for a frame whose length is now known: one allocation instead of a doubling
    /// sequence (16 → 32 → … KB, each step a copy) for every fresh buffer.
    fn reserve_for(&mut self, total: usize) {
        let have = self.data.len() - self.pos;
        if total > have {
            self.data.reserve(total - have);
        }
    }

    fn push_chunk(&mut self, chunk: &Uint8Array) {
        let n = chunk.length() as usize;
        self.data.reserve(n);
        let filled = chunk.copy_to_uninit(&mut self.data.spare_capacity_mut()[..n]).len();
        // SAFETY: `copy_to_uninit` initialised exactly `filled` (= `n`) bytes of the spare
        // capacity it was given, contiguous with the initialised prefix.
        unsafe { self.data.set_len(self.data.len() + filled) };
    }
}

/// Read until `buf` holds `need` bytes; `false` when the stream ended before that.
async fn read_exact(
    reader: &ReadableStreamDefaultReader,
    buf: &mut RecvBuf,
    need: usize,
    on_read: &impl Fn(),
) -> Result<bool, String> {
    let read_err = |e: JsValue| format!("stream read: {e:?}");
    while buf.available() < need {
        let Some(value) = reader_read_value(reader).await.map_err(read_err)? else {
            return Ok(false);
        };
        let chunk = value.dyn_into::<Uint8Array>().map_err(read_err)?;
        on_read();
        buf.push_chunk(&chunk);
    }
    Ok(true)
}

/// A frame off a media stream, or the index of the one a stream that ended mid-frame lost.
enum Envelope {
    Frame { index: u32, codestream: Uint8Array },
    /// `index: None` — the stream was cut inside the index itself, which cannot name a frame.
    Lost { index: Option<u32>, reason: String },
    Eof,
}

/// Read one `[4B BE len][4B BE index][codestream]` from a uni stream: the index ahead of the
/// codestream, so a stream that ends short can name what it lost.
async fn read_length_prefixed_frame(
    reader: &ReadableStreamDefaultReader,
    buf: &mut RecvBuf,
    st: &Rc<RefCell<SessionState>>,
    on_read: &impl Fn(),
) -> Result<Envelope, String> {
    if !read_exact(reader, buf, 4, on_read).await? {
        return Ok(Envelope::Eof);
    }
    let len = frame_envelope::envelope_len(buf.as_slice()[0..4].try_into().unwrap())?;
    buf.reserve_for(4 + len);
    if !read_exact(reader, buf, frame_envelope::FRAME_HEAD_LEN, on_read).await? {
        return Ok(lost(buf.as_slice(), len - frame_envelope::INDEX_LEN));
    }
    head_read(st, u32::from_be_bytes(buf.as_slice()[4..8].try_into().unwrap()));
    if !read_exact(reader, buf, 4 + len, on_read).await? {
        return Ok(lost(buf.as_slice(), len - frame_envelope::INDEX_LEN));
    }
    let envelope = &buf.as_slice()[4..4 + len];
    let (index, codestream) = unwrap_envelope(envelope).map_err(|e| format!("envelope: {e}"))?;
    // One full-frame copy into the JS heap — the app-owned Uint8Array.
    let codestream = js_buffer_from(codestream, &mut st.borrow_mut().wire);
    buf.consume(4 + len);
    Ok(Envelope::Frame { index, codestream })
}

/// An asked frame's head is read and its body is not: its `on_head` runs, after the borrow is
/// released — it is JS and may re-enter the session. One that throws fails its ask.
fn head_read(st: &Rc<RefCell<SessionState>>, index: u32) {
    let on_head = st.borrow().waiters.get(&index).and_then(|w| w.on_head.clone());
    if let Some(Err(e)) = on_head.map(|f| f.call0(&JsValue::NULL)) {
        let why = e.dyn_ref::<js_sys::Error>().map_or_else(|| format!("{e:?}"), |e| String::from(e.message()));
        fail_waiter(st, index, &format!("onHead threw: {why}"));
    }
}

/// `head` is what arrived of `[4B BE len][4B BE index][codestream]` before the stream ended.
fn lost(head: &[u8], declared: usize) -> Envelope {
    let named = 4 + frame_envelope::INDEX_LEN;
    if head.len() < named {
        return Envelope::Lost { index: None, reason: "truncated before its index".into() };
    }
    let index = u32::from_be_bytes(head[4..named].try_into().unwrap());
    let got = head.len() - named;
    Envelope::Lost {
        index: Some(index),
        reason: format!("truncated: {got} of {declared} bytes"),
    }
}

/// Drain length-prefixed envelopes from one uni until EOF (shared or per-frame).
async fn pump_framed_stream(
    stream: ReadableStream,
    st: Rc<RefCell<SessionState>>,
) {
    let reader = match stream
        .get_reader()
        .dyn_into::<ReadableStreamDefaultReader>()
    {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut buf = RecvBuf::default();
    let on_read = || {
        let mut s = st.borrow_mut();
        s.last_byte_ms = perf_now_ms();
        s.media_reads += 1;
    };
    loop {
        match read_length_prefixed_frame(&reader, &mut buf, &st, &on_read).await {
            Ok(Envelope::Frame { index, codestream }) => {
                deliver(&st, index, codestream, perf_now_ms());
            }
            // Shared mode carries the whole run here, so the frames behind the lost one are gone too.
            Ok(Envelope::Lost { index, reason }) => {
                if let Some(index) = index {
                    fail_waiter(&st, index, &reason);
                }
                break;
            }
            Ok(Envelope::Eof) | Err(_) => break,
        }
    }
    let _ = JsFuture::from(reader.cancel()).await;
}

/// An asked frame settles its waiter; a fill frame goes straight to the fill's callback, which
/// is called after the borrow is released — it is JS and may re-enter the session.
fn deliver(st: &Rc<RefCell<SessionState>>, index: u32, view: Uint8Array, now: f64) {
    let push = {
        let mut s = st.borrow_mut();
        let owed = s.fill.as_mut().is_some_and(|f| f.pending.remove(&index));
        if let Some(w) = s.waiters.remove(&index) {
            let _ = w.tx.send((view, now));
            return;
        }
        match s.fill.as_ref() {
            Some(f) if owed => Some((f.ask_ms, f.on_frame.clone())),
            _ => None,
        }
    };
    if let Some((ask_ms, on_frame)) = push {
        if let Ok(result) = result_to_js(index, ask_ms, view, now) {
            let _ = on_frame.call1(&JsValue::NULL, &result);
        }
    }
}

/// A frame that will not arrive: the waiter rejects, or the fill's `onError` names it — the
/// path a server `FrameError` takes. `client/transport/ts/frame-session.ts` `failWaiter`.
fn fail_waiter(st: &Rc<RefCell<SessionState>>, index: u32, reason: &str) {
    let refused = {
        let mut s = st.borrow_mut();
        let asked = s.waiters.remove(&index).is_some();
        if asked {
            s.errors.insert(index, reason.to_string());
        }
        let owed = s.fill.as_mut().is_some_and(|f| f.pending.remove(&index));
        if asked || !owed {
            None
        } else {
            s.fill.as_ref().and_then(|f| f.on_error.clone())
        }
    };
    if let Some(on_error) = refused {
        let _ = on_error.call2(&JsValue::NULL, &JsValue::from(index), &JsValue::from_str(reason));
    }
}

/// The session is gone: every waiter woken, and every frame the fill was still owed named once.
/// First reason wins — the stream ending and `closed` settling are the same event twice.
fn fail_all(st: &Rc<RefCell<SessionState>>, reason: String) {
    let owed = {
        let mut s = st.borrow_mut();
        let reason = s.closed.get_or_insert(reason).clone();
        s.waiters.clear();
        match s.fill.take() {
            Some(Fill { pending, on_error: Some(on_error), .. }) => Some((pending, on_error, reason)),
            _ => None,
        }
    };
    if let Some((pending, on_error, reason)) = owed {
        let mut indices: Vec<u32> = pending.into_iter().collect();
        indices.sort_unstable();
        for index in indices {
            let _ = on_error.call2(
                &JsValue::NULL,
                &JsValue::from(index),
                &JsValue::from_str(&reason),
            );
        }
    }
}

async fn write_all(writer: &WritableStreamDefaultWriter, bytes: &[u8]) -> Result<(), String> {
    let arr = Uint8Array::from(bytes);
    JsFuture::from(writer.write_with_chunk(&arr))
        .await
        .map_err(|e| format!("write: {e:?}"))?;
    Ok(())
}

/// Read one `[4B LE len][JSON]` control message. `buf` outlives the call: a browser read can
/// carry several messages, and whatever follows this one must wait in the buffer for the next.
async fn read_fod_msg(
    reader: &ReadableStreamDefaultReader,
    buf: &mut RecvBuf,
    st: &Rc<RefCell<SessionState>>,
) -> Result<FodMsg, String> {
    let on_read = || st.borrow_mut().last_byte_ms = perf_now_ms();
    if !read_exact(reader, buf, 4, &on_read).await? {
        return Err("control stream ended".into());
    }
    let len = u32::from_le_bytes(buf.as_slice()[0..4].try_into().unwrap()) as usize;
    if !read_exact(reader, buf, 4 + len, &on_read).await? {
        return Err("control stream ended mid-message".into());
    }
    let msg = decode_fod_msg(&buf.as_slice()[..4 + len]).map_err(|e| format!("decode FoD: {e}"));
    buf.consume(4 + len);
    msg
}

/// A fill pushed as it lands: what is still owed, and where each frame goes. No timer per frame.
struct Fill {
    pending: HashSet<u32>,
    ask_ms: f64,
    on_frame: js_sys::Function,
    on_error: Option<js_sys::Function>,
}

struct Waiter {
    tx: oneshot::Sender<(Uint8Array, f64)>,
    on_head: Option<js_sys::Function>,
}

#[derive(Default)]
struct SessionState {
    waiters: HashMap<u32, Waiter>,
    fill: Option<Fill>,
    /// Set once the session is gone; a waiter armed after this would only reach the timeout.
    closed: Option<String>,
    /// The refusal an asked frame's waiter was dropped for, read by its `settle`.
    errors: HashMap<u32, String>,
    wire: WireBuffers,
    /// `performance.now()` of the last byte any stream delivered: what a dead path stops moving.
    last_byte_ms: f64,
    media_reads: u32,
}

fn arm_fill(
    st: &Rc<RefCell<SessionState>>,
    from: u32,
    to: u32,
    on_frame: js_sys::Function,
    on_error: Option<js_sys::Function>,
) {
    let pending = (from..=to).collect();
    st.borrow_mut().fill = Some(Fill { pending, ask_ms: perf_now_ms(), on_frame, on_error });
}

/// `:` and `-` are legal in a query, and the server's `parse_opening_ask` splits on them literally.
fn opening_ask_url(url: &str, from: u32, to: u32) -> String {
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{url}{sep}ask=fill:{from}-{to}")
}

/// Open the transport; `dial_ms` closes a dial whose `ready` has not settled by then.
async fn dial(url: &str, cert_sha256: &str, dial_ms: Option<u32>) -> Result<WebTransport, String> {
    let options = WebTransportOptions::new();
    // No hash: a CA-signed certificate, verified as any page's is. docs/devices.md §4
    if !cert_sha256.is_empty() {
        let hash = WebTransportHash::new();
        hash.set_algorithm("sha-256");
        hash.set_value(&Uint8Array::from(hex_to_bytes(cert_sha256)?.as_slice()));
        options.set_server_certificate_hashes(&[hash]);
    }
    let transport = WebTransport::new_with_options(url, &options)
        .map_err(|e| format!("WebTransport new: {e:?}"))?;
    let mut ready = JsFuture::from(transport.ready()).fuse();
    let mut late = dial_ms.map_or(Fuse::terminated(), |ms| TimeoutFuture::new(ms).fuse());
    select! {
        r = ready => r.map_err(|e| format!("WebTransport ready: {e:?}"))?,
        _ = late => {
            transport.close();
            return Err(format!("the dial did not settle in {} ms", dial_ms.unwrap_or_default()));
        }
    };
    Ok(transport)
}

/// docs/CLIENTS.md#a-closed-session-is-noticed-at-once.
fn watch_closed(transport: &WebTransport, st: Rc<RefCell<SessionState>>) {
    let closed = transport.closed();
    spawn_local(async move {
        let reason = match JsFuture::from(closed).await {
            Ok(info) => closed_reason_of(&info),
            Err(e) => format!("session closed: {e:?}"),
        };
        fail_all(&st, reason);
    });
}

/// Each uni the server opens carries `[4B BE len][envelope]` frames, one or many.
fn pump_uni(transport: &WebTransport, st: Rc<RefCell<SessionState>>) -> Result<(), String> {
    let uni_reader = transport
        .incoming_unidirectional_streams()
        .get_reader()
        .dyn_into::<ReadableStreamDefaultReader>()
        .map_err(|e| format!("uni streams reader: {e:?}"))?;
    spawn_local(async move {
        loop {
            let next = match reader_read_value(&uni_reader).await {
                Ok(Some(v)) => v,
                Ok(None) | Err(_) => break,
            };
            let stream = match next.dyn_into::<ReadableStream>() {
                Ok(s) => s,
                Err(_) => continue,
            };
            spawn_local(pump_framed_stream(stream, Rc::clone(&st)));
        }
        fail_all(&st, "session closed: the media stream ended".into());
    });
    Ok(())
}

/// The server's control messages are refusals alone.
fn pump_control(reader: ReadableStreamDefaultReader, st: Rc<RefCell<SessionState>>) {
    spawn_local(async move {
        let mut buf = RecvBuf::default();
        loop {
            match read_fod_msg(&reader, &mut buf, &st).await {
                Ok(FodMsg::FrameError { frame_index, reason }) => fail_waiter(&st, frame_index, &reason),
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    });
}

pub struct TransportSession {
    transport: WebTransport,
    state: Rc<RefCell<SessionState>>,
    req_tx: mpsc::UnboundedSender<Vec<u8>>,
}

impl TransportSession {
    pub async fn connect(
        wt_url: String,
        cert_sha256: String,
        options: Option<ConnectOptions>,
    ) -> Result<Self, String> {
        let fill = options.as_ref().and_then(ConnectOptions::fill);
        let url = match &fill {
            Some(f) => opening_ask_url(&wt_url, f.from(), f.to()),
            None => wt_url,
        };
        let dial_ms = options.as_ref().and_then(ConnectOptions::dial_ms).filter(|&ms| ms > 0);
        let transport = dial(&url, &cert_sha256, dial_ms).await?;

        let bi = JsFuture::from(transport.create_bidirectional_stream())
            .await
            .map_err(|e| format!("create bidi: {e:?}"))?
            .dyn_into::<web_sys::WebTransportBidirectionalStream>()
            .map_err(|e| format!("bidi cast: {e:?}"))?;

        let control_writer = bi
            .writable()
            .get_writer()
            .map_err(|e| format!("control writer: {e:?}"))?;
        let control_reader = bi
            .readable()
            .get_reader()
            .dyn_into::<ReadableStreamDefaultReader>()
            .map_err(|e| format!("control reader: {e:?}"))?;

        let cap = options.as_ref().and_then(ConnectOptions::wire_buffers).unwrap_or(0) as usize;
        let state = Rc::new(RefCell::new(SessionState {
            wire: WireBuffers { free: Vec::new(), cap },
            ..SessionState::default()
        }));
        // The server is already pushing it, so the run is armed and never asked for.
        if let Some(f) = fill {
            arm_fill(&state, f.from(), f.to(), f.on_frame(), f.on_error());
        }

        watch_closed(&transport, Rc::clone(&state));
        pump_uni(&transport, Rc::clone(&state))?;
        pump_control(control_reader, Rc::clone(&state));

        let (req_tx, mut req_rx) = mpsc::unbounded::<Vec<u8>>();
        spawn_local(async move {
            while let Some(payload) = req_rx.next().await {
                if write_all(&control_writer, &payload).await.is_err() {
                    break;
                }
            }
        });

        Ok(Self {
            transport,
            state,
            req_tx,
        })
    }

    /// Armed and on the wire before it returns, as the TypeScript client's ask is: a fill asked
    /// next goes out behind it. docs/WIRE.md §An ask during a fill
    pub fn request_frame(
        &self,
        frame_index: u32,
        on_head: Option<js_sys::Function>,
    ) -> Result<impl Future<Output = Result<JsValue, String>>, String> {
        let ask_ms = perf_now_ms();
        let (tx, rx) = oneshot::channel();
        {
            let mut s = self.state.borrow_mut();
            if let Some(reason) = s.closed.clone() {
                return Err(format!("frame {frame_index} unavailable: {reason}"));
            }
            if s.waiters.contains_key(&frame_index) {
                return Err(format!("frame {frame_index} already requested"));
            }
            s.waiters.insert(frame_index, Waiter { tx, on_head });
        }

        let payload = encode_fod_msg(&FodMsg::RequestFrame {
            frame: frame_index,
        })
        .map_err(|e| format!("encode FoD: {e}"))?;
        if self.req_tx.unbounded_send(payload).is_err() {
            self.state.borrow_mut().waiters.remove(&frame_index);
            return Err("FoD request channel closed".into());
        }

        Ok(settle(rx, frame_index, ask_ms, Rc::clone(&self.state)))
    }

    /// A fill pushed as it lands, on the wire as `StreamFrames`: no waiter and no timer per
    /// frame, so `end_stream` or a later fill simply drops what is still owed.
    /// docs/CLIENTS.md#fills-are-pushed
    pub fn fill_frames(
        &self,
        from: u32,
        to: u32,
        on_frame: js_sys::Function,
        on_error: Option<js_sys::Function>,
    ) -> Result<(), String> {
        if to < from {
            return Err("fillFrames: to < from".into());
        }
        if let Some(reason) = self.state.borrow().closed.clone() {
            return Err(format!("session unavailable: {reason}"));
        }
        arm_fill(&self.state, from, to, on_frame, on_error);
        let payload = encode_fod_msg(&FodMsg::StreamFrames {
            from: Some(from),
            to: Some(to),
        })
        .map_err(|e| format!("encode FoD: {e}"))?;
        if self.req_tx.unbounded_send(payload).is_err() {
            self.state.borrow_mut().fill = None;
            return Err("FoD request channel closed".into());
        }
        Ok(())
    }

    /// A wire buffer the consumer has finished with, back into the ring.
    pub fn release_wire_buffer(&self, buffer: js_sys::ArrayBuffer) {
        self.state.borrow_mut().wire.release(buffer);
    }

    pub fn end_stream(&self) -> Result<(), String> {
        self.state.borrow_mut().fill = None;
        let payload =
            encode_fod_msg(&FodMsg::EndStream).map_err(|e| format!("encode FoD: {e}"))?;
        if self.req_tx.unbounded_send(payload).is_err() {
            return Err("FoD request channel closed".into());
        }
        Ok(())
    }

    /// Close the WebTransport session now. Without this the server only notices the session is
    /// gone at the QUIC idle timeout (~30 s).
    pub fn close(&self) {
        self.transport.close();
    }

    pub fn stats(&self) -> Result<JsValue, String> {
        let s = self.state.borrow();
        let out = Object::new();
        set(&out, "closed", &s.closed.as_deref().map_or(JsValue::NULL, JsValue::from_str))?;
        set(&out, "inFlight", &JsValue::from(s.waiters.len() as u32))?;
        set(&out, "lastByteAt", &JsValue::from(s.last_byte_ms))?;
        set(&out, "mediaReads", &JsValue::from(s.media_reads))?;
        Ok(out.into())
    }
}

fn closed_reason_of(info: &JsValue) -> String {
    let info = info.unchecked_ref::<WebTransportCloseInfo>();
    let code = info.get_close_code().unwrap_or(0);
    let why = info
        .get_reason()
        .filter(|r| !r.is_empty())
        .map(|r| format!(": {r}"))
        .unwrap_or_default();
    format!("session closed (code {code}){why}")
}

/// Await one armed waiter; a refusal the server sent for this frame wins over the raw error.
async fn settle(
    rx: oneshot::Receiver<(Uint8Array, f64)>,
    frame_index: u32,
    ask_ms: f64,
    st: Rc<RefCell<SessionState>>,
) -> Result<JsValue, String> {
    match await_bytes(rx, frame_index, &st).await {
        Ok((bytes, received_ms)) => result_to_js(frame_index, ask_ms, bytes, received_ms),
        Err(e) => {
            let mut s = st.borrow_mut();
            s.waiters.remove(&frame_index);
            match s.errors.remove(&frame_index) {
                Some(reason) => Err(format!("frame {frame_index} unavailable: {reason}")),
                None => Err(e),
            }
        }
    }
}

async fn await_bytes(
    rx: oneshot::Receiver<(Uint8Array, f64)>,
    frame_index: u32,
    st: &Rc<RefCell<SessionState>>,
) -> Result<(Uint8Array, f64), String> {
    let mut rx = rx.fuse();
    let armed = perf_now_ms();
    let mut wait = FRAME_TIMEOUT_MS;
    loop {
        let mut timeout = TimeoutFuture::new(wait).fuse();
        select! {
            res = rx => return res.map_err(|_| match st.borrow().closed.clone() {
                Some(reason) => format!("frame {frame_index} unavailable: {reason}"),
                None => format!("frame {frame_index} aborted before completion"),
            }),
            _ = timeout => {
                // Late when the session goes quiet, not when the ask is old: a long burst still owes its tail.
                let quiet = perf_now_ms() - st.borrow().last_byte_ms.max(armed);
                if quiet >= f64::from(FRAME_TIMEOUT_MS) {
                    return Err(format!(
                        "timeout waiting for frame {frame_index}: no byte for {FRAME_TIMEOUT_MS} ms"
                    ));
                }
                wait = (f64::from(FRAME_TIMEOUT_MS) - quiet).ceil() as u32;
            }
        }
    }
}

fn result_to_js(
    frame_index: u32,
    ask_ms: f64,
    bytes: Uint8Array,
    received_ms: f64,
) -> Result<JsValue, String> {
    let timing = Object::new();
    set(&timing, "askMs", &JsValue::from(ask_ms))?;
    set(&timing, "lastChunkMs", &JsValue::from(received_ms))?;

    let result = Object::new();
    set(&result, "frameIndex", &JsValue::from(frame_index))?;
    set(&result, "bytes", &bytes)?;
    set(&result, "timing", &timing)?;
    Ok(result.into())
}

thread_local! {
    /// The JS strings this module writes as keys, encoded once per thread: `JsValue::from_str`
    /// re-encodes its argument across the boundary on every call.
    static JS_STRINGS: RefCell<HashMap<&'static str, JsValue>> = RefCell::new(HashMap::new());
}

fn js_string(text: &'static str) -> JsValue {
    JS_STRINGS.with(|cache| {
        cache
            .borrow_mut()
            .entry(text)
            .or_insert_with(|| JsValue::from_str(text))
            .clone()
    })
}

fn set(target: &Object, key: &'static str, value: &JsValue) -> Result<(), String> {
    Reflect::set(target, &js_string(key), value)
        .map(|_| ())
        .map_err(|_| format!("set {key}"))
}
