use super::*;

fn tiles(names: &[u32]) -> Next {
    Next::Tiles(names.to_vec())
}

/// Two `RequestFrame`s in hand: the first is served with the second as upcoming.
#[test]
fn pipelined_asks_supply_the_upcoming_frames() {
    let mut plan = Planner::new(10);
    for frame in [4, 5, 6] {
        plan.push(Command::Frame(frame));
    }
    assert_eq!(plan.next(|| None).unwrap(), Step::Serve { frame: 4, next: tiles(&[5, 6]) });
}

/// Each ask served names the asks still behind it, and the next one served names one fewer.
#[test]
fn each_served_ask_names_the_asks_still_behind_it() {
    let mut plan = Planner::new(10);
    for frame in [1, 4, 5] {
        plan.push(Command::Frame(frame));
    }
    assert_eq!(plan.next(|| None).unwrap(), Step::Serve { frame: 1, next: tiles(&[4, 5]) });
    assert_eq!(plan.next(|| None).unwrap(), Step::Serve { frame: 4, next: tiles(&[5]) });
}

/// A fill recites `from..=to` inclusive, each frame naming the next, and only its first
/// frame says so, for `fills=`.
#[test]
fn a_fill_recites_from_to_inclusive_in_order() {
    let mut plan = Planner::new(8);
    plan.push(Command::Fill { from: Some(3), to: Some(7) });
    let mut served = Vec::new();
    loop {
        match plan.next(|| None).unwrap() {
            Step::Serve { frame, next: Next::Fill { after, first } } => served.push((frame, after, first)),
            Step::Wait => break,
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(
        served,
        vec![
            (3, Some(4), true),
            (4, Some(5), false),
            (5, Some(6), false),
            (6, Some(7), false),
            (7, None, false),
        ]
    );
}

/// `EndStream` found between two frames of a fill stops it; the session goes on.
#[test]
fn end_stream_stops_a_fill_before_the_next_frame() {
    let mut plan = Planner::new(10);
    plan.push(Command::Fill { from: Some(3), to: Some(7) });
    assert!(matches!(plan.next(|| None).unwrap(), Step::Serve { frame: 3, .. }));
    let mut arrived = Some(Command::EndStream);
    assert!(matches!(plan.next(|| arrived.take()).unwrap(), Step::Wait));
}

/// A data request found mid-fill ends the fill and is then served.
#[test]
fn a_data_request_during_a_fill_ends_it_and_is_served_next() {
    let mut plan = Planner::new(10);
    plan.push(Command::Fill { from: Some(0), to: Some(5) });
    assert!(matches!(plan.next(|| None).unwrap(), Step::Serve { frame: 0, .. }));
    let mut arrived = Some(Command::Frame(9));
    assert_eq!(plan.next(|| arrived.take()).unwrap(), Step::Serve { frame: 9, next: tiles(&[]) });
}

/// `EndSession` mid-fill: nothing more is served.
#[test]
fn end_session_during_a_fill_ends_the_session() {
    let mut plan = Planner::new(6);
    plan.push(Command::Fill { from: Some(0), to: Some(5) });
    assert!(matches!(plan.next(|| None).unwrap(), Step::Serve { frame: 0, .. }));
    let mut arrived = Some(Command::EndSession);
    assert!(matches!(plan.next(|| arrived.take()).unwrap(), Step::End));
    assert!(matches!(plan.next(|| None).unwrap(), Step::Wait));
}

/// `from > to`, or `to` past the series: `refuse` with `from`, no frame served.
#[test]
fn a_bad_range_is_refused_with_from() {
    for (from, to) in [(Some(7), Some(3)), (Some(0), Some(9))] {
        let mut p = Planner::new(4);
        p.push(Command::Fill { from, to });
        match p.next(|| None).unwrap() {
            Step::Refuse { frame, .. } => assert_eq!(frame, from.unwrap_or(0)),
            other => panic!("served {other:?}"),
        }
        assert!(matches!(p.next(|| None).unwrap(), Step::Wait));
    }
}

/// An empty series refuses `StreamFrames {}` with `from` 0.
#[test]
fn an_empty_series_is_refused_with_from() {
    let mut plan = Planner::new(0);
    plan.push(Command::Fill { from: None, to: None });
    match plan.next(|| None).unwrap() {
        Step::Refuse { frame, reason } => {
            assert_eq!(frame, 0);
            assert!(reason.contains("empty"), "empty series refused as {reason}");
        }
        other => panic!("{other:?}"),
    }
}

/// A frame past the series is refused by the planner, before any reader or stream is touched.
#[test]
fn a_frame_out_of_range_is_refused_by_the_planner() {
    let mut plan = Planner::new(4);
    plan.push(Command::Frame(99));
    assert_eq!(
        plan.next(|| None).unwrap(),
        Step::Refuse { frame: 99, reason: "frame index 99 out of range (4)".into() }
    );
}

/// A name past the series behind the served frame is skipped, and the names after it kept.
#[test]
fn an_out_of_range_name_is_skipped_not_a_stop() {
    let mut plan = Planner::new(4);
    for frame in [1, 99, 2] {
        plan.push(Command::Frame(frame));
    }
    assert_eq!(plan.next(|| None).unwrap(), Step::Serve { frame: 1, next: tiles(&[2]) });
}

/// A fill is counted by its first frame once, and a fill stopped before its first frame never.
#[test]
fn a_fill_counts_once_and_a_cancelled_fill_not_at_all() {
    let firsts = |asks: Vec<Command>| {
        let mut plan = Planner::new(10);
        asks.into_iter().for_each(|a| plan.push(a));
        let mut firsts = 0;
        while let Step::Serve { next, .. } = plan.next(|| None).unwrap() {
            firsts += u32::from(matches!(next, Next::Fill { first: true, .. }));
        }
        firsts
    };
    assert_eq!(firsts(vec![Command::Fill { from: Some(2), to: Some(5) }]), 1);
    assert_eq!(firsts(vec![Command::Fill { from: None, to: None }, Command::EndStream]), 0);
}

/// Both refusal texts are the ones `docs/WIRE.md` §FoD messages documents, word for word.
#[test]
fn the_refusal_texts_are_the_documented_ones() {
    assert_eq!(frame_in_range(9, 4), Err("frame index 9 out of range (4)".into()));
    assert_eq!(fill_range(Some(2), Some(9), 4), Err("StreamFrames 2..=9 outside 0..=3".into()));
    assert_eq!(fill_range(None, None, 0), Err("series is empty".into()));
}

/// A flood of asks holds at most `ASKS_AHEAD`, the frame being served among them; the rest stay in `poll`.
#[test]
fn the_loop_holds_no_more_than_asks_ahead() {
    let mut plan = Planner::new(1000);
    let mut offered = 0u32;
    let mut poll = || {
        if offered >= 800 {
            return None;
        }
        offered += 1;
        Some(Command::Frame(offered - 1))
    };
    for _ in 0..100 {
        let _ = plan.next(&mut poll).unwrap();
        assert!(
            plan.in_hand_len() < ASKS_AHEAD,
            "in_hand grew to {} past ASKS_AHEAD {ASKS_AHEAD}",
            plan.in_hand_len()
        );
    }
}

/// An end_stream between two asks ends neither, so the frame behind it is still read ahead.
#[test]
fn upcoming_reads_past_an_end_stream() {
    let mut plan = Planner::new(10);
    plan.push(Command::Frame(2));
    plan.push(Command::EndStream);
    plan.push(Command::Frame(4));
    assert_eq!(
        plan.next(|| None).unwrap(),
        Step::Serve { frame: 2, next: tiles(&[4]) },
        "an end_stream ends no ask, so 4 is still read ahead"
    );
}

/// A queued `Fill` is next; a frame behind it is not named as upcoming.
#[test]
fn upcoming_stops_at_the_first_ask_that_is_not_a_frame() {
    let mut plan = Planner::new(10);
    plan.push(Command::Frame(5));
    plan.push(Command::Fill { from: Some(7), to: Some(9) });
    plan.push(Command::Frame(9));
    assert_eq!(
        plan.next(|| None).unwrap(),
        Step::Serve { frame: 5, next: tiles(&[]) },
        "a fill is queued, so 9 is not the next frame to read"
    );
}

/// An `Err` in hand makes `next` return it.
#[test]
fn a_reader_error_is_the_session_error() {
    let mut plan = Planner::new(2);
    plan.push(Command::Failed(anyhow::anyhow!("control broke")));
    assert!(plan.next(|| None).is_err(), "reader error was swallowed");
}
