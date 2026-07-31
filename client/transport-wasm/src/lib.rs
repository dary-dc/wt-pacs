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
    pub async fn connect(wt_url: String, cert_sha256: String) -> Result<TransportSessionHandle, JsValue> {
        let inner = TransportSession::connect(wt_url, cert_sha256)
            .await
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(Self { inner })
    }

    #[wasm_bindgen(js_name = requestExactFrame)]
    pub async fn request_exact_frame(&self, frame_index: u32) -> Result<JsValue, JsValue> {
        self.inner
            .request_frame(frame_index)
            .await
            .map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = requestExactFrames)]
    pub async fn request_exact_frames(
        &self,
        indices: js_sys::Uint32Array,
    ) -> Result<JsValue, JsValue> {
        let mut v = Vec::with_capacity(indices.length() as usize);
        for i in 0..indices.length() {
            v.push(indices.get_index(i));
        }
        self.inner
            .request_frames(v)
            .await
            .map_err(|e| JsValue::from_str(&e))
