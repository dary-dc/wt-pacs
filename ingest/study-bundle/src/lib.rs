//! SBND on-disk format and streaming writer (ingest).

pub mod format;
pub mod writer;

pub use format::{
    aligned_frame_starts, parse_layout, read_layout, ParsedLayout, FRAME_ALIGN, HEADER_SIZE,
    INDEX_ENTRY_SIZE, MAGIC, VERSION,
};
pub use writer::{write_bundle, BundleWriter};
