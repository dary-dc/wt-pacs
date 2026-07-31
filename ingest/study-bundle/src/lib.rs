//! SBND on-disk format and streaming writer (ingest).

pub mod format;
pub mod writer;

pub use format::{
    parse_layout, ParsedLayout, HEADER_SIZE, INDEX_ENTRY_SIZE, MAGIC, VERSION,
};
pub use writer::{BundleWriter, write_bundle};
