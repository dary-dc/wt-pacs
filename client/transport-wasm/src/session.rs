//! Media-complete session over browser WebTransport via `web_sys`.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use fod::{decode_fod_msg, encode_fod_msg, FodMsg};
use frame_envelope::unwrap as unwrap_envelope;
use futures::channel::{mpsc, oneshot};
use futures::{select, FutureExt, StreamExt};
use gloo_timers::future::TimeoutFuture;
use js_sys::{Object, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::{
    ReadableStream, ReadableStreamDefaultReader, ReadableStreamReadResult, WebTransport,
    WebTransportCongestionControl, WebTransportHash, WebTransportOptions,
    WritableStreamDefaultWriter,
};
#[cfg(feature = "byob")]
use web_sys::{ReadableStreamByobReader, ReadableStreamGetReaderOptions, ReadableStreamReaderMode};

const FRAME_TIMEOUT_MS: u32 = 15_000;

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

fn wire_view(buffer: &js_sys::ArrayBuffer, len: u32) -> Uint8Array {
    Uint8Array::new_with_byte_offset_and_length(buffer, 0, len)
}

#[cfg(not(feature = "byob"))]
fn js_buffer_from(src: &[u8], wire: &mut WireBuffers) -> Uint8Array {
    let len = src.len() as u32;
    let view = wire_view(&wire.take(len), len);
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

/// One `reader.read()`; `None` at end of stream.
///
/// The result is read through the typed `ReadableStreamReadResult` getters: a `Reflect::get`
/// with a fresh `JsValue::from_str("done")` would encode that key across the boundary on
/// every read, which showed up as `decodeText` in the browser profile (one read per chunk).
async fn reader_read_value(
    reader: &ReadableStreamDefaultReader,
) -> Result<Option<JsValue>, JsValue> {
    let result: ReadableStreamReadResult = JsFuture::from(reader.read()).await?.unchecked_into();
    if result.get_done().unwrap_or(false) {
        return Ok(None);
    }
    Ok(Some(result.get_value()))
}

async fn reader_read_bytes(
    reader: &ReadableStreamDefaultReader,
) -> Result<Option<Uint8Array>, JsValue> {
    match reader_read_value(reader).await? {
        None => Ok(None),
        Some(v) => Ok(Some(v.dyn_into::<Uint8Array>()?)),
    }
}

/// Receive buffer with a read cursor — avoids per-frame `to_vec` + `drain` memmove (P4).
struct RecvBuf {
    data: Vec<u8>,
    pos: usize,
}

impl RecvBuf {
    fn new() -> Self {
        Self {
            data: Vec::new(),
            pos: 0,
        }
    }

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
    #[cfg(not(feature = "byob"))]
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
) -> Result<bool, String> {
    while buf.available() < need {
        match reader_read_bytes(reader)
            .await
            .map_err(|e| format!("stream read: {e:?}"))?
        {
            Some(chunk) => buf.push_chunk(&chunk),
            None => return Ok(false),
        }
    }
    Ok(true)
}

const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

/// A frame off a media stream, or the index of the one a stream that ended mid-frame lost.
enum Envelope {
    Frame { index: u32, codestream: Uint8Array },
    /// `index: None` — the stream was cut inside the index itself, which cannot name a frame.
    Lost { index: Option<u32>, reason: String },
    Eof,
}

/// Read one `[4B BE len][4B BE index][codestream]` from a uni stream: the index ahead of the
/// codestream, so a stream that ends short can name what it lost.
#[cfg(not(feature = "byob"))]
async fn read_length_prefixed_frame(
    reader: &ReadableStreamDefaultReader,
    buf: &mut RecvBuf,
    st: &Rc<RefCell<SessionState>>,
) -> Result<Envelope, String> {
    if !read_exact(reader, buf, 4).await? {
        return Ok(Envelope::Eof);
    }
    let len = u32::from_be_bytes(buf.as_slice()[0..4].try_into().unwrap()) as usize;
    if len < frame_envelope::ENVELOPE_LEN || len > MAX_FRAME_LEN {
        return Err(format!("invalid frame length {len}"));
    }
    buf.reserve_for(4 + len);
    if !read_exact(reader, buf, 4 + len).await? {
        return Ok(lost(buf.as_slice(), len - frame_envelope::ENVELOPE_LEN));
    }
    let envelope = &buf.as_slice()[4..4 + len];
    let (index, codestream) = unwrap_envelope(envelope).map_err(|e| format!("envelope: {e}"))?;
    // One full-frame copy into the JS heap — the app-owned Uint8Array.
    let codestream = js_buffer_from(codestream, &mut st.borrow_mut().wire);
    buf.consume(4 + len);
    Ok(Envelope::Frame { index, codestream })
}

/// `head` is what arrived of `[4B BE len][4B BE index][codestream]` before the stream ended.
#[cfg(not(feature = "byob"))]
fn lost(head: &[u8], declared: usize) -> Envelope {
    let named = 4 + frame_envelope::ENVELOPE_LEN;
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
#[cfg(not(feature = "byob"))]
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
    let mut buf = RecvBuf::new();
    loop {
        match read_length_prefixed_frame(&reader, &mut buf, &st).await {
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
        if let Some(tx) = s.waiters.remove(&index) {
            let _ = tx.send((view, now));
            return;
        }
        match s.fill.as_ref() {
            Some(f) if owed => Some((f.ask_ms, f.on_frame.clone())),
            _ => {
                s.dropped_early += 1;
                None
            }
        }
    };
    if let Some((ask_ms, on_frame)) = push {
        if let Ok(result) = result_to_js(index, ask_ms, view, now) {
            let _ = on_frame.call1(&JsValue::NULL, &result);
        }
    }
}

/// A frame that will not arrive: the waiter rejects, or the fill's `onError` names it — the
/// path a server `FrameError` takes. `client/transport-ts/session.ts` `failWaiter`.
fn fail_waiter(st: &Rc<RefCell<SessionState>>, index: u32, reason: &str) {
    let refused = {
        let mut s = st.borrow_mut();
        s.errors.insert(index, reason.to_string());
        s.frame_errors += 1;
        let asked = s.waiters.remove(&index).is_some();
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

/// `[4B BE length][4B BE display index]` in front of every codestream on a media stream.
#[cfg(feature = "byob")]
const HEAD_LEN: u32 = 8;

#[cfg(feature = "byob-count")]
thread_local! {
    static READS: Cell<u32> = const { Cell::new(0) };
    static TOTAL_READS: Cell<u32> = const { Cell::new(0) };
    static TOTAL_FRAMES: Cell<u32> = const { Cell::new(0) };
}

#[cfg(feature = "byob-min")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(extends = ReadableStreamByobReader, js_name = ReadableStreamBYOBReader)]
    type ByobReaderWithMin;
    /// `reader.read(view, { min })`: resolves once `min` elements are in, not at the first packet.
    /// web-sys binds `read` without its options argument, so it is declared here.
    #[wasm_bindgen(method, js_name = read)]
    fn read_min(this: &ByobReaderWithMin, view: &Object, options: &Object) -> js_sys::Promise;
}

/// One BYOB read into `buffer[offset..offset + len]`. The reader takes the buffer and hands it
/// back in the result: returns it with the bytes read, 0 at end of stream.
#[cfg(feature = "byob")]
async fn byob_read(
    reader: &ReadableStreamByobReader,
    buffer: js_sys::ArrayBuffer,
    offset: u32,
    len: u32,
) -> Result<(js_sys::ArrayBuffer, u32), String> {
    let view = Uint8Array::new_with_byte_offset_and_length(&buffer, offset, len);
    #[cfg(feature = "byob-count")]
    {
        READS.with(|r| r.set(r.get() + 1));
        TOTAL_READS.with(|r| r.set(r.get() + 1));
    }
    #[cfg(feature = "byob-min")]
    let read = {
        let options = Object::new();
        set(&options, "min", &JsValue::from(len))?;
        reader.unchecked_ref::<ByobReaderWithMin>().read_min(&view, &options)
    };
    #[cfg(not(feature = "byob-min"))]
    let read = reader.read_with_array_buffer_view(&view);
    let result: ReadableStreamReadResult = JsFuture::from(read)
        .await
        .map_err(|e| format!("stream read: {e:?}"))?
        .unchecked_into();
    let value = result.get_value();
    if value.is_undefined() {
        return Err("stream cancelled".into());
    }
    let got: Uint8Array = value.unchecked_into();
    let n = if result.get_done().unwrap_or(false) { 0 } else { got.byte_length() };
    Ok((got.buffer(), n))
}

/// Fill `buffer[start..end]`, and say how much of it arrived before the stream ended.
#[cfg(feature = "byob")]
async fn byob_fill(
    reader: &ReadableStreamByobReader,
    mut buffer: js_sys::ArrayBuffer,
    start: u32,
    end: u32,
) -> Result<(js_sys::ArrayBuffer, u32), String> {
    let mut at = start;
    while at < end {
        let (back, n) = byob_read(reader, buffer, at, end - at).await?;
        buffer = back;
        if n == 0 {
            break;
        }
        at += n;
    }
    Ok((buffer, at - start))
}

/// One frame straight into its own JS buffer: the head into a reused 8-byte buffer, the
/// codestream into one sized from the head. No byte of it passes through WASM memory.
#[cfg(feature = "byob")]
async fn read_frame_byob(
    reader: &ReadableStreamByobReader,
    head: &mut Option<js_sys::ArrayBuffer>,
    st: &Rc<RefCell<SessionState>>,
) -> Result<Envelope, String> {
    let buffer = head.take().unwrap_or_else(|| js_sys::ArrayBuffer::new(HEAD_LEN));
    let (buffer, got) = byob_fill(reader, buffer, 0, HEAD_LEN).await?;
    let mut raw = [0u8; HEAD_LEN as usize];
    Uint8Array::new(&buffer).copy_to(&mut raw);
    *head = Some(buffer);
    if got == 0 {
        return Ok(Envelope::Eof);
    }
    if got < HEAD_LEN {
        return Ok(Envelope::Lost { index: None, reason: "truncated before its index".into() });
    }
    let len = u32::from_be_bytes(raw[0..4].try_into().unwrap()) as usize;
    if len < frame_envelope::ENVELOPE_LEN || len > MAX_FRAME_LEN {
        return Err(format!("invalid frame length {len}"));
    }
    let (index, _) = unwrap_envelope(&raw[4..]).map_err(|e| format!("envelope: {e}"))?;
    let body_len = (len - frame_envelope::ENVELOPE_LEN) as u32;
    // Bound before the await: a borrow taken inside the call expression is held across it, and
    // `releaseWireBuffer` borrows the same cell from JS at any moment.
    let into = st.borrow_mut().wire.take(body_len);
    let (body, got) = byob_fill(reader, into, 0, body_len).await?;
    if got < body_len {
        return Ok(Envelope::Lost {
            index: Some(index),
            reason: format!("truncated: {got} of {body_len} bytes"),
        });
    }
    Ok(Envelope::Frame { index, codestream: wire_view(&body, body_len) })
}

/// Drain length-prefixed envelopes from one uni until EOF, each frame read into its own buffer.
#[cfg(feature = "byob")]
async fn pump_framed_stream(stream: ReadableStream, st: Rc<RefCell<SessionState>>) {
    let options = ReadableStreamGetReaderOptions::new();
    options.set_mode(ReadableStreamReaderMode::Byob);
    let reader = match stream
        .get_reader_with_options(&options)
        .dyn_into::<ReadableStreamByobReader>()
    {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut head = None;
    loop {
        match read_frame_byob(&reader, &mut head, &st).await {
            Ok(Envelope::Frame { index, codestream }) => {
                #[cfg(feature = "byob-count")]
                {
                    TOTAL_FRAMES.with(|f| f.set(f.get() + 1));
                    web_sys::console::log_1(&JsValue::from_str(&format!(
                        "byob-count frame={} bytes={} reads={} total_frames={} total_reads={}",
                        index,
                        codestream.byte_length(),
                        READS.with(|r| r.replace(0)),
                        TOTAL_FRAMES.with(Cell::get),
                        TOTAL_READS.with(Cell::get),
                    )));
                }
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
) -> Result<FodMsg, String> {
    if !read_exact(reader, buf, 4).await? {
        return Err("control stream ended".into());
    }
    let len = u32::from_le_bytes(buf.as_slice()[0..4].try_into().unwrap()) as usize;
    if !read_exact(reader, buf, 4 + len).await? {
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

#[derive(Default)]
struct SessionState {
    waiters: HashMap<u32, oneshot::Sender<(Uint8Array, f64)>>,
    fill: Option<Fill>,
    /// Set once the session is gone; a waiter armed after this would only reach the timeout.
    closed: Option<String>,
    dropped_early: u64,
    errors: HashMap<u32, String>,
    frame_errors: u64,
    wire: WireBuffers,
}

pub struct TransportSession {
    transport: WebTransport,
    state: Rc<RefCell<SessionState>>,
    req_tx: mpsc::UnboundedSender<Vec<u8>>,
    bulk_rx: RefCell<HashMap<u32, oneshot::Receiver<(Uint8Array, f64)>>>,
    bulk_ask_ms: Cell<Option<f64>>,
}

impl TransportSession {
    pub async fn connect(
        wt_url: String,
        cert_sha256: String,
        wire_buffers: Option<u32>,
    ) -> Result<Self, String> {
        let hash_bytes = hex_to_bytes(&cert_sha256)?;
        let hash_arr = Uint8Array::from(hash_bytes.as_slice());

        let hash = WebTransportHash::new();
        hash.set_algorithm("sha-256");
        hash.set_value(&hash_arr);

        let options = WebTransportOptions::new();
        options.set_server_certificate_hashes(&[hash]);
        options.set_congestion_control(WebTransportCongestionControl::LowLatency);

        let transport = WebTransport::new_with_options(&wt_url, &options)
            .map_err(|e| format!("WebTransport new: {e:?}"))?;
        JsFuture::from(transport.ready())
            .await
            .map_err(|e| format!("WebTransport ready: {e:?}"))?;

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

        let state = Rc::new(RefCell::new(SessionState {
            wire: WireBuffers { free: Vec::new(), cap: wire_buffers.unwrap_or(0) as usize },
            ..SessionState::default()
        }));

        // docs/CLIENTS.md#a-closed-session-is-noticed-at-once.
        let st_closed = Rc::clone(&state);
        let closed = transport.closed();
        spawn_local(async move {
            let reason = match JsFuture::from(closed).await {
                Ok(info) => closed_reason_of(&info),
                Err(e) => format!("session closed: {e:?}"),
            };
            fail_all(&st_closed, reason);
        });

        // Media pump — each uni carries `[4B BE len][envelope]` frames (one or many).
        let st_uni = Rc::clone(&state);
        let uni_incoming = transport.incoming_unidirectional_streams();
        let uni_reader = uni_incoming
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
                let st = Rc::clone(&st_uni);
                spawn_local(async move {
                    pump_framed_stream(stream, st).await;
                });
            }
            fail_all(&st_uni, "session closed: the media stream ended".into());
        });

        // FoD downlink — exceptions only (FrameError), length-prefixed on control stream.
        let st_ctl = Rc::clone(&state);
        spawn_local(async move {
            let mut buf = RecvBuf::new();
            loop {
                match read_fod_msg(&control_reader, &mut buf).await {
                    Ok(FodMsg::FrameError {
                        frame_index,
                        reason,
                    }) => fail_waiter(&st_ctl, frame_index, &reason),
                    Ok(_) => continue,
                    Err(_) => break,
                }
            }
        });

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
            bulk_rx: RefCell::new(HashMap::new()),
            bulk_ask_ms: Cell::new(None),
        })
    }

    pub async fn request_frame(&self, frame_index: u32) -> Result<JsValue, String> {
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
            s.waiters.insert(frame_index, tx);
        }

        let payload = encode_fod_msg(&FodMsg::RequestFrame {
            frame: frame_index,
        })
        .map_err(|e| format!("encode FoD: {e}"))?;
        if self.req_tx.unbounded_send(payload).is_err() {
            self.state.borrow_mut().waiters.remove(&frame_index);
            return Err("FoD request channel closed".into());
        }

        self.settle(rx, frame_index, ask_ms).await
    }

    pub async fn request_frames(&self, indices: Vec<u32>) -> Result<JsValue, String> {
        let ask_ms = self.start_frames(indices.clone())?;
        let results = js_sys::Array::new();
        for &frame_index in &indices {
            let one = self.wait_frame(frame_index, ask_ms).await?;
            results.push(&one);
        }
        Ok(results.into())
    }

    pub fn start_frames(&self, indices: Vec<u32>) -> Result<f64, String> {
        if indices.is_empty() {
            return Err("start_frames: empty index list".into());
        }
        if !self.bulk_rx.borrow().is_empty() {
            return Err("start_frames: previous bulk still pending".into());
        }
        let ask_ms = perf_now_ms();
        self.bulk_ask_ms.set(Some(ask_ms));
        let mut need_wire: Vec<u32> = Vec::new();
        {
            let mut s = self.state.borrow_mut();
            let mut bulk_rx = self.bulk_rx.borrow_mut();
            if let Some(reason) = s.closed.clone() {
                return Err(format!("session unavailable: {reason}"));
            }
            for &frame_index in &indices {
                if s.waiters.contains_key(&frame_index) || bulk_rx.contains_key(&frame_index) {
                    return Err(format!("frame {frame_index} already requested"));
                }
                let (tx, rx) = oneshot::channel();
                s.waiters.insert(frame_index, tx);
                bulk_rx.insert(frame_index, rx);
                need_wire.push(frame_index);
            }
        }
        let payload = encode_fod_msg(&FodMsg::RequestFrames {
            frames: need_wire.clone(),
        })
        .map_err(|e| format!("encode FoD: {e}"))?;
        if self.req_tx.unbounded_send(payload).is_err() {
            let mut s = self.state.borrow_mut();
            let mut bulk_rx = self.bulk_rx.borrow_mut();
            for &frame_index in &need_wire {
                s.waiters.remove(&frame_index);
                bulk_rx.remove(&frame_index);
            }
            self.bulk_ask_ms.set(None);
            return Err("FoD request channel closed".into());
        }
        Ok(ask_ms)
    }

    pub fn start_stream(&self, last: u32, from: Option<u32>, to: Option<u32>) -> Result<f64, String> {
        let lo = from.unwrap_or(0);
        let hi = to.unwrap_or(last);
        if hi < lo {
            return Err("start_stream: to < from".into());
        }
        if !self.bulk_rx.borrow().is_empty() {
            return Err("start_stream: previous bulk still pending".into());
        }
        let ask_ms = perf_now_ms();
        self.bulk_ask_ms.set(Some(ask_ms));
        let indices: Vec<u32> = (lo..=hi).collect();
        {
            let mut s = self.state.borrow_mut();
            let mut bulk_rx = self.bulk_rx.borrow_mut();
            if let Some(reason) = s.closed.clone() {
                return Err(format!("session unavailable: {reason}"));
            }
            for &frame_index in &indices {
                if s.waiters.contains_key(&frame_index) || bulk_rx.contains_key(&frame_index) {
                    return Err(format!("frame {frame_index} already requested"));
                }
                let (tx, rx) = oneshot::channel();
                s.waiters.insert(frame_index, tx);
                bulk_rx.insert(frame_index, rx);
            }
        }
        let payload = encode_fod_msg(&FodMsg::StreamFrames { from, to })
            .map_err(|e| format!("encode FoD: {e}"))?;
        if self.req_tx.unbounded_send(payload).is_err() {
            let mut s = self.state.borrow_mut();
            let mut bulk_rx = self.bulk_rx.borrow_mut();
            for &frame_index in &indices {
                s.waiters.remove(&frame_index);
                bulk_rx.remove(&frame_index);
            }
            self.bulk_ask_ms.set(None);
            return Err("FoD request channel closed".into());
        }
        Ok(ask_ms)
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
    ) -> Result<f64, String> {
        if to < from {
            return Err("fillFrames: to < from".into());
        }
        let ask_ms = perf_now_ms();
        {
            let mut s = self.state.borrow_mut();
            if let Some(reason) = s.closed.clone() {
                return Err(format!("session unavailable: {reason}"));
            }
            s.fill = Some(Fill {
                pending: (from..=to).collect(),
                ask_ms,
                on_frame,
                on_error,
            });
        }
        let payload = encode_fod_msg(&FodMsg::StreamFrames {
            from: Some(from),
            to: Some(to),
        })
        .map_err(|e| format!("encode FoD: {e}"))?;
        if self.req_tx.unbounded_send(payload).is_err() {
            self.state.borrow_mut().fill = None;
            return Err("FoD request channel closed".into());
        }
        Ok(ask_ms)
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

    pub async fn wait_frame(&self, frame_index: u32, ask_ms: f64) -> Result<JsValue, String> {
        let rx = self
            .bulk_rx
            .borrow_mut()
            .remove(&frame_index)
            .ok_or_else(|| format!("wait_frame: no pending bulk waiter for {frame_index}"))?;
        self.settle(rx, frame_index, ask_ms).await
    }

    /// Await one armed waiter; a refusal the server sent for this frame wins over the raw error.
    async fn settle(
        &self,
        rx: oneshot::Receiver<(Uint8Array, f64)>,
        frame_index: u32,
        ask_ms: f64,
    ) -> Result<JsValue, String> {
        match await_bytes(rx, frame_index, &self.state).await {
            Ok((bytes, received_ms)) => result_to_js(frame_index, ask_ms, bytes, received_ms),
            Err(e) => {
                let mut s = self.state.borrow_mut();
                s.waiters.remove(&frame_index);
                match s.errors.remove(&frame_index) {
                    Some(reason) => Err(format!("frame {frame_index} unavailable: {reason}")),
                    None => Err(e),
                }
            }
        }
    }

    /// Close the WebTransport session now. Without this the server only notices the session is
    /// gone at the QUIC idle timeout (~30 s), which is what the telemetry harvest used to wait on.
    pub fn close(&self) {
        self.transport.close();
    }

    pub fn stats(&self) -> Result<JsValue, String> {
        let s = self.state.borrow();
        let out = Object::new();
        set(&out, "closed", &s.closed.as_deref().map_or(JsValue::NULL, JsValue::from_str))?;
        set(&out, "inFlight", &JsValue::from(s.waiters.len() as u32))?;
        set(
            &out,
            "droppedEarlyMedia",
            &JsValue::from(s.dropped_early as f64),
        )?;
        set(&out, "frameErrors", &JsValue::from(s.frame_errors as f64))?;
        Ok(out.into())
    }
}

fn closed_reason_of(info: &JsValue) -> String {
    let code = Reflect::get(info, &JsValue::from_str("closeCode"))
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0) as i64;
    let why = Reflect::get(info, &JsValue::from_str("reason"))
        .ok()
        .and_then(|v| v.as_string())
        .filter(|r| !r.is_empty())
        .map(|r| format!(": {r}"))
        .unwrap_or_default();
    format!("session closed (code {code}){why}")
}

async fn await_bytes(
    rx: oneshot::Receiver<(Uint8Array, f64)>,
    frame_index: u32,
    st: &Rc<RefCell<SessionState>>,
) -> Result<(Uint8Array, f64), String> {
    let mut rx = rx.fuse();
    let mut timeout = TimeoutFuture::new(FRAME_TIMEOUT_MS).fuse();
    select! {
        res = rx => res.map_err(|_| match st.borrow().closed.clone() {
            Some(reason) => format!("frame {frame_index} unavailable: {reason}"),
            None => format!("frame {frame_index} aborted before completion"),
        }),
        _ = timeout => Err(format!(
            "timeout waiting for frame {frame_index} after {FRAME_TIMEOUT_MS} ms"
        )),
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
    set(&timing, "firstChunkMs", &JsValue::from(received_ms))?;
    set(&timing, "lastChunkMs", &JsValue::from(received_ms))?;
    set(&timing, "chunks", &JsValue::from(1u32))?;
    set(&timing, "serveUs", &JsValue::NULL)?;

    let result = Object::new();
    set(&result, "frameIndex", &JsValue::from(frame_index))?;
    set(&result, "tier", &js_string("exact"))?;
    set(&result, "codec", &js_string("htj2k"))?;
    set(&result, "bytes", &bytes)?;
    set(&result, "timing", &timing)?;
    Ok(result.into())
}

thread_local! {
    /// The JS strings this module writes as keys or constant values, encoded once per thread.
    /// `JsValue::from_str` re-encodes its argument across the boundary on every call, and at
    /// twelve strings per delivered frame that was the `decodeText` line of the browser profile.
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
