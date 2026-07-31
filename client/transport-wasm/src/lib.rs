mod session;

use session::TransportSession;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error")]
    console_error_panic_hook::set_once();
}
