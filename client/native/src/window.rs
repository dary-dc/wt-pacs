//! A minimal desktop window on the core: a series over `wt-pacs/1`, each frame decoded and checked, painted by `paint`.
//! The browser core's controls (`look.rs`), F toggles 1:1 and fitted, Escape closes; the title is the status line.
//! `docs/native/README.md` §4 and §Parity.
//! `--paint-thread` picks the thread that holds the frames and paints: §The view-worker design, native.

use anyhow::{bail, Context, Result};
use clap::{Parser, ValueEnum};
use native_client::cache::Cache;
use native_client::clock::{Busy, Cine, Play};
use native_client::count::{self, Sent};
use native_client::decode::Decoder;
use native_client::look::{Intent, Look, Status};
use native_client::paint::{Frame, Function, Painter, Photometric};
use native_client::resume::{Deadlines, ResumingSession};
use native_client::transport::{cert_hash, Windows};
use native_client::verify::{digests, exact, Exact};
use native_client::load::{load, Loaded};
use native_client::view::{decoders, download, Decoded, Store};
use serde_json::{json, Value};
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::keyboard::ModifiersState;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
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
    /// The lab's timer cine at this rate, from the window's opening, on the thread that paints.
    #[arg(long)]
    cine_hz: Option<f64>,
    /// The lab's busy-UI loop: the UI thread spins this long every `--busy-every-ms`, from the window's opening.
    #[arg(long, default_value_t = 0)]
    busy_ui_ms: u64,
    #[arg(long, default_value_t = 500)]
    busy_every_ms: u64,
    /// The lab's steps, one frame forward each, `--step-every-ms` apart from the window's opening.
    #[arg(long, default_value_t = 0)]
    steps: u32,
    #[arg(long, default_value_t = 1000)]
    step_every_ms: u64,
    #[arg(long, value_enum, default_value_t = StepsVia::Paint)]
    steps_via: StepsVia,
}

/// Where the lab's steps enter.
#[derive(Clone, Copy, PartialEq, ValueEnum, Debug)]
enum StepsVia {
    /// Straight to the thread that paints, from a thread of their own.
    Paint,
    /// Through the UI thread, as a user's input arrives.
    Ui,
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

/// What the UI thread is told: a frame (with the UI as paint thread), or the paint's events with the title they leave.
#[derive(Debug)]
enum Note {
    Frame(u32, Vec<u8>, Exact),
    Shown(u32, String),
    Failed(u32, String, Option<String>),
    Step,
}

fn stamp_step(stamp: bool) {
    if stamp {
        println!("step at_ms={:.3}", since_start());
    }
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
    frame_time: Duration,
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
        frame_time: Play::period(m["frameTimeMs"].as_f64(), m["cineRate"].as_f64()),
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
        let display = look.display(s.photometric, s.slope, s.intercept, s.function);
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
            let v = &look.view;
            let cell = json!({ "frame": look.current, "exact": exact, "center": look.center, "windowWidth": look.width, "fit": v.fit, "zoom": v.zoom,
                "panX": v.pan_x, "panY": v.pan_y, "rotate": v.rotate, "flipH": v.flip_h, "flipV": v.flip_v, "invert": look.invert,
                "width": width, "height": height, "dpr": dpr });
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

struct App {
    instance: wgpu::Instance,
    series: Series,
    frames: Vec<Option<Vec<u8>>>,
    look: Look,
    status: Status,
    cursor: Option<(f64, f64)>,
    /// Where a drag began, and whether it pans.
    grab: Option<(f64, f64, bool)>,
    modifiers: ModifiersState,
    gpu: Option<Gpu>,
    /// The window on every paint thread, for its title and its scale.
    window: Option<Arc<Window>>,
    args: Args,
    metadata: String,
    proxy: EventLoopProxy<Sent<Note>>,
    view: Option<mpsc::UnboundedSender<Sent<Intent>>>,
    busy: Option<Busy>,
    cine: Option<Cine>,
    play: Option<Play>,
}

/// Space: the product cine started from now, or stopped.
fn toggle(play: &mut Option<Play>, period: Duration) {
    *play = match play {
        Some(_) => None,
        None => Some(Play::new(period, Instant::now())),
    };
}

impl App {
    fn redraw(&self) {
        if let Some(gpu) = &self.gpu {
            gpu.window.request_redraw();
        }
    }

    fn step(&mut self, by: i64) {
        stamp_step(self.args.stamp_painted);
        self.input(Intent::Step(by));
    }

    /// On this thread when it paints; else sent to the thread that paints.
    fn input(&mut self, intent: Intent) {
        if let Some(view) = &self.view {
            let _ = view.send(Sent::now(intent));
            return;
        }
        if let (Intent::Resize(width, height), Some(gpu)) = (&intent, &mut self.gpu) {
            gpu.resize(*width, *height);
        }
        if let Intent::Cine = intent {
            toggle(&mut self.play, self.series.frame_time);
        }
        if self.look.apply(&intent, self.series.count) {
            self.redraw();
        }
        self.retitle(self.status.title(self.look.current));
    }

    fn retitle(&self, title: String) {
        if let Some(window) = self.window.as_ref().filter(|w| w.title() != title) {
            window.set_title(&title);
        }
    }

    /// False when the frame shown is not held.
    fn paint(&mut self) -> Result<bool> {
        let (Some(gpu), Some(Some(pixels))) = (&mut self.gpu, self.frames.get(self.look.current)) else { return Ok(false) };
        gpu.paint(&self.series, &self.look, pixels)?;
        Ok(true)
    }

    fn cine(&mut self) -> Result<()> {
        let Some((slot, frame, passed)) = self.cine.as_mut().and_then(|c| c.tick(Instant::now())) else { return Ok(()) };
        self.look.current = frame;
        let on_time = self.paint()? && self.cine.as_ref().is_some_and(|c| c.on_time(slot, Instant::now()));
        count::cine(u64::from(on_time), passed + u64::from(!on_time));
        Ok(())
    }

    /// The lab's clocks and steps, from the window's opening: the busy loop on this thread, the cine on the thread that
    /// paints, the steps from a thread of their own.
    fn lab(&mut self) -> Result<()> {
        let (a, now) = (&self.args, Instant::now());
        self.busy = (a.busy_ui_ms > 0).then(|| Busy::new(now, Duration::from_millis(a.busy_every_ms), Duration::from_millis(a.busy_ui_ms)));
        if self.view.is_none() {
            self.cine = a.cine_hz.map(|hz| Cine::new(hz, self.series.count, now));
        }
        if a.steps == 0 {
            return Ok(());
        }
        let step: Box<dyn Fn() + Send> = match (&self.view, a.steps_via) {
            (Some(view), StepsVia::Paint) => {
                let view = view.clone();
                Box::new(move || drop(view.send(Sent::now(Intent::Step(1)))))
            }
            _ => {
                let proxy = self.proxy.clone();
                Box::new(move || drop(proxy.send_event(Sent::now(Note::Step))))
            }
        };
        let (n, every, stamp) = (a.steps, Duration::from_millis(a.step_every_ms), a.stamp_painted);
        std::thread::Builder::new().name("steps".into()).spawn(move || {
            for _ in 0..n {
                std::thread::sleep(every);
                stamp_step(stamp);
                step();
            }
        })?;
        Ok(())
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
        let cine = a.cine_hz.map(|hz| Cine::new(hz, s.count, Instant::now()));
        let status = Status::new(s.count);
        let view = Viewer { gpu, series: s.clone(), look: self.look, store: Store::new(a.budget), frame_bytes, want, notes: self.proxy.clone(), cine, play: None, status };
        let (refused, refusals) = mpsc::unbounded_channel();
        let (url, hash, asks) = (a.url.clone(), cert_hash(&a.cert_sha256)?, a.asks);
        let downloading = async move {
            let session = ResumingSession::open(&url, hash, Windows::default(), 1, Deadlines::default()).await?;
            download(session, wanted, jobs, finished, cache, asks, move |index, reason| drop(refused.send((index, reason)))).await
        };
        let viewing = view.run(inbox, frames, refusals);
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
    notes: EventLoopProxy<Sent<Note>>,
    cine: Option<Cine>,
    play: Option<Play>,
    status: Status,
}

impl Viewer {
    async fn run(
        mut self,
        mut inbox: mpsc::UnboundedReceiver<Sent<Intent>>,
        mut frames: mpsc::Receiver<Sent<Decoded>>,
        mut refusals: mpsc::UnboundedReceiver<(u32, String)>,
    ) -> Result<()> {
        self.ask();
        loop {
            tokio::select! {
                intent = inbox.recv() => {
                    let Some(intent) = intent else { return Ok(()) };
                    let intent = intent.received("intent");
                    count::intent();
                    if let Intent::Resize(width, height) = intent {
                        self.gpu.resize(width, height);
                    }
                    if let Intent::Cine = intent {
                        toggle(&mut self.play, self.series.frame_time);
                    }
                    if self.look.apply(&intent, self.series.count) {
                        self.ask();
                        self.paint()?;
                    }
                }
                frame = frames.recv() => {
                    let Decoded { index, samples, exact, written } = frame.context("the decoders stopped")?.received("decoded");
                    count::hop(index);
                    match samples {
                        Ok(samples) if exact != Exact::False => {
                            self.status.held(index, exact);
                            self.store.put(index, samples, written, self.look.current as u32);
                            if index as usize == self.look.current {
                                self.paint()?;
                            }
                        }
                        Ok(_) => self.fail(index, "NOT EXACT".into()),
                        Err(reason) => self.fail(index, format!("NOT EXACT: {reason}")),
                    }
                }
                Some((index, reason)) = refusals.recv() => self.fail(index, reason),
                _ = tokio::time::sleep_until(self.cine.as_ref().map_or_else(Instant::now, Cine::next).into()), if self.cine.is_some() => self.cine()?,
                _ = tokio::time::sleep_until(self.play.as_ref().map_or_else(Instant::now, Play::next).into()), if self.play.is_some() => {
                    if self.play.as_mut().is_some_and(|p| p.tick(Instant::now()))
                        && self.look.apply(&Intent::To((self.look.current + 1) % self.series.count), self.series.count)
                    {
                        self.ask();
                        self.paint()?;
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

    /// False when the frame shown is not held.
    fn paint(&mut self) -> Result<bool> {
        let Some(pixels) = self.store.get(self.look.current as u32) else { return Ok(false) };
        self.gpu.paint(&self.series, &self.look, pixels)?;
        let title = self.status.title(self.look.current);
        let _ = self.notes.send_event(Sent::now(Note::Shown(self.look.current as u32, title)));
        Ok(true)
    }

    fn cine(&mut self) -> Result<()> {
        let Some((slot, frame, passed)) = self.cine.as_mut().and_then(|c| c.tick(Instant::now())) else { return Ok(()) };
        self.look.current = frame;
        self.ask();
        let on_time = self.paint()? && self.cine.as_ref().is_some_and(|c| c.on_time(slot, Instant::now()));
        count::cine(u64::from(on_time), passed + u64::from(!on_time));
        Ok(())
    }

    fn fail(&mut self, index: u32, reason: String) {
        self.status.failed(index, &reason);
        let title = self.status.title(self.look.current);
        let _ = self.notes.send_event(Sent::now(Note::Failed(index, reason, Some(title))));
    }
}

impl ApplicationHandler<Sent<Note>> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gpu.is_some() || self.view.is_some() {
            return;
        }
        let opened = self.open(event_loop).and_then(|gpu| {
            self.window = Some(gpu.window.clone());
            Ok(gpu)
        });
        let opened = opened.and_then(|gpu| match self.args.paint_thread {
            PaintThread::Ui => {
                self.gpu = Some(gpu);
                Ok(())
            }
            _ => self.start(gpu),
        });
        if let Err(e) = opened.and_then(|()| self.lab()) {
            eprintln!("{e:#}");
            event_loop.exit();
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if let Some(busy) = &mut self.busy {
            busy.run(Instant::now());
        }
        if self.play.as_mut().is_some_and(|p| p.tick(Instant::now())) {
            self.input(Intent::To((self.look.current + 1) % self.series.count));
        }
        if let Err(e) = self.cine() {
            eprintln!("{e:#}");
            event_loop.exit();
        }
        let next = [self.busy.as_ref().map(Busy::next), self.cine.as_ref().map(Cine::next), self.play.as_ref().map(Play::next)];
        let next = next.into_iter().flatten().min();
        event_loop.set_control_flow(next.map_or(ControlFlow::Wait, ControlFlow::WaitUntil));
    }

    fn user_event(&mut self, _: &ActiveEventLoop, note: Sent<Note>) {
        let hop = match *note {
            Note::Frame(..) => "frame",
            Note::Shown(..) => "shown",
            Note::Failed(..) => "failed",
            Note::Step => "step",
        };
        match note.received(hop) {
            Note::Frame(index, samples, exact) => {
                count::hop(index);
                self.frames[index as usize] = Some(samples);
                self.status.held(index, exact);
                if index as usize == self.look.current {
                    self.redraw();
                    self.retitle(self.status.title(self.look.current));
                }
            }
            Note::Shown(index, title) => {
                count::note();
                self.retitle(title);
                if self.args.check.is_some() {
                    println!("shown frame={index}");
                }
            }
            Note::Failed(index, reason, title) => {
                count::note();
                println!("failed scope=frame frame={index} reason={reason:?}");
                if title.is_none() {
                    self.status.failed(index, &reason);
                }
                self.retitle(title.unwrap_or_else(|| self.status.title(self.look.current)));
            }
            Note::Step => self.input(Intent::Step(1)),
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        let last = self.series.count.saturating_sub(1);
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
            WindowEvent::ModifiersChanged(m) => self.modifiers = m.state(),
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => match event.logical_key {
                Key::Named(NamedKey::ArrowRight | NamedKey::ArrowDown | NamedKey::PageDown) => self.step(1),
                Key::Named(NamedKey::ArrowLeft | NamedKey::ArrowUp | NamedKey::PageUp) => self.step(-1),
                Key::Named(NamedKey::Home) => self.input(Intent::To(0)),
                Key::Named(NamedKey::End) => self.input(Intent::To(last)),
                Key::Named(NamedKey::Escape) => event_loop.exit(),
                Key::Named(NamedKey::Space) => self.input(Intent::Cine),
                Key::Character(c) => match c.to_lowercase().as_str() {
                    "+" | "=" => self.input(Intent::Zoom(1.25)),
                    "-" => self.input(Intent::Zoom(0.8)),
                    "r" => self.input(Intent::Rotate),
                    "h" => self.input(Intent::FlipH),
                    "v" => self.input(Intent::FlipV),
                    "i" => self.input(Intent::Invert),
                    "f" => self.input(Intent::Fit),
                    "0" => self.input(Intent::Reset),
                    _ => {}
                },
                _ => {}
            },
            WindowEvent::MouseWheel { delta, .. } => {
                let y = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y as f64,
                    MouseScrollDelta::PixelDelta(p) => p.y,
                };
                if self.modifiers.control_key() {
                    self.input(Intent::Zoom(if y > 0.0 { 1.1 } else { 1.0 / 1.1 }));
                } else {
                    self.step(if y < 0.0 { 1 } else if y > 0.0 { -1 } else { 0 });
                }
            }
            WindowEvent::MouseInput { state: ElementState::Pressed, button: button @ (MouseButton::Left | MouseButton::Right), .. } => {
                if let Some((x, y)) = self.cursor {
                    self.grab = Some((x, y, button == MouseButton::Right || self.modifiers.shift_key()));
                    self.input(Intent::Grab);
                }
            }
            WindowEvent::MouseInput { state: ElementState::Released, .. } => self.grab = None,
            WindowEvent::CursorMoved { position, .. } => {
                if let (Some((x, y, pan)), Some(window)) = (self.grab, &self.window) {
                    let css = window.scale_factor();
                    self.input(Intent::Drag { dx: (position.x - x) / css, dy: (position.y - y) / css, pan });
                }
                self.cursor = Some((position.x, position.y));
            }
            _ => {}
        }
    }
}

async fn load_ui(args: Args, metadata: String, count: usize, proxy: EventLoopProxy<Sent<Note>>) -> Result<()> {
    let cache = match &args.cache {
        Some(root) => {
            let cache = Cache::open(root, args.series.as_deref().unwrap_or_default(), args.version.as_deref().unwrap_or_default())?;
            Some(cache.slow_writes(Duration::from_millis(args.cache_write_delay_ms)))
        }
        None => None,
    };
    let held = tokio::sync::Semaphore::MAX_PERMITS;
    let session = ResumingSession::open(&args.url, cert_hash(&args.cert_sha256)?, Windows::default(), held, Deadlines::default()).await?;
    let hand = |loaded| {
        let note = match loaded {
            Loaded::Frame { index, samples, exact } => Note::Frame(index, samples, exact),
            Loaded::Failed { index, reason } => Note::Failed(index, reason, None),
        };
        Ok(proxy.send_event(Sent::now(note))?)
    };
    load(session, Decoder::new(&metadata)?, digests(&metadata)?, count as u32, cache, args.asks, hand).await
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
        status: Status::new(series.count),
        series,
        look: Look::new(center, width),
        cursor: None,
        grab: None,
        modifiers: ModifiersState::empty(),
        gpu: None,
        window: None,
        args: args.clone(),
        metadata: metadata.clone(),
        proxy: proxy.clone(),
        view: None,
        busy: None,
        cine: None,
        play: None,
    };
    let runtime = tokio::runtime::Runtime::new()?;
    if args.paint_thread == PaintThread::Ui {
        let count = app.series.count;
        runtime.spawn(async move {
            if let Err(e) = load_ui(args, metadata, count, proxy).await {
                eprintln!("{e:#}");
                std::process::exit(1);
            }
        });
    }
    event_loop.run_app(&mut app)?;
    println!("{}", count::report());
    Ok(())
}
