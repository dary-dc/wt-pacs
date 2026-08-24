use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct RunConfig {
    pub wt_url: String,
    pub read_bps: u64,
    pub send_cancel: bool,
    pub timeout_ms: u64,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct HarnessMetrics {
    pub trace: String,
    pub read_bps: u64,
    pub server_cancel_enabled: bool,
    pub client_sent_cancel: bool,
    pub wanted_frame: u32,
    pub asks_sent: u32,
    pub reversal_ms: f64,
    pub recovered_ms: f64,
    pub wasted_bytes: u64,
    pub commitment_depth: u32,
    pub wanted_received: bool,
    /// Completed server uni streams (envelope payloads read).
    pub frames_on_wire: u32,
    pub bytes_on_wire: u64,
    pub frames_after_settle: u32,
    pub bytes_after_settle: u64,
    pub frames_before_settle: u32,
    pub bytes_before_settle: u64,
}

#[derive(Debug)]
pub struct MetricsState {
    pub wanted_frame: u32,
    pub settled: bool,
    pub reversal_at: Option<Instant>,
    pub first_byte_wanted_at: Option<Instant>,
    pub wasted_bytes: u64,
    pub commitment_depth: u32,
    pub wanted_received: bool,
    pub frames_on_wire: u32,
    pub bytes_on_wire: u64,
    pub frames_after_settle: u32,
    pub bytes_after_settle: u64,
}

impl MetricsState {
    pub fn new(wanted: u32) -> Self {
        Self {
            wanted_frame: wanted,
            settled: false,
            reversal_at: None,
            first_byte_wanted_at: None,
            wasted_bytes: 0,
            commitment_depth: 0,
            wanted_received: false,
            frames_on_wire: 0,
            bytes_on_wire: 0,
            frames_after_settle: 0,
            bytes_after_settle: 0,
        }
    }

    pub fn settle(&mut self) {
        if !self.settled {
            self.settled = true;
            self.reversal_at = Some(Instant::now());
        }
    }

    pub fn on_envelope(&mut self, index: u32, nbytes: u64) {
        self.frames_on_wire += 1;
        self.bytes_on_wire += nbytes;
        if self.settled {
            self.frames_after_settle += 1;
            self.bytes_after_settle += nbytes;
        }

        if index == self.wanted_frame {
            if self.first_byte_wanted_at.is_none() {
                self.first_byte_wanted_at = Some(Instant::now());
            }
            self.wanted_received = true;
            return;
        }
        if self.settled {
            self.wasted_bytes += nbytes;
            self.commitment_depth += 1;
        }
    }

    pub fn finalize(
        &self,
        trace: &str,
        read_bps: u64,
        server_cancel_enabled: bool,
        client_sent_cancel: bool,
        asks_sent: u32,
    ) -> HarnessMetrics {
        let recovered_ms = match (self.reversal_at, self.first_byte_wanted_at) {
            (Some(r), Some(w)) => w.duration_since(r).as_secs_f64() * 1000.0,
            _ => 0.0,
        };
        HarnessMetrics {
            trace: trace.to_string(),
            read_bps,
            server_cancel_enabled,
            client_sent_cancel,
            wanted_frame: self.wanted_frame,
            asks_sent,
            reversal_ms: 0.0,
            recovered_ms,
            wasted_bytes: self.wasted_bytes,
            commitment_depth: self.commitment_depth,
            wanted_received: self.wanted_received,
            frames_on_wire: self.frames_on_wire,
            bytes_on_wire: self.bytes_on_wire,
            frames_after_settle: self.frames_after_settle,
            bytes_after_settle: self.bytes_after_settle,
            frames_before_settle: self.frames_on_wire.saturating_sub(self.frames_after_settle),
            bytes_before_settle: self.bytes_on_wire.saturating_sub(self.bytes_after_settle),
        }
    }
}

pub type SharedMetrics = Arc<Mutex<MetricsState>>;
