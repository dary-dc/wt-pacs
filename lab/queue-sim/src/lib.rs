//! Transport-agnostic queue simulation — predicted curves before real harness runs.

pub mod study;

/// One server arm: cancel policy on or off.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelPolicy {
    Off,
    On,
}

#[derive(Debug, Clone)]
pub struct FlyAndSettleConfig {
    /// Bytes per HTJ2K frame (constant for the sweep).
    pub frame_bytes: u64,
    /// Downlink bits per second.
    pub link_bps: u64,
    /// Reader ask interval (16 ms/step ≈ 62 asks/sec).
    pub ask_interval_us: u64,
    /// Asks before the reader settles on the last index.
    pub burst_asks: u32,
    pub cancel: CancelPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimMetrics {
    /// Bytes written for frames the reader had already left (codestream only).
    pub wasted_bytes: u64,
    /// Settle → first byte of wanted frame (microseconds).
    pub recovered_time_us: u64,
    /// Unwanted frames fully sent after settle.
    pub commitment_depth: u32,
    /// Media uni streams completed (until wanted frame delivered).
    pub frames_on_wire: u32,
    /// Envelope payload bytes: frames × (4-byte index + codestream).
    pub bytes_on_wire: u64,
    /// Frames completed after settle (wanted + wasted).
    pub frames_after_settle: u32,
    pub bytes_after_settle: u64,
}

pub const ENVELOPE_OVERHEAD: u64 = 4;

pub fn frame_send_us(frame_bytes: u64, link_bps: u64) -> u64 {
    frame_bytes.saturating_mul(8).saturating_mul(1_000_000) / link_bps
}

/// Discrete-time model: asks arrive on a schedule; server sends one frame at a time.
pub fn simulate_fly_and_settle(cfg: &FlyAndSettleConfig) -> SimMetrics {
    assert!(cfg.link_bps > 0);
    assert!(cfg.frame_bytes > 0);
    assert!(cfg.burst_asks > 0);

    let send_time_us = frame_send_us(cfg.frame_bytes, cfg.link_bps);
    let wanted = cfg.burst_asks - 1;
    let settle_time_us = cfg.ask_interval_us.saturating_mul(cfg.burst_asks.saturating_sub(1) as u64);

    let mut deque: Vec<u32> = Vec::new();
    let mut next_ask: u32 = 0;
    let mut t_us: u64 = 0;
    let mut settled = false;
    let mut wasted_bytes: u64 = 0;
    let mut commitment_depth: u32 = 0;
    let mut recovered_time_us: u64 = 0;
    let mut recovered_recorded = false;
    let mut frames_on_wire: u32 = 0;
    let mut bytes_on_wire: u64 = 0;
    let mut frames_after_settle: u32 = 0;
    let mut bytes_after_settle: u64 = 0;
    let wire_frame_bytes = cfg.frame_bytes + ENVELOPE_OVERHEAD;

    // Upper bound: all asks land, then drain the queue at send rate.
    let horizon = settle_time_us
        .saturating_add(send_time_us.saturating_mul(cfg.burst_asks as u64 + 2));

    while t_us < horizon {
        while next_ask < cfg.burst_asks {
            let due = cfg.ask_interval_us.saturating_mul(next_ask as u64);
            if due > t_us {
                break;
            }
            deque.push(next_ask);
            next_ask += 1;
        }

        if !settled && t_us >= settle_time_us {
            settled = true;
            if cfg.cancel == CancelPolicy::On {
                deque.retain(|&idx| idx == wanted);
            }
        }

        if deque.is_empty() {
            if settled && (recovered_recorded || wanted >= cfg.burst_asks) {
                break;
            }
            t_us = t_us.saturating_add(1);
            continue;
        }

        let front = deque.remove(0);
        frames_on_wire += 1;
        bytes_on_wire += wire_frame_bytes;
        if settled {
            frames_after_settle += 1;
            bytes_after_settle += wire_frame_bytes;
        }

        if settled {
            if front != wanted {
                wasted_bytes += cfg.frame_bytes;
                commitment_depth += 1;
            } else if !recovered_recorded {
                recovered_time_us = t_us.saturating_sub(settle_time_us);
                recovered_recorded = true;
            }
        }

        t_us = t_us.saturating_add(send_time_us);

        if settled && recovered_recorded && deque.is_empty() {
            break;
        }
    }

    SimMetrics {
        wasted_bytes,
        recovered_time_us,
        commitment_depth,
        frames_on_wire,
        bytes_on_wire,
        frames_after_settle,
        bytes_after_settle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_reduces_wasted_bytes_on_fly_and_settle() {
        let base = FlyAndSettleConfig {
            frame_bytes: 50_000,
            link_bps: 2_000_000,
            ask_interval_us: 16_000,
            burst_asks: 20,
            cancel: CancelPolicy::Off,
        };
        let off = simulate_fly_and_settle(&base);
        let on = simulate_fly_and_settle(&FlyAndSettleConfig {
            cancel: CancelPolicy::On,
            ..base
        });
        assert!(off.wasted_bytes > on.wasted_bytes);
        assert!(on.recovered_time_us <= off.recovered_time_us);
    }
}
