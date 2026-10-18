//! What to serve next, decided without I/O. `docs/adr/disk-access.md`.

use anyhow::Result;
use std::collections::VecDeque;

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
}

pub struct Planner {
    in_hand: VecDeque<Command>,
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
            if let Some(Fill { frame, to, first }) = self.fill.take() {
                if self.in_hand.is_empty() {
                    let after = (frame < to).then_some(frame + 1);
                    self.fill = after.map(|frame| Fill { frame, to, first: false });
                    let next = Next::Fill { after, first };
                    return Ok(Step::Serve { frame, next });
                }
            }
            match self.in_hand.pop_front() {
                None => return Ok(Step::Wait),
                Some(Command::EndSession) => return Ok(Step::End),
                Some(Command::Failed(err)) => return Err(err),
                Some(Command::EndStream) => continue,
                Some(Command::Fill { from, to }) => match fill_range(from, to, self.frames) {
                    Ok((frame, to)) => self.fill = Some(Fill { frame, to, first: true }),
                    Err(reason) => return Ok(Step::Refuse { frame: from.unwrap_or(0), reason }),
                },
                Some(Command::Frame(frame)) => {
                    if let Err(reason) = frame_in_range(frame, self.frames) {
                        return Ok(Step::Refuse { frame, reason });
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
mod tests;
