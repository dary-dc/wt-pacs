//! Telemetry pipeline microbench — lab scaffolding, no network, no product crate.
//!
//! Two questions, answered with numbers instead of arguments:
//!
//! 1. `emit` — what does one row cost on the emitting thread, per seam design, as
//!    producers (sessions) grow, and does the drain keep up?
//! 2. `report` — what does the drain cost in memory and shutdown time, per drain
//!    shape, as rows grow?
//!
//! Seams mirror `server/src/record/tap.rs` (`global-lock`) and the proposed per-session
//! designs (`own-sender`, `own-batch`). Drain shapes mirror today's in-memory report
//! (`current`) and the proposed streaming design (`streaming`). Rows share one fixed
//! layout so the arms differ only in the thing being measured.
//!
//! See docs/server-telemetry-and-architecture-analysis-2026-09.md.

use clap::{Parser, Subcommand, ValueEnum};
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::PathBuf;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Barrier, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Parser)]
#[command(name = "telemetry-bench")]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Producer-side cost per row under contention, and drain keep-up.
    Emit {
        #[arg(long, value_enum)]
        seam: Seam,
        #[arg(long, value_enum, default_value_t = Sink::Count)]
        sink: Sink,
        #[arg(long, default_value_t = 1)]
        producers: usize,
        #[arg(long, default_value_t = 1_000_000)]
        emits_per_producer: u64,
        /// Rows per second per producer. 0 = as fast as possible.
        #[arg(long, default_value_t = 0)]
        rate_per_producer: u64,
        /// Ring capacity in rows (batch seam: ring_rows / batch batches).
        #[arg(long, default_value_t = 4096)]
        ring_rows: usize,
        #[arg(long, default_value_t = 64)]
        batch: usize,
        /// Scratch dir for file sinks.
        #[arg(long)]
        scratch: Option<PathBuf>,
    },
    /// Drain-side memory and shutdown cost as rows grow.
    Report {
        #[arg(long, value_enum)]
        shape: Shape,
        #[arg(long, default_value_t = 1_000_000)]
        rows: u64,
        #[arg(long)]
        out_dir: PathBuf,
        /// Streaming only: sort the row file afterwards for exact percentiles and compare.
        #[arg(long, default_value_t = false)]
        offline_exact: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Seam {
    /// Today: one process-wide `Mutex<Option<SyncSender>>`, locked on every row.
    GlobalLock,
    /// Each producer owns a `SyncSender` clone; one channel op per row.
    OwnSender,
    /// Each producer owns a sender and a local batch; one channel op per `batch` rows.
    OwnBatch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Sink {
    /// Drain counts rows (isolates the producer cost).
    Count,
    /// Drain writes one compact JSON object per row to a file.
    JsonFile,
    /// Drain writes the fixed-width row to a file.
    BinaryFile,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Shape {
    /// Today: every row kept in memory as a JSON-ready struct, sorted and pretty-printed at exit.
    Current,
    /// Proposed: fixed-width rows streamed to a file, log-linear histograms for the summary.
    Streaming,
}

/// Same width and field mix as `FrameRecord` in `server/src/record/tap.rs`.
#[derive(Clone, Copy, Debug, Default)]
#[repr(C)]
struct Row {
    session_id: u64,
    frame_index: u32,
    ask_ordinal: u32,
    locate_us: u32,
    serve_us: u32,
    send_us: u32,
    bytes: u32,
    locate_outcome: u8,
    write_outcome: u8,
    dropped_since_last: u16,
}

const ROW_BYTES: usize = 36;

impl Row {
    fn to_bytes(self) -> [u8; ROW_BYTES] {
        let mut b = [0u8; ROW_BYTES];
        b[0..8].copy_from_slice(&self.session_id.to_le_bytes());
        b[8..12].copy_from_slice(&self.frame_index.to_le_bytes());
        b[12..16].copy_from_slice(&self.ask_ordinal.to_le_bytes());
        b[16..20].copy_from_slice(&self.locate_us.to_le_bytes());
        b[20..24].copy_from_slice(&self.serve_us.to_le_bytes());
        b[24..28].copy_from_slice(&self.send_us.to_le_bytes());
        b[28..32].copy_from_slice(&self.bytes.to_le_bytes());
        b[32] = self.locate_outcome;
        b[33] = self.write_outcome;
        b[34..36].copy_from_slice(&self.dropped_since_last.to_le_bytes());
        b
    }

    fn from_bytes(b: &[u8; ROW_BYTES]) -> Self {
        Self {
            session_id: u64::from_le_bytes(b[0..8].try_into().unwrap()),
            frame_index: u32::from_le_bytes(b[8..12].try_into().unwrap()),
            ask_ordinal: u32::from_le_bytes(b[12..16].try_into().unwrap()),
            locate_us: u32::from_le_bytes(b[16..20].try_into().unwrap()),
            serve_us: u32::from_le_bytes(b[20..24].try_into().unwrap()),
            send_us: u32::from_le_bytes(b[24..28].try_into().unwrap()),
            bytes: u32::from_le_bytes(b[28..32].try_into().unwrap()),
            locate_outcome: b[32],
            write_outcome: b[33],
            dropped_since_last: u16::from_le_bytes(b[34..36].try_into().unwrap()),
        }
    }
}

/// Mirror of today's `FrameRecordJson` so the `current` shape pays the same per-row memory.
#[derive(Serialize)]
struct RowJson {
    kind: &'static str,
    session_id: u64,
    frame_index: u32,
    ask_ordinal: u32,
    server_work_us: u32,
    server_write_us: u32,
    server_serve_us: u32,
    server_bytes_sent: u32,
    locate_outcome: u8,
    write_outcome: u8,
    dropped_since_last: u16,
}

impl From<Row> for RowJson {
    fn from(r: Row) -> Self {
        Self {
            kind: "server_frame",
            session_id: r.session_id,
            frame_index: r.frame_index,
            ask_ordinal: r.ask_ordinal,
            server_work_us: r.locate_us,
            server_write_us: r.send_us,
            server_serve_us: r.serve_us,
            server_bytes_sent: r.bytes,
            locate_outcome: r.locate_outcome,
            write_outcome: r.write_outcome,
            dropped_since_last: r.dropped_since_last,
        }
    }
}

// ───────────────────────── synthetic rows ─────────────────────────

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    /// Heavy-tailed microsecond duration: mostly 50–450 µs, 1 % tail up to ~20 ms.
    fn duration_us(&mut self, base: u32) -> u32 {
        let r = self.next();
        let mut v = base + (r % 400) as u32;
        if r.is_multiple_of(100) {
            v = v.saturating_mul(40);
        }
        v
    }
    fn row(&mut self, session_id: u64, i: u64) -> Row {
        Row {
            session_id,
            frame_index: (i % 5000) as u32,
            ask_ordinal: (i / 5000) as u32,
            locate_us: self.duration_us(1),
            serve_us: self.duration_us(50),
            send_us: self.duration_us(100),
            bytes: 250_000 + (self.next() % 50_000) as u32,
            locate_outcome: 0,
            write_outcome: 0,
            dropped_since_last: 0,
        }
    }
}

// ───────────────────────── emit bench ─────────────────────────

static GLOBAL: OnceLock<Mutex<Option<SyncSender<Row>>>> = OnceLock::new();

#[inline(never)]
fn emit_global(row: Row) -> u64 {
    if let Ok(g) = GLOBAL.get().expect("global sink").lock() {
        if let Some(tx) = g.as_ref() {
            return match tx.try_send(row) {
                Ok(()) => 0,
                Err(_) => 1,
            };
        }
    }
    1
}

#[inline(never)]
fn emit_own(tx: &SyncSender<Row>, row: Row) -> u64 {
    match tx.try_send(row) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

#[inline(never)]
fn emit_batch(tx: &SyncSender<Vec<Row>>, buf: &mut Vec<Row>, batch: usize, row: Row) -> u64 {
    buf.push(row);
    if buf.len() < batch {
        return 0;
    }
    let full = std::mem::replace(buf, Vec::with_capacity(batch));
    match tx.try_send(full) {
        Ok(()) => 0,
        Err(TrySendError::Full(v)) | Err(TrySendError::Disconnected(v)) => v.len() as u64,
    }
}

enum Handles {
    Rows(SyncSender<Row>),
    Batches(SyncSender<Vec<Row>>),
}

struct ProducerStats {
    emits: u64,
    drops: u64,
    /// Busy: loop wall time. Paced: sum of per-emit call durations.
    cost_ns: u64,
}

fn run_producer(
    seam: Seam,
    handles: Handles,
    session_id: u64,
    emits: u64,
    rate: u64,
    batch: usize,
    start: Arc<Barrier>,
) -> ProducerStats {
    let mut rng = Rng::new(0x9E37_79B9_7F4A_7C15 ^ session_id);
    let mut drops = 0u64;
    let mut cost_ns = 0u64;
    let mut buf: Vec<Row> = Vec::with_capacity(batch);
    start.wait();
    let paced = rate > 0;
    let interval = if paced {
        Duration::from_nanos(1_000_000_000 / rate)
    } else {
        Duration::ZERO
    };
    let t0 = Instant::now();
    let mut next_at = t0;
    for i in 0..emits {
        let row = rng.row(session_id, i);
        if paced {
            let now = Instant::now();
            if next_at > now {
                thread::sleep(next_at - now);
            }
            next_at += interval;
        }
        let t = if paced { Some(Instant::now()) } else { None };
        drops += match (&handles, seam) {
            (_, Seam::GlobalLock) => emit_global(row),
            (Handles::Rows(tx), Seam::OwnSender) => emit_own(tx, row),
            (Handles::Batches(tx), Seam::OwnBatch) => emit_batch(tx, &mut buf, batch, row),
            _ => unreachable!("seam/handle mismatch"),
        };
        if let Some(t) = t {
            cost_ns += t.elapsed().as_nanos() as u64;
        }
    }
    if let (Handles::Batches(tx), false) = (&handles, buf.is_empty()) {
        let rest = std::mem::take(&mut buf);
        if let Err(TrySendError::Full(v)) | Err(TrySendError::Disconnected(v)) = tx.try_send(rest) {
            drops += v.len() as u64;
        }
    }
    if !paced {
        cost_ns = t0.elapsed().as_nanos() as u64;
    }
    ProducerStats {
        emits,
        drops,
        cost_ns,
    }
}

enum SinkState {
    Count,
    Json(BufWriter<File>),
    Binary(BufWriter<File>),
}

impl SinkState {
    fn open(sink: Sink, scratch: &Option<PathBuf>) -> anyhow::Result<Self> {
        Ok(match sink {
            Sink::Count => Self::Count,
            Sink::JsonFile | Sink::BinaryFile => {
                let dir = scratch.clone().unwrap_or_else(std::env::temp_dir);
                std::fs::create_dir_all(&dir)?;
                let path = dir.join(format!(
                    "telemetry-bench-sink-{}.{}",
                    std::process::id(),
                    if sink == Sink::JsonFile {
                        "ndjson"
                    } else {
                        "rows"
                    }
                ));
                let f = BufWriter::with_capacity(1 << 20, File::create(&path)?);
                if sink == Sink::JsonFile {
                    Self::Json(f)
                } else {
                    Self::Binary(f)
                }
            }
        })
    }

    fn consume(&mut self, row: &Row) {
        match self {
            Self::Count => {}
            Self::Json(w) => {
                let _ = serde_json::to_writer(&mut *w, &RowJson::from(*row));
                let _ = w.write_all(b"\n");
            }
            Self::Binary(w) => {
                let _ = w.write_all(&row.to_bytes());
            }
        }
    }

    fn finish(self) -> u64 {
        match self {
            Self::Count => 0,
            Self::Json(mut w) | Self::Binary(mut w) => {
                let _ = w.flush();
                let bytes = w.get_ref().metadata().map(|m| m.len()).unwrap_or(0);
                bytes
            }
        }
    }
}

#[derive(Serialize)]
struct EmitResult {
    bench: &'static str,
    seam: Seam,
    sink: Sink,
    producers: usize,
    rate_per_producer: u64,
    ring_rows: usize,
    batch: usize,
    row_bytes: usize,
    emits: u64,
    drops: u64,
    drop_pct: f64,
    drained: u64,
    wall_ms: f64,
    /// Mean cost of one emit as seen by the emitting thread.
    producer_ns_per_emit: f64,
    offered_rows_per_s: f64,
    drained_rows_per_s: f64,
    sink_file_bytes: u64,
    cpus: usize,
}

#[allow(clippy::too_many_arguments)]
fn bench_emit(
    seam: Seam,
    sink: Sink,
    producers: usize,
    emits_per_producer: u64,
    rate: u64,
    ring_rows: usize,
    batch: usize,
    scratch: Option<PathBuf>,
) -> anyhow::Result<EmitResult> {
    let mut sink_state = SinkState::open(sink, &scratch)?;
    let drained = Arc::new(Mutex::new(0u64));
    let start = Arc::new(Barrier::new(producers + 1));

    let (drain, handles_for): (thread::JoinHandle<u64>, Vec<Handles>) = match seam {
        Seam::GlobalLock | Seam::OwnSender => {
            let (tx, rx): (SyncSender<Row>, Receiver<Row>) = sync_channel(ring_rows);
            if seam == Seam::GlobalLock && GLOBAL.set(Mutex::new(Some(tx.clone()))).is_err() {
                panic!("global set once");
            }
            let handles = (0..producers).map(|_| Handles::Rows(tx.clone())).collect();
            drop(tx);
            let d = thread::spawn(move || {
                let mut n = 0u64;
                while let Ok(row) = rx.recv() {
                    sink_state.consume(&row);
                    n += 1;
                }
                let _ = sink_state.finish();
                n
            });
            (d, handles)
        }
        Seam::OwnBatch => {
            let (tx, rx): (SyncSender<Vec<Row>>, Receiver<Vec<Row>>) =
                sync_channel((ring_rows / batch).max(1));
            let handles = (0..producers)
                .map(|_| Handles::Batches(tx.clone()))
                .collect();
            drop(tx);
            let d = thread::spawn(move || {
                let mut n = 0u64;
                while let Ok(rows) = rx.recv() {
                    for row in &rows {
                        sink_state.consume(row);
                    }
                    n += rows.len() as u64;
                }
                let _ = sink_state.finish();
                n
            });
            (d, handles)
        }
    };

    let mut workers = Vec::with_capacity(producers);
    for (i, h) in handles_for.into_iter().enumerate() {
        let start = Arc::clone(&start);
        workers.push(thread::spawn(move || {
            run_producer(
                seam,
                h,
                i as u64 + 1,
                emits_per_producer,
                rate,
                batch,
                start,
            )
        }));
    }
    start.wait();
    let t0 = Instant::now();
    let mut emits = 0u64;
    let mut drops = 0u64;
    let mut cost_ns = 0u64;
    for w in workers {
        let s = w.join().expect("producer thread");
        emits += s.emits;
        drops += s.drops;
        cost_ns += s.cost_ns;
    }
    if seam == Seam::GlobalLock {
        // Today's shutdown: drop the global sender so the drain sees disconnect.
        if let Some(m) = GLOBAL.get() {
            if let Ok(mut g) = m.lock() {
                *g = None;
            }
        }
    }
    let drained_n = drain.join().expect("drain thread");
    let wall = t0.elapsed();
    *drained.lock().unwrap() = drained_n;

    let sink_file_bytes = 0; // reported by finish() inside the drain; file removed below
    if let Some(dir) = &scratch {
        let _ = std::fs::remove_file(dir.join(format!(
            "telemetry-bench-sink-{}.ndjson",
            std::process::id()
        )));
        let _ = std::fs::remove_file(
            dir.join(format!("telemetry-bench-sink-{}.rows", std::process::id())),
        );
    }

    Ok(EmitResult {
        bench: "emit",
        seam,
        sink,
        producers,
        rate_per_producer: rate,
        ring_rows,
        batch,
        row_bytes: ROW_BYTES,
        emits,
        drops,
        drop_pct: round2(100.0 * drops as f64 / emits.max(1) as f64),
        drained: drained_n,
        wall_ms: round2(wall.as_secs_f64() * 1000.0),
        producer_ns_per_emit: round2(cost_ns as f64 / emits.max(1) as f64),
        offered_rows_per_s: round2(emits as f64 / wall.as_secs_f64()),
        drained_rows_per_s: round2(drained_n as f64 / wall.as_secs_f64()),
        sink_file_bytes,
        cpus: thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(0),
    })
}

// ───────────────────────── report bench ─────────────────────────

#[derive(Serialize, Clone, Copy)]
struct Dist {
    count: u64,
    mean: f64,
    min: u32,
    max: u32,
    total: u64,
    p50: f64,
    p75: f64,
    p90: f64,
    p95: f64,
    p99: f64,
}

/// Nearest-rank, identical to `server/src/record/tap.rs`.
fn percentile(sorted: &[u32], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let n = sorted.len();
    let rank = ((p / 100.0) * n as f64).ceil() as usize;
    let rank = rank.clamp(1, n);
    f64::from(sorted[rank - 1])
}

fn dist_exact(values: &[u32]) -> Dist {
    if values.is_empty() {
        return Dist {
            count: 0,
            mean: 0.0,
            min: 0,
            max: 0,
            total: 0,
            p50: 0.0,
            p75: 0.0,
            p90: 0.0,
            p95: 0.0,
            p99: 0.0,
        };
    }
    // Same as today: copy, then sort.
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let total: u64 = sorted.iter().map(|&v| u64::from(v)).sum();
    Dist {
        count: sorted.len() as u64,
        mean: round2(total as f64 / sorted.len() as f64),
        min: sorted[0],
        max: sorted[sorted.len() - 1],
        total,
        p50: percentile(&sorted, 50.0),
        p75: percentile(&sorted, 75.0),
        p90: percentile(&sorted, 90.0),
        p95: percentile(&sorted, 95.0),
        p99: percentile(&sorted, 99.0),
    }
}

/// Log-linear histogram over u32 µs: exact below 1024, then 1024 sub-buckets per octave
/// (≤ 0.1 % relative error). 23 552 buckets × 8 B ≈ 188 KB per stage.
const SUB_BITS: u32 = 10;
const SUB: usize = 1 << SUB_BITS;
const HIST_BUCKETS: usize = SUB + (32 - SUB_BITS as usize) * SUB;

struct Hist {
    counts: Vec<u64>,
    total: u64,
    sum: u64,
    min: u32,
    max: u32,
}

impl Hist {
    fn new() -> Self {
        Self {
            counts: vec![0; HIST_BUCKETS],
            total: 0,
            sum: 0,
            min: u32::MAX,
            max: 0,
        }
    }

    #[inline]
    fn bucket(v: u32) -> usize {
        if (v as usize) < SUB {
            v as usize
        } else {
            let e = 31 - v.leading_zeros();
            let mant = (v >> (e - SUB_BITS)) as usize & (SUB - 1);
            SUB + (e - SUB_BITS) as usize * SUB + mant
        }
    }

    fn bucket_low(b: usize) -> u32 {
        if b < SUB {
            b as u32
        } else {
            let rel = b - SUB;
            let e = (rel / SUB) as u32 + SUB_BITS;
            let mant = (rel % SUB) as u32;
            (1u32 << e) | (mant << (e - SUB_BITS))
        }
    }

    #[inline]
    fn record(&mut self, v: u32) {
        self.counts[Self::bucket(v)] += 1;
        self.total += 1;
        self.sum += u64::from(v);
        self.min = self.min.min(v);
        self.max = self.max.max(v);
    }

    /// Nearest-rank over buckets; returns the bucket's lower bound (never above the true value).
    fn percentile(&self, p: f64) -> f64 {
        if self.total == 0 {
            return 0.0;
        }
        let rank = ((p / 100.0) * self.total as f64).ceil() as u64;
        let rank = rank.clamp(1, self.total);
        let mut cum = 0u64;
        for (b, &c) in self.counts.iter().enumerate() {
            cum += c;
            if cum >= rank {
                return f64::from(Self::bucket_low(b));
            }
        }
        f64::from(self.max)
    }

    fn dist(&self) -> Dist {
        Dist {
            count: self.total,
            mean: if self.total == 0 {
                0.0
            } else {
                round2(self.sum as f64 / self.total as f64)
            },
            min: if self.total == 0 { 0 } else { self.min },
            max: self.max,
            total: self.sum,
            p50: self.percentile(50.0),
            p75: self.percentile(75.0),
            p90: self.percentile(90.0),
            p95: self.percentile(95.0),
            p99: self.percentile(99.0),
        }
    }
}

#[derive(Serialize)]
struct Summary {
    frame_count: u64,
    locate_us: Dist,
    serve_us: Dist,
    send_us: Dist,
    bytes: Dist,
}

#[derive(Serialize)]
struct CurrentReport<'a> {
    summary: Summary,
    server_frames: &'a [RowJson],
    run_end: RunEnd,
}

#[derive(Serialize)]
struct RunEnd {
    event: &'static str,
    written_records: u64,
    dropped_records: u64,
}

#[derive(Serialize)]
struct ReportResult {
    bench: &'static str,
    shape: Shape,
    rows: u64,
    row_bytes: usize,
    rss_after_rows_kb: u64,
    rss_peak_kb: u64,
    t_rows_ms: f64,
    t_summary_ms: f64,
    t_write_ms: f64,
    t_total_ms: f64,
    report_bytes: u64,
    row_file_bytes: u64,
    percentile_method: &'static str,
    /// Streaming only, with --offline-exact.
    offline_exact: Option<OfflineExact>,
}

#[derive(Serialize)]
struct OfflineExact {
    t_exact_ms: f64,
    rss_peak_kb_after: u64,
    /// Largest |hist − exact| / exact over p50, p95, p99 of the three duration stages.
    max_rel_err_pct: f64,
    serve_us_exact: Dist,
    serve_us_hist: Dist,
}

fn proc_status_kb(key: &str) -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with(key))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(0)
}

fn bench_report(
    shape: Shape,
    rows: u64,
    out_dir: PathBuf,
    offline_exact: bool,
) -> anyhow::Result<ReportResult> {
    std::fs::create_dir_all(&out_dir)?;
    let mut rng = Rng::new(42);
    let t_all = Instant::now();
    match shape {
        Shape::Current => {
            // Mirror drain_loop: Vec<FrameRecordJson> + four Vec<u32> accumulators.
            let t0 = Instant::now();
            let mut frames: Vec<RowJson> = Vec::new();
            let (mut work, mut serve, mut send, mut bytes) =
                (Vec::new(), Vec::new(), Vec::new(), Vec::new());
            for i in 0..rows {
                let r = rng.row(1 + i % 1000, i);
                work.push(r.locate_us);
                serve.push(r.serve_us);
                send.push(r.send_us);
                bytes.push(r.bytes);
                frames.push(RowJson::from(r));
            }
            let t_rows = t0.elapsed();
            let rss_after_rows = proc_status_kb("VmRSS:");

            let t1 = Instant::now();
            let summary = Summary {
                frame_count: rows,
                locate_us: dist_exact(&work),
                serve_us: dist_exact(&serve),
                send_us: dist_exact(&send),
                bytes: dist_exact(&bytes),
            };
            let t_summary = t1.elapsed();

            let t2 = Instant::now();
            let path = out_dir.join("telemetry-server.json");
            let report = CurrentReport {
                summary,
                server_frames: &frames,
                run_end: RunEnd {
                    event: "run_end",
                    written_records: rows,
                    dropped_records: 0,
                },
            };
            {
                let mut w = BufWriter::new(File::create(&path)?);
                serde_json::to_writer_pretty(&mut w, &report)?;
                w.write_all(b"\n")?;
                w.flush()?;
            }
            let t_write = t2.elapsed();
            let report_bytes = std::fs::metadata(&path)?.len();
            let rss_peak = proc_status_kb("VmHWM:");
            let _ = std::fs::remove_file(&path);
            Ok(ReportResult {
                bench: "report",
                shape,
                rows,
                row_bytes: ROW_BYTES,
                rss_after_rows_kb: rss_after_rows,
                rss_peak_kb: rss_peak,
                t_rows_ms: ms(t_rows),
                t_summary_ms: ms(t_summary),
                t_write_ms: ms(t_write),
                t_total_ms: ms(t_all.elapsed()),
                report_bytes,
                row_file_bytes: 0,
                percentile_method: "exact-sort",
                offline_exact: None,
            })
        }
        Shape::Streaming => {
            let rows_path = out_dir.join("telemetry-server.rows");
            let t0 = Instant::now();
            let mut w = BufWriter::with_capacity(1 << 20, File::create(&rows_path)?);
            let (mut h_work, mut h_serve, mut h_send, mut h_bytes) =
                (Hist::new(), Hist::new(), Hist::new(), Hist::new());
            for i in 0..rows {
                let r = rng.row(1 + i % 1000, i);
                w.write_all(&r.to_bytes())?;
                h_work.record(r.locate_us);
                h_serve.record(r.serve_us);
                h_send.record(r.send_us);
                h_bytes.record(r.bytes);
            }
            w.flush()?;
            drop(w);
            let t_rows = t0.elapsed();
            let rss_after_rows = proc_status_kb("VmRSS:");

            let t1 = Instant::now();
            let summary = Summary {
                frame_count: rows,
                locate_us: h_work.dist(),
                serve_us: h_serve.dist(),
                send_us: h_send.dist(),
                bytes: h_bytes.dist(),
            };
            let t_summary = t1.elapsed();

            let t2 = Instant::now();
            let path = out_dir.join("telemetry-server.json");
            {
                let mut w = BufWriter::new(File::create(&path)?);
                serde_json::to_writer_pretty(
                    &mut w,
                    &serde_json::json!({
                        "summary": summary,
                        "percentile_method": "histogram-loglinear-1024",
                        "rows_file": "telemetry-server.rows",
                        "run_end": { "event": "run_end", "written_records": rows, "dropped_records": 0 }
                    }),
                )?;
                w.write_all(b"\n")?;
                w.flush()?;
            }
            let t_write = t2.elapsed();
            let report_bytes = std::fs::metadata(&path)?.len();
            let row_file_bytes = std::fs::metadata(&rows_path)?.len();
            let rss_peak = proc_status_kb("VmHWM:");
            let t_total = t_all.elapsed();

            let offline = if offline_exact {
                let t3 = Instant::now();
                // One stage at a time, so peak memory is one Vec<u32> of `rows`.
                let mut max_err = 0.0f64;
                let mut serve_exact = None;
                for (stage, hist) in [(1usize, &h_work), (2, &h_serve), (3, &h_send)] {
                    let vals = read_stage(&rows_path, stage)?;
                    let exact = dist_exact(&vals);
                    let hd = hist.dist();
                    for (e, h) in [
                        (exact.p50, hd.p50),
                        (exact.p95, hd.p95),
                        (exact.p99, hd.p99),
                    ] {
                        if e > 0.0 {
                            max_err = max_err.max(((h - e).abs() / e) * 100.0);
                        }
                    }
                    if stage == 2 {
                        serve_exact = Some((exact, hd));
                    }
                }
                let (serve_us_exact, serve_us_hist) = serve_exact.expect("serve stage");
                Some(OfflineExact {
                    t_exact_ms: ms(t3.elapsed()),
                    rss_peak_kb_after: proc_status_kb("VmHWM:"),
                    max_rel_err_pct: round2(max_err),
                    serve_us_exact,
                    serve_us_hist,
                })
            } else {
                None
            };
            let _ = std::fs::remove_file(&path);
            let _ = std::fs::remove_file(&rows_path);
            Ok(ReportResult {
                bench: "report",
                shape,
                rows,
                row_bytes: ROW_BYTES,
                rss_after_rows_kb: rss_after_rows,
                rss_peak_kb: rss_peak,
                t_rows_ms: ms(t_rows),
                t_summary_ms: ms(t_summary),
                t_write_ms: ms(t_write),
                t_total_ms: ms(t_total),
                report_bytes,
                row_file_bytes,
                percentile_method: "histogram-loglinear-1024",
                offline_exact: offline,
            })
        }
    }
}

/// Read one u32 stage column from the row file: 1 = locate, 2 = serve, 3 = send.
fn read_stage(path: &PathBuf, stage: usize) -> anyhow::Result<Vec<u32>> {
    let mut r = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut out = Vec::new();
    let mut buf = [0u8; ROW_BYTES];
    loop {
        match r.read_exact(&mut buf) {
            Ok(()) => {
                let row = Row::from_bytes(&buf);
                out.push(match stage {
                    1 => row.locate_us,
                    2 => row.serve_us,
                    _ => row.send_us,
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(out)
}

fn ms(d: Duration) -> f64 {
    round2(d.as_secs_f64() * 1000.0)
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    match args.cmd {
        Cmd::Emit {
            seam,
            sink,
            producers,
            emits_per_producer,
            rate_per_producer,
            ring_rows,
            batch,
            scratch,
        } => {
            let r = bench_emit(
                seam,
                sink,
                producers,
                emits_per_producer,
                rate_per_producer,
                ring_rows,
                batch,
                scratch,
            )?;
            println!("{}", serde_json::to_string(&r)?);
        }
        Cmd::Report {
            shape,
            rows,
            out_dir,
            offline_exact,
        } => {
            let r = bench_report(shape, rows, out_dir, offline_exact)?;
            println!("{}", serde_json::to_string(&r)?);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_round_trip() {
        let r = Row {
            session_id: 7,
            frame_index: 3,
            ask_ordinal: 1,
            locate_us: 5,
            serve_us: 123_456,
            send_us: 99,
            bytes: 250_000,
            locate_outcome: 0,
            write_outcome: 1,
            dropped_since_last: 2,
        };
        let b = r.to_bytes();
        let back = Row::from_bytes(&b);
        assert_eq!(back.serve_us, 123_456);
        assert_eq!(back.dropped_since_last, 2);
        assert_eq!(back.session_id, 7);
    }

    #[test]
    fn hist_bucket_low_never_exceeds_value() {
        for v in [0u32, 1, 1023, 1024, 1025, 4095, 65_537, 1_000_000, u32::MAX] {
            let b = Hist::bucket(v);
            let low = Hist::bucket_low(b);
            assert!(low <= v, "v={v} low={low}");
            assert!(b < HIST_BUCKETS);
            if v >= 1024 {
                let rel = (v - low) as f64 / v as f64;
                assert!(rel <= 1.0 / 1024.0 + 1e-9, "v={v} rel={rel}");
            } else {
                assert_eq!(low, v);
            }
        }
    }

    #[test]
    fn hist_percentile_matches_exact_within_bound() {
        let mut rng = Rng::new(1);
        let mut h = Hist::new();
        let mut vals = Vec::new();
        for _ in 0..200_000 {
            let v = rng.duration_us(50);
            h.record(v);
            vals.push(v);
        }
        let exact = dist_exact(&vals);
        let hd = h.dist();
        for (e, hv) in [
            (exact.p50, hd.p50),
            (exact.p95, hd.p95),
            (exact.p99, hd.p99),
        ] {
            assert!(hv <= e);
            assert!((e - hv) / e <= 1.0 / 1024.0 + 1e-9, "exact={e} hist={hv}");
        }
        assert_eq!(hd.count, exact.count);
        assert_eq!(hd.total, exact.total);
    }
}
