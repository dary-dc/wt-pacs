//! Per frame, what the lab counts rather than times: the threads that touch it, the messages that carry it between
//! two of them, and the copies of its samples. `docs/native/README.md` §The view-worker design, native.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Mutex;
use std::thread::ThreadId;
use std::time::Instant;

#[derive(Default)]
struct Frame {
    threads: HashSet<ThreadId>,
    messages: u64,
    copies: u64,
}

static FRAMES: Mutex<Option<HashMap<u32, Frame>>> = Mutex::new(None);
static PAINTS: AtomicU64 = AtomicU64::new(0);
static INTENTS: AtomicU64 = AtomicU64::new(0);
static NOTES: AtomicU64 = AtomicU64::new(0);
static HOPS: Mutex<BTreeMap<&str, Vec<f64>>> = Mutex::new(BTreeMap::new());
static CINE_ON_TIME: AtomicU64 = AtomicU64::new(0);
static CINE_LATE: AtomicU64 = AtomicU64::new(0);

fn on(index: u32, f: impl FnOnce(&mut Frame)) {
    let mut frames = FRAMES.lock().unwrap_or_else(|e| e.into_inner());
    let frame = frames.get_or_insert_with(HashMap::new).entry(index).or_default();
    frame.threads.insert(std::thread::current().id());
    f(frame);
}

/// The frame is on this thread.
pub fn touch(index: u32) {
    on(index, |_| {});
}

/// A message carrying the frame was received on this thread.
pub fn hop(index: u32) {
    on(index, |f| f.messages += 1);
}

/// `n` copies of the frame's samples were made on this thread.
pub fn copy(index: u32, n: u64) {
    on(index, |f| f.copies += n);
}

/// A paint: the samples written to the GPU through one staging copy.
pub fn paint() {
    PAINTS.fetch_add(1, Relaxed);
}

/// An intent from the UI thread, received on the thread that paints.
pub fn intent() {
    INTENTS.fetch_add(1, Relaxed);
}

/// An event for the UI thread (`shown`, `failed`), received there.
pub fn note() {
    NOTES.fetch_add(1, Relaxed);
}

/// A message and when it was sent, for its hop's stamp.
#[derive(Debug)]
pub struct Sent<T> {
    message: T,
    at: Instant,
}

impl<T> Sent<T> {
    pub fn now(message: T) -> Self {
        Self { message, at: Instant::now() }
    }

    /// The message, its send → receive time stamped under `hop`; on the receiving thread.
    pub fn received(self, hop: &'static str) -> T {
        stamp(hop, self.at);
        self.message
    }
}

impl<T> std::ops::Deref for Sent<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.message
    }
}

/// A hop of `hop` sent at `sent` and received now.
pub fn stamp(hop: &'static str, sent: Instant) {
    let us = sent.elapsed().as_secs_f64() * 1e6;
    HOPS.lock().unwrap_or_else(|e| e.into_inner()).entry(hop).or_default().push(us);
}

/// Cine frames painted before the next was due, and those that were not: passed over, not held, or painted late.
pub fn cine(on_time: u64, late: u64) {
    CINE_ON_TIME.fetch_add(on_time, Relaxed);
    CINE_LATE.fetch_add(late, Relaxed);
}

/// The nearest-rank quantile `q` of `sorted`.
fn quantile(sorted: &[f64], q: f64) -> f64 {
    sorted[((q * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len()) - 1]
}

/// Per hop, its count and the median and p99 of its send → receive, in µs.
fn hops() -> String {
    let hops = HOPS.lock().unwrap_or_else(|e| e.into_inner());
    let line = |(name, us): (&&str, &Vec<f64>)| {
        let mut us = us.clone();
        us.sort_by(f64::total_cmp);
        format!("\nhop {name} n={} median_us={:.1} p99_us={:.1}", us.len(), quantile(&us, 0.5), quantile(&us, 0.99))
    };
    hops.iter().map(line).collect()
}

/// Per frame delivered, the means of its threads, messages and copies; then the totals of paints and of the
/// messages between the UI thread and the one that paints; the cine's frames on time and late; a line per hop.
pub fn report() -> String {
    let frames = FRAMES.lock().unwrap_or_else(|e| e.into_inner());
    let frames: Vec<&Frame> = frames.iter().flat_map(|m| m.values()).collect();
    let n = frames.len().max(1) as f64;
    let mean = |f: fn(&Frame) -> u64| frames.iter().map(|x| f(x)).sum::<u64>() as f64 / n;
    format!(
        "counts frames={} threads={:.2} messages={:.2} copies={:.2} paints={} intents={} notes={} cine_on_time={} cine_late={}{}",
        frames.len(),
        mean(|f| f.threads.len() as u64),
        mean(|f| f.messages),
        mean(|f| f.copies),
        PAINTS.load(Relaxed),
        INTENTS.load(Relaxed),
        NOTES.load(Relaxed),
        CINE_ON_TIME.load(Relaxed),
        CINE_LATE.load(Relaxed),
        hops()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// **A hop's stamp is its send → receive.** A message received 20 ms after its send stamps at least 20 000 µs
    /// under its hop's name, and the report prints that hop's count.
    #[test]
    fn a_hop_stamps_its_send_to_receive() {
        let sent = Sent::now(7u32);
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(sent.received("test-hop"), 7);
        let us = HOPS.lock().unwrap()["test-hop"].clone();
        assert!(us.len() == 1 && us[0] >= 20_000.0, "{us:?}");
        assert!(report().contains("hop test-hop n=1 "));
    }

    /// The nearest-rank quantiles: of 1..=100, the median is 50 and the p99 is 99; of one value, both are it.
    #[test]
    fn quantiles_are_nearest_rank() {
        let v: Vec<f64> = (1..=100).map(f64::from).collect();
        assert_eq!((quantile(&v, 0.5), quantile(&v, 0.99)), (50.0, 99.0));
        assert_eq!((quantile(&[3.0], 0.5), quantile(&[3.0], 0.99)), (3.0, 3.0));
    }
}
