use super::*;

/// **Zero copy, then reuse.** The bytes quinn sees are the buffer that was read into, and
/// dropping them puts that buffer back for the next read.
#[test]
fn a_handed_off_frame_is_the_buffer_itself_and_comes_back_when_dropped() {
    static POOL: Pool = Pool::new();
    let mut buf = POOL.take();
    buf.resize(1000, 7);
    let ptr = buf.as_ptr();
    let frame = POOL.hand_off(buf, 600);
    assert_eq!(frame.len(), 600);
    assert_eq!(frame.as_ptr(), ptr, "the frame was copied on hand-off");
    assert_eq!(POOL.pooled(), 0, "the buffer came back while quinn still held it");
    drop(frame);
    assert_eq!(POOL.pooled(), 1, "the buffer did not come back when quinn dropped it");
    let reused = POOL.take();
    assert_eq!(reused.as_ptr(), ptr, "take() did not reuse the returned buffer");
}

/// **A frame dropped on another thread still comes back.** The work-stealing runtime may
/// acknowledge a frame on a thread other than the one that read it, which is exactly what
/// a thread-local pool loses.
#[test]
fn a_buffer_returned_from_another_thread_is_reused_by_this_one() {
    static POOL: Pool = Pool::new();
    let mut buf = POOL.take();
    buf.resize(1000, 7);
    let ptr = buf.as_ptr();
    let frame = POOL.hand_off(buf, 1000);
    std::thread::spawn(move || drop(frame)).join().expect("drop thread");
    assert_eq!(POOL.pooled(), 1, "the other thread kept the buffer");
    let reused = POOL.take();
    assert_eq!(reused.as_ptr(), ptr, "the buffer did not come back to this thread");
}

/// Every reader in the process takes from and returns to the product's pool, other tests'
/// readers included; churning it here must not move any count another test asserts.
#[test]
fn churning_the_process_pool_moves_no_other_tests_count() {
    let until = std::time::Instant::now() + std::time::Duration::from_millis(300);
    while std::time::Instant::now() < until {
        let held: Vec<_> = (0..8).map(|_| hand_off(take(), 0)).collect();
        drop(held);
    }
}

/// The pool is a reuse cache, not a leak: past `POOL_CAP` it lets buffers go.
#[test]
fn the_pool_stops_growing_at_its_cap() {
    static POOL: Pool = Pool::new();
    let frames: Vec<_> = (0..POOL_CAP + 8).map(|_| POOL.hand_off(vec![0u8; 16], 16)).collect();
    drop(frames);
    assert_eq!(POOL.pooled(), POOL_CAP, "the pool grew past its cap");
}
