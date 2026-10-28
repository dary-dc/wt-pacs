//! Opens a session over raw QUIC, receives the frames asked, and checks each against the bundle.
//! Timing is printed, not claimed. `docs/native/README.md` §8.4.

use anyhow::{bail, Context, Result};
use clap::Parser;
use native_client::transport::{dial, Event, Windows, ALPN};
use native_client::verify::digests;
use std::os::unix::fs::FileExt;
use std::path::PathBuf;
use std::time::Instant;

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
    #[arg(long, default_value_t = Windows::default().stream)]
    stream_window: u64,
    #[arg(long, default_value_t = Windows::default().connection)]
    connection_window: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let hash = (0..32)
        .map(|i| args.cert_sha256.get(2 * i..2 * i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect::<Option<Vec<u8>>>()
        .and_then(|h| h.try_into().ok())
        .context("--cert-sha256 is not 64 hex digits")?;
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
    let windows = Windows { stream: args.stream_window, connection: args.connection_window };
    println!(
        "native-fill url={} alpn={} stream_window={} connection_window={} frames={} digests={}",
        args.url,
        String::from_utf8_lossy(ALPN),
        windows.stream,
        windows.connection,
        owed.len(),
        digests.map_or("none".into(), |d| format!("{} (unchecked: no decode in this build)", d.len())),
    );

    let mut session = dial(&args.url, hash, &windows).await?;
    let start = Instant::now();
    match fill {
        Some((from, to)) => session.fill(from, to).await?,
        None => {
            for &frame in &args.ask {
                session.ask(frame).await?;
            }
        }
    }
    let (mut bytes, mut failed) = (0, 0);
    while !owed.is_empty() {
        match session.next().await.context("the session ended with frames owed")?? {
            Event::Frame { index, body, at } => {
                let entry = layout.index.get(index as usize).context("a frame outside the bundle")?;
                let mut want = vec![0; entry.1 as usize];
                bundle.read_exact_at(&mut want, entry.0)?;
                let identical = *body == want;
                let asked = owed.iter().position(|&f| f == index).map(|i| owed.swap_remove(i)).is_some();
                failed += usize::from(!identical || !asked);
                bytes += body.len();
                let ms = (at - start).as_secs_f64() * 1e3;
                println!("frame={index} bytes={} last_byte_ms={ms:.3} identical={identical} exact=unchecked", body.len());
            }
            Event::Refused { frame, reason } => {
                owed.retain(|&f| f != frame);
                failed += 1;
                println!("frame={frame} refused={reason:?}");
            }
        }
    }
    println!("total bytes={bytes} ms={:.3} failed={failed}", start.elapsed().as_secs_f64() * 1e3);
    session.close();
    if failed > 0 {
        bail!("{failed} frames failed");
    }
    Ok(())
}
