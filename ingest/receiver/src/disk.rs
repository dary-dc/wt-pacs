//! Durability and reads from disk: docs/adr/pacs-receiver.md §3.

use anyhow::{Context, Result};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use xxhash_rust::xxh3::Xxh3;

pub fn sync_dir(dir: &Path) -> Result<()> {
    File::open(dir)
        .and_then(|d| d.sync_all())
        .with_context(|| format!("fsync {}", dir.display()))
}

/// XXH3-64 of a file as read, streamed; `from_disk` reads it from the device.
pub fn hash_file(path: &Path, from_disk: bool) -> Result<u64> {
    let file = if from_disk {
        from_disk::open_uncached(path)
    } else {
        File::open(path)
    };
    let mut file = file.with_context(|| format!("open {}", path.display()))?;
    let mut hasher = Xxh3::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = file
            .read(&mut buffer)
            .with_context(|| format!("read {}", path.display()))?;
        if n == 0 {
            return Ok(hasher.digest());
        }
        hasher.update(&buffer[..n]);
    }
}

/// `<path>.partial`, fsync, rename over `path`, fsync of the directory.
pub fn write_durably(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut partial = path.as_os_str().to_owned();
    partial.push(".partial");
    let mut file = File::create(&partial).with_context(|| format!("create {}", path.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(&partial, path).with_context(|| format!("rename to {}", path.display()))?;
    sync_dir(path.parent().context("a path with no directory")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::device_reads;

    /// The read-back reads from the device: with the file cached, `from_disk::read` and a hash
    /// `from_disk` each have its every byte read from the device again, and a plain hash none.
    #[test]
    fn the_read_back_reads_from_the_device_not_the_cache() {
        let path = crate::tests::scratch("from-disk").join("f");
        let len = 1 << 20;
        let mut file = File::create(&path).unwrap();
        file.write_all(&vec![7u8; len]).unwrap();
        file.sync_all().unwrap();
        hash_file(&path, false).unwrap();
        let device = |read: &dyn Fn()| {
            let before = device_reads();
            read();
            device_reads() - before
        };
        assert_eq!(
            device(&|| {
                hash_file(&path, false).unwrap();
            }),
            0,
            "the file was not cached"
        );
        assert!(device(&|| drop(from_disk::read(&path).unwrap())) >= len as u64);
        assert!(
            device(&|| {
                hash_file(&path, true).unwrap();
            }) >= len as u64
        );
    }

    /// A durable write leaves the bytes under the name and no partial beside them.
    #[test]
    fn a_durable_write_leaves_the_file_and_no_partial() {
        let dir = crate::tests::scratch("durable");
        let path = dir.join("status");
        write_durably(&path, b"stored\n").unwrap();
        write_durably(&path, b"refused x\n").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"refused x\n");
        assert!(!dir.join("status.partial").exists());
    }

    /// The streamed hash is XXH3-64 of the whole file, past one buffer.
    #[test]
    fn the_file_hash_is_xxh3_of_every_byte() {
        let dir = crate::tests::scratch("hash");
        let path = dir.join("f");
        let bytes: Vec<u8> = (0..3_000_000u32).map(|i| i as u8).collect();
        std::fs::write(&path, &bytes).unwrap();
        let want = xxhash_rust::xxh3::xxh3_64(&bytes);
        assert_eq!(hash_file(&path, false).unwrap(), want);
        assert_eq!(hash_file(&path, true).unwrap(), want);
    }
}
