//! Media-complete session over browser WebTransport via `web_sys`.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
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
    ReadableStream, ReadableStreamDefaultReader, WebTransport, WebTransportCongestionControl,
    WebTransportHash, WebTransportOptions, WritableStreamDefaultWriter,
};

const FRAME_TIMEOUT_MS: u32 = 15_000;

fn perf_now_ms() -> f64 {
    web_sys::window()
        .and_then(|w| w.performance())
        .map(|p| p.now())
        .unwrap_or(0.0)
}

fn js_buffer_from(src: &[u8]) -> Uint8Array {
    let view = Uint8Array::new_with_length(src.len() as u32);
    view.copy_from(src);
    view
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
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

async fn reader_read_value(
    reader: &ReadableStreamDefaultReader,
) -> Result<Option<JsValue>, JsValue> {
    let obj = JsFuture::from(reader.read()).await?;
    let done = Reflect::get(&obj, &JsValue::from_str("done"))?
        .as_bool()
        .unwrap_or(false);
    if done {
        return Ok(None);
    }
    Ok(Some(Reflect::get(&obj, &JsValue::from_str("value"))?))
}

async fn reader_read_bytes(
    reader: &ReadableStreamDefaultReader,
) -> Result<Option<Uint8Array>, JsValue> {
    match reader_read_value(reader).await? {
        None => Ok(None),
        Some(v) => Ok(Some(v.dyn_into::<Uint8Array>()?)),
    }
}

async fn read_exact(
    reader: &ReadableStreamDefaultReader,
    buf: &mut Vec<u8>,
    need: usize,
) -> Result<(), String> {
    while buf.len() < need {
        match reader_read_bytes(reader)
            .await
            .map_err(|e| format!("stream read: {e:?}"))?
        {
            Some(chunk) => {
                let n = chunk.length() as usize;
                let start = buf.len();
                buf.resize(start + n, 0);
                chunk.copy_to(&mut buf[start..]);
            }
            None => return Err("stream ended early".into()),
        }
    }
    Ok(())
}

const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

/// Read one `[4B BE len][payload]` from a uni stream. `Ok(None)` on clean EOF before a frame.
async fn read_length_prefixed(
    reader: &ReadableStreamDefaultReader,
    buf: &mut Vec<u8>,
) -> Result<Option<Vec<u8>>, String> {
    if let Err(e) = read_exact(reader, buf, 4).await {
        if buf.is_empty() {
            return Ok(None);
        }
        return Err(e);
    }
    let len = u32::from_be_bytes(buf[0..4].try_into().unwrap()) as usize;
    if len == 0 || len > MAX_FRAME_LEN {
        return Err(format!("invalid frame length {len}"));
    }
    read_exact(reader, buf, 4 + len).await?;
    let payload = buf[4..4 + len].to_vec();
    buf.drain(..4 + len);
    Ok(Some(payload))
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
    let mut buf = Vec::new();
    loop {
        let envelope = match read_length_prefixed(&reader, &mut buf).await {
            Ok(Some(e)) => e,
            Ok(None) | Err(_) => break,
        };
        let now = perf_now_ms();
        match unwrap_envelope(&envelope) {
            Ok((index, chunk)) => {
                let view = js_buffer_from(chunk);
                let mut s = st.borrow_mut();
                if let Some(tx) = s.waiters.remove(&index) {
                    let _ = tx.send((view, now));
                } else {
                    s.dropped_early += 1;
                }
            }
            Err(_) => continue,
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

async fn read_fod_msg(reader: &ReadableStreamDefaultReader) -> Result<FodMsg, String> {
    let mut buf = Vec::new();
    read_exact(reader, &mut buf, 4).await?;
    let len = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    read_exact(reader, &mut buf, 4 + len).await?;
    decode_fod_msg(&buf).map_err(|e| format!("decode FoD: {e}"))
}

#[derive(Default)]
struct SessionState {
    waiters: HashMap<u32, oneshot::Sender<(Uint8Array, f64)>>,
    dropped_early: u64,
    errors: HashMap<u32, String>,
    frame_errors: u64,
}

pub struct TransportSession {
    _transport: WebTransport,
    state: Rc<RefCell<SessionState>>,
    req_tx: mpsc::UnboundedSender<Vec<u8>>,
    bulk_rx: RefCell<HashMap<u32, oneshot::Receiver<(Uint8Array, f64)>>>,
    bulk_ask_ms: Cell<Option<f64>>,
}

impl TransportSession {
    pub async fn connect(wt_url: String, cert_sha256: String) -> Result<Self, String> {
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

        let state = Rc::new(RefCell::new(SessionState::default()));

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
            st_uni.borrow_mut().waiters.clear();
        });

        // FoD downlink — exceptions only (FrameError), length-prefixed on control stream.
        let st_ctl = Rc::clone(&state);
        spawn_local(async move {
            loop {
                match read_fod_msg(&control_reader).await {
                    Ok(FodMsg::FrameError {
                        frame_index,
                        reason,
                    }) => {
                        let mut s = st_ctl.borrow_mut();
                        s.errors.insert(frame_index, reason);
                        s.frame_errors += 1;
                        s.waiters.remove(&frame_index);
                    }
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
            _transport: transport,
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

        let (bytes, received_ms) = match await_bytes(rx, frame_index).await {
            Ok(d) => d,
            Err(e) => {
                let mut s = self.state.borrow_mut();
                s.waiters.remove(&frame_index);
                if let Some(reason) = s.errors.remove(&frame_index) {
                    return Err(format!("frame {frame_index} unavailable: {reason}"));
                }
                return Err(e);
            }
        };
        result_to_js(frame_index, ask_ms, bytes, received_ms)
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

    pub async fn wait_frame(&self, frame_index: u32, ask_ms: f64) -> Result<JsValue, String> {
        let rx = self
            .bulk_rx
            .borrow_mut()
            .remove(&frame_index)
            .ok_or_else(|| format!("wait_frame: no pending bulk waiter for {frame_index}"))?;
        let (bytes, received_ms) = match await_bytes(rx, frame_index).await {
            Ok(d) => d,
            Err(e) => {
                let mut s = self.state.borrow_mut();
                s.waiters.remove(&frame_index);
                if let Some(reason) = s.errors.remove(&frame_index) {
                    return Err(format!("frame {frame_index} unavailable: {reason}"));
                }
                return Err(e);
            }
        };
        result_to_js(frame_index, ask_ms, bytes, received_ms)
    }

    pub fn stats(&self) -> Result<JsValue, String> {
        let s = self.state.borrow();
        let out = Object::new();
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

async fn await_bytes(
    rx: oneshot::Receiver<(Uint8Array, f64)>,
    frame_index: u32,
) -> Result<(Uint8Array, f64), String> {
    let mut rx = rx.fuse();
    let mut timeout = TimeoutFuture::new(FRAME_TIMEOUT_MS).fuse();
    select! {
        res = rx => res.map_err(|_| format!("frame {frame_index} aborted before completion")),
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
    set(&result, "tier", &JsValue::from_str("exact"))?;
    set(&result, "codec", &JsValue::from_str("htj2k"))?;
    set(&result, "bytes", &bytes)?;
    set(&result, "timing", &timing)?;
    Ok(result.into())
}

fn set(target: &Object, key: &str, value: &JsValue) -> Result<(), String> {
    Reflect::set(target, &JsValue::from_str(key), value)
        .map(|_| ())
        .map_err(|_| format!("set {key}"))
}
