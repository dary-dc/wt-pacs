//! What to serve next, decided without I/O. `docs/disk-access/IMPLEMENTATION.md`.

use anyhow::Result;
use std::collections::VecDeque;

/// Asks the server holds beyond the frame being served. A tile reader takes what fits (`slots − 1`).
pub const ASKS_AHEAD: usize = 8;
/// A fill reads one frame ahead: two buffers, pool only. `docs/disk-access/adr.md`.
pub const FILL_AHEAD: usize = 1;

/// What the loop consumes: one item per frame, whichever message carried it.
#[derive(Debug)]
pub enum Ask {
    Frame(u32),
    Fill { from: Option<u32>, to: Option<u32> },
    EndStream,
    EndSession,
    Failed(anyhow::Error),
}

impl Ask {
    pub fn frame(&self) -> Option<u32> {
        match self {
            Self::Frame(f) => Some(*f),
            _ => None,
        }
    }
}

/// The next thing to do. Decided without I/O, so it is tested with a `Vec`.
/// Which reader serves a frame: a fill knows what comes next, an on-demand ask does not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Fill,
    OnDemand,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    Serve {
        frame: u32,
        upcoming: Vec<u32>,
        mode: Mode,
    },
    Refuse {
        frame: u32,
        reason: String,
    },
    Wait,
    End,
}

pub struct Planner {
    in_hand: VecDeque<Ask>,
    fill: Option<(u32, u32)>,
    frames: u32,
    note_fill: bool,
    count_this_fill: bool,
}

impl Planner {
    pub fn new(frames: u32) -> Self {
        Self {
            in_hand: VecDeque::new(),
            fill: None,
            frames,
            note_fill: false,
            count_this_fill: false,
        }
    }

    pub fn push(&mut self, ask: Ask) {
        self.in_hand.push_back(ask);
    }

    /// True once after a fill's first frame is served, so the session can count `fills=N`.
    pub fn take_noted_fill(&mut self) -> bool {
        std::mem::take(&mut self.note_fill)
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
            if let Some((frame, to)) = self.fill {
                if self.in_hand.is_empty() {
                    self.fill = (frame < to).then_some((frame + 1, to));
                    let upcoming = (frame + 1..=to).take(FILL_AHEAD).collect();
                    if self.count_this_fill {
                        self.note_fill = true;
                        self.count_this_fill = false;
                    }
                    return Ok(Step::Serve {
                        frame,
                        upcoming,
                        mode: Mode::Fill,
                    });
                }
                self.fill = None;
                self.count_this_fill = false;
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
                    Ok(range) => {
                        self.fill = Some(range);
                        self.count_this_fill = true;
                        continue;
                    }
                    Err(reason) => {
                        return Ok(Step::Refuse {
                            frame: from.unwrap_or(0),
                            reason,
                        })
                    }
                },
                Some(Ask::Frame(frame)) => {
                    let upcoming = self
                        .in_hand
                        .iter()
                        .take_while(|a| matches!(a, Ask::Frame(_) | Ask::EndStream))
                        .filter_map(Ask::frame)
                        .take(ASKS_AHEAD)
                        .collect();
                    return Ok(Step::Serve {
                        frame,
                        upcoming,
                        mode: Mode::OnDemand,
                    });
                }
            }
        }
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

    /// Two `RequestFrame`s in hand: the first is served with the second as upcoming.
    #[test]
    fn pipelined_asks_supply_the_upcoming_frames() {
        let mut plan = Planner::new(10);
        for frame in [4, 5, 6] {
            plan.push(Ask::Frame(frame));
        }
        let Step::Serve {
            frame, upcoming, ..
        } = plan.next(|| None).unwrap()
        else {
            panic!()
        };
        assert_eq!((frame, upcoming), (4, vec![5, 6]));
    }

    /// `RequestFrame` then `RequestFrames`: the batch's frames are upcoming.
    #[test]
    fn a_batch_after_a_single_ask_supplies_its_first_frame() {
        let mut plan = Planner::new(10);
        plan.push(Ask::Frame(1));
        for frame in [4, 5] {
            plan.push(Ask::Frame(frame));
        }
        let Step::Serve {
            frame, upcoming, ..
        } = plan.next(|| None).unwrap()
        else {
            panic!()
        };
        assert_eq!((frame, upcoming), (1, vec![4, 5]));
        let Step::Serve {
            frame, upcoming, ..
        } = plan.next(|| None).unwrap()
        else {
            panic!()
        };
        assert_eq!((frame, upcoming), (4, vec![5]));
    }

    /// A fill recites `from..=to` inclusive, each frame naming the next.
    #[test]
    fn a_fill_recites_from_to_inclusive_in_order() {
        let mut plan = Planner::new(8);
        plan.push(Ask::Fill {
            from: Some(3),
            to: Some(7),
        });
        let mut served = Vec::new();
        let mut noted = 0u32;
        loop {
            match plan.next(|| None).unwrap() {
                Step::Serve {
                    frame, upcoming, ..
                } => {
                    if plan.take_noted_fill() {
                        noted += 1;
                    }
                    served.push((frame, upcoming));
                }
                Step::Wait => break,
                other => panic!("{other:?}"),
            }
        }
        assert_eq!(noted, 1, "a fill that served frames was not counted once");
        assert_eq!(
            served,
            vec![
                (3, vec![4]),
                (4, vec![5]),
                (5, vec![6]),
                (6, vec![7]),
                (7, vec![]),
            ]
        );
    }

    /// `EndStream` found between two frames of a fill stops it; the session goes on.
    #[test]
    fn end_stream_stops_a_fill_before_the_next_frame() {
        let mut plan = Planner::new(10);
        plan.push(Ask::Fill {
            from: Some(3),
            to: Some(7),
        });
        assert!(matches!(
            plan.next(|| None).unwrap(),
            Step::Serve { frame: 3, .. }
        ));
        let mut arrived = Some(Ask::EndStream);
        assert!(matches!(plan.next(|| arrived.take()).unwrap(), Step::Wait));
    }

    /// A data request found mid-fill ends the fill and is then served.
    #[test]
    fn a_data_request_during_a_fill_ends_it_and_is_served_next() {
        let mut plan = Planner::new(10);
        plan.push(Ask::Fill {
            from: Some(0),
            to: Some(5),
        });
        assert!(matches!(
            plan.next(|| None).unwrap(),
            Step::Serve { frame: 0, .. }
        ));
        let mut arrived = Some(Ask::Frame(9));
        let Step::Serve {
            frame, upcoming, ..
        } = plan.next(|| arrived.take()).unwrap()
        else {
            panic!()
        };
        assert_eq!((frame, upcoming), (9, vec![]));
    }

    /// `EndSession` mid-fill: nothing more is served.
    #[test]
    fn end_session_during_a_fill_ends_the_session() {
        let mut plan = Planner::new(6);
        plan.push(Ask::Fill {
            from: Some(0),
            to: Some(5),
        });
        assert!(matches!(
            plan.next(|| None).unwrap(),
            Step::Serve { frame: 0, .. }
        ));
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
        plan.push(Ask::Fill {
            from: None,
            to: None,
        });
        match plan.next(|| None).unwrap() {
            Step::Refuse { frame, reason } => {
                assert_eq!(frame, 0);
                assert!(reason.contains("empty"), "empty study refused as {reason}");
            }
            other => panic!("{other:?}"),
        }
    }

    /// `EndStream` before the first fill frame is not a fill that served anything.
    #[test]
    fn a_fill_stopped_before_its_first_frame_is_not_counted() {
        let mut plan = Planner::new(10);
        plan.push(Ask::Fill {
            from: None,
            to: None,
        });
        plan.push(Ask::EndStream);
        assert!(matches!(plan.next(|| None).unwrap(), Step::Wait));
        assert!(
            !plan.take_noted_fill(),
            "a fill that never served a frame was counted"
        );
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
        plan.push(Ask::Fill {
            from: Some(7),
            to: Some(9),
        });
        plan.push(Ask::Frame(9));
        let Step::Serve {
            frame, upcoming, ..
        } = plan.next(|| None).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            (frame, upcoming),
            (5, vec![]),
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
