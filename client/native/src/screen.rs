//! The shown frame painted on a thread of its own, as the browser's paint worker does, in the viewer's display:
//! the metadata's window, else the frame's decoded range. `client/viewer/viewer.js` `display`.

use anyhow::{Context, Result};
use native_client::paint::{Display, Frame, Function, Painter, Photometric, View, Voi};
use serde_json::Value;
use std::sync::mpsc;
use std::thread;
use std::time::Instant;

pub struct Screen {
    frames: mpsc::Sender<Vec<u8>>,
    painted: mpsc::Receiver<Result<Instant>>,
    pub renderer: String,
}

struct Shape {
    width: u32,
    height: u32,
    bits: u32,
    components: u32,
    signed: bool,
    photometric: Photometric,
    window: Option<(f64, f64)>,
}

impl Screen {
    /// Returns once the painter is up, so its start is not inside a timed fill.
    pub fn open(metadata: &str, width: u32, height: u32) -> Result<Self> {
        let m: Value = serde_json::from_str(metadata)?;
        let int = |k: &str| m[k].as_u64().map(|v| v as u32);
        let components = int("channels").unwrap_or(1);
        let shape = Shape {
            width: int("width").context("metadata width")?,
            height: int("height").context("metadata height")?,
            bits: int("bitsStored").or(int("bitsPerSample")).unwrap_or(16),
            components,
            signed: m["signed"].as_bool().unwrap_or(false),
            photometric: match m["photometric"].as_str() {
                Some("MONOCHROME1") => Photometric::Monochrome1,
                Some("RGB") => Photometric::Rgb,
                Some(_) => Photometric::Monochrome2,
                None if components == 3 => Photometric::Rgb,
                None => Photometric::Monochrome2,
            },
            window: m["window"]["center"][0].as_f64().zip(m["window"]["width"][0].as_f64()),
        };
        let (frames, rx) = mpsc::channel::<Vec<u8>>();
        let (tx, painted) = mpsc::channel();
        let (ready_tx, ready) = mpsc::channel();
        thread::spawn(move || {
            let painter = match Painter::new() {
                Ok(p) => p,
                Err(e) => return ready_tx.send(Err(e)).unwrap_or(()),
            };
            let _ = ready_tx.send(Ok(painter.renderer.clone()));
            for pixels in rx {
                let done = paint(&painter, &shape, &pixels, width, height).map(|_| Instant::now());
                if tx.send(done).is_err() {
                    return;
                }
            }
        });
        let renderer = ready.recv().context("the painter thread ended")??;
        Ok(Self { frames, painted, renderer })
    }

    pub fn paint(&self, samples: Vec<u8>) -> Result<()> {
        self.frames.send(samples).context("the painter thread ended")
    }

    /// When the oldest paint not yet waited on finished.
    pub fn painted(&self) -> Result<Instant> {
        self.painted.recv().context("the painter thread ended")?
    }
}

fn paint(painter: &Painter, s: &Shape, pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    let frame = Frame { pixels, width: s.width, height: s.height, bits: s.bits, components: s.components, signed: s.signed };
    let voi = s.window.map_or_else(|| Voi::of_range(&frame, 1.0, 0.0), |(center, width)| Voi { center, width: width.max(1.0), function: Function::Linear });
    let voi = Some(voi);
    let view = View { fit: true, zoom: 1.0, pan_x: 0.0, pan_y: 0.0, rotate: 0, flip_h: false, flip_v: false };
    let display = Display { photometric: s.photometric, invert: false, slope: 1.0, intercept: 0.0, voi, view };
    painter.paint(&frame, &display, width, height, 1.0)
}
