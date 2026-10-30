//! Per frame, what the lab counts rather than times: the threads that touch it, the messages that carry it between
//! two of them, and the copies of its samples. `docs/native/README.md` §The view-worker design, native.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Mutex;
use std::thread::ThreadId;

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

/// Per frame delivered, the means of its threads, messages and copies; then the totals of paints and of the
/// messages between the UI thread and the one that paints.
pub fn report() -> String {
    let frames = FRAMES.lock().unwrap_or_else(|e| e.into_inner());
    let frames: Vec<&Frame> = frames.iter().flat_map(|m| m.values()).collect();
    let n = frames.len().max(1) as f64;
    let mean = |f: fn(&Frame) -> u64| frames.iter().map(|x| f(x)).sum::<u64>() as f64 / n;
    format!(
        "counts frames={} threads={:.2} messages={:.2} copies={:.2} paints={} intents={} notes={}",
        frames.len(),
        mean(|f| f.threads.len() as u64),
        mean(|f| f.messages),
        mean(|f| f.copies),
        PAINTS.load(Relaxed),
        INTENTS.load(Relaxed),
        NOTES.load(Relaxed)
    )
}
