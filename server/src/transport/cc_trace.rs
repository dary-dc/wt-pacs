//! Lab only: any controller, its `metrics()` written once per batch of acknowledgements as a JSON
//! line to `$WTPACS_CC_TRACE`. `docs/transport/transport-conclusions.md` §1, R1.

use quinn_proto::RttEstimator;
use serde::Serialize;
use std::any::Any;
use std::fs::{File, OpenOptions};
use std::io::{LineWriter, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use wtransport::quinn::congestion::{Bbr, Controller, ControllerFactory, ControllerMetrics};

#[derive(Serialize)]
struct Row<'a> {
    conn: u64,
    t_us: u128,
    window: u64,
    /// Bits per second, as quinn reports it.
    pacing: Option<u64>,
    in_flight: u64,
    delivered: u64,
    lost: u64,
    srtt_us: u128,
    min_rtt_us: u128,
    /// BBR's state machine; absent under any other controller.
    mode: Option<&'a str>,
}

struct Traced {
    inner: Box<dyn Controller>,
    out: Arc<Mutex<LineWriter<File>>>,
    conn: u64,
    started: Instant,
    delivered: u64,
    lost: u64,
    srtt: Duration,
    min_rtt: Duration,
}

impl Traced {
    fn write(&self, now: Instant, in_flight: u64) {
        let bbr = self.inner.clone_box().into_any().downcast::<Bbr>().ok().map(|b| format!("{b:?}"));
        let mode = bbr.as_deref().and_then(|d| d.split("mode: ").nth(1)?.split(',').next());
        let m = self.inner.metrics();
        let row = Row {
            conn: self.conn,
            t_us: now.saturating_duration_since(self.started).as_micros(),
            window: m.congestion_window,
            pacing: m.pacing_rate,
            in_flight,
            delivered: self.delivered,
            lost: self.lost,
            srtt_us: self.srtt.as_micros(),
            min_rtt_us: self.min_rtt.as_micros(),
            mode,
        };
        let mut line = serde_json::to_vec(&row).expect("a row serializes");
        line.push(b'\n');
        let _ = self.out.lock().expect("trace lock").write_all(&line);
    }
}

impl Controller for Traced {
    fn on_sent(&mut self, now: Instant, bytes: u64, last_packet_number: u64) {
        self.inner.on_sent(now, bytes, last_packet_number);
    }

    fn on_ack(&mut self, now: Instant, sent: Instant, bytes: u64, app_limited: bool, rtt: &RttEstimator) {
        self.delivered += bytes;
        self.srtt = rtt.get();
        self.min_rtt = rtt.min();
        self.inner.on_ack(now, sent, bytes, app_limited, rtt);
    }

    fn on_end_acks(&mut self, now: Instant, in_flight: u64, app_limited: bool, largest: Option<u64>) {
        self.inner.on_end_acks(now, in_flight, app_limited, largest);
        self.write(now, in_flight);
    }

    fn on_congestion_event(&mut self, now: Instant, sent: Instant, persistent: bool, lost_bytes: u64) {
        self.lost += lost_bytes;
        self.inner.on_congestion_event(now, sent, persistent, lost_bytes);
    }

    fn on_mtu_update(&mut self, new_mtu: u16) {
        self.inner.on_mtu_update(new_mtu);
    }

    fn window(&self) -> u64 {
        self.inner.window()
    }

    fn metrics(&self) -> ControllerMetrics {
        self.inner.metrics()
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(Self {
            inner: self.inner.clone_box(),
            out: Arc::clone(&self.out),
            conn: self.conn,
            started: self.started,
            delivered: self.delivered,
            lost: self.lost,
            srtt: self.srtt,
            min_rtt: self.min_rtt,
        })
    }

    fn initial_window(&self) -> u64 {
        self.inner.initial_window()
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

struct TracedConfig {
    inner: Arc<dyn ControllerFactory + Send + Sync>,
    out: Arc<Mutex<LineWriter<File>>>,
    conns: AtomicU64,
}

impl ControllerFactory for TracedConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(Traced {
            inner: Arc::clone(&self.inner).build(now, current_mtu),
            out: Arc::clone(&self.out),
            conn: self.conns.fetch_add(1, Ordering::Relaxed),
            started: now,
            delivered: 0,
            lost: 0,
            srtt: Duration::ZERO,
            min_rtt: Duration::ZERO,
        })
    }
}

/// `factory` unchanged unless `WTPACS_CC_TRACE` names a file to append to.
pub fn traced(factory: Arc<dyn ControllerFactory + Send + Sync>) -> Arc<dyn ControllerFactory + Send + Sync> {
    let Some(path) = std::env::var_os("WTPACS_CC_TRACE") else { return factory };
    let file = OpenOptions::new().create(true).append(true).open(&path).expect("WTPACS_CC_TRACE opens");
    Arc::new(TracedConfig { inner: factory, out: Arc::new(Mutex::new(LineWriter::new(file))), conns: AtomicU64::new(0) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use wtransport::quinn::congestion::BbrConfig;

    /// A traced BBR writes one row per batch with the window an untraced one driven alike reports,
    /// and its mode: quinn's BBR enters ProbeRtt at its first batch, before it has an estimate.
    #[test]
    fn a_batch_writes_the_inner_window_and_mode() {
        let path = std::env::temp_dir().join(format!("cc-trace-{}.jsonl", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let file = OpenOptions::new().create(true).append(true).open(&path).unwrap();
        let config = Arc::new(TracedConfig {
            inner: Arc::new(BbrConfig::default()),
            out: Arc::new(Mutex::new(LineWriter::new(file))),
            conns: AtomicU64::new(0),
        });
        let now = Instant::now();
        let mut traced = config.build(now, 1200);
        let mut plain = Arc::new(BbrConfig::default()).build(now, 1200);
        for c in [&mut traced, &mut plain] {
            c.on_sent(now, 1200, 0);
            c.on_end_acks(now + Duration::from_millis(5), 1200, false, None);
        }
        assert_eq!(traced.window(), plain.window());
        let rows = std::fs::read_to_string(&path).unwrap();
        let row: serde_json::Value = serde_json::from_str(rows.lines().next().unwrap()).unwrap();
        assert_eq!(row["window"], plain.window());
        assert_eq!(row["mode"], "ProbeRtt");
        assert_eq!(row["t_us"], 5000);
        std::fs::remove_file(&path).unwrap();
    }
}
