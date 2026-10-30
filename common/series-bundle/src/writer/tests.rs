use super::*;
use crate::format::bundle;

/// The writer lays a bundle out byte for byte as the format does: header, index of offset
/// then length, metadata, frames.
#[test]
fn the_writer_lays_out_the_format_byte_for_byte() -> Result<()> {
    let meta = br#"{"frameCount":3}"#;
    let frames: [&[u8]; 3] = [b"aaa", b"bbbb", b"cc"];
    let path = std::env::temp_dir().join(format!("sbnd-writer-{}.sbnd", std::process::id()));
    write_bundle(&path, meta, &frames)?;
    let written = std::fs::read(&path)?;
    let _ = std::fs::remove_file(&path);
    assert_eq!(written, bundle(&frames, meta));
    Ok(())
}

/// A series with a frame no client would read is refused before anything is written.
#[test]
fn the_writer_refuses_an_oversized_frame_naming_it() {
    let path = std::env::temp_dir().join(format!("sbnd-writer-big-{}.sbnd", std::process::id()));
    let too_big = frame_envelope::MAX_CODESTREAM_LEN as u32 + 1;
    let err = BundleWriter::create(&path, b"{}", &[3, too_big]).err().expect("accepted");
    assert!(format!("{err:#}").contains("frame 1 "), "the refusal does not name the frame: {err:#}");
    assert!(!path.exists(), "the refused series was written anyway");
}

/// A frame of another length than its index entry, and a bundle finished short of its
/// count, are refused: the index was written first and cannot be corrected.
#[test]
fn the_writer_refuses_what_its_index_did_not_declare() -> Result<()> {
    let path = std::env::temp_dir().join(format!("sbnd-refuse-{}.sbnd", std::process::id()));
    let mut writer = BundleWriter::create(&path, b"{}", &[3, 4])?;
    let longer = writer.write_frame(b"aaaa");
    writer.write_frame(b"aaa")?;
    let short = writer.finish();
    let _ = std::fs::remove_file(&path);
    assert!(longer.is_err(), "a 4-byte frame where 3 were declared was written");
    assert!(short.unwrap_err().to_string().contains("1 of 2"));
    Ok(())
}

/// A pack that fails midway leaves nothing at its name and no partial; one that finishes
/// leaves the bundle at its name and no partial.
#[test]
fn only_a_finished_pack_is_published_and_no_partial_is_left() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("sbnd-partial-{}", std::process::id()));
    let path = dir.join("s.sbnd");
    let partial = dir.join("s.sbnd.partial");

    let mut writer = BundleWriter::create(&path, b"{}", &[3, 4])?;
    writer.write_frame(b"aaa")?;
    assert!(writer.write_frame(b"bbb").is_err(), "a 3-byte frame where 4 were declared was written");
    drop(writer);
    let failed = (path.exists(), partial.exists());

    write_bundle(&path, b"{}", &[b"aaa", b"bbbb"])?;
    let finished = (path.exists(), partial.exists());
    let _ = std::fs::remove_dir_all(&dir);

    assert_eq!(failed, (false, false), "a failed pack left (bundle, partial)");
    assert_eq!(finished, (true, false), "a finished pack left (bundle, partial)");
    Ok(())
}
