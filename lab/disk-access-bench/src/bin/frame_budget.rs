//! Where a warm 250 KB frame's microseconds actually go.
//!
//! The campaign reports one number per frame (`later_p50`). This splits that number into
//! parts a decision can act on — syscall, kernel copy, user copy, scheduler — and prices a
//! single read op at sizes from 4 KiB up, which is the only unit in which a device-level
//! "3–6 µs per I/O" figure can be compared with anything here.
//!
//! Warm by construction: the point is what the path costs when the page cache hits, which
//! is the case a server spends its life in. Two sections:
//!
//! * `ops` — components measured alone, no runtime. Both `pread` orders, because a second
//!   loop over the same offsets is warmer than the first.
//! * `uring` — the same reads through a ring, and what a real device round trip costs.
//! * `ladder` — the same components added one at a time *inside* the product-shaped runtime
//!   (4 workers, optional co-tenant spin monitor), so the cost of a yield is measured where
//!   something else is runnable.

use anyhow::{Context, Result};
use exact_server::media::frame_store::FrameStore;
use io_uring::{opcode, types, IoUring};
use std::os::unix::io::AsRawFd;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

const REPS: usize = 400;

fn pct(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let k = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[k]
}

struct Stat {
    p50: u64,
    p99: u64,
}

fn stat(mut v: Vec<u64>) -> Stat {
    v.sort_unstable();
    Stat {
        p50: pct(&v, 0.50),
        p99: pct(&v, 0.99),
    }
}

fn row(label: &str, s: &Stat, per: Option<u64>) {
    let extra = match per {
        Some(bytes) => format!("  {:6.2} GB/s", bytes as f64 / s.p50.max(1) as f64),
        None => String::new(),
    };
    println!(
        "{label:<46} p50 {:>8} ns  p99 {:>8} ns{extra}",
        s.p50, s.p99
    );
}

fn preadv2_once(fd: i32, buf: &mut [u8], offset: u64, flags: i32) -> isize {
    let iov = libc::iovec {
        iov_base: buf.as_mut_ptr() as *mut libc::c_void,
        iov_len: buf.len(),
    };
    unsafe { libc::preadv2(fd, &iov, 1, offset as libc::off_t, flags) }
}

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

/// Read every byte of the file so all measurements below are page-cache hits.
fn warm_file(fd: i32, len: u64) {
    let mut scratch = vec![0u8; 1 << 20];
    let mut off = 0u64;
    while off < len {
        let n = scratch.len().min((len - off) as usize);
        preadv2_once(fd, &mut scratch[..n], off, 0);
        off += n as u64;
    }
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let study: PathBuf = args
        .next()
        .context("usage: frame_budget <study.sbnd> [ops|ladder|all] [monitors]")?
        .into();
    let section = args.next().unwrap_or_else(|| "all".into());
    let monitors: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(1);

    let store = Arc::new(FrameStore::open(&study)?);
    let file = std::fs::File::open(&study)?;
    let fd = file.as_raw_fd();
    let flen = file.metadata()?.len();
    warm_file(fd, flen);
    let (_, frame_len) = store.frame_range(0)?;
    let frame_len = frame_len as usize;
    let frames = store.frame_count();
    println!(
        "study {} · {frames} × {frame_len} B · file {flen} B · RWF_NOWAIT {}",
        study.display(),
        if store.nowait_supported() {
            "yes"
        } else {
            "NO"
        }
    );
    println!(
        "host {} CPUs · warm page cache · forward trace\n",
        num_cpus()
    );

    if section == "ops" || section == "all" {
        ops_section(&store, fd, frames, frame_len)?;
    }
    if section == "uring" || section == "all" {
        uring_section(&study, &store, fd, frames, frame_len)?;
    }
    if section == "ladder" || section == "all" {
        ladder_section(&store, fd, frames, frame_len, monitors)?;
    }
    Ok(())
}

/// Offset of frame `i` in a forward pass, wrapping.
fn frame_off(store: &FrameStore, frames: u32, i: usize) -> Result<(u64, usize)> {
    let (off, len) = store.frame_range((i as u32) % frames)?;
    Ok((off, len as usize))
}

fn ops_section(store: &FrameStore, fd: i32, frames: u32, frame_len: usize) -> Result<()> {
    println!("## One warm read op, by size — the unit a device latency figure is quoted in");
    println!("   (both flag orders, because the second pass over the same offsets is warmer)");
    let mut buf = vec![0u8; 262_144];
    for &sz in &[1usize, 4096, 16_384, 65_536, 131_072, 250_000] {
        let mut out = Vec::new();
        for &first_nowait in &[false, true] {
            let order: [(i32, &str); 2] = if first_nowait {
                [(libc::RWF_NOWAIT, "nowait"), (0, "pread ")]
            } else {
                [(0, "pread "), (libc::RWF_NOWAIT, "nowait")]
            };
            for (flag, name) in order {
                let mut v = Vec::with_capacity(REPS);
                for i in 0..REPS {
                    let (off, _) = frame_off(store, frames, i)?;
                    let t = Instant::now();
                    let n = preadv2_once(fd, &mut buf[..sz], off, flag);
                    v.push(t.elapsed().as_nanos() as u64);
                    assert_eq!(n as usize, sz, "short read");
                }
                out.push((name, first_nowait, stat(v)));
            }
        }
        for (name, first_nowait, s) in &out {
            let pos = if (*name == "nowait") == *first_nowait {
                "1st"
            } else {
                "2nd"
            };
            row(
                &format!("  {name} {sz:>7} B  ({pos} in its pass)"),
                s,
                Some(sz as u64),
            );
        }
    }

    println!("\n## User-space copy — the window→wire half of each frame");
    let src = vec![0xABu8; frame_len];
    let mut sink: Vec<u8> = Vec::with_capacity(262_144);
    for &chunk in &[16_384usize, 65_536, 250_000] {
        let mut v = Vec::with_capacity(REPS);
        for _ in 0..REPS {
            let t = Instant::now();
            for c in src.chunks(chunk) {
                sink.clear();
                sink.extend_from_slice(c);
                std::hint::black_box(sink.len());
            }
            v.push(t.elapsed().as_nanos() as u64);
        }
        row(
            &format!("  copy {frame_len} B in {chunk} B chunks (src L3-hot)"),
            &stat(v),
            Some(frame_len as u64),
        );
    }

    println!("\n## Whole frame, no runtime, no writes — read cost by window size");
    for &win in &[16_384usize, 65_536, 131_072, 262_144] {
        let mut v = Vec::with_capacity(REPS);
        for i in 0..REPS {
            let (off, len) = frame_off(store, frames, i)?;
            let t = Instant::now();
            let mut pos = 0usize;
            while pos < len {
                let this = win.min(len - pos);
                let n = preadv2_once(fd, &mut buf[..this], off + pos as u64, libc::RWF_NOWAIT);
                assert_eq!(n as usize, this);
                pos += this;
            }
            v.push(t.elapsed().as_nanos() as u64);
        }
        row(
            &format!("  {} × {win} B nowait reads", frame_len.div_ceil(win)),
            &stat(v),
            Some(frame_len as u64),
        );
    }
    Ok(())
}

/// The accepted arm's body, with each ingredient switchable.
#[allow(clippy::too_many_arguments)]
async fn serve(
    store: &FrameStore,
    fd: i32,
    off: u64,
    len: usize,
    win: usize,
    chunk: usize,
    buf: &mut [u8],
    sink: &mut Vec<u8>,
    do_read: bool,
    do_copy: bool,
    yields_per_window: bool,
) {
    let mut pos = 0usize;
    while pos < len {
        let this = win.min(len - pos);
        if do_read {
            let n = preadv2_once(fd, &mut buf[..this], off + pos as u64, libc::RWF_NOWAIT);
            debug_assert_eq!(n as usize, this);
            let _ = store;
        }
        if do_copy {
            for c in buf[..this].chunks(chunk) {
                sink.clear();
                sink.extend_from_slice(c);
                std::hint::black_box(sink.len());
                if !yields_per_window {
                    tokio::task::yield_now().await;
                }
            }
        }
        if yields_per_window {
            tokio::task::yield_now().await;
        }
        pos += this;
    }
}

fn ladder_section(
    store: &Arc<FrameStore>,
    fd: i32,
    frames: u32,
    frame_len: usize,
    monitors: usize,
) -> Result<()> {
    println!(
        "\n## In-situ ladder — tokio multi ({} workers), {monitors} co-tenant spin monitor(s)",
        num_cpus()
    );
    println!("   Each row adds one ingredient to the row above. 320-frame forward pass × 9.");
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(num_cpus())
        .enable_all()
        .build()?;

    // (label, read, copy, yields-per-window-not-per-chunk, window, chunk)
    let rows: Vec<(&str, bool, bool, bool, usize, usize)> = vec![
        (
            "A  loop only (no read, no copy, no yield)",
            false,
            false,
            true,
            65_536,
            16_384,
        ),
        (
            "B  + 4 × 64 KiB nowait reads",
            true,
            false,
            true,
            65_536,
            16_384,
        ),
        (
            "C  + copy to sink in 16 KiB chunks",
            true,
            true,
            true,
            65_536,
            16_384,
        ),
        (
            "D  + yield per 16 KiB chunk  = accepted arm",
            true,
            true,
            false,
            65_536,
            16_384,
        ),
        (
            "E  D, but 64 KiB write chunks (4 yields)",
            true,
            true,
            false,
            65_536,
            65_536,
        ),
        (
            "F  D, but 256 KiB window (1 read, 16 yields)",
            true,
            true,
            false,
            262_144,
            16_384,
        ),
        (
            "G  D, but 16 KiB window (16 reads, 16 yields)",
            true,
            true,
            false,
            16_384,
            16_384,
        ),
    ];

    let store2 = Arc::clone(store);
    rt.block_on(async move {
        let stop = Arc::new(AtomicBool::new(false));
        let mut mons = Vec::new();
        for _ in 0..monitors {
            let s = Arc::clone(&stop);
            mons.push(tokio::spawn(async move {
                let mut n = 0u64;
                while !s.load(Ordering::Relaxed) {
                    tokio::task::yield_now().await;
                    n += 1;
                }
                n
            }));
        }
        let mut prev: Option<u64> = None;
        for (label, do_read, do_copy, per_window, win, chunk) in rows {
            let st = Arc::clone(&store2);
            // Spawned, not `block_on`'d: a task on the worker pool is what the product and
            // the campaign harness measure, and it is the only shape where a yield can hand
            // the core to a co-tenant and resume the frame on a different worker.
            let all = tokio::spawn(async move {
                let mut all = Vec::new();
                for _ in 0..9 {
                    let mut buf = vec![0u8; win.max(1)];
                    let mut sink: Vec<u8> = Vec::with_capacity(chunk);
                    for i in 0..frames as usize {
                        let (off, len) = frame_off(&st, frames, i).unwrap();
                        let t = Instant::now();
                        serve(
                            &st, fd, off, len, win, chunk, &mut buf, &mut sink, do_read, do_copy,
                            per_window,
                        )
                        .await;
                        all.push(t.elapsed().as_nanos() as u64);
                    }
                }
                all
            })
            .await
            .unwrap();
            let s = stat(all);
            let delta = match prev {
                Some(p) if label.starts_with(['B', 'C', 'D']) => {
                    format!("   Δ {:+8} ns", s.p50 as i64 - p as i64)
                }
                _ => String::new(),
            };
            println!(
                "{label:<46} p50 {:>8} ns  p99 {:>8} ns{delta}",
                s.p50, s.p99
            );
            if label.starts_with(['A', 'B', 'C', 'D']) {
                prev = Some(s.p50);
            }
        }
        stop.store(true, Ordering::Relaxed);
        tokio::task::yield_now().await;
        for m in mons {
            let _ = m.await;
        }
        let _ = frame_len;
    });
    Ok(())
}

/// Aligned buffer for `O_DIRECT`.
struct Aligned {
    ptr: *mut u8,
    len: usize,
}

impl Aligned {
    fn new(len: usize) -> Self {
        let layout = std::alloc::Layout::from_size_align(len, 4096).unwrap();
        // SAFETY: non-zero size, valid alignment.
        let ptr = unsafe { std::alloc::alloc_zeroed(layout) };
        assert!(!ptr.is_null());
        Self { ptr, len }
    }
    fn as_mut(&mut self) -> &mut [u8] {
        // SAFETY: `ptr` owns `len` initialised bytes for the lifetime of `self`.
        unsafe { std::slice::from_raw_parts_mut(self.ptr, self.len) }
    }
}

impl Drop for Aligned {
    fn drop(&mut self) {
        let layout = std::alloc::Layout::from_size_align(self.len, 4096).unwrap();
        // SAFETY: same layout the allocation was made with.
        unsafe { std::alloc::dealloc(self.ptr, layout) }
    }
}

/// io_uring at its best on this workload, and what a device round trip really costs.
///
/// The ring here is *synchronous* — `submit_and_wait(1)`, no eventfd, no runtime. That is
/// not a shape the server could use (blocking in `io_uring_enter` is the executor stall
/// this ADR exists to avoid), which is the point: it is io_uring's floor, so a comparison
/// against `preadv2` cannot be accused of instrumenting the wrapper.
fn uring_section(
    study: &PathBuf,
    store: &FrameStore,
    fd: i32,
    frames: u32,
    _frame_len: usize,
) -> Result<()> {
    println!("\n## io_uring vs preadv2 on the same warm bytes (page-cache hit)");
    let file = std::fs::File::open(study)?;
    let mut ring: IoUring = IoUring::builder()
        .setup_coop_taskrun()
        .build(8)
        .context("io_uring setup")?;
    ring.submitter().register_files(&[file.as_raw_fd()])?;

    for &sz in &[4096usize, 65_536, 250_000] {
        let mut buf = vec![0u8; sz].into_boxed_slice();
        let iov = [libc::iovec {
            iov_base: buf.as_ptr() as *mut libc::c_void,
            iov_len: buf.len(),
        }];
        // SAFETY: `buf` outlives the registration (unregistered before it drops).
        unsafe { ring.submitter().register_buffers(&iov) }?;

        let mut v = Vec::with_capacity(REPS);
        for i in 0..REPS {
            let (off, _) = frame_off(store, frames, i)?;
            let e = opcode::ReadFixed::new(types::Fixed(0), buf.as_mut_ptr(), sz as u32, 0)
                .offset(off)
                .build()
                .user_data(1);
            let t = Instant::now();
            // SAFETY: the entry points at a registered buffer that outlives the completion,
            // and the ring is drained before the next submit.
            unsafe { ring.submission().push(&e).expect("sq full") };
            ring.submit_and_wait(1)?;
            let n = ring.completion().next().expect("cqe").result();
            v.push(t.elapsed().as_nanos() as u64);
            assert_eq!(n as usize, sz, "short uring read");
        }
        row(
            &format!("  io_uring ReadFixed {sz:>7} B (registered, QD1)"),
            &stat(v),
            Some(sz as u64),
        );

        let mut v = Vec::with_capacity(REPS);
        for i in 0..REPS {
            let (off, _) = frame_off(store, frames, i)?;
            let t = Instant::now();
            let n = preadv2_once(fd, &mut buf[..sz], off, libc::RWF_NOWAIT);
            v.push(t.elapsed().as_nanos() as u64);
            assert_eq!(n as usize, sz);
        }
        row(
            &format!("  preadv2 RWF_NOWAIT {sz:>7} B"),
            &stat(v),
            Some(sz as u64),
        );
        ring.submitter().unregister_buffers()?;
    }

    println!("\n## What a real device round trip costs here (O_DIRECT, cache bypassed)");
    println!("   This is the quantity a \"3–6 µs per I/O\" figure names.");
    let direct = unsafe {
        let path = std::ffi::CString::new(study.to_string_lossy().as_bytes())?;
        let raw = libc::open(path.as_ptr(), libc::O_RDONLY | libc::O_DIRECT);
        if raw < 0 {
            println!(
                "  O_DIRECT open failed: {}",
                std::io::Error::last_os_error()
            );
            return Ok(());
        }
        raw
    };
    for &sz in &[4096usize, 65_536] {
        let mut ab = Aligned::new(sz);
        let mut v = Vec::with_capacity(REPS);
        for i in 0..REPS {
            // 4 KiB-aligned offsets, walking the file so the host cache is not the answer.
            let off = ((i as u64 * 1_048_576) % (frames as u64 * 250_000 / 2)) & !4095;
            let t = Instant::now();
            let n = preadv2_once(direct, ab.as_mut(), off, 0);
            let ns = t.elapsed().as_nanos() as u64;
            if n as usize != sz {
                continue;
            }
            v.push(ns);
        }
        if !v.is_empty() {
            row(
                &format!("  O_DIRECT pread {sz:>7} B (device path)"),
                &stat(v),
                Some(sz as u64),
            );
        }
    }
    unsafe { libc::close(direct) };
    Ok(())
}
