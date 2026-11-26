use std::fs::File;
use std::io::Read;
use std::os::fd::AsRawFd;
use std::path::PathBuf;

fn scratch(name: &str) -> PathBuf {
    let dir =
        PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Pages of the file resident in the page cache, by mincore over a mapping that touches none.
fn resident_pages(file: &File) -> usize {
    let len = file.metadata().unwrap().len() as usize;
    let page = 4096;
    let mut vec = vec![0u8; len.div_ceil(page)];
    // SAFETY: a read-only shared mapping of `len` bytes of an open file, unmapped before return;
    // mincore writes one byte per page into `vec`, sized for them.
    unsafe {
        let addr = libc::mmap(
            std::ptr::null_mut(),
            len,
            libc::PROT_READ,
            libc::MAP_SHARED,
            file.as_raw_fd(),
            0,
        );
        assert_ne!(addr, libc::MAP_FAILED);
        assert_eq!(libc::mincore(addr, len, vec.as_mut_ptr()), 0);
        libc::munmap(addr, len);
    }
    vec.iter().filter(|&&b| b & 1 == 1).count()
}

/// Bytes this thread has had read from the device, not served from the page cache.
fn device_reads() -> u64 {
    let io = std::fs::read_to_string("/proc/thread-self/io").unwrap();
    let line = io.lines().find(|l| l.starts_with("read_bytes:")).unwrap();
    line[11..].trim().parse().unwrap()
}

/// A file just written, its pages dirty and cached, has none cached once opened uncached: what
/// follows is read from the device. (Not on tmpfs, whose pages are its storage.)
#[test]
fn a_file_just_written_has_no_page_cached_once_opened_uncached() {
    let path = scratch("uncached").join("f");
    std::fs::write(&path, vec![7u8; 1 << 20]).unwrap();
    assert!(
        resident_pages(&File::open(&path).unwrap()) > 0,
        "the fresh file is not cached: the check proves nothing here"
    );
    let file = from_disk::open_uncached(&path).unwrap();
    assert_eq!(resident_pages(&file), 0);
}

/// A read of a cached file is served by the device, every byte, and returns the file.
#[test]
fn a_read_is_served_by_the_device() {
    let path = scratch("read").join("f");
    let bytes: Vec<u8> = (0..1u32 << 20).map(|i| i as u8).collect();
    std::fs::write(&path, &bytes).unwrap();
    File::open(&path)
        .unwrap()
        .read_to_end(&mut Vec::new())
        .unwrap();
    let before = device_reads();
    let read = from_disk::read(&path).unwrap();
    let served = device_reads() - before;
    assert_eq!(read, bytes);
    assert!(
        served >= bytes.len() as u64,
        "the device served {served} of {} bytes",
        bytes.len()
    );
}
