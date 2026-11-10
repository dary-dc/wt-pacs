//! A minimal desktop window on the core: a series over `wt-pacs/1`, each frame decoded and checked, painted by `paint`.
//! Wheel and arrows step frames, a drag sets the window, F toggles 1:1 and fitted, Escape closes. `docs/native/README.md` §4.
//! `--paint-thread` picks the thread that holds the frames and paints: §The view-worker design, native.

use anyhow::{bail, Context, Result};
use clap::{Parser, ValueEnum};
use native_client::cache::Cache;
use native_client::count;
use native_client::decode::Decoder;
use native_client::paint::{Display, Frame, Function, Painter, Photometric, View, Voi};
use native_client::transport::{cert_hash, dial, dial_bounded, Event, Windows};
use native_client::verify::{digests, exact, Exact};
use native_client::view::{decoders, download, Decoded, Store};
use serde_json::{json, Value};
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowId};

#[derive(Parser, Clone)]
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
    #[arg(long, value_enum, default_value_t = PaintThread::Ui)]
    paint_thread: PaintThread,
    /// The view's memory store, in bytes.
    #[arg(long, default_value_t = 64 << 20)]
    budget: usize,
    /// K: decoded frames the view has not yet received, at most; and coded frames waiting for a decoder.
    #[arg(long, default_value_t = 4)]
    credits: usize,
    /// N, the decoder threads; `min(3, cores)` when absent.
    #[arg(long)]
    decoders: Option<usize>,
    /// Asks on the wire at once.
    #[arg(long, default_value_t = 8)]
    asks: usize,
    /// Every frame fetched `true` is written here; with a view or core paint thread, also read first.
    #[arg(long, requires_all = ["series", "version"])]
    cache: Option<PathBuf>,
    #[arg(long)]
    series: Option<String>,
    #[arg(long)]
    version: Option<String>,
    /// The lab's lever: each cache write waits this long before it starts.
    #[arg(long, default_value_t = 0)]
    cache_write_delay_ms: u64,
    /// After each paint, wait for the GPU's queue to drain and print when: the lab's painted stamp.
    #[arg(long)]
    stamp_painted: bool,
}

#[derive(Clone, Copy, PartialEq, ValueEnum, Debug)]
enum PaintThread {
    /// The UI thread holds every frame and paints; one task decodes on tokio's workers.
    Ui,
    /// A view thread holds the store and paints; a downloader thread holds the session; N decoders between.
    View,
    /// The view thread's loop and the downloader's on one thread; N decoders.
    Core,
}

/// What the UI thread is told: a frame (with the UI as paint thread), or the paint's events.
#[derive(Debug)]
enum Note {
    Frame(u32, Vec<u8>),
    Shown(u32),
    Failed(String),
}

/// The user's input as the thread that paints applies it.
enum Intent {
    Step(i64),
    Drag(f64, f64),
    Fit,
    Resize(u32, u32),
    Redraw,
}

fn since_start() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1e3
}

/// The series' metadata as the painter needs it. `docs/FIXTURES.md` §The metadata.
#[derive(Clone)]
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
    check: Option<PathBuf>,
    painted: usize,
    digests: Option<Vec<u64>>,
    stamp: bool,
}

impl Gpu {
    fn resize(&mut self, width: u32, height: u32) {
        (self.config.width, self.config.height) = (width.max(1), height.max(1));
        self.surface.configure(&self.painter.device, &self.config);
    }

    fn paint(&mut self, s: &Series, look: &Look, pixels: &[u8]) -> Result<()> {
        let frame = Frame { pixels, width: s.width, height: s.height, bits: s.bits, components: s.components, signed: s.signed };
        let (wgpu::CurrentSurfaceTexture::Success(texture) | wgpu::CurrentSurfaceTexture::Suboptimal(texture)) = self.surface.get_current_texture() else {
            self.surface.configure(&self.painter.device, &self.config);
            return Ok(());
        };
        let display = look.display(s);
        let dpr = self.window.scale_factor();
        self.painter.draw(&texture.texture, &frame, &display, dpr)?;
        count::paint();
        if let Some(dir) = &self.check {
            let mut rgba = self.painter.read(&texture.texture)?;
            if self.config.format == wgpu::TextureFormat::Bgra8Unorm {
                rgba.chunks_exact_mut(4).for_each(|p| p.swap(0, 2));
            }
            let n = self.painted;
            std::fs::write(dir.join(format!("{n:03}.rgba")), rgba)?;
            std::fs::write(dir.join(format!("{n:03}.raw")), pixels)?;
            let (width, height) = (self.config.width, self.config.height);
            let exact = format!("{:?}", exact(pixels, self.digests.as_ref().and_then(|d| d.get(look.current).copied()))).to_lowercase();
            let cell = json!({ "frame": look.current, "exact": exact, "center": look.center, "windowWidth": look.width, "fit": look.fit, "width": width, "height": height, "dpr": dpr });
            std::fs::write(dir.join(format!("{n:03}.json")), cell.to_string())?;
        }
        self.painted += 1;
        self.painter.queue.present(texture);
        if self.stamp {
            let (drained, wait) = std::sync::mpsc::channel();
            self.painter.queue.on_submitted_work_done(move || drained.send(()).unwrap_or(()));
            self.painter.device.poll(wgpu::PollType::wait_indefinitely())?;
            wait.recv()?;
            println!("painted frame={} at_ms={:.3}", look.current, since_start());
        }
        Ok(())
    }
}

/// What the user has set: the frame shown and its display.
#[derive(Clone, Copy)]
struct Look {
    current: usize,
    center: f64,
    width: f64,
    fit: bool,
}

impl Look {
    /// True when the change needs a paint.
    fn apply(&mut self, intent: &Intent, count: usize) -> bool {
        match *intent {
            Intent::Step(by) => {
                let next = (self.current as i64 + by).clamp(0, count as i64 - 1) as usize;
                std::mem::replace(&mut self.current, next) != next
            }
            Intent::Drag(dx, dy) => {
                self.width = (self.width + dx).max(1.0);
                self.center += dy;
                println!("window center={} width={}", self.center, self.width);
                true
            }
            Intent::Fit => {
                self.fit = !self.fit;
                true
            }
            Intent::Resize(..) | Intent::Redraw => true,
        }
    }

    fn display(&self, s: &Series) -> Display {
        Display {
            photometric: s.photometric,
            invert: false,
            slope: s.slope,
            intercept: s.intercept,
            voi: Some(Voi { center: self.center, width: self.width, function: s.function }),
            view: View { fit: self.fit, zoom: 1.0, pan_x: 0.0, pan_y: 0.0, rotate: 0, flip_h: false, flip_v: false },
        }
    }
}

struct App {
    instance: wgpu::Instance,
    series: Series,
    frames: Vec<Option<Vec<u8>>>,
    look: Look,
    cursor: Option<(f64, f64)>,
    held: bool,
    gpu: Option<Gpu>,
    args: Args,
    metadata: String,
    proxy: EventLoopProxy<Note>,
    view: Option<mpsc::UnboundedSender<Intent>>,
}

impl App {
    fn redraw(&self) {
        if let Some(gpu) = &self.gpu {
            gpu.window.request_redraw();
        }
    }

    /// On this thread when it paints; else sent to the thread that paints.
    fn input(&mut self, intent: Intent) {
        if matches!(intent, Intent::Step(_)) && self.args.stamp_painted {
            println!("step at_ms={:.3}", since_start());
        }
        if let Some(view) = &self.view {
            let _ = view.send(intent);
            return;
        }
        if let (Intent::Resize(width, height), Some(gpu)) = (&intent, &mut self.gpu) {
            gpu.resize(*width, *height);
        }
        if self.look.apply(&intent, self.series.count) {
            self.redraw();
        }
    }

    fn paint(&mut self) -> Result<()> {
        let (Some(gpu), Some(Some(pixels))) = (&mut self.gpu, self.frames.get(self.look.current)) else { return Ok(()) };
        gpu.paint(&self.series, &self.look, pixels)
    }

    fn open(&mut self, event_loop: &ActiveEventLoop) -> Result<Gpu> {
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
        // The core thread receives between paints, so its present must not wait for a vblank: README §The single core.
        let never_waits = [wgpu::PresentMode::Mailbox, wgpu::PresentMode::Immediate];
        config.present_mode = match self.args.paint_thread {
            PaintThread::Core => *never_waits.iter().find(|m| caps.present_modes.contains(m)).context("the surface has no present that never waits")?,
            _ => wgpu::PresentMode::Fifo,
        };
        if self.args.check.is_some() && !config.usage.contains(wgpu::TextureUsages::COPY_SRC) {
            bail!("--check: this surface cannot be read back");
        }
        let painter = Painter::on(&adapter, format)?;
        surface.configure(&painter.device, &config);
        println!("renderer {} surface {format:?} present {:?} paint_thread {:?}", painter.renderer, config.present_mode, self.args.paint_thread);
        let (check, digests, stamp) = (self.args.check.clone(), digests(&self.metadata)?, self.args.stamp_painted);
        Ok(Gpu { window, surface, config, painter, check, painted: 0, digests, stamp })
    }

    /// A view or core paint thread: the decoders, then the downloader and the view on their thread or threads.
    fn start(&mut self, gpu: Gpu) -> Result<()> {
        let a = &self.args;
        let cache = match &a.cache {
            Some(root) => {
                let cache = Cache::open(root, a.series.as_deref().unwrap_or_default(), a.version.as_deref().unwrap_or_default())?;
                Some(Arc::new(cache.slow_writes(Duration::from_millis(a.cache_write_delay_ms))))
            }
            None => None,
        };
        let n = a.decoders.unwrap_or_else(|| std::thread::available_parallelism().map_or(3, |c| c.get().min(3)));
        println!("decoders={n} credits={} budget={} asks={} cache={}", a.credits, a.budget, a.asks, a.cache.as_ref().map_or("none".into(), |c| c.display().to_string()));
        let (intents, inbox) = mpsc::unbounded_channel();
        let (want, wanted) = watch::channel(Vec::new());
        let (jobs, queued) = mpsc::channel(a.credits);
        let (decoded, frames) = mpsc::channel(a.credits);
        let (done, finished) = mpsc::unbounded_channel();
        decoders(n, &self.metadata, digests(&self.metadata)?, cache.clone(), queued, decoded, done)?;
        let s = &self.series;
        let frame_bytes = (s.width * s.height * s.components) as usize * if s.bits > 8 { 2 } else { 1 };
        let view = Viewer { gpu, series: s.clone(), look: self.look, store: Store::new(a.budget), frame_bytes, want, notes: self.proxy.clone() };
        let (url, hash, asks) = (a.url.clone(), cert_hash(&a.cert_sha256)?, a.asks);
        let downloading = async move {
            let session = dial_bounded(&url, hash, &Windows::default(), 1).await?;
            download(session, wanted, jobs, finished, cache, asks).await
        };
        let viewing = view.run(inbox, frames);
        match a.paint_thread {
            PaintThread::Core => on_thread("core", async { tokio::try_join!(downloading, viewing).map(|_| ()) })?,
            _ => {
                on_thread("downloader", downloading)?;
                on_thread("view", viewing)?;
            }
        }
        self.view = Some(intents);
        Ok(())
    }
}

/// A thread running `work` on a runtime of its own; an error ends the process, as the UI paint thread's loader does.
fn on_thread(name: &str, work: impl Future<Output = Result<()>> + Send + 'static) -> Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    std::thread::Builder::new().name(name.into()).spawn(move || {
        if let Err(e) = runtime.block_on(work) {
            eprintln!("{e:#}");
            std::process::exit(1);
        }
    })?;
    Ok(())
}

/// The view thread: the controller (`look`), the frame store and the paint. It holds every frame it has.
struct Viewer {
    gpu: Gpu,
    series: Series,
    look: Look,
    store: Store,
    frame_bytes: usize,
    want: watch::Sender<Vec<u32>>,
    notes: EventLoopProxy<Note>,
}

impl Viewer {
    async fn run(mut self, mut inbox: mpsc::UnboundedReceiver<Intent>, mut frames: mpsc::Receiver<Decoded>) -> Result<()> {
        self.ask();
        loop {
            tokio::select! {
                intent = inbox.recv() => {
                    let Some(intent) = intent else { return Ok(()) };
                    count::intent();
                    if let Intent::Resize(width, height) = intent {
                        self.gpu.resize(width, height);
                    }
                    if self.look.apply(&intent, self.series.count) {
                        self.ask();
                        self.paint()?;
                    }
                }
                frame = frames.recv() => {
                    let Decoded { index, samples, exact, written } = frame.context("the decoders stopped")?;
                    count::hop(index);
                    match samples {
                        Ok(samples) if exact != Exact::False => {
                            self.store.put(index, samples, written, self.look.current as u32);
                            if index as usize == self.look.current {
                                self.paint()?;
                            }
                        }
                        Ok(_) => self.fail(format!("scope=frame frame={index} reason=\"exact=false\"")),
                        Err(reason) => self.fail(format!("scope=frame frame={index} reason={reason:?}")),
                    }
                }
            }
        }
    }

    /// The want replaced: the frames the budget holds around the current one, less those held.
    fn ask(&self) {
        let want = self.store.want(self.look.current as u32, self.series.count as u32, self.frame_bytes);
        self.want.send_if_modified(|old| *old != want && {
            *old = want;
            true
        });
    }

    fn paint(&mut self) -> Result<()> {
        let Some(pixels) = self.store.get(self.look.current as u32) else { return Ok(()) };
        self.gpu.paint(&self.series, &self.look, pixels)?;
        let _ = self.notes.send_event(Note::Shown(self.look.current as u32));
        Ok(())
    }

    fn fail(&self, reason: String) {
        let _ = self.notes.send_event(Note::Failed(reason));
    }
}

impl ApplicationHandler<Note> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gpu.is_some() || self.view.is_some() {
            return;
        }
        let opened = self.open(event_loop).and_then(|gpu| match self.args.paint_thread {
            PaintThread::Ui => {
                self.gpu = Some(gpu);
                Ok(())
            }
            _ => self.start(gpu),
        });
        if let Err(e) = opened {
            eprintln!("{e:#}");
            event_loop.exit();
        }
    }

    fn user_event(&mut self, _: &ActiveEventLoop, note: Note) {
        match note {
            Note::Frame(index, samples) => {
                count::hop(index);
                self.frames[index as usize] = Some(samples);
                if index as usize == self.look.current {
                    self.redraw();
                }
            }
            Note::Shown(index) => {
                count::note();
                if self.args.check.is_some() {
                    println!("shown frame={index}");
                }
            }
            Note::Failed(reason) => {
                count::note();
                println!("failed {reason}");
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => self.input(Intent::Resize(size.width, size.height)),
            WindowEvent::RedrawRequested if self.view.is_some() => self.input(Intent::Redraw),
            WindowEvent::RedrawRequested => {
                if let Err(e) = self.paint() {
                    eprintln!("{e:#}");
                    event_loop.exit();
                }
            }
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => match event.logical_key {
                Key::Named(NamedKey::ArrowRight | NamedKey::ArrowDown) => self.input(Intent::Step(1)),
                Key::Named(NamedKey::ArrowLeft | NamedKey::ArrowUp) => self.input(Intent::Step(-1)),
                Key::Character(c) if c.eq_ignore_ascii_case("f") => self.input(Intent::Fit),
                Key::Named(NamedKey::Escape) => event_loop.exit(),
                _ => {}
            },
            WindowEvent::MouseWheel { delta, .. } => {
                let y = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y as f64,
                    MouseScrollDelta::PixelDelta(p) => p.y,
                };
                self.input(Intent::Step(if y < 0.0 { 1 } else if y > 0.0 { -1 } else { 0 }));
            }
            WindowEvent::MouseInput { state, button: MouseButton::Left, .. } => self.held = state == ElementState::Pressed,
            WindowEvent::CursorMoved { position, .. } => {
                if let (true, Some((x, y))) = (self.held, self.cursor) {
                    self.input(Intent::Drag(position.x - x, position.y - y));
                }
                self.cursor = Some((position.x, position.y));
            }
            _ => {}
        }
    }
}

/// Fills the series and hands each frame on once decoded; a frame that is not exact is never painted.
/// With a cache, each frame's write and both fsyncs run before its hand-off, as the branches merged it.
async fn load(args: Args, metadata: String, count: usize, proxy: EventLoopProxy<Note>) -> Result<()> {
    let digests = digests(&metadata)?;
    let mut decoder = Decoder::new(&metadata)?;
    let cache = match &args.cache {
        Some(root) => {
            let cache = Cache::open(root, args.series.as_deref().unwrap_or_default(), args.version.as_deref().unwrap_or_default())?;
            Some(cache.slow_writes(Duration::from_millis(args.cache_write_delay_ms)))
        }
        None => None,
    };
    let mut session = dial(&args.url, cert_hash(&args.cert_sha256)?, &Windows::default()).await?;
    session.fill(0, count as u32 - 1).await?;
    for _ in 0..count {
        match session.next().await.context("the session ended with frames owed")?? {
            Event::Frame { index, body, .. } => {
                count::copy(index, decoder.copies());
                let checked = decoder.decode(&body).map(|s| (exact(&s, digests.as_ref().and_then(|d| d.get(index as usize).copied())), s));
                match checked {
                    Ok((Exact::False, _)) => println!("frame={index} exact=false"),
                    Ok((e, samples)) => {
                        println!("frame={index} exact={}", format!("{e:?}").to_lowercase());
                        if let Some(cache) = &cache {
                            cache.put(index, &body, &e)?;
                        }
                        proxy.send_event(Note::Frame(index, samples))?;
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
    let proxy = event_loop.create_proxy();
    let mut app = App {
        instance,
        frames: vec![None; series.count],
        series,
        look: Look { current: 0, center, width, fit: false },
        cursor: None,
        held: false,
        gpu: None,
        args: args.clone(),
        metadata: metadata.clone(),
        proxy: proxy.clone(),
        view: None,
    };
    let runtime = tokio::runtime::Runtime::new()?;
    if args.paint_thread == PaintThread::Ui {
        let count = app.series.count;
        runtime.spawn(async move {
            if let Err(e) = load(args, metadata, count, proxy).await {
                eprintln!("{e:#}");
                std::process::exit(1);
            }
        });
    }
    event_loop.run_app(&mut app)?;
    println!("{}", count::report());
    Ok(())
}
