//! What to serve next, decided without I/O. `docs/adr/disk-access.md`.

use anyhow::Result;
use std::collections::{BTreeSet, VecDeque};

/// Asks the server holds, the frame being served among them. A tile reader takes what fits (`slots − 1`).
pub const ASKS_AHEAD: usize = 8;

/// What the loop consumes. `EndSession` and `Failed` end it; every other ask carries frames.
#[derive(Debug)]
pub enum Command {
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
    /// Frames of `frame..=to` an ask has served, which the fill skips.
    served: BTreeSet<u32>,
}

impl Fill {
    fn unserved_from(&self, from: u32) -> Option<u32> {
        (from..=self.to).find(|f| !self.served.contains(f))
    }
}

pub struct Planner {
    in_hand: VecDeque<Command>,
    fill: Option<Fill>,
    frames: u32,
    fill_resumes: bool,
}

impl Planner {
    pub fn new(frames: u32) -> Self {
        Self {
            in_hand: VecDeque::new(),
            fill: None,
            frames,
            fill_resumes: false,
        }
    }

    /// Lab only: an ask no longer ends a fill but goes before it. docs/WIRE.md §Proposed: an ask during a fill
    pub fn fill_resumes(self, on: bool) -> Self {
        Self { fill_resumes: on, ..self }
    }

    pub fn push(&mut self, ask: Command) {
        self.in_hand.push_back(ask);
    }

    #[cfg(test)]
    fn in_hand_len(&self) -> usize {
        self.in_hand.len()
    }

    /// `poll` yields asks that arrived since the last step; a fill checks it between frames.
    pub fn next(&mut self, mut poll: impl FnMut() -> Option<Command>) -> Result<Step> {
        while self.in_hand.len() < ASKS_AHEAD {
            let Some(ask) = poll() else { break };
            self.in_hand.push_back(ask);
        }
        loop {
            if self.in_hand.is_empty() {
                if let Some(step) = self.fill_step() {
                    return Ok(step);
                }
            }
            let Some(ask) = self.in_hand.pop_front() else { return Ok(Step::Wait) };
            if !(self.fill_resumes && matches!(ask, Command::Frame(_))) {
                self.fill = None;
            }
            match ask {
                Command::EndSession => return Ok(Step::End),
                Command::Failed(err) => return Err(err),
                Command::EndStream => continue,
                Command::Fill { from, to } => match fill_range(from, to, self.frames) {
                    Ok((frame, to)) => self.fill = Some(Fill { frame, to, first: true, served: BTreeSet::new() }),
                    Err(reason) => return Ok(Step::Refuse { frame: from.unwrap_or(0), reason }),
                },
                Command::Frame(frame) => {
                    if let Err(reason) = frame_in_range(frame, self.frames) {
                        return Ok(Step::Refuse { frame, reason });
                    }
                    if let Some(fill) = self.fill.as_mut().filter(|f| (f.frame..=f.to).contains(&frame)) {
                        fill.served.insert(frame);
                    }
                    let names = self
                        .in_hand
                        .iter()
                        .take_while(|a| matches!(a, Command::Frame(_) | Command::EndStream))
                        .filter_map(|a| match a {
                            Command::Frame(f) => frame_in_range(*f, self.frames).is_ok().then_some(*f),
                            _ => None,
                        })
                        .collect();
                    return Ok(Step::Serve { frame, next: Next::Tiles(names) });
                }
            }
        }
    }

    /// The fill's next frame no ask has served, naming the one after it; `None` once none is left.
    fn fill_step(&mut self) -> Option<Step> {
        let fill = self.fill.as_mut()?;
        let Some(frame) = fill.unserved_from(fill.frame) else {
            self.fill = None;
            return None;
        };
        let after = fill.unserved_from(frame + 1);
        let first = std::mem::replace(&mut fill.first, false);
        match after {
            Some(after) => fill.frame = after,
            None => self.fill = None,
        }
        Some(Step::Serve { frame, next: Next::Fill { after, first } })
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
        Err("series is empty".into())
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

    /// Every frame served until the planner waits, with what each named next.
    fn served(plan: &mut Planner) -> Vec<(u32, Next)> {
        let mut out = Vec::new();
        while let Step::Serve { frame, next } = plan.next(|| None).unwrap() {
            out.push((frame, next));
        }
        out
    }

    fn frames_of(steps: &[(u32, Next)]) -> Vec<u32> {
        steps.iter().map(|(f, _)| *f).collect()
    }

    /// A fill of `from..=to` that has served its first frame, with `fill_resumes` on.
    fn resuming_fill(frames: u32, from: u32, to: u32) -> Planner {
        let mut plan = Planner::new(frames).fill_resumes(true);
        plan.push(Command::Fill { from: Some(from), to: Some(to) });
        assert!(matches!(plan.next(|| None).unwrap(), Step::Serve { frame, .. } if frame == from));
        plan
    }

    /// With `fill_resumes`, an ask mid-fill is served next and the fill then resumes where it stopped.
    #[test]
    fn with_fill_resumes_an_ask_mid_fill_is_served_next_and_the_fill_resumes() {
        let mut plan = resuming_fill(10, 0, 4);
        let mut arrived = Some(Command::Frame(9));
        assert_eq!(plan.next(|| arrived.take()).unwrap(), Step::Serve { frame: 9, next: tiles(&[]) });
        let fill = |after, first| Next::Fill { after, first };
        assert_eq!(
            served(&mut plan),
            vec![(1, fill(Some(2), false)), (2, fill(Some(3), false)), (3, fill(Some(4), false)), (4, fill(None, false))]
        );
    }

    /// With `fill_resumes`, a fill frame an ask already served is neither served again nor read ahead.
    #[test]
    fn with_fill_resumes_a_frame_an_ask_served_is_skipped() {
        let mut plan = resuming_fill(10, 0, 5);
        let mut arrived = Some(Command::Frame(3));
        assert!(matches!(plan.next(|| arrived.take()).unwrap(), Step::Serve { frame: 3, .. }));
        let rest = served(&mut plan);
        assert_eq!(frames_of(&rest), vec![1, 2, 4, 5]);
        assert_eq!(rest[1].1, Next::Fill { after: Some(4), first: false }, "the read-ahead named a frame already served");
    }

    /// With `fill_resumes`, several asks in hand all go before the fill, in ask order.
    #[test]
    fn with_fill_resumes_several_asks_go_before_the_fill_in_ask_order() {
        let mut plan = resuming_fill(10, 0, 9);
        let mut arrived = vec![Command::Frame(7), Command::Frame(2), Command::Frame(5)].into_iter();
        assert_eq!(plan.next(|| arrived.next()).unwrap(), Step::Serve { frame: 7, next: tiles(&[2, 5]) });
        assert_eq!(frames_of(&served(&mut plan)), vec![2, 5, 1, 3, 4, 6, 8, 9]);
    }

    /// With `fill_resumes`, a new fill still replaces the running one.
    #[test]
    fn with_fill_resumes_a_new_fill_replaces_the_running_one() {
        let mut plan = resuming_fill(10, 0, 5);
        let mut arrived = Some(Command::Fill { from: Some(7), to: Some(8) });
        assert!(matches!(plan.next(|| arrived.take()).unwrap(), Step::Serve { frame: 7, .. }));
        assert_eq!(frames_of(&served(&mut plan)), vec![8]);
    }

    /// With `fill_resumes`, `end_stream` and `end_session` still end the fill, also behind an ask.
    #[test]
    fn with_fill_resumes_end_stream_and_end_session_still_end_the_fill() {
        let ends: [fn() -> Command; 2] = [|| Command::EndStream, || Command::EndSession];
        for end in ends {
            let mut plan = resuming_fill(10, 0, 5);
            let mut arrived = vec![Command::Frame(8), end()].into_iter();
            assert!(matches!(plan.next(|| arrived.next()).unwrap(), Step::Serve { frame: 8, .. }));
            assert!(matches!(plan.next(|| None).unwrap(), Step::Wait | Step::End));
            assert!(served(&mut plan).is_empty(), "the fill outlived {:?}", end());
        }
    }

    /// An `Err` in hand makes `next` return it.
    #[test]
    fn a_reader_error_is_the_session_error() {
        let mut plan = Planner::new(2);
        plan.push(Command::Failed(anyhow::anyhow!("control broke")));
        assert!(plan.next(|| None).is_err(), "reader error was swallowed");
    }
}
