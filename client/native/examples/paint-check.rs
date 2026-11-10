//! Paints the cells `client/paint/native.mjs` writes, for it to compare with the CPU reference.
//!   paint-check CELLS.json OUT_DIR   (prints the renderer; each cell's RGBA to OUT_DIR/<i>.rgba, or its refusal to <i>.error)
use anyhow::{Context, Result};
use native_client::paint::{Display, Frame, Function, Painter, Photometric, View, Voi};
use serde_json::Value;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let cells: Vec<Value> = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let out = std::path::Path::new(&args[2]);
    let painter = Painter::new()?;
    println!("{}", painter.renderer);
    for (i, cell) in cells.iter().enumerate() {
        let pixels = std::fs::read(cell["raw"].as_str().context("raw")?)?;
        let s = &cell["spec"];
        let frame = Frame {
            pixels: &pixels,
            width: s["width"].as_u64().context("width")? as u32,
            height: s["height"].as_u64().context("height")? as u32,
            bits: s["bits"].as_u64().context("bits")? as u32,
            components: s["components"].as_u64().context("components")? as u32,
            signed: s["signed"].as_bool().context("signed")?,
        };
        let size = |k: &str| cell[k].as_u64().map(|v| v as u32).context("size");
        let painted = display(&cell["display"]).and_then(|d| painter.paint(&frame, &d, size("width")?, size("height")?, cell["dpr"].as_f64().context("dpr")?));
        match painted {
            Ok(rgba) => std::fs::write(out.join(format!("{i}.rgba")), rgba)?,
            Err(e) => std::fs::write(out.join(format!("{i}.error")), format!("{e:#}"))?,
        }
    }
    Ok(())
}

/// The browser painter's `display` object, with its defaults.
fn display(d: &Value) -> Result<Display> {
    let num = |v: &Value, k: &str, or: f64| v.get(k).and_then(Value::as_f64).unwrap_or(or);
    let flag = |v: &Value, k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
    let photometric = match d.get("photometric").and_then(Value::as_str).unwrap_or("MONOCHROME2") {
        "MONOCHROME1" => Photometric::Monochrome1,
        "MONOCHROME2" => Photometric::Monochrome2,
        "RGB" => Photometric::Rgb,
        p => anyhow::bail!("photometric interpretation {p} is not painted"),
    };
    let voi = match d.get("voi") {
        None => None,
        Some(v) => Some(Voi {
            center: num(v, "center", f64::NAN),
            width: num(v, "width", f64::NAN),
            function: match v.get("function").and_then(Value::as_str).unwrap_or("LINEAR") {
                "LINEAR" => Function::Linear,
                "LINEAR_EXACT" => Function::LinearExact,
                "SIGMOID" => Function::Sigmoid,
                f => anyhow::bail!("VOI LUT function {f} is not one of LINEAR, LINEAR_EXACT, SIGMOID"),
            },
        }),
    };
    let r = d.get("rescale").cloned().unwrap_or(Value::Null);
    let v = &d["view"];
    Ok(Display {
        photometric,
        invert: flag(d, "invert"),
        slope: num(&r, "slope", 1.0),
        intercept: num(&r, "intercept", 0.0),
        voi,
        view: View {
            fit: v.get("fit").and_then(Value::as_bool).unwrap_or(true),
            zoom: num(v, "zoom", 1.0),
            pan_x: num(v, "panX", 0.0),
            pan_y: num(v, "panY", 0.0),
            rotate: num(v, "rotate", 0.0) as i32,
            flip_h: flag(v, "flipH"),
            flip_v: flag(v, "flipV"),
        },
    })
}
