use super::*;

fn set_entry(bytes: &mut [u8], i: usize, offset: u64, length: u32) {
    let base = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
    bytes[base..base + 8].copy_from_slice(&offset.to_le_bytes());
    bytes[base + 8..base + 12].copy_from_slice(&length.to_le_bytes());
}

#[test]
fn well_formed_bundle_parses() {
    let bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
    let layout = parse_layout(&bytes).unwrap();
    assert_eq!(layout.index.len(), 2);
    assert_eq!(layout.index[0], (layout.data_base as u64, 3));
    assert_eq!(layout.index[1], (layout.data_base as u64 + 3, 4));
    assert_eq!(layout.metadata, "{}");
}

/// A header that declares more index than its file holds is refused before anything is
/// allocated for it, rather than by running out of memory.
#[test]
fn a_header_larger_than_its_file_is_refused_before_allocating() {
    let mut header = bundle(&[], b"");
    header[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
    let path = std::env::temp_dir().join(format!("sbnd-huge-{}.sbnd", std::process::id()));
    std::fs::write(&path, &header).unwrap();
    let got = read_layout(&File::open(&path).unwrap());
    let _ = std::fs::remove_file(&path);
    assert!(got.is_err(), "a 16-byte file declaring u32::MAX frames was accepted");
}

/// An index entry that points past the end of the file is a corrupt bundle. It must be
/// refused when the bundle is opened, not discovered frame by frame while serving.
#[test]
fn index_entry_past_file_end_is_refused_at_parse() {
    let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
    let len = bytes.len();
    set_entry(&mut bytes, 1, len as u64 - 2, 4);
    assert!(
        parse_layout(&bytes).is_err(),
        "frame 1 runs 2 bytes past EOF"
    );

    let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
    set_entry(&mut bytes, 1, len as u64 - 3, 4);
    assert!(parse_layout(&bytes).is_err(), "frame 1 runs 1 byte past EOF");

    let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
    set_entry(&mut bytes, 0, u64::MAX - 1, 4);
    assert!(parse_layout(&bytes).is_err(), "offset + length overflows");
}

/// A frame over the client's limit fails the series at open, naming the frame, rather than
/// every client that asks for it. The file is sparse: the entry must also lie inside it.
#[test]
fn an_oversized_frame_is_refused_at_open_naming_it() {
    let length = MAX_CODESTREAM_LEN as u32 + 1;
    let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
    let data_end = bytes.len() as u64;
    set_entry(&mut bytes, 1, data_end, length);
    let path = std::env::temp_dir().join(format!("sbnd-oversized-{}.sbnd", std::process::id()));
    std::fs::write(&path, &bytes).unwrap();
    let file = File::options().read(true).write(true).open(&path).unwrap();
    file.set_len(data_end + u64::from(length)).unwrap();
    let got = read_layout(&file);
    let _ = std::fs::remove_file(&path);
    let err = format!("{:#}", got.expect_err("a frame over the limit was accepted"));
    assert!(err.contains("frame 1 "), "the refusal does not name the frame: {err}");
}

/// Frames live after the metadata; an entry inside the header or index is corrupt too.
#[test]
fn index_entry_before_data_base_is_refused_at_parse() {
    let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
    set_entry(&mut bytes, 0, 0, 3);
    assert!(
        parse_layout(&bytes).is_err(),
        "frame 0 points at the header"
    );
}

/// A file too short for a header, a wrong magic and an unknown version are each refused by name.
#[test]
fn a_file_that_is_not_a_bundle_is_refused_by_name() {
    let good = bundle(&[b"aaa"], b"{}");
    let refusal = |b: &[u8]| parse_layout(b).unwrap_err().to_string();
    assert!(refusal(&good[..10]).contains("too small"));
    let mut b = good.clone();
    b[0] = b'X';
    assert!(refusal(&b).contains("magic"));
    let mut b = good.clone();
    b[4..8].copy_from_slice(&2u32.to_le_bytes());
    assert!(refusal(&b).contains("version 2"));
}

/// Metadata declared past the bytes in hand is refused, not sliced out of bounds.
#[test]
fn metadata_past_the_prefix_is_refused() {
    let mut b = bundle(&[], b"{}");
    b[8..12].copy_from_slice(&100u32.to_le_bytes());
    assert!(parse_layout(&b).unwrap_err().to_string().contains("past file end"));
}
