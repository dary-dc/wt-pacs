use super::*;
use std::time::{SystemTime, UNIX_EPOCH};
use series_bundle::write_bundle;

fn scratch(name: &str) -> std::path::PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{name}-{stamp}.sbnd"))
}

/// Two frames of different lengths — the smallest case that catches a reader computing
/// offsets by arithmetic instead of through the index.
#[test]
fn round_trip_from_writer() -> Result<()> {
    let f0 = b"frame-0";
    let f1 = b"frame-1-longer";
    let path = scratch("frame-store");
    write_bundle(
        &path,
        br#"{"frameCount":2}"#,
        &[f0.as_slice(), f1.as_slice()],
    )?;

    let store = FrameStore::open(&path)?;
    assert_eq!(store.frame_count(), 2);
    for (index, want) in [(0u32, f0.as_slice()), (1, f1.as_slice())] {
        let span = store.frame_span(index);
        let mut buf = vec![0u8; span.len as usize];
        store.read_at_blocking(&mut buf, span.offset)?;
        assert_eq!(buf, want, "frame {index}");
    }
    let _ = std::fs::remove_file(path);
    Ok(())
}

/// A series holding a frame no client would read stops the server at startup, naming the
/// frame. Laid out by hand, since the writer refuses it too; sparse, so nothing is written.
#[test]
fn a_study_with_an_oversized_frame_fails_to_open_naming_it() -> Result<()> {
    let too_big = frame_envelope::MAX_CODESTREAM_LEN as u32 + 1;
    let data_base = 16 + 12;
    let mut bytes = b"SBND".to_vec();
    for word in [1u32, 0, 1] {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    bytes.extend_from_slice(&(data_base as u64).to_le_bytes());
    bytes.extend_from_slice(&too_big.to_le_bytes());
    let path = scratch("frame-store-oversized");
    std::fs::write(&path, &bytes)?;
    File::options().write(true).open(&path)?.set_len(data_base + u64::from(too_big))?;
    let opened = FrameStore::open(&path);
    let _ = std::fs::remove_file(&path);
    let err = format!("{:#}", opened.err().expect("the oversized series opened"));
    assert!(err.contains("frame 0 "), "the refusal does not name the frame: {err}");
    Ok(())
}

/// `check-fastpath` is only worth running if it answers what the server will decide, so
/// this pins the agreement rather than trusting the shared `probe_nowait`.
#[test]
fn the_standalone_probe_agrees_with_the_store() -> Result<()> {
    let path = scratch("frame-store-probe-agrees");
    write_bundle(&path, br#"{"frameCount":1}"#, &[b"x".as_slice()])?;
    let store = FrameStore::open(&path)?;

    assert_eq!(
        nowait_supported_at(&path)?,
        store.nowait_supported(),
        "check-fastpath would report a different answer than the server acts on"
    );
    // A directory too: that is how the tool is used, before any series is in place.
    let dir = path.parent().expect("scratch dir");
    assert_eq!(
        nowait_supported_at(dir)?,
        store.nowait_supported(),
        "probing the directory disagrees with probing a file on the same mount"
    );
    let _ = std::fs::remove_file(&path);
    Ok(())
}

/// Where the mount serves a warm byte under `RWF_NOWAIT`, the store's probe says yes: a
/// probe stuck at no passes every other test while sending every read to the pool. The
/// oracle is its own `preadv2`, not `probe_nowait`, so the two cannot be wrong together.
#[test]
fn the_probe_finds_nowait_where_the_mount_has_it() -> Result<()> {
    let path = scratch("frame-store-probe-yes");
    write_bundle(&path, br#"{"frameCount":1}"#, &[b"warm".as_slice()])?;
    let file = File::open(&path)?;
    let mut byte = [0u8; 1];
    let iov = libc::iovec {
        iov_base: byte.as_mut_ptr() as *mut libc::c_void,
        iov_len: 1,
    };
    // SAFETY: `iov` describes a live, exclusively borrowed one-byte buffer.
    let n = unsafe { libc::preadv2(file.as_raw_fd(), &iov, 1, 0, libc::RWF_NOWAIT) };
    let refused = (n < 0).then(std::io::Error::last_os_error);
    let store = FrameStore::open(&path)?;
    let _ = std::fs::remove_file(&path);

    if let Some(err) = refused {
        eprintln!(
            "SKIPPED: the_probe_finds_nowait_where_the_mount_has_it: \
             a warm RWF_NOWAIT read is refused on this mount ({err})"
        );
        return Ok(());
    }
    assert!(
        store.nowait_supported(),
        "this mount served a warm byte under RWF_NOWAIT, yet the probe says unsupported"
    );
    Ok(())
}

/// The serving path is only correct if `read_at_blocking` can complete a short
/// `read_at_nowait` at the offset it stopped at.
#[test]
fn nowait_and_blocking_compose_into_the_whole_frame() -> Result<()> {
    let body: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
    let path = scratch("frame-store-nowait");
    write_bundle(&path, br#"{"frameCount":1}"#, &[body.as_slice()])?;
    let store = FrameStore::open(&path)?;
    let span = store.frame_span(0);

    let mut out = vec![0u8; span.len as usize];
    let mut pos = 0usize;
    while pos < out.len() {
        let want = TEST_CHUNK.min(out.len() - pos);
        let at = span.offset + pos as u64;
        let got = store.read_at_nowait(&mut out[pos..pos + want], at)?;
        assert!(got <= want, "nowait overran the window: {got} > {want}");
        if got < want {
            store.read_at_blocking(&mut out[pos + got..pos + want], at + got as u64)?;
        }
        pos += want;
    }
    assert_eq!(out, body);
    let _ = std::fs::remove_file(path);
    Ok(())
}
