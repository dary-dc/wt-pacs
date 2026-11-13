use super::*;

/// A refusal in a session whose control stream never came returns once the session has
/// closed, rather than waiting for a stream that cannot arrive.
#[test]
fn a_refusal_with_no_control_stream_returns_once_the_session_closes() {
    let (closed, coming) = oneshot::channel();
    let mut control = ControlStream::Coming(coming);
    drop(closed);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("rt");
    rt.block_on(async {
        let msg = FodMsg::FrameError { frame_index: 9, reason: "out of range".into() };
        tokio::time::timeout(Duration::from_secs(2), control.write(&msg))
            .await
            .expect("the refusal waited on a control stream that can no longer come")
            .expect("refuse");
    });
    assert!(matches!(control, ControlStream::Gone), "a control stream that cannot come is still awaited");
}

/// Ask order is stream priority: every later frame ranks strictly below every earlier one,
/// and the sequence never wraps back above an earlier frame.
#[test]
fn later_asks_rank_strictly_below_earlier_ones() {
    let mut last = ask_priority(0);
    for seq in [1u32, 2, 1000, i32::MAX as u32, u32::MAX] {
        let p = ask_priority(seq);
        assert!(p < last, "ask {seq} ranks at {p}, not below {last}");
        last = p;
    }
}

/// Each per-frame stream takes a rank below the one before it, not the same one.
#[test]
fn each_stream_takes_the_next_rank_down() {
    let mut seq = 0;
    let ranks: Vec<i32> = (0..3).map(|_| take_priority(&mut seq)).collect();
    assert_eq!(ranks, [0, -1, -2]);
}

/// A session's per-frame streams rank an ask where it arrives, as any frame: only
/// `per-frame-asks-first` lifts it.
#[test]
fn a_sessions_streams_rank_an_ask_in_arrival_order() {
    let mut streams = FrameStreams::default();
    assert_eq!([streams.rank(false), streams.rank(true), streams.rank(false)], [0, -1, -2]);
}

/// Under `per-frame-asks-first` a session ranks an ask above the fills on either side of it,
/// and the fill after it takes the rank it would have taken without the ask.
#[cfg(feature = "lab-levers")]
#[test]
fn asks_first_streams_rank_an_ask_above_the_fills_around_it() {
    let mut streams = FrameStreams { asks: Some(0), ..FrameStreams::default() };
    let (before, ask, after) = (streams.rank(false), streams.rank(true), streams.rank(false));
    assert!(ask > before && ask > after, "the ask ranks at {ask}, fills at {before} and {after}");
    assert_eq!(after, before - 1);
}

/// With asks first, every ask ranks above every fill frame, however many of either came
/// before, and earlier asks above later ones.
#[cfg(feature = "lab-levers")]
#[test]
fn asks_first_rank_every_ask_above_every_fill() {
    let (mut seq, mut asks) = (0, 0);
    let fill: Vec<i32> = (0..3).map(|_| take_priority(&mut seq)).collect();
    let ask: Vec<i32> = (0..3).map(|_| take_ask_priority(&mut asks)).collect();
    assert!(ask.windows(2).all(|w| w[0] > w[1]), "later asks not ranked below earlier ones: {ask:?}");
    assert!(ask.iter().all(|a| fill.iter().all(|f| a > f)), "an ask ranks at or below a fill: {ask:?} {fill:?}");
    let (mut seq, mut asks) = (0, u32::MAX);
    assert!(take_ask_priority(&mut asks) > take_priority(&mut seq), "the last ask ranks at or below the first fill");
}

/// A budget cuts the envelope where it ends, head first, and only a budget that covers the
/// head and the body leaves the frame whole.
#[cfg(feature = "lab-levers")]
#[test]
fn a_budget_cuts_the_envelope_head_first() {
    let (head, body) = (Bytes::from_static(b"HEADHEAD"), Bytes::from_static(b"body"));
    let cut = |budget| {
        let (h, b, whole) = within(head.clone(), body.clone(), budget);
        (h.len(), b.len(), whole)
    };
    assert_eq!(cut(usize::MAX), (8, 4, true));
    assert_eq!(cut(12), (8, 4, true));
    assert_eq!(cut(11), (8, 3, false));
    assert_eq!(cut(5), (5, 0, false));
}
