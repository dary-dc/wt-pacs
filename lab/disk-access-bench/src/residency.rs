//! Controlled page-cache residency — the instrument the miss-ratio cells need. A cell's
//! miss set is chosen, applied and then *verified*, so a cell that did not achieve the mix
//! it asked for aborts rather than reporting under the wrong label.
//!
//! The order of [`apply`] is load-bearing and each step is there because the one before it
//! is not enough: `docs/disk-access/RERUN-miss.md` §The instrument.

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
    /// Spread the miss set through the region: a run of consecutive misses is a read-ahead
    /// cell in disguise, and flatters every arm that streams windows.
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

/// What the residency check found, so a cell is judged on its achieved mix and not the one
/// it asked for. `achieved` is counted from `mincore`: a frame misses when less than half of
/// it is resident. The two `_resident` means are the quality check — 0.03 on the miss set is
/// the inward page rounding, 0.4 means the eviction did not take and the cell is void.
pub struct MixReport {
    pub target: f64,
    pub achieved: f64,
    pub hit_resident: f64,
    pub miss_resident: f64,
}

/// Page-aligned byte range of a frame, rounded **inward** — frames share boundary pages, so
/// rounding outward would evict a hit neighbour's first page. The cost is up to one page at
/// each end of a run staying resident, which the report shows rather than hides.
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
/// mapping. Reports the page cache and not our page tables, so unmapping does not blind it.
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

/// Put the study's page cache into the state `plan` describes, then prove it. `unmap` is the
/// mapping's whole data region.
pub fn apply(store: &StudyMap, path: &Path, unmap: &[u8], plan: &MixPlan) -> Result<MixReport> {
    let page = host_page_size() as u64;
    crate::candidate_access::unmap_pages(unmap)?;

    let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let fd = file.as_raw_fd();
    fadvise_range(fd, 0, 0)?;

    // Hit set: read through a descriptor of our own, hinted `RANDOM` so the kernel does not
    // read ahead into the miss set. Preventing that read-ahead is what makes the mix hold —
    // evicting it afterwards does not work (`docs/disk-access/RERUN-miss.md`).
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

    // Miss set: consecutive frames are merged into one range first, so an interior boundary
    // page is evicted too and only the ends of a run pay the inward rounding.
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

    // From `mincore`, not from the plan: the plan is a request, and it can fail silently.
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
