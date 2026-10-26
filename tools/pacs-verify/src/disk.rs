//! Reads that reach the disk, not the page cache: tools/pacs-verify/README.md §From disk.

use std::fs::File;
use std::io;
use std::os::fd::AsRawFd;
use std::path::Path;

/// Opens `path` with none of its pages cached, so the reads that follow come from the device.
pub fn open_uncached(path: &Path) -> io::Result<File> {
    let file = File::open(path)?;
    drop_cached(&file)?;
    Ok(file)
}

/// Dirty pages are not dropped, so they are written back first; a read-only mount has none.
pub fn drop_cached(file: &File) -> io::Result<()> {
    if let Err(e) = file.sync_data() {
        if !matches!(e.raw_os_error(), Some(libc::EROFS | libc::EINVAL)) {
            return Err(e);
        }
    }
    // SAFETY: the descriptor is open for the call's duration; the call reads no memory of ours.
    let err = unsafe { libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_DONTNEED) };
    match err {
        0 => Ok(()),
        e => Err(io::Error::from_raw_os_error(e)),
    }
}
