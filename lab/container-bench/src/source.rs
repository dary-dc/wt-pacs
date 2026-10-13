//! The bytes an open reads, counted, from the page cache or past it with `O_DIRECT`.

use anyhow::{ensure, Context, Result};
use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::cell::Cell;
use std::fs::File;
use std::os::unix::fs::{FileExt, OpenOptionsExt};
use std::path::Path;

/// `O_DIRECT`'s alignment for offset, length and buffer on the hosts measured.
const BLOCK: u64 = 4096;

pub struct Source {
    file: File,
    len: u64,
    direct: bool,
    reads: Cell<u32>,
    bytes: Cell<u64>,
}

impl Source {
    /// `direct` reads past the page cache: the cold open, forced without evicting anything.
    pub fn open(path: &Path, direct: bool) -> Result<Self> {
        let mut opts = std::fs::OpenOptions::new();
        opts.read(true);
        if direct {
            opts.custom_flags(libc::O_DIRECT);
        }
        let file = opts.open(path).with_context(|| format!("open {}", path.display()))?;
        let len = file.metadata()?.len();
        Ok(Self { file, len, direct, reads: Cell::new(0), bytes: Cell::new(0) })
    }

    pub fn len(&self) -> u64 {
        self.len
    }

    pub fn reads(&self) -> u32 {
        self.reads.get()
    }

    pub fn bytes(&self) -> u64 {
        self.bytes.get()
    }

    pub fn into_file(self) -> File {
        self.file
    }

    /// `len` bytes at `at`, or fewer where the file ends first.
    pub fn read(&self, at: u64, len: usize) -> Result<Vec<u8>> {
        ensure!(at <= self.len, "read at {at} past the end ({})", self.len);
        let len = len.min((self.len - at) as usize);
        self.reads.set(self.reads.get() + 1);
        self.bytes.set(self.bytes.get() + len as u64);
        if !self.direct {
            let mut buf = vec![0u8; len];
            self.file.read_exact_at(&mut buf, at).with_context(|| format!("read {len} at {at}"))?;
            return Ok(buf);
        }
        let start = at / BLOCK * BLOCK;
        let span = ((at + len as u64).div_ceil(BLOCK) * BLOCK - start) as usize;
        let aligned = Aligned::new(span.max(BLOCK as usize));
        let mut got = 0usize;
        while got < span {
            // SAFETY: `aligned` owns `span` writable bytes; the subrange stays inside them.
            let buf = unsafe { std::slice::from_raw_parts_mut(aligned.ptr.add(got), span - got) };
            let n = self.file.read_at(buf, start + got as u64).context("O_DIRECT read")?;
            if n == 0 {
                break;
            }
            got += n;
        }
        let skip = (at - start) as usize;
        ensure!(got >= skip + len, "O_DIRECT read {got} of {} bytes", skip + len);
        // SAFETY: the first `got` bytes of `aligned` were written by the reads above.
        let all = unsafe { std::slice::from_raw_parts(aligned.ptr, got) };
        Ok(all[skip..skip + len].to_vec())
    }
}

struct Aligned {
    ptr: *mut u8,
    layout: Layout,
}

impl Aligned {
    fn new(len: usize) -> Self {
        let layout = Layout::from_size_align(len, BLOCK as usize).expect("O_DIRECT layout");
        // SAFETY: `layout` has a non-zero size.
        let ptr = unsafe { alloc_zeroed(layout) };
        assert!(!ptr.is_null(), "O_DIRECT buffer");
        Self { ptr, layout }
    }
}

impl Drop for Aligned {
    fn drop(&mut self) {
        // SAFETY: `ptr` came from `alloc_zeroed` with this `layout`.
        unsafe { dealloc(self.ptr, self.layout) }
    }
}

/// Reads ahead in windows, for the containers whose index sits behind headers of unknown size.
pub struct Cursor<'a> {
    src: &'a Source,
    window: usize,
    base: u64,
    buf: Vec<u8>,
}

impl<'a> Cursor<'a> {
    pub fn new(src: &'a Source, window: usize) -> Self {
        Self { src, window, base: 0, buf: Vec::new() }
    }

    /// `len` bytes at `at`, reading a new window only when they are not already held.
    pub fn get(&mut self, at: u64, len: usize) -> Result<&[u8]> {
        let held = at >= self.base && at + len as u64 <= self.base + self.buf.len() as u64;
        if !held {
            self.buf = self.src.read(at, len.max(self.window))?;
            self.base = at;
            ensure!(self.buf.len() >= len, "{len} bytes at {at} run past the end");
        }
        let from = (at - self.base) as usize;
        Ok(&self.buf[from..from + len])
    }

    pub fn src(&self) -> &Source {
        self.src
    }
}
