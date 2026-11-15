//! The link record: one line per session at its end, keyed by the page's load id. docs/client/evidence/report-plan.md §3.4.

use std::time::Duration;

pub fn load_id(path: &str) -> Option<String> {
    unimplemented!("{path}")
}

pub fn line(load: &str, path: &wtransport::quinn::PathStats, bytes_sent: u64, duration: Duration) -> String {
    unimplemented!("{load} {path:?} {bytes_sent} {duration:?}")
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
        let v: serde_json::Value = serde_json::from_str(&line("ab12", &p, 1_000_000, Duration::from_millis(4_200))).unwrap();
        let fields: serde_json::Value =
            serde_json::from_str(include_str!("../../report-arms/report-fields.json")).unwrap();
        let listed: Vec<&str> = fields["link"].as_array().unwrap().iter().map(|f| f.as_str().unwrap()).collect();
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        for k in &keys {
            assert!(listed.contains(k), "{k} is not in report-fields.json's link list");
        }
        assert_eq!(keys.len(), listed.len(), "every listed field present: {keys:?}");
        assert_eq!(v["kind"], "link");
        assert_eq!(v["load"], "ab12");
        assert_eq!(v["rtt_us"], 20_500);
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
