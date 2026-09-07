//! Controlled page-cache residency — the instrument the miss-ratio cells need.
//!
//! The campaign this extends had two temperatures: warm (every ask hits) and cold (every
//! page evicted, then read-ahead decides how many asks actually miss). Neither can answer
//! "what happens at 60% misses", and cold-forward is not even miss-dominated — 6 of 320
//! asks paid a hop, because read-ahead served the rest.
//!
//! Here the miss set is chosen, applied and then *verified*: a cell that did not achieve
//! the mix it asked for aborts rather than reporting a number under the wrong label.
//!
//! Order matters, and each step exists because the one before it is not enough:
//!
//! 1. `MADV_DONTNEED` the mapping — `fadvise(DONTNEED)` will not evict a page that is
//!    still mapped, and `FrameStore::open` maps the whole file.
//! 2. `fadvise(DONTNEED)` the file — now everything is evictable, and evicted.
//! 3. `pread` the hit set through a **`FADV_RANDOM`** descriptor — page cache only; our
//!    mapping's PTEs stay absent, which is what the `pread`/io_uring arms under test
//!    would see anyway. The hint is not cosmetic: this host reads ahead 8 MB
//!    (`/sys/block/vda/queue/read_ahead_kb`, 64x the usual 128 KB), so warming one frame
//!    drags in the next ~32 — enough to leave a 50% miss set 90% resident.
//! 4. `fadvise(DONTNEED)` the miss set's byte ranges — belt and braces for whatever the
//!    hint did not prevent.
//! 5. `mincore` every frame and check the two sets separately.
//!
//! Step 4 alone is not a substitute for step 3: `fadvise(DONTNEED)` refuses to evict a
//! good fraction of freshly read-ahead pages no matter how many times it is called
//! (measured: 0.90 resident, then 0.63 after one pass and 0.63 after five). Prevent the
//! read-ahead; do not try to undo it.

use crate::study_map::{host_page_size, StudyMap};
use anyhow::{Context, Result};
use exact_server::media::frame_store::FrameSpan;
use std::os::unix::fs::FileExt;
use std::os::unix::io::AsRawFd;
use std::path::Path;

/// Which frames of a cell's region are to miss, and which are to hit.
pub struct MixPlan {
    pub miss: Vec<u32>,
    pub hit: Vec<u32>,
}

impl MixPlan {
    /// Spread the miss set through the region rather than clustering it: a run of
    /// consecutive misses is a read-ahead cell in disguise, and would flatter every arm
    /// that streams windows.
    pub fn build(frames: &[u32], mix: f64, seed: u64) -> Self {
        let mut order: Vec<u32> = frames.to_vec();
        let mut state = seed ^ 0x9E37_79B9_7F4A_7C15;
        for i in (1..order.len()).rev() {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let j = (state >> 33) as usize % (i + 1);
            order.swap(i, j);
        }
        let n_miss =
            ((mix.clamp(0.0, 1.0) * frames.len() as f64).round() as usize).min(order.len());
        let mut miss: Vec<u32> = order[..n_miss].to_vec();
        let mut hit: Vec<u32> = order[n_miss..].to_vec();
        miss.sort_unstable();
        hit.sort_unstable();
        Self { miss, hit }
    }
}

/// What the residency check actually found, so a cell can be judged on its achieved mix
/// rather than the one it asked for.
///
/// `achieved` is counted from `mincore`, not from the plan: a frame counts as a miss when
/// less than half of it is resident. `hit_resident` / `miss_resident` are the means of the
/// two sets and are the real quality check — a miss set at 0.03 is the inward page
/// rounding, a miss set at 0.4 means the eviction did not take and the cell is void.
pub struct MixReport {
    pub target: f64,
    pub achieved: f64,
    pub hit_resident: f64,
    pub miss_resident: f64,
}

/// Page-aligned byte range of a frame, rounded **inward**.
///
/// A 250 000 B frame is 61.04 pages, so frames share boundary pages with their
/// neighbours. Rounding inward when evicting is what keeps a miss frame from taking its
/// hit neighbour's first page with it; the cost is that up to one page at each end of a
/// run stays resident, which the report shows rather than hides.
fn inward(offset: u64, len: u64, page: u64) -> Option<(u64, u64)> {
    let start = offset.div_ceil(page) * page;
    let end = (offset + len) / page * page;
    (end > start).then_some((start, end - start))
}

fn fadvise_range(fd: i32, offset: u64, len: u64) -> Result<()> {
    let rc = unsafe {
        libc::posix_fadvise(
            fd,
            offset as libc::off_t,
            len as libc::off_t,
            libc::POSIX_FADV_DONTNEED,
        )
    };
    if rc != 0 {
        anyhow::bail!("posix_fadvise(DONTNEED, {offset}, {len}) errno={rc}");
    }
    Ok(())
}

/// Fraction of a frame's pages resident in the page cache, via `mincore` on the study
/// mapping. Reports the page cache, not our page tables — which is why step 1 unmapping
/// the region does not blind it.
fn frame_residency(store: &StudyMap, idx: u32) -> Result<f64> {
    let slice = store.frame_slice(idx)?;
    if slice.is_empty() {
        return Ok(0.0);
    }
    let page = host_page_size();
    let addr = slice.as_ptr() as usize;
    let start = addr & !(page - 1);
    let len = (addr + slice.len() - start).div_ceil(page) * page;
    let n = len / page;
    let mut vec = vec![0u8; n];
    // SAFETY: page-aligned subrange of the live study mmap held by the caller's store.
    let rc = unsafe { libc::mincore(start as *mut libc::c_void, len, vec.as_mut_ptr()) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error()).context("mincore frame residency");
    }
    Ok(vec.iter().filter(|b| *b & 1 != 0).count() as f64 / n as f64)
}

/// Put the study's page cache into the state `plan` describes, then prove it.
///
/// `unmap` is the mapping's whole data region (step 1) — the caller owns it because
/// `data_span` needs the same reasoning the cold cell uses.
pub fn apply(store: &StudyMap, path: &Path, unmap: &[u8], plan: &MixPlan) -> Result<MixReport> {
    let page = host_page_size() as u64;
    crate::candidate_access::unmap_pages(unmap)?;

    let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let fd = file.as_raw_fd();
    fadvise_range(fd, 0, 0)?;

    // Hit set: read it in through a descriptor of our own, hinted `RANDOM` so the kernel
    // does not read ahead into the miss set. `pread` and not a mapped touch, because the
    // arms under test read through a file descriptor and that is the cache state they
    // will meet. The arms keep their own descriptors and their own default read-ahead.
    let warm = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let rc = unsafe { libc::posix_fadvise(warm.as_raw_fd(), 0, 0, libc::POSIX_FADV_RANDOM) };
    if rc != 0 {
        anyhow::bail!("posix_fadvise(RANDOM) errno={rc}");
    }
    let mut scratch = vec![0u8; 1 << 20];
    for &idx in &plan.hit {
        let FrameSpan { offset, len } = store.frame_span(idx)?;
        let len = len as usize;
        if scratch.len() < len {
            scratch.resize(len, 0);
        }
        warm.read_exact_at(&mut scratch[..len], offset)
            .with_context(|| format!("warm frame {idx}"))?;
    }

    // Miss set: undo the read-ahead the hit set just dragged in. Consecutive miss frames
    // are merged into one range first, so an interior boundary page is evicted too and
    // only the ends of a run pay the inward rounding.
    let mut runs: Vec<(u64, u64)> = Vec::new();
    for &idx in &plan.miss {
        let FrameSpan { offset, len } = store.frame_span(idx)?;
        let end = offset + len as u64;
        match runs.last_mut() {
            Some(last) if last.1 == offset => last.1 = end,
            _ => runs.push((offset, end)),
        }
    }
    for (start, end) in runs {
        if let Some((off, len)) = inward(start, end - start, page) {
            fadvise_range(fd, off, len)?;
        }
    }

    // Count the achieved mix from `mincore`, not from the plan — the plan is the request,
    // and the point of this step is that a request can fail silently.
    let survey = |set: &[u32]| -> Result<(f64, usize)> {
        let mut acc = 0.0;
        let mut cold = 0usize;
        for &idx in set {
            let r = frame_residency(store, idx)?;
            acc += r;
            if r < 0.5 {
                cold += 1;
            }
        }
        Ok((
            if set.is_empty() {
                0.0
            } else {
                acc / set.len() as f64
            },
            cold,
        ))
    };
    let (hit_resident, hit_cold) = survey(&plan.hit)?;
    let (miss_resident, miss_cold) = survey(&plan.miss)?;
    let total = plan.hit.len() + plan.miss.len();
    Ok(MixReport {
        target: if total == 0 {
            0.0
        } else {
            plan.miss.len() as f64 / total as f64
        },
        achieved: if total == 0 {
            0.0
        } else {
            (hit_cold + miss_cold) as f64 / total as f64
        },
        hit_resident,
        miss_resident,
    })
}
