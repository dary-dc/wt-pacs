use super::*;

const MTU: u16 = 1200;
const PKT: u64 = MTU as u64;
const RTT: Duration = Duration::from_millis(80);

fn bound() -> LossBound {
    LossBound::new(Arc::new(BbrConfig::default()), Instant::now(), MTU)
}

/// One round trip from `start`: `delivered` packets acknowledged in ten pieces, `lost` declared
/// lost, `in_flight` left at its end. The first piece acknowledges a packet sent before the
/// round, the last one sent at its start, which closes it.
fn round(b: &mut LossBound, start: Instant, delivered: u64, lost: u64, in_flight: u64) -> Instant {
    b.round_start.get_or_insert(start);
    b.in_flight = in_flight * PKT;
    b.on_congestion_event(start, start, false, lost * PKT);
    let piece = RTT / 10;
    for i in 1..=10u32 {
        let sent = if i == 10 { start } else { start - RTT };
        b.note_ack(start + piece * i, sent, delivered * PKT / 10, false, RTT);
    }
    start + RTT
}

/// With no lossy round the window is BBR's own, whatever else happened.
#[test]
fn before_a_lossy_round_the_window_is_bbrs() {
    let mut b = bound();
    let mut now = Instant::now();
    for _ in 0..5 {
        now = round(&mut b, now, 100, 0, 80);
    }
    assert_eq!(b.cap(), None);
    assert_eq!(b.window(), b.inner.window());
}

/// A round losing 2 % sets nothing; one losing over 2 % holds the window to 0.85 × the in-flight
/// it ended with — here above 0.7 × BDP, so the in-flight is `inflight_hi`.
#[test]
fn a_round_losing_over_2_percent_sets_the_cap() {
    let mut b = bound();
    let now = round(&mut b, Instant::now(), 98, 2, 80);
    assert_eq!(b.cap(), None, "a 2 % round set the cap");
    round(&mut b, now, 97, 3, 80);
    assert_eq!(b.inflight_hi, Some(80 * PKT));
    let cap = (0.85 * (80 * PKT) as f64) as u64;
    assert_eq!(b.cap(), Some(cap));
    assert!(b.inner.window() > cap, "BBR's own window does not exceed the cap here");
    assert_eq!(b.window(), cap, "the window is not held to the cap");
}

/// `inflight_hi` never falls under 0.7 × the path's BDP: 100 packets a round trip is a
/// 100-packet BDP, so a lossy round ending at 20 in flight still leaves 70.
#[test]
fn inflight_hi_is_floored_at_0_7_bdp() {
    let mut b = bound();
    let now = round(&mut b, Instant::now(), 100, 0, 100);
    round(&mut b, now, 90, 10, 20);
    let hi = b.inflight_hi.expect("a lossy round set no cap") as f64;
    assert!((hi / (0.7 * (100 * PKT) as f64) - 1.0).abs() < 0.02, "inflight_hi {hi} is not 0.7 × BDP");
}

/// Each clean round after the cap adds 1, 2, 4… packets to `inflight_hi`, and the next lossy
/// round starts the count again from one.
#[test]
fn clean_rounds_regrow_it_1_2_4_packets() {
    let mut b = bound();
    let mut now = round(&mut b, Instant::now(), 90, 10, 50);
    let hi = b.inflight_hi.unwrap();
    let mut added = Vec::new();
    for _ in 0..3 {
        now = round(&mut b, now, 100, 0, 50);
        added.push((b.inflight_hi.unwrap() - hi) / PKT);
    }
    assert_eq!(added, [1, 3, 7]);
    now = round(&mut b, now, 90, 10, 50);
    let hi = b.inflight_hi.unwrap();
    round(&mut b, now, 100, 0, 50);
    assert_eq!(b.inflight_hi.unwrap() - hi, PKT, "a lossy round did not restart the growth");
}
