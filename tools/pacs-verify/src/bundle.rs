//! A series bundle: its layout through `series-bundle`, then every frame read back from disk.

use crate::Finding;
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::path::Path;

/// The target's version, a draft with no reader yet: docs/disk-layout/target.md.
const DRAFT_VERSION: u32 = 2;

pub(crate) fn check(path: &Path, findings: &mut Vec<Finding>) {
    let file = match from_disk::open_uncached(path) {
        Ok(file) => file,
        Err(e) => return findings.push(Finding::fail(path, "open", e)),
    };
    let layout = match series_bundle::read_layout(&file) {
        Ok(layout) => layout,
        Err(e) if version(&file) == Some(DRAFT_VERSION) => {
            let why = "version 2 is the draft target (docs/disk-layout/target.md); series-bundle has no reader for it yet";
            return findings.push(Finding::fail(path, "layout", format!("{e:#}: {why}")));
        }
        Err(e) => return findings.push(Finding::fail(path, "layout", format!("{e:#}"))),
    };
    let frames = layout.index.len();
    findings.push(Finding::ok(
        path,
        "layout",
        format!(
            "version 1, {frames} frames, every index entry inside the file and under the frame cap"
        ),
    ));

    let mut bytes = Vec::new();
    for (i, &(offset, length)) in layout.index.iter().enumerate() {
        bytes.resize(length as usize, 0);
        if let Err(e) = file.read_exact_at(&mut bytes, offset) {
            return findings.push(Finding::fail(path, "frames", format!("frame {i}: {e}")));
        }
    }
    findings.push(Finding::ok(
        path,
        "frames",
        format!(
            "{frames} frames read from disk; version 1 carries no coded hash to check them against"
        ),
    ));
}

fn version(file: &File) -> Option<u32> {
    let mut field = [0u8; 4];
    file.read_exact_at(&mut field, 4).ok()?;
    Some(u32::from_le_bytes(field))
}
