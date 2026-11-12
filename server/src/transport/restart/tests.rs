use super::*;

const MTU: u16 = 1200;
const RTT: Duration = Duration::from_millis(80);

fn restart() -> SlowStartRestart {
    SlowStartRestart::new(Arc::new(CubicConfig::default()), Instant::now(), MTU)
}

/// Two acknowledgements `gap` apart, then the congestion event that follows them, over
/// packets sent before the gap.
fn acks_then_loss(r: &mut SlowStartRestart, gap: Duration) {
    let now = Instant::now();
    r.note_ack(now, RTT);
    r.note_ack(now + gap, RTT);
    r.on_congestion_event(now + gap, now, false, 1200);
}

/// Slow start is where a controller has no threshold yet: `ssthresh` infinite, window at the
/// initial one. Halving leaves both below it, so the pair tells the two apart.
fn in_slow_start(r: &SlowStartRestart) -> bool {
    r.metrics().ssthresh == Some(u64::MAX) && r.window() == r.initial_window()
}

/// A silence of four round trips is an outage: the controller is back in slow start, not in
/// congestion avoidance at seven tenths of the window it had.
#[test]
fn a_silence_restarts_slow_start() {
    let mut r = restart();
    acks_then_loss(&mut r, 4 * RTT);
    assert!(in_slow_start(&r));
}

/// Loss with acknowledgements still arriving is congestion, and is passed through: the inner
/// controller halves, which leaves a threshold behind and the window under the initial one.
#[test]
fn loss_among_acks_is_passed_through() {
    let mut r = restart();
    acks_then_loss(&mut r, RTT);
    assert!(!in_slow_start(&r));
    assert!(r.window() < r.initial_window());
}

/// The threshold is four round trips of the estimate that held when the silence began —
/// three does not restart, four does.
#[test]
fn the_threshold_is_four_round_trips() {
    let mut r = restart();
    acks_then_loss(&mut r, 3 * RTT);
    assert!(!in_slow_start(&r));
    let mut r = restart();
    acks_then_loss(&mut r, 4 * RTT);
    assert!(in_slow_start(&r));
}

/// One acknowledgement is no gap to measure, so the first congestion event of a session can
/// never be read as an outage.
#[test]
fn a_single_ack_is_not_a_silence() {
    let mut r = restart();
    let now = Instant::now();
    r.note_ack(now, RTT);
    r.on_congestion_event(now + 10 * RTT, now, false, 1200);
    assert!(!in_slow_start(&r));
}

/// quinn calls `on_ack` once per acknowledged packet: the zero-length gaps inside one batch
/// must not erase the silence the first packet of it recorded.
#[test]
fn a_batch_of_acks_is_one_arrival() {
    let mut r = restart();
    let now = Instant::now();
    r.note_ack(now, RTT);
    for _ in 0..8 {
        r.note_ack(now + 4 * RTT, RTT);
    }
    assert_eq!(r.silence_end, Some(now + 4 * RTT));
}

/// The acknowledgement that closes an outage carries the outage as its round-trip sample:
/// read the gap against that and a long blink raises its own bar out of reach.
#[test]
fn the_closing_sample_does_not_raise_the_bar() {
    let mut r = restart();
    let now = Instant::now();
    r.note_ack(now, RTT);
    r.note_ack(now + 5 * RTT, 5 * RTT);
    assert_eq!(r.silence_end, Some(now + 5 * RTT));
}

/// quinn declares the loss an acknowledgement or two after the one that closed the outage, and a detector that reads only the newest gap misses it.
#[test]
fn a_silence_survives_the_acks_that_follow_it() {
    let mut r = restart();
    let now = Instant::now();
    r.note_ack(now, RTT);
    r.note_ack(now + 4 * RTT, RTT);
    r.note_ack(now + 5 * RTT, RTT);
    r.on_congestion_event(now + 5 * RTT, now, false, 1200);
    assert!(in_slow_start(&r));
}

/// Loss of packets sent after the outage closed is ordinary congestion, however recent the
/// outage — otherwise one blink would turn every later loss into a restart.
#[test]
fn loss_after_the_silence_closed_is_congestion() {
    let mut r = restart();
    let now = Instant::now();
    r.note_ack(now, RTT);
    r.note_ack(now + 4 * RTT, RTT);
    r.on_congestion_event(now + 6 * RTT, now + 5 * RTT, false, 1200);
    assert!(!in_slow_start(&r));
}

/// A restart consumes the silence: a second congestion event behind the same gap halves the
/// window it just rebuilt instead of rebuilding it again.
#[test]
fn a_restart_consumes_the_silence() {
    let mut r = restart();
    acks_then_loss(&mut r, 4 * RTT);
    let now = Instant::now();
    r.on_congestion_event(now, now, false, 1200);
    assert!(!in_slow_start(&r));
}

/// A restart rebuilds the controller at the path's current MTU, not the one the connection
/// opened with: the rebuilt window's floor is two of the larger datagrams.
#[test]
fn a_restart_keeps_the_mtu_the_path_has_grown_to() {
    let mut r = restart();
    r.on_mtu_update(9000);
    acks_then_loss(&mut r, 4 * RTT);
    assert!(in_slow_start(&r), "precondition: the silence restarted slow start");
    let now = Instant::now();
    r.on_congestion_event(now, now, true, 1200);
    assert_eq!(r.window(), 2 * 9000, "the rebuilt controller forgot the MTU update");
}

/// A halved window, then a last batch of acknowledgements at `now` leaving `in_flight`, then
/// one send `gap` later.
fn idle_then_send(in_flight: u64, gap: Duration) -> SlowStartRestart {
    let mut r = restart();
    let now = Instant::now();
    r.on_congestion_event(now, now, false, 1200);
    r.note_ack(now, RTT);
    r.on_end_acks(now, in_flight, true, None);
    r.on_sent(now + gap, 1200, 1);
    r
}

/// An idle spell is the application's silence, not the path's: loss in the first flight after
/// it is congestion; reading it as an outage restarted sessions that were only idle.
#[test]
fn an_idle_spell_is_not_an_outage() {
    let mut r = idle_then_send(0, 10 * RTT);
    let now = Instant::now();
    r.note_ack(now + 11 * RTT, RTT);
    r.on_congestion_event(now + 11 * RTT, now + 10 * RTT, false, 1200);
    assert!(!in_slow_start(&r));
}

/// The gap runs from the first send an acknowledgement is owed for, so a blink that starts
/// as an idle session sends again is still an outage.
#[test]
fn a_blink_after_an_idle_spell_is_an_outage() {
    let mut r = idle_then_send(0, 10 * RTT);
    let now = Instant::now();
    r.note_ack(now + 15 * RTT, RTT);
    r.on_congestion_event(now + 15 * RTT, now + 10 * RTT, false, 1200);
    assert!(in_slow_start(&r));
}

/// An idle spell alone restarts nothing: the window survives it, as quinn's own Cubic does.
#[test]
fn an_idle_spell_keeps_the_window() {
    assert!(!in_slow_start(&idle_then_send(0, 10 * RTT)));
}
