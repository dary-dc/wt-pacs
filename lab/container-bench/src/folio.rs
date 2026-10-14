//! Files written past the page cache, and the page-cache folios their bytes sit in: rows 172 and 197.

use anyhow::{bail, ensure, Result};
use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileExt, OpenOptionsExt};
use std::path::Path;

pub const PAGE: u64 = 4096;
const KPF_COMPOUND_HEAD: u64 = 1 << 15;
const KPF_COMPOUND_TAIL: u64 = 1 << 16;

struct Aligned {
    ptr: *mut u8,
    layout: Layout,
}

impl Aligned {
    fn new(len: usize) -> Self {
        let layout = Layout::from_size_align(len, PAGE as usize).expect("layout");
        // SAFETY: `layout` has a non-zero size.
        let ptr = unsafe { alloc_zeroed(layout) };
        assert!(!ptr.is_null(), "alloc");
        Self { ptr, layout }
    }

    fn buf(&mut self) -> &mut [u8] {
        // SAFETY: `ptr` owns `layout.size()` initialised bytes for `self`'s lifetime.
        unsafe { std::slice::from_raw_parts_mut(self.ptr, self.layout.size()) }
    }
}

impl Drop for Aligned {
    fn drop(&mut self) {
        // SAFETY: allocated with this layout in `new`.
        unsafe { dealloc(self.ptr, self.layout) };
    }
}

/// `src`'s bytes into `out` through `O_DIRECT`: nothing of `out` is cached after it.
pub fn direct(src: &Path, out: &Path) -> Result<()> {
    let mut input = File::open(src)?;
    let size = input.metadata()?.len();
    let file = OpenOptions::new().write(true).create(true).truncate(true).custom_flags(libc::O_DIRECT).open(out)?;
    let mut block = Aligned::new(1 << 20);
    let mut at = 0u64;
    while at < size {
        let buf = block.buf();
        let want = ((size - at) as usize).min(buf.len());
        input.read_exact(&mut buf[..want])?;
        let padded = (want as u64).div_ceil(PAGE) * PAGE;
        buf[want..padded as usize].fill(0);
        file.write_all_at(&buf[..padded as usize], at)?;
        at += want as u64;
    }
    file.set_len(size)?;
    Ok(())
}

pub fn resident(file: &File, len: u64) -> Result<(u64, u64)> {
    let vec = residency(file, len)?;
    Ok((vec.iter().filter(|&&b| b & 1 == 1).count() as u64, vec.len() as u64))
}

pub fn residency(file: &File, len: u64) -> Result<Vec<u8>> {
    let pages = len.div_ceil(PAGE);
    // SAFETY: a read-only shared mapping of `len` bytes of an open file; unmapped below.
    let map = unsafe { libc::mmap(std::ptr::null_mut(), len as usize, libc::PROT_READ, libc::MAP_SHARED, file.as_raw_fd(), 0) };
    ensure!(map != libc::MAP_FAILED, "mmap: {}", std::io::Error::last_os_error());
    let mut vec = vec![0u8; pages as usize];
    // SAFETY: `map` spans `len` bytes; `vec` holds one byte per page.
    let rc = unsafe { libc::mincore(map, len as usize, vec.as_mut_ptr()) };
    // SAFETY: the mapping made above.
    unsafe { libc::munmap(map, len as usize) };
    ensure!(rc == 0, "mincore: {}", std::io::Error::last_os_error());
    Ok(vec)
}

/// For each page of the file, whether it begins a folio, and the folio's order: from the PFN that
/// `/proc/self/pagemap` gives a mapped page and that page's `/proc/kpageflags`.
pub fn pages(file: &File, len: u64, mutate: bool) -> Result<Vec<(bool, u32)>> {
    let (got, pages) = resident(file, len)?;
    ensure!(got == pages, "{got} of {pages} pages resident: mapping the rest would read them in");
    // SAFETY: a read-only shared mapping of `len` bytes of an open file; unmapped below.
    let map = unsafe { libc::mmap(std::ptr::null_mut(), len as usize, libc::PROT_READ, libc::MAP_SHARED, file.as_raw_fd(), 0) };
    ensure!(map != libc::MAP_FAILED, "mmap: {}", std::io::Error::last_os_error());
    // SAFETY: MADV_RANDOM on our own mapping only turns fault-around off.
    unsafe { libc::madvise(map, len as usize, libc::MADV_RANDOM) };
    let base = map as usize;
    let mut sum = 0u64;
    for p in 0..pages {
        // SAFETY: every page is resident and inside the mapping.
        sum = sum.wrapping_add(u64::from(unsafe { std::ptr::read_volatile((base + (p * PAGE) as usize) as *const u8) }));
    }
    std::hint::black_box(sum);
    let pagemap = File::open("/proc/self/pagemap")?;
    let kflags = File::open("/proc/kpageflags")?;
    let mut raw = vec![0u8; 8 * pages as usize];
    pagemap.read_exact_at(&mut raw, (base as u64 / PAGE) * 8)?;
    // SAFETY: the mapping made above.
    unsafe { libc::munmap(map, len as usize) };
    let mut out = Vec::with_capacity(pages as usize);
    let mut order = 0u32;
    for (p, e) in raw.chunks_exact(8).enumerate() {
        let e = u64::from_le_bytes(e.try_into().unwrap());
        ensure!(e >> 63 == 1, "page {p} not present in pagemap");
        let pfn = e & ((1 << 55) - 1);
        ensure!(pfn != 0, "PFN 0: /proc/self/pagemap needs CAP_SYS_ADMIN");
        let mut f = [0u8; 8];
        kflags.read_exact_at(&mut f, pfn * 8)?;
        let f = u64::from_le_bytes(f) & if mutate { !KPF_COMPOUND_HEAD } else { !0 };
        let head = f & KPF_COMPOUND_TAIL == 0;
        if head {
            order = if f & KPF_COMPOUND_HEAD != 0 { folio_order(pfn, &kflags)? } else { 0 };
        }
        out.push((head || p == 0, order));
    }
    check_layout(&out)?;
    Ok(out)
}

/// Every folio starts on a multiple of its own size and is followed by tails to its end.
fn check_layout(pages: &[(bool, u32)]) -> Result<()> {
    let mut p = 0usize;
    while p < pages.len() {
        let (head, order) = pages[p];
        let size = 1usize << order;
        ensure!(head, "page {p} is a tail where a folio should begin");
        ensure!(p.is_multiple_of(size), "a folio of {size} pages at page {p}");
        if let Some(q) = (p + 1..(p + size).min(pages.len())).find(|&q| pages[q].0) {
            bail!("page {q} begins a folio inside the one at {p}");
        }
        p += size;
    }
    Ok(())
}

fn folio_order(head: u64, kflags: &File) -> Result<u32> {
    let mut n = 1u64;
    let mut f = [0u8; 8];
    while n < 512 && kflags.read_exact_at(&mut f, (head + n) * 8).is_ok() && u64::from_le_bytes(f) & KPF_COMPOUND_TAIL != 0 {
        n += 1;
    }
    Ok(n.trailing_zeros())
}

