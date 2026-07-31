mod session;

use session::TransportSession;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct TransportSessionHandle {
    inner: TransportSession,
}

#[wasm_bindgen]
impl TransportSessionHandle {
    #[wasm_bindgen(js_name = connect)]
