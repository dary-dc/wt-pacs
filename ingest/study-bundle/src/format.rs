//! Shared SBND layout constants and header/index parser.

use anyhow::{bail, ensure, Context, Result};
use frame_envelope::MAX_CODESTREAM_LEN;
use std::fs::File;
use std::os::unix::fs::FileExt;

pub const MAGIC: &[u8; 4] = b"SBND";
pub const VERSION: u32 = 1;

pub const HEADER_SIZE: usize = 16;
pub const INDEX_ENTRY_SIZE: usize = 12;

/// Header, index and metadata — everything before the first frame.
#[derive(Debug, Clone)]
pub struct ParsedLayout {
    pub index: Vec<(u64, u32)>,
    pub metadata: String,
    pub data_base: usize,
}

/// `bytes` is the prefix; `file_len` is the study file, which the index is checked against.
fn parse_layout_checked(bytes: &[u8], file_len: u64) -> Result<ParsedLayout> {
    if bytes.len() < HEADER_SIZE {
        bail!("bundle too small");
    }
    if &bytes[0..4] != MAGIC {
        bail!("invalid magic (expected SBND)");
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into()?);
    if version != VERSION {
        bail!("unsupported bundle version {version}");
    }
    let metadata_len = u32::from_le_bytes(bytes[8..12].try_into()?);
    let frame_count = u32::from_le_bytes(bytes[12..16].try_into()?);
    let index_bytes = frame_count as usize * INDEX_ENTRY_SIZE;
    let header_bytes = HEADER_SIZE + index_bytes;
    let data_base = header_bytes + metadata_len as usize;
    if data_base > bytes.len() {
        bail!("bundle header/metadata extends past file end");
    }

    let mut index = Vec::with_capacity(frame_count as usize);
    for i in 0..frame_count as usize {
        let base = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
        let offset = u64::from_le_bytes(bytes[base..base + 8].try_into()?);
        let length = u32::from_le_bytes(bytes[base + 8..base + 12].try_into()?);
        let end = offset
            .checked_add(u64::from(length))
            .filter(|&end| offset >= data_base as u64 && end <= file_len);
        if end.is_none() {
            bail!(
                "frame {i} index entry (offset {offset}, length {length}) lies outside the data \
                 region ({data_base}..{file_len})"
            );
        }
        check_frame_len(i, length)?;
        index.push((offset, length));
    }

    let metadata = std::str::from_utf8(&bytes[header_bytes..data_base])
        .context("metadata is not UTF-8")?
        .to_owned();

    Ok(ParsedLayout {
        index,
        metadata,
        data_base,
    })
}

/// A frame no client would read is refused when the study is written or opened, naming it.
pub(crate) fn check_frame_len(index: usize, length: u32) -> Result<()> {
    ensure!(
        length as usize <= MAX_CODESTREAM_LEN,
        "frame {index} is {length} bytes, over the {MAX_CODESTREAM_LEN}-byte codestream a client reads"
    );
    Ok(())
}

#[cfg(test)]
fn parse_layout(bytes: &[u8]) -> Result<ParsedLayout> {
    parse_layout_checked(bytes, bytes.len() as u64)
}

/// Two preads: the fixed header, then the whole prefix. Index entries use the file length.
pub fn read_layout(file: &File) -> Result<ParsedLayout> {
    let file_len = file.metadata().context("stat bundle")?.len();
    let mut prefix = vec![0u8; HEADER_SIZE];
    file.read_exact_at(&mut prefix, 0).context("read header")?;
    let len = prefix_len(&prefix)?;
    ensure!(
        len <= file_len,
        "bundle header declares {len} bytes of index and metadata in a {file_len}-byte file"
    );
    prefix.resize(len as usize, 0);
    file.read_exact_at(&mut prefix, 0).context("read index")?;
    parse_layout_checked(&prefix, file_len)
}

/// Bytes from the start of the file up to the first frame, read off the fixed header.
fn prefix_len(header: &[u8]) -> Result<u64> {
    if header.len() < HEADER_SIZE {
        bail!("bundle too small");
    }
    let metadata_len = u32::from_le_bytes(header[8..12].try_into()?);
    let frame_count = u32::from_le_bytes(header[12..16].try_into()?);
    let index_len = u64::from(frame_count) * INDEX_ENTRY_SIZE as u64;
    Ok(HEADER_SIZE as u64 + index_len + u64::from(metadata_len))
}

/// A bundle laid out by hand from the format, for the parser and the writer to be checked against.
#[cfg(test)]
pub(crate) fn bundle(frames: &[&[u8]], metadata: &[u8]) -> Vec<u8> {
    let data_base = HEADER_SIZE + frames.len() * INDEX_ENTRY_SIZE + metadata.len();
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
    out.extend_from_slice(&(frames.len() as u32).to_le_bytes());
    let mut offset = data_base as u64;
    for frame in frames {
        out.extend_from_slice(&offset.to_le_bytes());
        out.extend_from_slice(&(frame.len() as u32).to_le_bytes());
        offset += frame.len() as u64;
    }
    out.extend_from_slice(metadata);
    for frame in frames {
        out.extend_from_slice(frame);
    }
    out
}

#[cfg(test)]
mod tests {
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
        set_entry(&mut bytes, 0, u64::MAX - 1, 4);
        assert!(parse_layout(&bytes).is_err(), "offset + length overflows");
    }

    /// A frame over the client's limit fails the study at open, naming the frame, rather than
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
}
