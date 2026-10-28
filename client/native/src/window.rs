//! A minimal desktop window on the core: a series over `wt-pacs/1`, each frame decoded and checked, painted by `paint`.
//! Wheel and arrows step frames, a drag sets the window, F toggles 1:1 and fitted. `docs/native/README.md` §4.

use anyhow::{bail, Context, Result};
use clap::Parser;
use native_client::decode::Decoder;
use native_client::paint::{Display, Frame, Function, Painter, Photometric, View, Voi};
use native_client::transport::{cert_hash, dial, Event, Windows};
use native_client::verify::{digests, exact, Exact};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowId};

#[derive(Parser)]
#[command(name = "native-window")]
struct Args {
    #[arg(long)]
    url: String,
    #[arg(long)]
    cert_sha256: String,
    /// Stands in for the metadata a viewer would be served: the frames' shape, display and digests.
    #[arg(long)]
    bundle: PathBuf,
    /// Each paint's surface read back into DIR, beside its frame's samples and the window's state, for `client/paint/window.mjs`.
    #[arg(long)]
    check: Option<PathBuf>,
}

/// The series' metadata as the painter needs it. `docs/FIXTURES.md` §The metadata.
struct Series {
    count: usize,
    width: u32,
    height: u32,
    bits: u32,
    components: u32,
    signed: bool,
    photometric: Photometric,
    slope: f64,
    intercept: f64,
    function: Function,
}

fn series(m: &Value) -> Result<(Series, f64, f64)> {
    let int = |k: &str| m[k].as_u64().map(|v| v as u32).with_context(|| format!("metadata {k}"));
    let photometric = match m["photometric"].as_str().unwrap_or("MONOCHROME2") {
        "MONOCHROME1" => Photometric::Monochrome1,
        "MONOCHROME2" => Photometric::Monochrome2,
        "RGB" => Photometric::Rgb,
        p => bail!("photometric interpretation {p} is not painted"),
    };
    let w = &m["window"];
    let function = match w["function"].as_str().unwrap_or("LINEAR") {
        "LINEAR" => Function::Linear,
        "LINEAR_EXACT" => Function::LinearExact,
        "SIGMOID" => Function::Sigmoid,
        f => bail!("VOI LUT function {f} is not one of LINEAR, LINEAR_EXACT, SIGMOID"),
    };
    let s = Series {
        count: int("frameCount")? as usize,
        width: int("width")?,
        height: int("height")?,
        bits: int("bitsStored")?,
        components: m["channels"].as_u64().unwrap_or(1) as u32,
        signed: m["signed"].as_bool().unwrap_or(false),
        photometric,
        slope: m["rescale"]["slope"].as_f64().unwrap_or(1.0),
        intercept: m["rescale"]["intercept"].as_f64().unwrap_or(0.0),
        function,
    };
    let first = |k: &str| w[k][0].as_f64().unwrap_or(f64::NAN);
    Ok((s, first("center"), first("width")))
}

struct Gpu {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    painter: Painter,
}

struct App {
    instance: wgpu::Instance,
    series: Series,
    frames: Vec<Option<Vec<u8>>>,
    current: usize,
    center: f64,
    width: f64,
    fit: bool,
    cursor: Option<(f64, f64)>,
    held: bool,
    gpu: Option<Gpu>,
    check: Option<PathBuf>,
    painted: usize,
}

impl App {
    fn display(&self) -> Display {
        let s = &self.series;
        Display {
            photometric: s.photometric,
            invert: false,
            slope: s.slope,
            intercept: s.intercept,
            voi: Some(Voi { center: self.center, width: self.width, function: s.function }),
            view: View { fit: self.fit, zoom: 1.0, pan_x: 0.0, pan_y: 0.0, rotate: 0, flip_h: false, flip_v: false },
        }
    }

    fn redraw(&self) {
        if let Some(gpu) = &self.gpu {
            gpu.window.request_redraw();
        }
    }

    fn step(&mut self, by: i64) {
        let next = (self.current as i64 + by).clamp(0, self.series.count as i64 - 1) as usize;
        if next != self.current {
            self.current = next;
            self.redraw();
        }
    }

    fn paint(&mut self) -> Result<()> {
        let (Some(gpu), Some(Some(pixels))) = (&self.gpu, self.frames.get(self.current)) else { return Ok(()) };
        let s = &self.series;
        let frame = Frame { pixels, width: s.width, height: s.height, bits: s.bits, components: s.components, signed: s.signed };
        let (wgpu::CurrentSurfaceTexture::Success(texture) | wgpu::CurrentSurfaceTexture::Suboptimal(texture)) = gpu.surface.get_current_texture() else {
            gpu.surface.configure(&gpu.painter.device, &gpu.config);
            return Ok(());
        };
        let display = self.display();
        let dpr = gpu.window.scale_factor();
        gpu.painter.draw(&texture.texture, &frame, &display, dpr)?;
        if let Some(dir) = &self.check {
            let mut rgba = gpu.painter.read(&texture.texture)?;
            if gpu.config.format == wgpu::TextureFormat::Bgra8Unorm {
                rgba.chunks_exact_mut(4).for_each(|p| p.swap(0, 2));
            }
            let n = self.painted;
            std::fs::write(dir.join(format!("{n:03}.rgba")), rgba)?;
            std::fs::write(dir.join(format!("{n:03}.raw")), pixels)?;
            let (width, height) = (gpu.config.width, gpu.config.height);
            let cell = json!({ "frame": self.current, "center": self.center, "windowWidth": self.width, "fit": self.fit, "width": width, "height": height, "dpr": dpr });
            std::fs::write(dir.join(format!("{n:03}.json")), cell.to_string())?;
        }
        self.painted += 1;
        gpu.painter.queue.present(texture);
        Ok(())
    }

    fn open(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        let attributes = Window::default_attributes().with_title("wt-pacs").with_inner_size(winit::dpi::LogicalSize::new(512, 384));
        let window = Arc::new(event_loop.create_window(attributes)?);
        let surface = self.instance.create_surface(window.clone())?;
        let options = wgpu::RequestAdapterOptions { compatible_surface: Some(&surface), ..Default::default() };
        let adapter = pollster::block_on(self.instance.request_adapter(&options)).context("no wgpu adapter for the window")?;
        let caps = surface.get_capabilities(&adapter);
        let unorm = [wgpu::TextureFormat::Rgba8Unorm, wgpu::TextureFormat::Bgra8Unorm];
        let format = *caps.formats.iter().find(|f| unorm.contains(f)).context("the surface offers no 8-bit unorm format")?;
        let size = window.inner_size();
        let mut config = surface.get_default_config(&adapter, size.width.max(1), size.height.max(1)).context("the surface fits no adapter")?;
        config.format = format;
        config.usage |= caps.usages & wgpu::TextureUsages::COPY_SRC;
        if self.check.is_some() && !config.usage.contains(wgpu::TextureUsages::COPY_SRC) {
            bail!("--check: this surface cannot be read back");
        }
        let painter = Painter::on(&adapter, format)?;
        surface.configure(&painter.device, &config);
        println!("renderer {} surface {format:?}", painter.renderer);
        self.gpu = Some(Gpu { window, surface, config, painter });
        Ok(())
    }
}

impl ApplicationHandler<(u32, Vec<u8>)> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gpu.is_none() {
            if let Err(e) = self.open(event_loop) {
                eprintln!("{e:#}");
                event_loop.exit();
            }
        }
    }

    fn user_event(&mut self, _: &ActiveEventLoop, (index, samples): (u32, Vec<u8>)) {
        self.frames[index as usize] = Some(samples);
        if index as usize == self.current {
            self.redraw();
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = &mut self.gpu {
                    (gpu.config.width, gpu.config.height) = (size.width.max(1), size.height.max(1));
                    gpu.surface.configure(&gpu.painter.device, &gpu.config);
                    gpu.window.request_redraw();
                }
            }
            WindowEvent::RedrawRequested => {
                if let Err(e) = self.paint() {
                    eprintln!("{e:#}");
                    event_loop.exit();
                }
            }
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => match event.logical_key {
                Key::Named(NamedKey::ArrowRight | NamedKey::ArrowDown) => self.step(1),
                Key::Named(NamedKey::ArrowLeft | NamedKey::ArrowUp) => self.step(-1),
                Key::Character(c) if c.eq_ignore_ascii_case("f") => {
                    self.fit = !self.fit;
                    self.redraw();
                }
                _ => {}
            },
            WindowEvent::MouseWheel { delta, .. } => {
                let y = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y as f64,
                    MouseScrollDelta::PixelDelta(p) => p.y,
                };
                self.step(if y < 0.0 { 1 } else if y > 0.0 { -1 } else { 0 });
            }
            WindowEvent::MouseInput { state, button: MouseButton::Left, .. } => self.held = state == ElementState::Pressed,
            WindowEvent::CursorMoved { position, .. } => {
                if let (true, Some((x, y))) = (self.held, self.cursor) {
                    self.width = (self.width + position.x - x).max(1.0);
                    self.center += position.y - y;
                    println!("window center={} width={}", self.center, self.width);
                    self.redraw();
                }
                self.cursor = Some((position.x, position.y));
            }
            _ => {}
        }
    }
}

/// Fills the series and hands each frame on once decoded; a frame that is not exact is never painted.
async fn load(args: Args, metadata: String, count: usize, proxy: EventLoopProxy<(u32, Vec<u8>)>) -> Result<()> {
    let digests = digests(&metadata)?;
    let mut decoder = Decoder::new(&metadata)?;
    let mut session = dial(&args.url, cert_hash(&args.cert_sha256)?, &Windows::default()).await?;
    session.fill(0, count as u32 - 1).await?;
    for _ in 0..count {
        match session.next().await.context("the session ended with frames owed")?? {
            Event::Frame { index, body, .. } => {
                let checked = decoder.decode(&body).map(|s| (exact(&s, digests.as_ref().and_then(|d| d.get(index as usize).copied())), s));
                match checked {
                    Ok((Exact::False, _)) => println!("frame={index} exact=false"),
                    Ok((e, samples)) => {
                        println!("frame={index} exact={}", format!("{e:?}").to_lowercase());
                        proxy.send_event((index, samples))?;
                    }
                    Err(e) => println!("frame={index} exact=false reason={e:#}"),
                }
            }
            Event::Refused { frame, reason } => println!("frame={frame} refused={reason:?}"),
        }
    }
    session.close();
    Ok(())
}

fn main() -> Result<()> {
    let args = Args::parse();
    let bundle = std::fs::File::open(&args.bundle).with_context(|| format!("open {}", args.bundle.display()))?;
    let metadata = series_bundle::read_layout(&bundle)?.metadata;
    let (series, center, width) = series(&serde_json::from_str(&metadata)?)?;
    let event_loop = EventLoop::with_user_event().build()?;
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_with_display_handle_from_env(Box::new(event_loop.owned_display_handle())));
    let mut app = App {
        instance,
        frames: vec![None; series.count],
        series,
        current: 0,
        center,
        width,
        fit: false,
        cursor: None,
        held: false,
        gpu: None,
        check: args.check.clone(),
        painted: 0,
    };
    let runtime = tokio::runtime::Runtime::new()?;
    let count = app.series.count;
    let proxy = event_loop.create_proxy();
    runtime.spawn(async move {
        if let Err(e) = load(args, metadata, count, proxy).await {
            eprintln!("{e:#}");
            std::process::exit(1);
        }
    });
    event_loop.run_app(&mut app)?;
    Ok(())
}
