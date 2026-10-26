#[cfg(test)]
mod tests {
    use std::os::fd::AsRawFd;
    use std::path::PathBuf;
    use std::process::Command;

    fn scratch(name: &str) -> PathBuf {
        let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Pages of the file resident in the page cache, by mincore over a mapping that touches none.
    fn resident_pages(file: &std::fs::File) -> usize {
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

    /// A file just written, its pages dirty and cached, has none cached once opened for checking:
    /// what follows is read from the device. (Not on tmpfs, whose pages are its storage.)
    #[test]
    fn a_file_opened_for_checking_has_no_page_cached() {
        let path = scratch("uncached").join("f");
        std::fs::write(&path, vec![7u8; 1 << 20]).unwrap();
        assert!(
            resident_pages(&std::fs::File::open(&path).unwrap()) > 0,
            "the fresh file is not cached: the check proves nothing here"
        );
        let file = pacs_verify::disk::open_uncached(&path).unwrap();
        assert_eq!(resident_pages(&file), 0);
    }

    /// Bytes this thread has had read from the device, not served from the page cache.
    fn device_reads() -> u64 {
        let io = std::fs::read_to_string("/proc/thread-self/io").unwrap();
        let line = io.lines().find(|l| l.starts_with("read_bytes:")).unwrap();
        line[11..].trim().parse().unwrap()
    }

    /// A bundle and a study DB just written, their pages cached, are each checked from the device:
    /// it serves at least every byte of the frames, and of the group row.
    #[test]
    fn a_check_reads_each_file_from_the_device() {
        let dir = scratch("device");
        let frames = vec![vec![5u8; 1 << 18]; 4];
        let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();
        let bundle = dir.join("1A.sbnd");
        series_bundle::write_bundle(&bundle, b"{}", &refs).unwrap();
        let db = dir.join(study_db::FILE_NAME);
        let conn = rusqlite::Connection::open(&db).unwrap();
        study_db::create(&conn).unwrap();
        study_db::put(&conn, "series", "1A", &frames.concat()).unwrap();
        drop(conn);
        let written = (1 << 18) * 4;
        for path in [&bundle, &db] {
            let before = device_reads();
            let findings = pacs_verify::verify(path);
            let read = device_reads() - before;
            assert!(
                findings
                    .iter()
                    .all(|f| f.result == pacs_verify::Outcome::Ok),
                "{findings:?}"
            );
            assert!(
                read >= written,
                "{}: the device served {read} of {written} bytes",
                path.display()
            );
        }
    }

    /// The binary exits 0 on a sound study, 1 when a check fails, and writes JSON lines with --json.
    #[test]
    fn the_exit_code_is_non_zero_on_any_failure() {
        let dir = scratch("exit");
        series_bundle::write_bundle(&dir.join("1A.sbnd"), b"{}", &[b"aaa"]).unwrap();
        let run = |args: &[&std::ffi::OsStr]| {
            Command::new(env!("CARGO_BIN_EXE_pacs-verify"))
                .args(args)
                .output()
                .unwrap()
        };
        let json = dir.join("report.jsonl");
        let sound = run(&[dir.as_os_str(), "--json".as_ref(), json.as_os_str()]);
        assert_eq!(sound.status.code(), Some(0), "{sound:?}");
        assert_eq!(std::fs::read_to_string(&json).unwrap().lines().count(), 2);

        std::fs::write(dir.join("1B.sbnd"), b"SBND").unwrap();
        let broken = run(&[dir.as_os_str()]);
        assert_eq!(broken.status.code(), Some(1), "{broken:?}");
        assert!(String::from_utf8_lossy(&broken.stdout).contains("FAIL "));
    }
}
