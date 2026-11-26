//! The lab's clocks in the window: the timer cine and the busy-UI block. `docs/native/README.md` §The comparison,
//! pre-registered, metrics 4 and 5.

use std::time::{Duration, Instant};

/// A timer cine: its `n`th frame due, unwrapped, is frame `n % count` at `start + n × period`. Each tick shows the
/// frame due now, so a late tick passes frames over rather than falling behind.
pub struct Cine {
    start: Instant,
    period: Duration,
    count: usize,
    last: Option<u64>,
}

impl Cine {
    pub fn new(hz: f64, count: usize, start: Instant) -> Self {
        Self { start, period: Duration::from_secs_f64(1.0 / hz), count: count.max(1), last: None }
    }

    /// `n` of the frame due at `now`, its index, and how many due before it were passed over; `None` if already shown.
    pub fn tick(&mut self, now: Instant) -> Option<(u64, usize, u64)> {
        let n = (now.saturating_duration_since(self.start).as_secs_f64() / self.period.as_secs_f64()) as u64;
        let first = self.last.map_or(0, |l| l + 1);
        if n < first {
            return None;
        }
        self.last = Some(n);
        Some((n, (n % self.count as u64) as usize, n - first))
    }

    /// True when the `n`th frame's paint, ended at `painted`, ended before the next was due.
    pub fn on_time(&self, n: u64, painted: Instant) -> bool {
        painted < self.due(n + 1)
    }

    /// When the next frame not yet shown is due.
    pub fn next(&self) -> Instant {
        self.due(self.last.map_or(0, |l| l + 1))
    }

    fn due(&self, n: u64) -> Instant {
        self.start + self.period.mul_f64(n as f64)
    }
}

/// The busy-UI loop: from `start`, every `every`, the thread spins for `block`.
pub struct Busy {
    next: Instant,
    every: Duration,
    block: Duration,
}

impl Busy {
    pub fn new(start: Instant, every: Duration, block: Duration) -> Self {
        Self { next: start, every, block }
    }

    /// When a block is due, spins through it and returns true. Blocks keep their schedule: the next is due `every`
    /// after this one was due, not after it ended.
    pub fn run(&mut self, now: Instant) -> bool {
        if now < self.next {
            return false;
        }
        let end = Instant::now() + self.block;
        while Instant::now() < end {
            std::hint::spin_loop();
        }
        self.next += self.every;
        true
    }

    pub fn next(&self) -> Instant {
        self.next
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: Duration = Duration::from_millis(1);

    /// **The cine shows the frame due by the clock, not the next in line.** At 10 Hz, a tick 250 ms in shows `n` = 2,
    /// frame 2, passing over `n` = 1; a tick at 290 ms shows nothing; a tick at 730 ms shows `n` = 7 — frame 1 of a
    /// three-frame series — passing over `n` = 3 to 6.
    #[test]
    fn the_cine_shows_the_frame_due_and_counts_those_passed_over() {
        let t0 = Instant::now();
        let mut cine = Cine::new(10.0, 3, t0);
        assert_eq!(cine.tick(t0), Some((0, 0, 0)));
        assert_eq!(cine.tick(t0 + 250 * MS), Some((2, 2, 1)));
        assert_eq!(cine.tick(t0 + 290 * MS), None, "a frame due was shown twice");
        assert_eq!(cine.next(), t0 + 300 * MS);
        assert_eq!(cine.tick(t0 + 730 * MS), Some((7, 1, 4)));
        assert_eq!(cine.tick(t0 + 800 * MS), Some((8, 2, 0)));
    }

    /// **A frame is on time only if its paint ends before the next is due.** At 10 Hz, `n` = 2's paint ending at
    /// 299 ms is on time, at 300 ms late.
    #[test]
    fn a_paint_is_on_time_only_before_the_next_is_due() {
        let t0 = Instant::now();
        let cine = Cine::new(10.0, 3, t0);
        assert!(cine.on_time(2, t0 + 299 * MS));
        assert!(!cine.on_time(2, t0 + 300 * MS));
        assert!(!cine.on_time(2, t0 + 450 * MS));
    }

    /// **The busy loop blocks for its length and keeps its schedule.** Every 50 ms it spins 20: not before it is due,
    /// for at least 20 ms when it is, and the next block is due 50 ms after the last was due, however late it ran.
    #[test]
    fn the_busy_loop_blocks_and_keeps_its_schedule() {
        let t0 = Instant::now();
        let mut busy = Busy::new(t0 + 50 * MS, 50 * MS, 20 * MS);
        assert!(!busy.run(t0));
        let late = t0 + 70 * MS;
        let before = Instant::now();
        assert!(busy.run(late));
        assert!(before.elapsed() >= 20 * MS, "the block was shorter than its length");
        assert_eq!(busy.next(), t0 + 100 * MS);
    }
}
