//! The link record: one line per session at its end, keyed by the page's load id. docs/client/evidence/report-plan.md §3.4.

use std::io::Write;
use std::time::{Duration, Instant};

use serde_json::json;

/// quinn's PathStats has no minimum RTT, so the record keeps the least of samples at this interval.
const MIN_RTT_SAMPLE: Duration = Duration::from_millis(100);

/// The `load=` token of a session's path, or `None`: only 1–64 of `[0-9A-Za-z-]`, so a client writes no free text.
pub fn load_id(path: &str) -> Option<String> {
    let (_, query) = path.split_once('?')?;
    let id = query.split('&').find_map(|kv| kv.strip_prefix("load="))?;
    let ok =
        (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    ok.then(|| id.to_string())
}

pub fn line(
    load: &str,
    path: &wtransport::quinn::PathStats,
    min_rtt: Duration,
    bytes_sent: u64,
    duration: Duration,
) -> String {
    json!({
        "v": 1, "kind": "link", "load": load,
        "rtt_us": path.rtt.as_micros() as u64, "min_rtt_us": min_rtt.as_micros() as u64, "cwnd": path.cwnd,
        "congestion_events": path.congestion_events, "lost_packets": path.lost_packets,
        "lost_bytes": path.lost_bytes, "sent_packets": path.sent_packets,
        "bytes_sent": bytes_sent, "duration_ms": duration.as_millis() as u64,
    })
    .to_string()
}

/// Writes the session's line to `WTPACS_LINK_RECORD_PATH` when it closes; nothing when unset or the load has no id.
pub async fn run(connection: wtransport::quinn::Connection, load: Option<String>) {
    let (Ok(file), Some(load)) = (std::env::var("WTPACS_LINK_RECORD_PATH"), load) else {
        return;
    };
    let started = Instant::now();
    let mut min_rtt = Duration::MAX;
    let mut tick = tokio::time::interval(MIN_RTT_SAMPLE);
    loop {
        tokio::select! {
            _ = connection.closed() => break,
            _ = tick.tick() => min_rtt = min_rtt.min(connection.stats().path.rtt),
        }
    }
    let stats = connection.stats();
    let mut row = line(
        &load,
        &stats.path,
        min_rtt.min(stats.path.rtt),
        stats.udp_tx.bytes,
        started.elapsed(),
    );
    row.push('\n');
    // One write per line, so concurrent sessions never interleave (path.rs's append_row).
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
    {
        let _ = f.write(row.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The load id rides the session URL's query; anything but a short hex-and-dash token is no id, so the record
    /// never carries what a client chose to write.
    #[test]
    fn load_id_is_a_token_from_the_query() {
        assert_eq!(load_id("/?load=3f2a-9b").as_deref(), Some("3f2a-9b"));
        assert_eq!(load_id("/?ask=frame:3&load=ab12").as_deref(), Some("ab12"));
        assert_eq!(load_id("/?ask=frame:3"), None);
        assert_eq!(load_id("/?load="), None);
        assert_eq!(load_id("/?load=ab%22cd"), None);
        assert_eq!(load_id(&format!("/?load={}", "a".repeat(65))), None);
        assert_eq!(load_id("/load=ab12"), None);
    }

    /// One JSON object with the fields report-fields.json lists for `link`, values from quinn's PathStats.
    #[test]
    fn line_carries_the_listed_fields() {
        let mut p = wtransport::quinn::PathStats::default();
        p.rtt = Duration::from_micros(20_500);
        p.cwnd = 12_000;
        p.congestion_events = 2;
        p.lost_packets = 3;
        p.lost_bytes = 3_600;
        p.sent_packets = 900;
        let v: serde_json::Value = serde_json::from_str(&line(
            "ab12",
            &p,
            Duration::from_micros(18_000),
            1_000_000,
            Duration::from_millis(4_200),
        ))
        .unwrap();
        let fields: serde_json::Value =
            serde_json::from_str(include_str!("../../report-arms/report-fields.json")).unwrap();
        let listed: Vec<&str> = fields["link"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f.as_str().unwrap())
            .collect();
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        for k in &keys {
            assert!(
                listed.contains(k),
                "{k} is not in report-fields.json's link list"
            );
        }
        assert_eq!(
            keys.len(),
            listed.len(),
            "every listed field present: {keys:?}"
        );
        assert_eq!(v["kind"], "link");
        assert_eq!(v["load"], "ab12");
        assert_eq!(v["rtt_us"], 20_500);
        assert_eq!(v["min_rtt_us"], 18_000);
        assert_eq!(v["cwnd"], 12_000);
        assert_eq!(v["lost_packets"], 3);
        assert_eq!(v["lost_bytes"], 3_600);
        assert_eq!(v["congestion_events"], 2);
        assert_eq!(v["sent_packets"], 900);
        assert_eq!(v["bytes_sent"], 1_000_000);
        assert_eq!(v["duration_ms"], 4_200);
        assert_eq!(v["v"], fields["v"]);
    }
}
