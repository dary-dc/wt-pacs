use super::*;

/// A series of `frames` frames, each a different length, so a span cannot match by luck.
fn series(path: &std::path::Path, frames: u32) {
    let bodies: Vec<Vec<u8>> = (0..frames).map(|i| vec![i as u8; 4 + i as usize]).collect();
    let refs: Vec<&[u8]> = bodies.iter().map(|b| b.as_slice()).collect();
    series_bundle::write_bundle(
        path,
        format!("{{\"frameCount\":{frames}}}").as_bytes(),
        &refs,
    )
    .expect("write series");
}

/// Serves nothing from disk: `read` hands back an empty frame, and `write` takes
/// `write_delay`, so a test can tell the stages apart.
struct StubPipeline {
    store: Arc<FrameStore>,
    write_delay: std::time::Duration,
}

impl FramePipeline for StubPipeline {
    fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    async fn read(&mut self, _frame: u32, _next: &Next) -> Result<Bytes> {
        Ok(Bytes::new())
    }

    async fn write(&mut self, _frame: u32, _body: Bytes, _ask: bool) -> Result<()> {
        if !self.write_delay.is_zero() {
            tokio::time::sleep(self.write_delay).await;
        }
        Ok(())
    }

    async fn refuse(&mut self, _frame: u32, _reason: String) -> Result<()> {
        Ok(())
    }

    async fn finish(&mut self) {}
}

fn recorder(tag: &str, frames: u32) -> (std::path::PathBuf, StubPipeline) {
    let path = std::env::temp_dir().join(format!("wtpacs-{tag}-{}.sbnd", std::process::id()));
    series(&path, frames);
    let store = Arc::new(FrameStore::open(&path).expect("open store"));
    (path, StubPipeline { store, write_delay: std::time::Duration::ZERO })
}

/// **The seam.** The planner's frame indexes become the spans the read path starts on, a
/// fill's one frame ahead included. Nothing on the wire and no other test can see that
/// line, so this one owns it. `docs/adr/disk-access.md`.
#[test]
fn every_named_frame_reaches_the_read_path_as_its_span() {
    let (path, rec) = recorder("seam", 4);
    let store = &rec.store;
    let want: Vec<FrameSpan> = [1u32, 2, 3].iter().map(|&f| store.frame_span(f)).collect();
    assert_eq!(ahead(store, &Next::Tiles(vec![1, 2, 3])), want, "the planner's names did not reach the read path");
    let fill = Next::Fill { after: Some(3), first: true };
    assert_eq!(ahead(store, &fill), vec![store.frame_span(3)], "a fill's next frame was lost");
    assert_eq!(ahead(store, &Next::Fill { after: None, first: false }), vec![]);
    let _ = std::fs::remove_file(&path);
}

/// A frame slow on the wire shows as `write_us`, not `read_us`: the split a slow frame's
/// row exists to make. `docs/adr/telemetry-server-pipeline.md`.
#[cfg(feature = "telemetry")]
#[test]
fn a_slow_write_lands_in_write_us_not_read_us() {
    use crate::record::tap::{Live, Record};
    let (path, mut rec) = recorder("slow-write", 2);
    rec.write_delay = std::time::Duration::from_millis(20);
    let (tx, rows) = std::sync::mpsc::sync_channel(64);
    let mut recorded = RecordedPipeline::new(rec, Tap::new(1, Some(tx), &Live::default()));
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("rt");
    rt.block_on(recorded.serve(0, &Next::Tiles(vec![]))).expect("serve");
    drop(recorded);
    let row = rows
        .try_iter()
        .flatten()
        .find_map(|r| match r {
            Record::Frame(f) => Some(f),
            Record::Session(_) => None,
        })
        .expect("a frame row");
    let (read, write) = (row.read_us.expect("read"), row.write_us.expect("write"));
    assert!(write >= 20_000, "the slow write is missing from write_us: {row:?}");
    assert!(read < 20_000, "the slow write landed in read_us: {row:?}");
    let _ = std::fs::remove_file(&path);
}

/// **A refusal is its own row.** The planner refuses a `stream_frames` range and a frame
/// outside the series before any frame opens; each row carries the refused frame, not the
/// last one served, and every row opened is closed. `docs/adr/telemetry-server-pipeline.md`.
#[cfg(feature = "telemetry")]
#[test]
fn a_refused_range_records_a_row_of_its_own() {
    use crate::record::tap::{Live, Record};
    use crate::transport::planner::{Command, ASKS_AHEAD};
    let (path, rec) = recorder("refused-row", 4);
    let (tx, rows) = std::sync::mpsc::sync_channel(64);
    let mut recorded = RecordedPipeline::new(rec, Tap::new(1, Some(tx), &Live::default()));
    let (asks_tx, mut asks) = tokio::sync::mpsc::channel(ASKS_AHEAD);
    asks_tx.try_send(Command::Frame(1)).expect("queue ask");
    asks_tx.try_send(Command::Fill { from: Some(6), to: Some(9) }).expect("queue fill");
    asks_tx.try_send(Command::Frame(99)).expect("queue ask");
    drop(asks_tx);
    let rt = tokio::runtime::Builder::new_current_thread().build().expect("rt");
    rt.block_on(crate::transport::server::drive(&mut recorded, &mut asks)).expect("drive");
    drop(recorded);

    let records: Vec<Record> = rows.try_iter().flatten().collect();
    let frames: Vec<(u32, u8)> = records
        .iter()
        .filter_map(|r| match r {
            Record::Frame(f) => Some((f.frame_index, f.write_outcome)),
            Record::Session(_) => None,
        })
        .collect();
    assert_eq!(frames, vec![(1, 0), (6, 2), (99, 2)], "a refusal's row is not its own");
    let Some(Record::Session(session)) = records.last() else { panic!("no session row") };
    assert_eq!(
        (session.rows_opened, session.rows_closed),
        (3, 3),
        "rows opened and rows closed disagree"
    );
    let _ = std::fs::remove_file(&path);
}

/// **One index per series, never per session** — nothing in the type system prevents a
/// session opening its own store, so this pins the shape it actually gets.
/// `docs/adr/disk-access.md` §Invariants.
#[test]
fn sessions_share_one_store_rather_than_opening_their_own() {
    let path = std::env::temp_dir().join(format!("wtpacs-share-{}.sbnd", std::process::id()));
    series(&path, 1);
    let store = Arc::new(FrameStore::open(&path).expect("open store"));

    let sessions = 8;
    let pipelines: Vec<ProductPipeline> = (0..sessions)
        .map(|_| ProductPipeline::new(Arc::clone(&store), Link::Detached, ReadMode::Auto))
        .collect();

    for (n, pipeline) in pipelines.iter().enumerate() {
        assert!(
            Arc::ptr_eq(pipeline.store(), &store),
            "session {n} is reading through a store of its own"
        );
    }
    assert_eq!(
        Arc::strong_count(&store),
        sessions + 1,
        "one clone per session and the original, and nothing else"
    );
    let _ = std::fs::remove_file(&path);
}
