//! Opens a session over raw QUIC, receives the frames asked, and checks each against the bundle.
//! Timing is printed, not claimed. `docs/native/README.md` §8.4.

use anyhow::{bail, ensure, Context, Result};
use bytes::Bytes;
use clap::Parser;
use native_client::cache::Cache;
use native_client::transport::{cert_hash, dial, Event, Windows, ALPN};
use native_client::verify::{digests, Exact};
use std::os::unix::fs::FileExt;
use std::path::PathBuf;
use std::time::Instant;

#[cfg(feature = "paint")]
mod screen;

#[derive(Parser)]
#[command(name = "native-fill")]
struct Args {
    /// The server's `wt_url=`.
    #[arg(long)]
    url: String,
    /// The server's `cert_sha256=`, 64 hex digits.
    #[arg(long)]
    cert_sha256: String,
    /// The series bundle the server serves; each frame received is compared with its entry.
    #[arg(long)]
    bundle: PathBuf,
    /// A fill, `A-B`, both inclusive.
    #[arg(long, conflicts_with = "ask", required_unless_present = "ask")]
    fill: Option<String>,
    /// Asks, `N,…`, sent at once.
    #[arg(long, value_delimiter = ',')]
    ask: Vec<u32>,
    /// The asks one at a time: each sent once the last is checked, and painted with `--paint`.
    #[arg(long, requires = "ask")]
    in_turn: bool,
    /// `WxH` device pixels: paints a fill's first frame, or every ask in turn, as the viewer shows it.
    #[cfg(feature = "paint")]
    #[arg(long)]
    paint: Option<String>,
    #[arg(long, default_value_t = Windows::default().stream)]
    stream_window: u64,
    #[arg(long, default_value_t = Windows::default().connection)]
    connection_window: u64,
    /// Frames are read from this cache first, re-checked, and every frame fetched `true` is written to it.
    #[arg(long, requires_all = ["series", "version"])]
    cache: Option<PathBuf>,
    /// The cache's key beside the frame's index: the series, and its metadata's version.
    #[arg(long)]
    series: Option<String>,
    #[arg(long)]
    version: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let hash = cert_hash(&args.cert_sha256)?;
    let bundle = std::fs::File::open(&args.bundle).with_context(|| format!("open {}", args.bundle.display()))?;
    let layout = series_bundle::read_layout(&bundle)?;
    let digests = digests(&layout.metadata)?;
    let fill = match &args.fill {
        Some(range) => {
            let (from, to) = range.split_once('-').context("--fill is A-B")?;
            Some((from.parse()?, to.parse()?))
        }
        None => None,
    };
    let mut owed: Vec<u32> = match fill {
        Some((from, to)) => (from..=to).collect(),
        None => args.ask.clone(),
    };
    ensure!(cfg!(feature = "decode") || args.cache.is_none(), "--cache needs the decode feature to check what it holds");
    let cache = match &args.cache {
        Some(root) => Some(Cache::open(root, args.series.as_deref().unwrap_or_default(), args.version.as_deref().unwrap_or_default())?),
        None => None,
    };
    let windows = Windows { stream: args.stream_window, connection: args.connection_window };
    #[cfg(feature = "paint")]
    let screen = match &args.paint {
        Some(size) => {
            let (w, h) = size.split_once('x').context("--paint is WxH")?;
            Some(screen::Screen::open(&layout.metadata, w.parse()?, h.parse()?)?)
        }
        None => None,
    };
    #[cfg(feature = "paint")]
    let painter = screen.as_ref().map_or("none".into(), |s| format!("{} at {}", s.renderer, args.paint.as_deref().unwrap_or("")));
    #[cfg(not(feature = "paint"))]
    let painter = "none (built without the paint feature)";
    println!(
        "native-fill url={} alpn={} stream_window={} connection_window={} frames={} digests={} decode={} in_turn={} paint={} cache={}",
        args.url,
        String::from_utf8_lossy(ALPN),
        windows.stream,
        windows.connection,
        owed.len(),
        digests.as_ref().map_or("none".into(), |d| d.len().to_string()),
        decoders(),
        args.in_turn,
        painter,
        args.cache.as_ref().map_or("none".into(), |c| c.display().to_string()),
    );

    #[cfg(feature = "decode")]
    let mut decoder = native_client::decode::Decoder::new(&layout.metadata)?;
    #[cfg(not(feature = "decode"))]
    let mut decoder = ();
    let digest = |index: u32| digests.as_ref().and_then(|d| d.get(index as usize).copied());
    let dialed = Instant::now();
    let mut frames: Vec<(u32, Bytes, Instant, &str, String, Exact, Vec<u8>)> = Vec::new();
    if let Some(cache) = &cache {
        for &index in &owed {
            let hit = cache.get(index, |coded| {
                let (checked, exact, samples) = check(&mut decoder, coded, digest(index));
                (exact == Exact::True).then(|| (index, coded.to_vec().into(), Instant::now(), "cache", checked, exact, samples))
            })?;
            frames.extend(hit);
        }
    }
    let missing: Vec<u32> = owed.iter().copied().filter(|f| !frames.iter().any(|hit| hit.0 == *f)).collect();
    let mut turns = missing.clone().into_iter();
    let mut session = None;
    let mut start = dialed;
    if !missing.is_empty() {
        let session = session.insert(dial(&args.url, hash, &windows).await?);
        start = Instant::now();
        match fill {
            Some((from, to)) if missing.len() == owed.len() => session.fill(from, to).await?,
            _ if args.in_turn => session.ask(turns.next().context("no ask")?).await?,
            _ => {
                for &frame in &missing {
                    session.ask(frame).await?;
                }
            }
        }
    }
    let mut asked = start;
    let shown = fill.map(|(from, _)| from);
    let (mut bytes, mut failed, mut last) = (0, 0, start);
    while !owed.is_empty() {
        let (index, body, at, source, checked, exact, samples) = match frames.pop() {
            Some(hit) => hit,
            None => match session.as_mut().context("frames owed and no session")?.next().await.context("the session ended with frames owed")?? {
                Event::Frame { index, body, at } => {
                    let (checked, exact, samples) = check(&mut decoder, &body, digest(index));
                    if let Some(cache) = &cache {
                        cache.put(index, &body, &exact)?;
                    }
                    (index, body, at, "server", checked, exact, samples)
                }
                Event::Refused { frame, reason } => {
                    owed.retain(|&f| f != frame);
                    failed += 1;
                    println!("frame={frame} refused={reason:?}");
                    continue;
                }
            },
        };
        let entry = layout.index.get(index as usize).context("a frame outside the bundle")?;
        let mut want = vec![0; entry.1 as usize];
        bundle.read_exact_at(&mut want, entry.0)?;
        let identical = *body == want;
        let was_owed = owed.iter().position(|&f| f == index).map(|i| owed.swap_remove(i)).is_some();
        last = Instant::now();
        failed += usize::from(!identical || !was_owed || exact == Exact::False);
        bytes += body.len();
        let ms = (at - start).as_secs_f64() * 1e3;
        let mut row = format!("frame={index} bytes={} last_byte_ms={ms:.3} source={source} identical={identical} {checked}", body.len());
        if args.in_turn {
            row += &format!(" ask_ms={:.3}", (last - asked).as_secs_f64() * 1e3);
        }
        #[cfg(feature = "paint")]
        if let Some(screen) = screen.as_ref().filter(|_| exact == Exact::True && (args.in_turn || shown == Some(index))) {
            screen.paint(samples)?;
            if args.in_turn {
                row += &format!(" painted_ms={:.3}", (screen.painted()? - asked).as_secs_f64() * 1e3);
            }
        }
        #[cfg(not(feature = "paint"))]
        let _ = (samples, shown);
        println!("{row}");
        if let (Some(session), Some(next)) = (session.as_mut().filter(|_| args.in_turn && source == "server"), turns.next()) {
            asked = Instant::now();
            session.ask(next).await?;
        }
    }
    let ms = |t: Instant| (t - start).as_secs_f64() * 1e3;
    #[cfg(feature = "paint")]
    if let Some(screen) = screen.as_ref().filter(|_| !args.in_turn && failed == 0) {
        println!("shown frame={} painted_from_dial_ms={:.3}", shown.unwrap_or(0), (screen.painted()? - dialed).as_secs_f64() * 1e3);
    }
    println!(
        "total bytes={bytes} ms={:.3} dial_ms={:.3} from_dial_ms={:.3} failed={failed}",
        ms(last),
        (start - dialed).as_secs_f64() * 1e3,
        (last - dialed).as_secs_f64() * 1e3
    );
    session.iter().for_each(|s| s.close());
    if failed > 0 {
        bail!("{failed} frames failed");
    }
    Ok(())
}

#[cfg(feature = "decode")]
fn decoders() -> String {
    format!("{} dav1d_threads=auto", native_client::decode::versions())
}

#[cfg(not(feature = "decode"))]
fn decoders() -> String {
    "none (built without the decode feature)".into()
}

#[cfg(not(feature = "decode"))]
fn check(_: &mut (), _: &[u8], _: Option<u64>) -> (String, Exact, Vec<u8>) {
    ("exact=unchecked".into(), Exact::Unchecked, Vec::new())
}

/// The decode timed alone, then its samples against the frame's digest; a frame that does not decode is `false`.
#[cfg(feature = "decode")]
fn check(decoder: &mut native_client::decode::Decoder, body: &[u8], digest: Option<u64>) -> (String, Exact, Vec<u8>) {
    let start = Instant::now();
    match decoder.decode(body) {
        Ok(samples) => {
            let ms = start.elapsed().as_secs_f64() * 1e3;
            let exact = native_client::verify::exact(&samples, digest);
            (format!("decode_ms={ms:.3} exact={}", format!("{exact:?}").to_lowercase()), exact, samples)
        }
        Err(err) => (format!("exact=false reason={err:#}"), Exact::False, Vec::new()),
    }
}
