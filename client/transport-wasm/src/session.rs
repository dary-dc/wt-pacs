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

