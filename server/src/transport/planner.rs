//! What to serve next, decided without I/O. `docs/adr/disk-access.md`.

use anyhow::Result;
use std::collections::VecDeque;

/// Asks the server holds beyond the frame being served. A tile reader takes what fits (`slots − 1`).
pub const ASKS_AHEAD: usize = 8;

/// What the loop consumes. `EndSession` and `Failed` end it; every other ask carries frames.
#[derive(Debug)]
pub enum Ask {
    Frame(u32),
    Fill { from: Option<u32>, to: Option<u32> },
    EndStream,
    EndSession,
    Failed(anyhow::Error),
}

/// The next thing to do. Decided without I/O, so it is tested with a `Vec`.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    /// `frame` and every name in `next` are in range.
    Serve { frame: u32, next: Next },
    /// The only source of refusal text.
    Refuse { frame: u32, reason: String },
    Wait,
    End,
}

/// What follows the served frame, which also picks its reader. `docs/adr/disk-access.md`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Next {
    /// A fill reads one frame ahead; `first` is its first frame, for `fills=`.
    Fill { after: Option<u32>, first: bool },
    /// The frames asked for behind this one, in ask order; the reader takes what fits.
    Tiles(Vec<u32>),
}

struct Fill {
    frame: u32,
    to: u32,
    first: bool,
}

pub struct Planner {
    in_hand: VecDeque<Ask>,
    fill: Option<Fill>,
    frames: u32,
}

impl Planner {
    pub fn new(frames: u32) -> Self {
        Self {
            in_hand: VecDeque::new(),
            fill: None,
            frames,
        }
    }

    pub fn push(&mut self, ask: Ask) {
        self.in_hand.push_back(ask);
    }

    #[cfg(test)]
    fn in_hand_len(&self) -> usize {
        self.in_hand.len()
    }

    /// `poll` yields asks that arrived since the last step; a fill checks it between frames.
    pub fn next(&mut self, mut poll: impl FnMut() -> Option<Ask>) -> Result<Step> {
        while self.in_hand.len() < ASKS_AHEAD {
            let Some(ask) = poll() else { break };
            self.in_hand.push_back(ask);
        }
        loop {
            if let Some(Fill { frame, to, first }) = self.fill.take() {
                if self.in_hand.is_empty() {
                    let after = (frame < to).then_some(frame + 1);
                    self.fill = after.map(|frame| Fill { frame, to, first: false });
                    let next = Next::Fill { after, first };
                    return Ok(Step::Serve { frame, next });
                }
                if matches!(self.in_hand.front(), Some(Ask::EndStream)) {
                    self.in_hand.pop_front();
                }
            }
            match self.in_hand.pop_front() {
                None => return Ok(Step::Wait),
                Some(Ask::EndSession) => return Ok(Step::End),
                Some(Ask::Failed(err)) => return Err(err),
                Some(Ask::EndStream) => continue,
                Some(Ask::Fill { from, to }) => match fill_range(from, to, self.frames) {
                    Ok((frame, to)) => self.fill = Some(Fill { frame, to, first: true }),
                    Err(reason) => return Ok(Step::Refuse { frame: from.unwrap_or(0), reason }),
                },
                Some(Ask::Frame(frame)) => {
                    if let Err(reason) = frame_in_range(frame, self.frames) {
                        return Ok(Step::Refuse { frame, reason });
                    }
                    let names = self
                        .in_hand
                        .iter()
                        .take_while(|a| matches!(a, Ask::Frame(_) | Ask::EndStream))
                        .filter_map(|a| match a {
                            Ask::Frame(f) => frame_in_range(*f, self.frames).is_ok().then_some(*f),
                            _ => None,
                        })
                        .collect();
                    return Ok(Step::Serve { frame, next: Next::Tiles(names) });
                }
            }
        }
    }
}

pub fn frame_in_range(frame: u32, frames: u32) -> Result<(), String> {
    if frame < frames {
        Ok(())
    } else {
        Err(format!("frame index {frame} out of range ({frames})"))
    }
}

pub fn fill_range(from: Option<u32>, to: Option<u32>, frames: u32) -> Result<(u32, u32), String> {
    let last = frames.saturating_sub(1);
    let from = from.unwrap_or(0);
    let to = to.unwrap_or(last);
    if frames == 0 {
        Err("study is empty".into())
    } else if from > to || to >= frames {
        Err(format!("StreamFrames {from}..={to} outside 0..={last}"))
    } else {
        Ok((from, to))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiles(names: &[u32]) -> Next {
        Next::Tiles(names.to_vec())
    }

    /// Two `RequestFrame`s in hand: the first is served with the second as upcoming.
    #[test]
    fn pipelined_asks_supply_the_upcoming_frames() {
        let mut plan = Planner::new(10);
        for frame in [4, 5, 6] {
            plan.push(Ask::Frame(frame));
        }
        assert_eq!(plan.next(|| None).unwrap(), Step::Serve { frame: 4, next: tiles(&[5, 6]) });
    }

    /// Each ask served names the asks still behind it, and the next one served names one fewer.
    #[test]
    fn each_served_ask_names_the_asks_still_behind_it() {
        let mut plan = Planner::new(10);
        for frame in [1, 4, 5] {
            plan.push(Ask::Frame(frame));
        }
        assert_eq!(plan.next(|| None).unwrap(), Step::Serve { frame: 1, next: tiles(&[4, 5]) });
        assert_eq!(plan.next(|| None).unwrap(), Step::Serve { frame: 4, next: tiles(&[5]) });
    }

    /// A fill recites `from..=to` inclusive, each frame naming the next, and only its first
    /// frame says so, for `fills=`.
    #[test]
    fn a_fill_recites_from_to_inclusive_in_order() {
        let mut plan = Planner::new(8);
        plan.push(Ask::Fill { from: Some(3), to: Some(7) });
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
        plan.push(Ask::Fill { from: Some(3), to: Some(7) });
        assert!(matches!(plan.next(|| None).unwrap(), Step::Serve { frame: 3, .. }));
        let mut arrived = Some(Ask::EndStream);
        assert!(matches!(plan.next(|| arrived.take()).unwrap(), Step::Wait));
    }

    /// A data request found mid-fill ends the fill and is then served.
    #[test]
    fn a_data_request_during_a_fill_ends_it_and_is_served_next() {
        let mut plan = Planner::new(10);
        plan.push(Ask::Fill { from: Some(0), to: Some(5) });
        assert!(matches!(plan.next(|| None).unwrap(), Step::Serve { frame: 0, .. }));
        let mut arrived = Some(Ask::Frame(9));
        assert_eq!(plan.next(|| arrived.take()).unwrap(), Step::Serve { frame: 9, next: tiles(&[]) });
    }

    /// `EndSession` mid-fill: nothing more is served.
    #[test]
    fn end_session_during_a_fill_ends_the_session() {
        let mut plan = Planner::new(6);
        plan.push(Ask::Fill { from: Some(0), to: Some(5) });
        assert!(matches!(plan.next(|| None).unwrap(), Step::Serve { frame: 0, .. }));
        let mut arrived = Some(Ask::EndSession);
        assert!(matches!(plan.next(|| arrived.take()).unwrap(), Step::End));
        assert!(matches!(plan.next(|| None).unwrap(), Step::Wait));
    }

    /// `from > to`, or `to` past the study: `refuse` with `from`, no frame served.
    #[test]
    fn a_bad_range_is_refused_with_from() {
        for (from, to) in [(Some(7), Some(3)), (Some(0), Some(9))] {
            let mut p = Planner::new(4);
            p.push(Ask::Fill { from, to });
            match p.next(|| None).unwrap() {
                Step::Refuse { frame, .. } => assert_eq!(frame, from.unwrap_or(0)),
                other => panic!("served {other:?}"),
            }
            assert!(matches!(p.next(|| None).unwrap(), Step::Wait));
        }
    }

    /// An empty study refuses `StreamFrames {}` with `from` 0.
    #[test]
    fn an_empty_study_is_refused_with_from() {
        let mut plan = Planner::new(0);
        plan.push(Ask::Fill { from: None, to: None });
        match plan.next(|| None).unwrap() {
            Step::Refuse { frame, reason } => {
                assert_eq!(frame, 0);
                assert!(reason.contains("empty"), "empty study refused as {reason}");
            }
            other => panic!("{other:?}"),
        }
    }

    /// A frame past the study is refused by the planner, before any reader or stream is touched.
    #[test]
    fn a_frame_out_of_range_is_refused_by_the_planner() {
        let mut plan = Planner::new(4);
        plan.push(Ask::Frame(99));
        assert_eq!(
            plan.next(|| None).unwrap(),
            Step::Refuse { frame: 99, reason: "frame index 99 out of range (4)".into() }
        );
    }

    /// A name past the study behind the served frame is skipped, and the names after it kept.
    #[test]
    fn an_out_of_range_name_is_skipped_not_a_stop() {
        let mut plan = Planner::new(4);
        for frame in [1, 99, 2] {
            plan.push(Ask::Frame(frame));
        }
        assert_eq!(plan.next(|| None).unwrap(), Step::Serve { frame: 1, next: tiles(&[2]) });
    }

    /// A fill is counted by its first frame once, and a fill stopped before its first frame never.
    #[test]
    fn a_fill_counts_once_and_a_cancelled_fill_not_at_all() {
        let firsts = |asks: Vec<Ask>| {
            let mut plan = Planner::new(10);
            asks.into_iter().for_each(|a| plan.push(a));
            let mut firsts = 0;
            while let Step::Serve { next, .. } = plan.next(|| None).unwrap() {
                firsts += u32::from(matches!(next, Next::Fill { first: true, .. }));
            }
            firsts
        };
        assert_eq!(firsts(vec![Ask::Fill { from: Some(2), to: Some(5) }]), 1);
        assert_eq!(firsts(vec![Ask::Fill { from: None, to: None }, Ask::EndStream]), 0);
    }

    /// Both refusal texts are the ones `docs/WIRE.md` §FoD messages documents, word for word.
    #[test]
    fn the_refusal_texts_are_the_documented_ones() {
        assert_eq!(frame_in_range(9, 4), Err("frame index 9 out of range (4)".into()));
        assert_eq!(fill_range(Some(2), Some(9), 4), Err("StreamFrames 2..=9 outside 0..=3".into()));
        assert_eq!(fill_range(None, None, 0), Err("study is empty".into()));
    }

    /// A flood of asks does not grow `in_hand` past `ASKS_AHEAD`; the rest stay in `poll`.
    #[test]
    fn the_loop_holds_no_more_than_asks_ahead() {
        let mut plan = Planner::new(1000);
        let mut offered = 0u32;
        let mut poll = || {
            if offered >= 800 {
                return None;
            }
            offered += 1;
            Some(Ask::Frame(offered - 1))
        };
        for _ in 0..100 {
            let _ = plan.next(&mut poll).unwrap();
            assert!(
                plan.in_hand_len() <= ASKS_AHEAD,
                "in_hand grew to {} past ASKS_AHEAD {ASKS_AHEAD}",
                plan.in_hand_len()
            );
        }
    }

    /// A queued `Fill` is next; a frame behind it is not named as upcoming.
    #[test]
    fn upcoming_stops_at_the_first_ask_that_is_not_a_frame() {
        let mut plan = Planner::new(10);
        plan.push(Ask::Frame(5));
        plan.push(Ask::Fill { from: Some(7), to: Some(9) });
        plan.push(Ask::Frame(9));
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
        plan.push(Ask::Failed(anyhow::anyhow!("control broke")));
        assert!(plan.next(|| None).is_err(), "reader error was swallowed");
    }
}
