use super::*;
use crate::media::frame_store::TEST_CHUNK;

/// A series of `frames` frames of `len` bytes, each filled with a per-frame pattern so a
/// mis-assembled frame cannot pass by accident.
fn write_bundle(dir: &std::path::Path, frames: u32, len: u32) -> std::path::PathBuf {
    let bodies: Vec<Vec<u8>> = (0..frames).map(|i| frame_pattern(i, len)).collect();
    let refs: Vec<&[u8]> = bodies.iter().map(Vec::as_slice).collect();
    let path = dir.join("test.sbnd");
    series_bundle::write_bundle(&path, format!("{{\"frameCount\":{frames}}}").as_bytes(), &refs)
        .expect("write bundle");
    path
}

fn frame_pattern(idx: u32, len: u32) -> Vec<u8> {
    (0..len)
        .map(|b| (b.wrapping_mul(31).wrapping_add(idx.wrapping_mul(7)) % 251) as u8)
        .collect()
}

fn scratch(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("wtpacs-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("tmpdir");
    dir
}

fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("rt")
}

fn spans(store: &Arc<FrameStore>, idx: &[u32]) -> Vec<FrameSpan> {
    idx.iter()
        .map(|&i| store.frame_span(i))
        .collect()
}

/// Six chunks long, so a frame read whole can be told from one read a chunk at a time.
const LEN: u32 = (TEST_CHUNK * 5 + 17) as u32;
const SHORT: usize = TEST_CHUNK / 3;

/// **The ADR's claim, as an assertion**: a miss reads to the end of the *frame*, so a
/// missing frame costs one round trip however wide it is. Capping the probe at
/// 64 KiB cost +55–82 % at two chunks and up; `docs/adr/disk-access.md`.
#[test]
fn a_missing_frame_costs_one_round_trip_however_wide_it_is() {
    let dir = scratch("oneshot");
    let path = write_bundle(&dir, 2, 250_000);
    let mut store = FrameStore::open(&path).expect("open");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let span = store.frame_span(0);

    for (name, got) in [
        ("fill", {
            store.reset_pool_starts();
            let mut fill = FillReader::new(Arc::clone(&store));
            let out = rt
                .block_on(fill.read(span, None))
                .expect("read")
                .to_vec();
            (out, store.pool_starts())
        }),
        ("tile", {
            store.reset_pool_starts();
            let mut tile = TileReader::new(ReadMode::Pool, Arc::clone(&store), TILE_SLOTS);
            let out = rt
                .block_on(tile.read(span, &[]))
                .expect("read")
                .to_vec();
            (out, store.pool_starts())
        }),
    ] {
        assert_eq!(got.0, frame_pattern(0, 250_000), "{name} came back wrong");
        assert_eq!(got.1, 1, "{name} started {} blocking reads, not 1", got.1);
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// Every frame, whole, on both readers and whichever escalation the host allows.
#[test]
fn both_readers_reassemble_every_frame() {
    let dir = scratch("compose-all");
    let path = write_bundle(&dir, 4, LEN);
    let rt = rt();
    for pooled in [false, true] {
        let mut store = FrameStore::open(&path).expect("open store");
        if pooled {
            store.force_pool_reads();
        }
        let store = Arc::new(store);
        let mut fill = FillReader::new(Arc::clone(&store));
        let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(&store), TILE_SLOTS);
        for idx in 0..4u32 {
            let span = store.frame_span(idx);
            let next = (idx + 1 < 4).then(|| store.frame_span(idx + 1));
            let got = rt.block_on(fill.read(span, next)).expect("fill");
            assert_eq!(&got[..], &frame_pattern(idx, LEN)[..], "fill {idx}, pooled={pooled}");
            let one = rt.block_on(tile.read(span, &[])).expect("tile");
            assert_eq!(&one[..], &frame_pattern(idx, LEN)[..], "tile {idx}, pooled={pooled}");
        }
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// **The fill reader's whole point.** Naming the next frame starts its read now, so the
/// call that asks for it does not start one.
#[test]
fn a_named_fill_frame_is_read_before_it_is_asked_for() {
    let dir = scratch("readahead");
    let path = write_bundle(&dir, 2, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let [first, second] = spans(&store, &[0, 1])[..] else {
        unreachable!("two frames")
    };

    let mut fill = FillReader::new(Arc::clone(&store));
    rt.block_on(fill.read(first, Some(second)))
        .expect("first");
    store.reset_pool_starts();
    let out = rt.block_on(fill.read(second, None)).expect("second");
    assert_eq!(
        &out[..],
        &frame_pattern(1, LEN)[..],
        "the read-ahead served wrong bytes"
    );
    assert_eq!(
        store.pool_starts(),
        0,
        "the named frame was read again instead of being served from the read-ahead"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// A fill holds **one** read at a time whatever it names, which is what bounds its
/// blocking threads at scale. `docs/adr/disk-access.md` §Fill at scale.
#[test]
fn a_fill_never_holds_more_than_one_read_at_once() {
    let dir = scratch("onedeep");
    let path = write_bundle(&dir, 8, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let mut fill = FillReader::new(Arc::clone(&store));
    for idx in 0..8u32 {
        let span = store.frame_span(idx);
        let next = (idx + 1 < 8).then(|| store.frame_span(idx + 1));
        rt.block_on(fill.read(span, next)).expect("read");
    }
    assert_eq!(
        fill.stats().peak_in_flight,
        1,
        "a fill queued more than one read; its threads no longer scale with sessions"
    );
    assert_eq!(fill.stats().misses, 8, "precondition: every frame missed");
    std::fs::remove_dir_all(&dir).ok();
}

/// A fill asks the kernel for `FILL_WINDOW` past the named frame, extends it only once a
/// quarter window has been walked, and restarts it on a seek past it. Without the
/// advice a 250 kB fill at the stock 128 KiB read-ahead misses six frames in ten —
/// `docs/adr/disk-access.md`.
#[test]
fn a_fill_tells_the_kernel_what_follows_the_named_frame() {
    let dir = scratch("advise");
    let path = write_bundle(&dir, 24, LEN);
    let store = Arc::new(FrameStore::open(&path).expect("open store"));
    let rt = rt();
    let all = spans(&store, &(0..24u32).collect::<Vec<_>>());
    let end = |s: FrameSpan| s.offset + u64::from(s.len);

    let mut fill = FillReader::new(Arc::clone(&store));
    rt.block_on(fill.read(all[0], Some(all[1]))).expect("read");
    assert_eq!(
        store.take_advice(),
        vec![(end(all[1]), FILL_WINDOW)],
        "the first frame asks for one whole window past the named frame"
    );
    let mut walked = 0u64;
    for i in 1..20u32 {
        rt.block_on(fill.read(all[i as usize], Some(all[i as usize + 1])))
            .expect("read");
        walked += u64::from(all[i as usize + 1].len);
        let advice = store.take_advice();
        if walked < FILL_WINDOW / 4 {
            assert!(advice.is_empty(), "frame {i}: advised again inside a quarter window");
        } else {
            assert_eq!(
                advice,
                vec![(end(all[1]) + FILL_WINDOW, walked)],
                "frame {i}: the extension does not start where the window ended"
            );
            break;
        }
    }
    assert!(walked >= FILL_WINDOW / 4, "the walk never extended the window");
    rt.block_on(fill.read(all[20], Some(all[21]))).expect("read");
    assert_eq!(
        store.take_advice(),
        vec![(end(all[21]), FILL_WINDOW)],
        "a seek past the window restarts it"
    );
    rt.block_on(fill.read(all[3], Some(all[4]))).expect("read");
    assert_eq!(
        store.take_advice(),
        vec![(end(all[4]), FILL_WINDOW)],
        "a seek back before the window restarts it"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// A read-ahead the session then abandons still owns its buffer until it lands, so it
/// has to be waited for before that buffer is handed to another frame.
#[test]
fn an_abandoned_read_ahead_is_awaited_before_its_buffer_is_reused() {
    let dir = scratch("abandon");
    let path = write_bundle(&dir, 3, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let [first, second, third] = spans(&store, &[0, 1, 2])[..] else {
        unreachable!("three frames")
    };

    let mut fill = FillReader::new(Arc::clone(&store));
    rt.block_on(fill.read(first, Some(second)))
        .expect("first");
    // Frame 1 was named and is in flight; the session asks for 2 instead.
    let out = rt.block_on(fill.read(third, None)).expect("third");
    assert_eq!(
        &out[..],
        &frame_pattern(2, LEN)[..],
        "the abandoned read landed in the buffer serving another frame"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// A frame the probe reads only part of is finished on the pool from where the probe
/// stopped, on both readers.
#[test]
fn the_pool_finishes_a_partial_hit_from_where_the_probe_stopped() {
    let dir = scratch("pooltail");
    let path = write_bundle(&dir, 2, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    if !store.nowait_supported() {
        eprintln!("SKIPPED: this filesystem refuses RWF_NOWAIT");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    store.force_short_reads(SHORT);
    let store = Arc::new(store);
    let rt = rt();
    let span = store.frame_span(1);

    let mut fill = FillReader::new(Arc::clone(&store));
    let got = rt.block_on(fill.read(span, None)).expect("fill");
    assert_eq!(&got[..], &frame_pattern(1, LEN)[..], "the fill's tail landed out of place");
    let mut tile = TileReader::new(ReadMode::Pool, Arc::clone(&store), TILE_SLOTS);
    let got = rt.block_on(tile.read(span, &[])).expect("tile");
    assert_eq!(&got[..], &frame_pattern(1, LEN)[..], "the tile's tail landed out of place");
    assert_eq!(store.pool_starts(), 2, "precondition: both readers went to the pool");
    std::fs::remove_dir_all(&dir).ok();
}

/// **The tile reader's whole point.** Naming `slots - 1` upcoming frames puts that many
/// reads on the device before the current one finishes — `peak_in_flight` is counted
/// after they start and before the current frame is awaited.
#[test]
fn naming_upcoming_tiles_starts_their_reads_before_the_current_one_finishes() {
    let dir = scratch("tiledepth");
    let path = write_bundle(&dir, TILE_SLOTS as u32, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let all = spans(&store, &(0..TILE_SLOTS as u32).collect::<Vec<_>>());
    let (span, upcoming) = all.split_first().expect("one frame at least");

    let mut tile = TileReader::new(ReadMode::Pool, Arc::clone(&store), TILE_SLOTS);
    let out = rt
        .block_on(tile.read(*span, upcoming))
        .expect("read");
    assert_eq!(
        &out[..],
        &frame_pattern(0, LEN)[..],
        "the served frame came back wrong"
    );
    assert_eq!(
        tile.stats().peak_in_flight as usize,
        TILE_SLOTS,
        "the upcoming frames' reads had not started when the current one was awaited"
    );
    assert_eq!(
        tile.pending_slots(),
        TILE_SLOTS - 1,
        "the named reads were awaited too"
    );
    assert_eq!(
        tile.serving_slot(),
        0,
        "the first slot serves the asked frame"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// **A jump must not queue behind the prefetch it abandons.** The read for the frame the
/// client asked for is issued while the abandoned one is still in flight, not after it.
#[test]
fn an_abandoned_tile_prefetch_does_not_delay_the_frame_that_replaces_it() {
    let dir = scratch("tilejump");
    let path = write_bundle(&dir, 4, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let [first, named, jump, behind] = spans(&store, &[0, 1, 2, 3])[..] else {
        unreachable!("four frames")
    };

    let mut tile = TileReader::new(ReadMode::Pool, Arc::clone(&store), TILE_SLOTS);
    rt.block_on(tile.read(first, &[named])).expect("first");
    // Frame 1 was named and is in flight; the session jumps to 2, naming 3 behind it.
    rt.block_on(tile.read(jump, &[behind])).expect("jump");
    assert_eq!(
        tile.stats().peak_in_flight,
        3,
        "the abandoned read-ahead was awaited before the jumped-to frames were started"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// A tile read dropped while its pooled read is still queued leaves that frame readable:
/// the next read of it waits on the same pooled read and serves the frame whole.
#[test]
fn a_tile_read_dropped_mid_way_leaves_its_frame_readable() {
    use futures_util::FutureExt;
    let dir = scratch("tilecancel");
    let path = write_bundle(&dir, 1, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = tokio::runtime::Builder::new_current_thread()
        .max_blocking_threads(1)
        .build()
        .expect("rt");
    let span = store.frame_span(0);
    let (release, held) = std::sync::mpsc::channel::<()>();
    let _busy = rt.spawn_blocking(move || held.recv());

    let mut tile = TileReader::new(ReadMode::Pool, Arc::clone(&store), TILE_SLOTS);
    let polled_once = rt.block_on(async { tile.read(span, &[]).now_or_never() });
    assert!(polled_once.is_none(), "precondition: the pooled read landed on a held pool");
    release.send(()).expect("release the pool");
    let out = rt.block_on(tile.read(span, &[])).expect("read again");
    assert_eq!(&out[..], &frame_pattern(0, LEN)[..], "the frame came back wrong");
    std::fs::remove_dir_all(&dir).ok();
}

/// A pooled tile read that fails leaves its frame readable: the next read of it reads it
/// again and serves it whole, rather than serving the empty buffer the failed read left.
#[test]
fn a_failed_pooled_tile_read_leaves_its_frame_readable() {
    let dir = scratch("tilefail");
    let path = write_bundle(&dir, 1, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let span = store.frame_span(0);

    let mut tile = TileReader::new(ReadMode::Pool, Arc::clone(&store), TILE_SLOTS);
    store.fail_blocking_reads(1);
    assert!(rt.block_on(tile.read(span, &[])).is_err(), "precondition: the read did not fail");
    let out = rt.block_on(tile.read(span, &[])).expect("read again");
    assert_eq!(&out[..], &frame_pattern(0, LEN)[..], "the frame came back wrong");
    std::fs::remove_dir_all(&dir).ok();
}

/// A slot whose next probe fails no longer claims the frame it held, whose bytes the probe
/// may already have overwritten. The probe fails on a write-only fd put in the store's place.
#[test]
fn a_slot_whose_probe_fails_no_longer_holds_its_frame() {
    use std::os::fd::AsRawFd;
    let dir = scratch("probefail");
    let path = write_bundle(&dir, 2, LEN);
    let [held, next] = spans(&Arc::new(FrameStore::open(&path).expect("open")), &[0, 1])[..]
    else {
        unreachable!("two frames")
    };
    let file = std::fs::File::open(&path).expect("open file");
    let fd = file.as_raw_fd();
    let store = FrameStore::with_index(file, vec![(held.offset, LEN)], held.offset);
    if !store.nowait_supported() {
        eprintln!("SKIPPED: this filesystem refuses RWF_NOWAIT");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    let rt = rt();
    let mut tile = TileReader::new(ReadMode::Pool, Arc::new(store), 2);
    rt.block_on(tile.read(next, &[held])).expect("read");
    let w = tile.holding(held).expect("precondition: the named frame is held");
    rt.block_on(tile.wait(w)).expect("precondition: the named frame landed");

    let write_only = std::fs::OpenOptions::new().write(true).open(&path).expect("open");
    // SAFETY: `fd` is the store's own, open for its whole life; `dup2` swaps what it names.
    assert_eq!(unsafe { libc::dup2(write_only.as_raw_fd(), fd) }, fd, "dup2");
    assert!(tile.begin(w, next).is_err(), "precondition: a probe on a write-only fd succeeded");
    assert!(!tile.holds(held), "the slot still claims its frame after a failed probe");
    std::fs::remove_dir_all(&dir).ok();
}

/// A read-ahead abandoned for a frame that names nothing after it gives its buffer back to
/// the pool rather than freeing it.
#[test]
fn an_abandoned_read_ahead_gives_its_buffer_back_to_the_pool() {
    let dir = scratch("fillspare");
    let path = write_bundle(&dir, 3, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let [first, second, third] = spans(&store, &[0, 1, 2])[..] else {
        unreachable!("three frames")
    };

    let mut fill = FillReader::new(Arc::clone(&store));
    let _first = rt.block_on(fill.read(first, Some(second))).expect("first");
    let before = frame_pool::RETURNED.get();
    // Frame 1 was named and is in flight; the session asks for 2, naming nothing after it.
    let _third = rt.block_on(fill.read(third, None)).expect("third");
    assert_eq!(
        frame_pool::RETURNED.get() - before,
        1,
        "the abandoned read-ahead's buffer was not given back to the pool"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// Slots are a constructor argument, so the depth a tile session runs at is a number the
/// lab run can sweep rather than a constant. `docs/adr/disk-access.md` §1.
#[test]
fn a_tile_reader_holds_as_many_frames_as_it_was_given_slots() {
    let dir = scratch("slots");
    let path = write_bundle(&dir, 9, LEN);
    let store = Arc::new(FrameStore::open(&path).expect("open store"));
    let rt = rt();
    for slots in [2usize, 8] {
        let mut tile = TileReader::new(ReadMode::Pool, Arc::clone(&store), slots);
        let all = spans(&store, &(0..9u32).collect::<Vec<_>>());
        let (span, upcoming) = all.split_first().expect("frames");
        rt.block_on(tile.read(*span, upcoming))
            .expect("read");
        assert_eq!(
            tile.stats().peak_named as usize,
            slots,
            "a {slots}-slot reader named a different number of frames"
        );
        assert!(!tile.holds(all[0]), "the served frame stayed in its slot after hand-off");
        for held in all.iter().take(slots).skip(1) {
            assert!(tile.holds(*held), "a named frame is not held");
        }
        assert!(
            !tile.holds(all[slots]),
            "held more frames than it has slots"
        );
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// Puts spare buffers in the process pool, so a reader that took one for no frame is seen holding it.
fn stock_the_pool() {
    drop((0..64).map(|_| frame_pool::hand_off(vec![0; 1], 1)).collect::<Vec<_>>());
}

/// **An idle tile session holds no frame buffer**: once every frame it named is served, each
/// slot's buffer has left with its frame and none has taken its place — on a hit, on the pool,
/// and on the ring where the host has one. `docs/adr/disk-access.md` §9, *Idle sessions' buffers*.
#[test]
fn a_tile_reader_holds_no_buffer_once_its_named_frames_are_served() {
    let dir = scratch("tileidle");
    let path = write_bundle(&dir, 4, LEN);
    let rt = rt();
    let mut taken = vec!["hit", "pool"];
    #[cfg(feature = "uring")]
    taken.push("ring");
    for path_taken in taken {
        let mut store = FrameStore::open(&path).expect("open store");
        match path_taken {
            "pool" => store.force_pool_reads(),
            #[cfg(feature = "uring")]
            "ring" => store.force_short_reads(SHORT),
            _ => {}
        }
        let store = Arc::new(store);
        let all = spans(&store, &[0, 1, 2, 3]);
        let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(&store), TILE_SLOTS);
        stock_the_pool();
        for (i, span) in all.iter().enumerate() {
            let out = rt.block_on(tile.read(*span, &all[i + 1..])).expect("read");
            assert_eq!(&out[..], &frame_pattern(i as u32, LEN)[..], "{path_taken}: frame {i}");
        }
        let held = tile.slots.iter().filter(|s| s.buf.capacity() > 0).count();
        assert_eq!(held, 0, "{path_taken}: {held} slots kept a buffer with no frame in it");
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// **An idle fill holds no frame buffer**: once it names nothing, neither the frame it served
/// nor the read-ahead it abandoned stays with it. `docs/adr/disk-access.md` §9, *Idle sessions' buffers*.
#[test]
fn a_fill_that_names_nothing_holds_no_buffer() {
    let dir = scratch("fillidle");
    let path = write_bundle(&dir, 4, LEN);
    let rt = rt();
    for pooled in [false, true] {
        let mut store = FrameStore::open(&path).expect("open store");
        if pooled {
            store.force_pool_reads();
        }
        let store = Arc::new(store);
        let [f0, f1, f2, f3] = spans(&store, &[0, 1, 2, 3])[..] else {
            unreachable!("four frames")
        };
        let mut seq = FillReader::new(Arc::clone(&store));
        stock_the_pool();
        // Frame 2 is named, then abandoned for 3, which names nothing.
        for (idx, span, next) in [(0, f0, Some(f1)), (1, f1, Some(f2)), (3, f3, None)] {
            let out = rt.block_on(seq.read(span, next)).expect("read");
            assert_eq!(&out[..], &frame_pattern(idx, LEN)[..], "frame {idx}, pooled={pooled}");
        }
        assert_eq!(seq.cur.capacity(), 0, "the served frame's buffer was refilled, pooled={pooled}");
        assert!(matches!(seq.ahead, Ahead::Idle), "a fill naming nothing kept a buffer, pooled={pooled}");
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// The values the ADR documents parse to their own mode, unset is `Auto`, and anything
/// else is refused rather than read as one of them.
#[test]
fn read_mode_parses_the_values_it_documents() {
    for (value, want) in [
        (Some("pool"), Ok(ReadMode::Pool)),
        (Some("auto"), Ok(ReadMode::Auto)),
        (None, Ok(ReadMode::Auto)),
    ] {
        assert_eq!(ReadMode::parse(value), want, "WTPACS_READ_PATH={value:?}");
    }
    assert!(ReadMode::parse(Some("nonsense")).is_err(), "an unknown value was taken");
    assert!(ReadMode::parse(Some("uring")).is_err(), "a value that is not a mode was taken");
}

#[test]
fn read_stats_report_the_session_miss_rate() {
    let dir = scratch("stats");
    let path = write_bundle(&dir, 3, LEN);
    let rt = rt();
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);

    let mut tile = TileReader::new(ReadMode::Pool, Arc::clone(&store), TILE_SLOTS);
    assert_eq!(
        tile.stats().miss_rate(),
        None,
        "nothing read, nothing to say"
    );
    for idx in 0..3u32 {
        let span = store.frame_span(idx);
        rt.block_on(tile.read(span, &[])).expect("read");
    }
    let stats = tile.stats();
    assert_eq!(
        (stats.hits, stats.misses, stats.miss_rate()),
        (0, 3, Some(1.0)),
        "every read escalated, and one read covered each frame"
    );

    let store = Arc::new(FrameStore::open(&path).expect("open store"));
    if store.nowait_supported() {
        let mut fill = FillReader::new(Arc::clone(&store));
        for idx in 0..3u32 {
            let span = store.frame_span(idx);
            rt.block_on(fill.read(span, None)).expect("read");
        }
        assert_eq!(fill.stats().miss_rate(), Some(0.0), "a warm fill escalated");
        assert_eq!(fill.stats().hits, 3);
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// **The variant's whole point**: a session that never misses never builds a ring, so on a
/// hit-dominated workload the change is inert by design rather than by configuration.
#[test]
#[cfg(feature = "uring")]
fn lazy_ring_is_not_built_when_every_read_hits() {
    let dir = scratch("nohit");
    let path = write_bundle(&dir, 3, LEN);
    let store = Arc::new(FrameStore::open(&path).expect("open store"));
    if !store.nowait_supported() {
        eprintln!("SKIPPED: this filesystem refuses RWF_NOWAIT, so every read reports a miss");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    let rt = rt();
    let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(&store), TILE_SLOTS);
    for idx in 0..3u32 {
        let span = store.frame_span(idx);
        let out = rt.block_on(tile.read(span, &[])).expect("read");
        assert_eq!(&out[..], &frame_pattern(idx, LEN)[..]);
    }
    assert!(
        !tile.ring_built(),
        "a session that only ever hit the page cache built a ring anyway"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// **The container trap**: where `RWF_NOWAIT` is refused every read reports a miss, so
/// a ring keyed on the shortfall alone would then serve every *warm* read.
#[test]
#[cfg(feature = "uring")]
fn lazy_ring_is_never_built_without_nowait() {
    let dir = scratch("nonowait");
    let path = write_bundle(&dir, 3, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    store.force_pool_reads();
    let store = Arc::new(store);
    let rt = rt();
    let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(&store), TILE_SLOTS);
    for idx in 0..3u32 {
        let span = store.frame_span(idx);
        let out = rt.block_on(tile.read(span, &[])).expect("read");
        assert_eq!(&out[..], &frame_pattern(idx, LEN)[..], "the pooled path still serves");
    }
    assert!(
        !tile.ring_built(),
        "a ring was built on a filesystem that refuses RWF_NOWAIT — every warm read \
         would now go through it"
    );
    std::fs::remove_dir_all(&dir).ok();
}

/// The prefix from the inline read plus the remainder from the ring is the frame.
#[test]
#[cfg(feature = "uring")]
fn nowait_and_ring_compose_into_the_whole_frame() {
    let dir = scratch("ringcompose");
    let path = write_bundle(&dir, 3, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    if !store.nowait_supported() {
        eprintln!("SKIPPED: this filesystem refuses RWF_NOWAIT");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    store.force_short_reads(SHORT);
    let store = Arc::new(store);
    let rt = rt();
    let ring_available = {
        let _guard = rt.enter();
        UringReader::new(store.file(), TILE_SLOTS as u32).is_ok()
    };
    let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(&store), TILE_SLOTS);
    for idx in 0..3u32 {
        let span = store.frame_span(idx);
        let out = rt.block_on(tile.read(span, &[])).expect("read");
        assert_eq!(&out[..], &frame_pattern(idx, LEN)[..], "frame {idx} did not compose");
    }
    if ring_available {
        assert!(tile.ring_built(), "the miss path never reached the ring");
    } else {
        eprintln!("SKIPPED (the ring assert): io_uring is unavailable on this host");
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// A frame the file no longer holds ends the ring read with an error: a read that returns
/// nothing is the end of the file, not a short read to resubmit and wait on for ever.
#[test]
#[cfg(feature = "uring")]
fn a_frame_cut_from_the_file_fails_the_ring_read_instead_of_hanging() {
    let dir = scratch("ringeof");
    let path = write_bundle(&dir, 2, LEN);
    let store = Arc::new(FrameStore::open(&path).expect("open store"));
    let span = store.frame_span(0);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .and_then(|f| f.set_len(span.offset))
        .expect("cut the frames off");
    let rt = rt();
    let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(&store), TILE_SLOTS);
    let read = rt.block_on(async {
        tokio::time::timeout(std::time::Duration::from_secs(5), tile.read(span, &[]))
            .await
    });
    if !tile.ring_built() {
        eprintln!("SKIPPED: io_uring or RWF_NOWAIT is unavailable on this host");
    } else {
        let read = read.expect("the ring read hung on the end of the file");
        assert!(read.is_err(), "a frame past the end of the file was served");
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// A ring read that fails in the same batch as another slot's completion does not lose that
/// completion: the frame waiting on it is served whole, and the failed frame fails cleanly.
#[test]
#[cfg(feature = "uring")]
fn a_failed_ring_read_does_not_lose_another_slots_completion() {
    let dir = scratch("ringbatch");
    let path = write_bundle(&dir, 1, LEN);
    let span = FrameStore::open(&path).expect("open store").frame_span(0);
    let cut = FrameSpan { offset: span.offset + u64::from(LEN), len: LEN };
    let file = std::fs::File::open(&path).expect("open file");
    let index = vec![(span.offset, LEN), (cut.offset, LEN)];
    let mut store = FrameStore::with_index(file, index, span.offset);
    if !store.nowait_supported() {
        eprintln!("SKIPPED: this filesystem refuses RWF_NOWAIT");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    store.force_short_reads(SHORT);
    let store = Arc::new(store);
    let rt = rt();
    let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(&store), TILE_SLOTS);
    let bounded = |tile: &mut TileReader, span, upcoming: &[FrameSpan]| {
        let read = tile.read(span, upcoming);
        rt.block_on(async { tokio::time::timeout(std::time::Duration::from_secs(5), read).await })
        .expect("a wait parked for ever on a completion already taken")
    };

    let out = bounded(&mut tile, span, &[cut]).expect("the frame whose read landed");
    if !tile.ring_built() {
        eprintln!("SKIPPED: io_uring is unavailable on this host");
    } else {
        assert_eq!(&out[..], &frame_pattern(0, LEN)[..], "the frame came back wrong");
        assert_eq!(tile.pending_slots(), 0, "the failed read's slot still waits on the ring");
        let past_the_end = bounded(&mut tile, cut, &[]);
        assert!(past_the_end.is_err(), "a frame past the end of the file was served");
        let out = bounded(&mut tile, span, &[]).expect("read again");
        assert_eq!(&out[..], &frame_pattern(0, LEN)[..], "the frame came back wrong again");
    }
    std::fs::remove_dir_all(&dir).ok();
}

/// A failed ring read of the frame being served, reaped by the wait that recycles another slot
/// for an upcoming frame, fails the read with an error rather than a panic, and the batch's
/// other completion still lands.
#[test]
#[cfg(feature = "uring")]
fn a_failed_ring_read_reaped_by_another_slots_wait_fails_its_frame() {
    let dir = scratch("ringcurrent");
    let path = write_bundle(&dir, 1, LEN);
    let whole = FrameStore::open(&path).expect("open store").frame_span(0);
    let head = FrameSpan { len: SHORT as u32, ..whole };
    let cut = FrameSpan { offset: whole.offset + u64::from(LEN), len: LEN };
    let file = std::fs::File::open(&path).expect("open file");
    let mut store = FrameStore::with_index(file, vec![(whole.offset, LEN)], whole.offset);
    if !store.nowait_supported() {
        eprintln!("SKIPPED: this filesystem refuses RWF_NOWAIT");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    store.force_short_reads(SHORT);
    let rt = rt();
    let mut tile = TileReader::new(ReadMode::Auto, Arc::new(store), 2);

    // `head` is a hit; `whole` goes to the ring and is left unreaped in the other slot.
    let out = rt.block_on(tile.read(head, &[whole])).expect("head");
    assert_eq!(&out[..], &frame_pattern(0, LEN)[..SHORT], "the head came back wrong");
    if !tile.ring_built() {
        eprintln!("SKIPPED: io_uring is unavailable on this host");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    assert_eq!(tile.pending_slots(), 1, "precondition: the abandoned ring read was reaped");
    let read = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        rt.block_on(tile.read(cut, &[head]))
    }));
    assert!(matches!(read, Ok(Err(_))), "a frame past the end of the file did not fail cleanly");
    assert_eq!(tile.pending_slots(), 0, "a completion of the batch did not land");
    let out = rt.block_on(tile.read(whole, &[])).expect("read the whole frame");
    assert_eq!(&out[..], &frame_pattern(0, LEN)[..], "the whole frame came back wrong");
    std::fs::remove_dir_all(&dir).ok();
}

/// A ring read whose submit fails stays in flight, since its entry is still queued for the
/// kernel: the frame is not served half-read, and reading it again serves it whole.
#[test]
#[cfg(feature = "uring")]
fn a_ring_read_whose_submit_fails_is_not_served_half_read() {
    use crate::media::uring_reader::FAILED_WAITS;
    let dir = scratch("ringsubmit");
    let path = write_bundle(&dir, 1, LEN);
    let mut store = FrameStore::open(&path).expect("open store");
    if !store.nowait_supported() {
        eprintln!("SKIPPED: this filesystem refuses RWF_NOWAIT");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    store.force_short_reads(SHORT);
    let store = Arc::new(store);
    let span = store.frame_span(0);
    let rt = rt();
    let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(&store), TILE_SLOTS);

    FAILED_WAITS.with(|f| f.borrow_mut().push(libc::EAGAIN));
    let failed = rt.block_on(tile.read(span, &[]));
    if !tile.ring_built() {
        FAILED_WAITS.with(|f| f.borrow_mut().clear());
        eprintln!("SKIPPED: io_uring is unavailable on this host");
        std::fs::remove_dir_all(&dir).ok();
        return;
    }
    assert!(failed.is_err(), "precondition: the failed submit was not an error");
    let again = rt.block_on(async {
        tokio::time::timeout(std::time::Duration::from_secs(5), tile.read(span, &[])).await
    });
    let out = again.expect("the read parked on an entry never sent").expect("read again");
    let whole = out[..] == frame_pattern(0, LEN)[..];
    // Before `out`: where the slot was served, the drain lands the queued entry in its buffer.
    drop(tile);
    assert!(whole, "a frame was served before its ring read landed");
    std::fs::remove_dir_all(&dir).ok();
}

/// A tile reader whose ring fails with a read in flight leaks its slots instead of freeing
/// memory the kernel may still write. The read is on a pipe nobody writes, so it never lands.
#[test]
#[cfg(feature = "uring")]
fn a_tile_reader_whose_ring_fails_mid_read_leaks_its_slots() {
    use crate::media::uring_reader::FAILED_WAITS;
    use std::os::fd::FromRawFd;
    let dir = scratch("ringleak");
    let path = write_bundle(&dir, 1, LEN);
    let store = Arc::new(FrameStore::open(&path).expect("open store"));
    let rt = rt();
    let _guard = rt.enter();
    let mut fds = [0i32; 2];
    // SAFETY: `pipe` fills two fds or fails.
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0, "pipe");
    // SAFETY: fresh fds, owned here and nowhere else.
    let (rd, wr) =
        unsafe { (std::fs::File::from_raw_fd(fds[0]), std::fs::File::from_raw_fd(fds[1])) };
    let Ok(ring) = UringReader::new(&rd, TILE_SLOTS as u32) else {
        eprintln!("SKIPPED: io_uring is unavailable on this host");
        std::fs::remove_dir_all(&dir).ok();
        return;
    };
    let mut tile = TileReader::new(ReadMode::Pool, store, TILE_SLOTS);
    tile.ring = Ring::Built(Box::new(ring));
    let TileReader { ring: Ring::Built(ring), slots, .. } = &mut tile else {
        unreachable!("built above")
    };
    slots[0].buf = vec![0u8; 64];
    // SAFETY: the test's subject: the slot's buffer must outlive the read, leaked or drained.
    unsafe { ring.submit(0, &mut slots[0].buf, 0) }.expect("submit");
    slots[0].read = Some(InFlight::Ring);

    // One for the tile reader's drain, one for the ring's own on drop.
    FAILED_WAITS.with(|f| f.borrow_mut().extend([libc::EBADF, libc::EBADF]));
    let before = LEAKED_ON_DROP.get();
    drop(tile);
    assert_eq!(LEAKED_ON_DROP.get(), before + 1, "the slots were freed under a live read");
    drop(wr);
    std::fs::remove_dir_all(&dir).ok();
}
