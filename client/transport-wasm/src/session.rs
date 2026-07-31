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
