//! Lab only: any controller, its `metrics()` written once per batch of acknowledgements as a JSON
//! line to `$WTPACS_CC_TRACE`, and each congestion event to `$WTPACS_LOSS_TRACE`.
//! `docs/transport/transport-conclusions.md` §1, R1 and R2.

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

#[derive(Serialize)]
struct Loss {
    conn: u64,
    /// CLOCK_MONOTONIC, the clock `lab/scripts/link_impair.py --drop-log` writes.
    now_ns: i128,
    sent_ns: i128,
    /// `now − sent` of the last packet acknowledged before the event, ack delay included.
    rtt_latest_us: u128,
    srtt_us: u128,
    min_rtt_us: u128,
    persistent: bool,
    lost_bytes: u64,
    window_before: u64,
    window_after: u64,
}

type Sink = Arc<Mutex<LineWriter<File>>>;

/// An `Instant` as CLOCK_MONOTONIC nanoseconds, from one pair read together.
#[derive(Clone, Copy)]
struct Clock {
    at: Instant,
    ns: i128,
}

impl Clock {
    fn now() -> Self {
        let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        // SAFETY: `ts` is a valid, writable timespec for the call's duration.
        unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
        Self { at: Instant::now(), ns: ts.tv_sec as i128 * 1_000_000_000 + ts.tv_nsec as i128 }
    }

    fn ns(&self, t: Instant) -> i128 {
        match t.checked_duration_since(self.at) {
            Some(d) => self.ns + d.as_nanos() as i128,
            None => self.ns - self.at.duration_since(t).as_nanos() as i128,
        }
    }
}

struct Traced {
    inner: Box<dyn Controller>,
    out: Option<Sink>,
    losses: Option<Sink>,
    clock: Clock,
    conn: u64,
    started: Instant,
    delivered: u64,
    lost: u64,
    srtt: Duration,
    min_rtt: Duration,
    rtt_latest: Duration,
}

impl Traced {
    fn write(&self, now: Instant, in_flight: u64) {
        let Some(out) = &self.out else { return };
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
        append(out, &row);
    }
}

impl Traced {
    /// `RttEstimator` cannot be built outside quinn, so this is the seam the tests drive.
    fn note_ack(&mut self, now: Instant, sent: Instant, bytes: u64, srtt: Duration, min_rtt: Duration) {
        self.delivered += bytes;
        self.srtt = srtt;
        self.min_rtt = min_rtt;
        self.rtt_latest = now.saturating_duration_since(sent);
    }
}

fn append<T: Serialize>(sink: &Sink, row: &T) {
    let mut line = serde_json::to_vec(row).expect("a row serializes");
    line.push(b'\n');
    let _ = sink.lock().expect("trace lock").write_all(&line);
}

impl Controller for Traced {
    fn on_sent(&mut self, now: Instant, bytes: u64, last_packet_number: u64) {
        self.inner.on_sent(now, bytes, last_packet_number);
    }

    fn on_ack(&mut self, now: Instant, sent: Instant, bytes: u64, app_limited: bool, rtt: &RttEstimator) {
        self.note_ack(now, sent, bytes, rtt.get(), rtt.min());
        self.inner.on_ack(now, sent, bytes, app_limited, rtt);
    }

    fn on_end_acks(&mut self, now: Instant, in_flight: u64, app_limited: bool, largest: Option<u64>) {
        self.inner.on_end_acks(now, in_flight, app_limited, largest);
        self.write(now, in_flight);
    }

    fn on_congestion_event(&mut self, now: Instant, sent: Instant, persistent: bool, lost_bytes: u64) {
        self.lost += lost_bytes;
        let window_before = self.inner.window();
        self.inner.on_congestion_event(now, sent, persistent, lost_bytes);
        if let Some(sink) = &self.losses {
            let row = Loss {
                conn: self.conn,
                now_ns: self.clock.ns(now),
                sent_ns: self.clock.ns(sent),
                rtt_latest_us: self.rtt_latest.as_micros(),
                srtt_us: self.srtt.as_micros(),
                min_rtt_us: self.min_rtt.as_micros(),
                persistent,
                lost_bytes,
                window_before,
                window_after: self.inner.window(),
            };
            append(sink, &row);
        }
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
            out: self.out.clone(),
            losses: self.losses.clone(),
            clock: self.clock,
            conn: self.conn,
            started: self.started,
            delivered: self.delivered,
            lost: self.lost,
            srtt: self.srtt,
            min_rtt: self.min_rtt,
            rtt_latest: self.rtt_latest,
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
    out: Option<Sink>,
    losses: Option<Sink>,
    clock: Clock,
    conns: AtomicU64,
}

impl ControllerFactory for TracedConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(Traced {
            inner: Arc::clone(&self.inner).build(now, current_mtu),
            out: self.out.clone(),
            losses: self.losses.clone(),
            clock: self.clock,
            conn: self.conns.fetch_add(1, Ordering::Relaxed),
            started: now,
            delivered: 0,
            lost: 0,
            srtt: Duration::ZERO,
            min_rtt: Duration::ZERO,
            rtt_latest: Duration::ZERO,
        })
    }
}

fn sink(var: &str) -> Option<Sink> {
    let path = std::env::var_os(var)?;
    let file = OpenOptions::new().create(true).append(true).open(&path).unwrap_or_else(|e| panic!("{var} opens: {e}"));
    Some(Arc::new(Mutex::new(LineWriter::new(file))))
}

/// `factory` unchanged unless `WTPACS_CC_TRACE` or `WTPACS_LOSS_TRACE` names a file to append to.
pub fn traced(factory: Arc<dyn ControllerFactory + Send + Sync>) -> Arc<dyn ControllerFactory + Send + Sync> {
    let (out, losses) = (sink("WTPACS_CC_TRACE"), sink("WTPACS_LOSS_TRACE"));
    if out.is_none() && losses.is_none() {
        return factory;
    }
    Arc::new(TracedConfig { inner: factory, out, losses, clock: Clock::now(), conns: AtomicU64::new(0) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use wtransport::quinn::congestion::{BbrConfig, CubicConfig};

    /// A traced BBR writes one row per batch with the window an untraced one driven alike reports,
    /// and its mode: quinn's BBR enters ProbeRtt at its first batch, before it has an estimate.
    #[test]
    fn a_batch_writes_the_inner_window_and_mode() {
        let path = std::env::temp_dir().join(format!("cc-trace-{}.jsonl", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let file = OpenOptions::new().create(true).append(true).open(&path).unwrap();
        let config = Arc::new(TracedConfig {
            inner: Arc::new(BbrConfig::default()),
            out: Some(Arc::new(Mutex::new(LineWriter::new(file)))),
            losses: None,
            clock: Clock::now(),
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

    /// A congestion event writes one loss row: its times on CLOCK_MONOTONIC, the round trip of the
    /// last packet acknowledged before it, and the window it cut from and to.
    #[test]
    fn a_congestion_event_writes_its_times_round_trip_and_cut() {
        let path = std::env::temp_dir().join(format!("loss-trace-{}.jsonl", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let file = OpenOptions::new().create(true).append(true).open(&path).unwrap();
        let clock = Clock::now();
        let config = Arc::new(TracedConfig {
            inner: Arc::new(CubicConfig::default()),
            out: None,
            losses: Some(Arc::new(Mutex::new(LineWriter::new(file)))),
            clock,
            conns: AtomicU64::new(0),
        });
        let t0 = clock.at;
        let ms = Duration::from_millis;
        let mut traced = config.build(t0, 1200).into_any().downcast::<Traced>().unwrap();
        traced.on_sent(t0, 1200, 0);
        traced.note_ack(t0 + ms(47), t0 + ms(2), 1200, ms(40), ms(40));
        traced.on_end_acks(t0 + ms(47), 0, false, Some(0));
        let before = traced.window();
        traced.on_congestion_event(t0 + ms(50), t0 + ms(3), false, 1200);
        let rows = std::fs::read_to_string(&path).unwrap();
        assert_eq!(rows.lines().count(), 1);
        let row: serde_json::Value = serde_json::from_str(rows.lines().next().unwrap()).unwrap();
        assert_eq!(row["sent_ns"].as_i64().unwrap() as i128, clock.ns + 3_000_000);
        assert_eq!(row["now_ns"].as_i64().unwrap() as i128, clock.ns + 50_000_000);
        assert_eq!(row["rtt_latest_us"], 45_000);
        assert_eq!(row["window_before"], before);
        assert_eq!(row["window_after"], traced.window());
        assert!(traced.window() < before);
        std::fs::remove_file(&path).unwrap();
    }

    /// The clock pair maps an `Instant` onto CLOCK_MONOTONIC within a millisecond of a second pair
    /// read later, and an earlier `Instant` to exactly as many nanoseconds before its own.
    #[test]
    fn an_instant_maps_onto_the_monotonic_clock() {
        let clock = Clock::now();
        let later = Clock::now();
        assert!((clock.ns(later.at) - later.ns).abs() < 1_000_000);
        assert_eq!(clock.ns(clock.at - Duration::from_millis(5)), clock.ns - 5_000_000);
    }
}
