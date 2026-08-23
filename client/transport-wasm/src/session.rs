//! Media-complete session over browser WebTransport.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use futures::channel::{mpsc, oneshot};
use futures::{select, FutureExt, StreamExt};
use gloo_timers::future::TimeoutFuture;
use js_sys::{Object, Reflect, Uint8Array};
use fod::{encode_fod_msg, FodMsg};
use frame_envelope::unwrap as unwrap_envelope;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[wasm_bindgen(module = "/session_wt.js")]
extern "C" {
    #[wasm_bindgen(catch, js_name = wtConnect)]
    async fn wt_connect(url: &str, hash_hex: &str) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(catch, js_name = wtWrite)]
    async fn wt_write(writer: &JsValue, bytes: &[u8]) -> Result<(), JsValue>;

    #[wasm_bindgen(catch, js_name = wtReadAll)]
    async fn wt_read_all(reader: &JsValue) -> Result<Uint8Array, JsValue>;

    #[wasm_bindgen(catch, js_name = wtAcceptUni)]
    async fn wt_accept_uni(transport: &JsValue) -> Result<JsValue, JsValue>;
}

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

#[derive(Default)]
struct SessionState {
    waiters: HashMap<u32, oneshot::Sender<(Uint8Array, f64)>>,
    dropped_early: u64,
    cancelled_frames: u64,
    errors: HashMap<u32, String>,
    frame_errors: u64,
}

pub struct TransportSession {
    transport: JsValue,
    state: Rc<RefCell<SessionState>>,
    req_tx: mpsc::UnboundedSender<Vec<u8>>,
    control_writable: JsValue,
    bulk_rx: RefCell<HashMap<u32, oneshot::Receiver<(Uint8Array, f64)>>>,
    bulk_ask_ms: Cell<Option<f64>>,
}

impl TransportSession {
    pub async fn connect(wt_url: String, cert_sha256: String) -> Result<Self, String> {
        let conn = wt_connect(&wt_url, &cert_sha256)
            .await
            .map_err(|e| format!("wt connect: {:?}", e))?;

        let readable = Reflect::get(&conn, &JsValue::from_str("readable"))
            .map_err(|_| "missing readable")?;
        let writable = Reflect::get(&conn, &JsValue::from_str("writable"))
            .map_err(|_| "missing writable")?;
        let transport = Reflect::get(&conn, &JsValue::from_str("transport"))
            .map_err(|_| "missing transport")?;

        let state = Rc::new(RefCell::new(SessionState::default()));
        let st_uni = Rc::clone(&state);
        let transport_uni = transport.clone();

        spawn_local(async move {
            loop {
                let stream = match wt_accept_uni(&transport_uni).await {
                    Ok(v) if v.is_null() => break,
                    Ok(v) => v,
                    Err(_) => break,
                };
                let bytes = match wt_read_all(&stream).await {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                let raw: Vec<u8> = bytes.to_vec();
                let now = perf_now_ms();
                match unwrap_envelope(&raw) {
                    Ok((index, chunk)) => {
                        let view = js_buffer_from(chunk);
                        let mut s = st_uni.borrow_mut();
                        if let Some(tx) = s.waiters.remove(&index) {
                            let _ = tx.send((view, now));
                        } else {
                            s.dropped_early += 1;
                        }
                    }
                    Err(_) => continue,
                }
            }
            st_uni.borrow_mut().waiters.clear();
        });

        let st_ctl = Rc::clone(&state);
        let readable_ctl = readable.clone();
        spawn_local(async move {
            loop {
                let bytes = match wt_read_all(&readable_ctl).await {
                    Ok(b) => b,
                    Err(_) => break,
                };
                let raw = b.to_vec();
                if let Ok(FodMsg::FrameError {
                    frame_index,
                    reason,
                }) = fod::decode_fod_msg(&raw)
                {
                    let mut s = st_ctl.borrow_mut();
                    s.errors.insert(frame_index, reason);
                    s.frame_errors += 1;
                    s.waiters.remove(&frame_index);
                }
            }
        });

        let (req_tx, mut req_rx) = mpsc::unbounded::<Vec<u8>>();
        let writable_send = writable.clone();
        spawn_local(async move {
            while let Some(payload) = req_rx.next().await {
                if wt_write(&writable_send, &payload).await.is_err() {
                    break;
                }
            }
        });

        Ok(Self {
            transport,
            state,
            req_tx,
            control_writable: writable,
            bulk_rx: RefCell::new(HashMap::new()),
            bulk_ask_ms: Cell::new(None),
        })
    }

    pub fn cancel_frame(&self, frame_index: u32) -> u32 {
        let mut s = self.state.borrow_mut();
        let had = s.waiters.remove(&frame_index).is_some();
        self.bulk_rx.borrow_mut().remove(&frame_index);
        if had {
            s.cancelled_frames += 1;
        }
        0
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
        set(&out, "droppedEarlyMedia", &JsValue::from(s.dropped_early as f64))?;
        set(&out, "frameErrors", &JsValue::from(s.frame_errors as f64))?;
        set(&out, "cancelledFrames", &JsValue::from(s.cancelled_frames as f64))?;
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
