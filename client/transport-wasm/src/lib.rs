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
    pub async fn connect(
        wt_url: String,
        cert_sha256: String,
        wire_buffers: Option<u32>,
    ) -> Result<TransportSessionHandle, JsValue> {
        let inner = TransportSession::connect(wt_url, cert_sha256, wire_buffers)
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

    #[wasm_bindgen(js_name = fillFrames)]
    pub fn fill_frames(
        &self,
        from: u32,
        to: u32,
        on_frame: js_sys::Function,
        on_error: Option<js_sys::Function>,
    ) -> Result<f64, JsValue> {
        self.inner
            .fill_frames(from, to, on_frame, on_error)
            .map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = releaseWireBuffer)]
    pub fn release_wire_buffer(&self, buffer: js_sys::ArrayBuffer) {
        self.inner.release_wire_buffer(buffer);
    }

    #[wasm_bindgen(js_name = endStream)]
    pub fn end_stream(&self) -> Result<(), JsValue> {
        self.inner.end_stream().map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = stats)]
    pub fn stats(&self) -> Result<JsValue, JsValue> {
        self.inner.stats().map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen(js_name = close)]
    pub fn close(&self) {
        self.inner.close();
    }
}
