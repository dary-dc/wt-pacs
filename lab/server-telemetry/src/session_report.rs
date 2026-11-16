//! SESSION's receiver: each client stream after the control stream is one record, read to FIN, appended with the
//! path at receipt, then answered with one byte. docs/client/evidence/report-plan.md §3.3.

use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Map, Value};
use wtransport::VarInt;

const MAX_RECORD: usize = 16 * 1024;
/// Per session; the protocol names no number, so this build's choice.
const MAX_RECORDS: u32 = 512;
const FIELDS: &str = include_str!("../../report-arms/report-fields.json");

/// The sink's counters (lab/report-arms/sink.mjs), the same names, plus the fields dropped as outside the list.
#[derive(Default)]
pub struct Receiver {
    dir: PathBuf,
    received: u64,
    appended: u64,
    acknowledged: u64,
    duplicates: u64,
    load: u64,
    safety: u64,
    not_object: u64,
    too_large: u64,
    path: u64,
    cap: u64,
    outside: u64,
    seen: HashSet<String>,
    /// §7.4's mutant: the byte is sent and the line never written.
    ack_before_write: bool,
}

/// What a report stream gets back.
#[derive(Debug, PartialEq)]
pub enum Answer {
    Byte,
    Reset,
}

impl Receiver {
    pub fn new(dir: PathBuf, ack_before_write: bool) -> Self {
        Self { dir, ack_before_write, ..Self::default() }
    }

    /// The session's `n`th record (from 1): the byte only once its line is written, a reset for anything refused.
    pub fn file(&mut self, n: u32, bytes: Option<&[u8]>, path: Value, t: u64) -> Answer {
        if n > MAX_RECORDS {
            self.cap += 1;
            self.write_counters();
            return Answer::Reset;
        }
        match self.take(bytes, path, t) {
            Some(_) if self.ack_before_write => Answer::Byte,
            Some((kind, line)) if self.append(kind, &line) => Answer::Byte,
            _ => Answer::Reset,
        }
    }

    /// The line to append to `server-<kind>.jsonl`, or `None` when refused. `bytes`: `None` past 16 KiB.
    pub fn take(&mut self, bytes: Option<&[u8]>, path: Value, t: u64) -> Option<(&'static str, String)> {
        self.received += 1;
        let Some(bytes) = bytes else {
            self.too_large += 1;
            return None;
        };
        let Ok(Value::Object(mut r)) = serde_json::from_slice::<Value>(bytes) else {
            self.not_object += 1;
            return None;
        };
        let kind = match r.get("kind").and_then(Value::as_str) {
            Some("load") => "load",
            Some("safety") => "safety",
            _ => {
                self.path += 1;
                return None;
            }
        };
        self.drop_outside(kind, &mut r);
        if let Some(id) = r.get("reportId").and_then(Value::as_str) {
            if !self.seen.insert(id.to_string()) {
                self.duplicates += 1;
            }
        }
        if kind == "load" { self.load += 1 } else { self.safety += 1 }
        Some((kind, json!({ "t": t, "r": r, "path": path }).to_string()))
    }

    fn drop_outside(&mut self, kind: &str, r: &mut Map<String, Value>) {
        let listed: &Value = &fields()[kind];
        let outside: Vec<String> = r.keys().filter(|k| !listed.as_array().unwrap().iter().any(|f| f == *k)).cloned().collect();
        for k in &outside {
            r.remove(k);
            tracing::warn!(field = %k, kind, "report field outside report-fields.json dropped");
        }
        self.outside += outside.len() as u64;
    }

    pub fn counters(&self) -> Value {
        json!({
            "received": self.received, "appended": self.appended, "acknowledged": self.acknowledged,
            "duplicates": self.duplicates, "byKind": { "load": self.load, "safety": self.safety },
            "refused": { "notObject": self.not_object, "tooLarge": self.too_large, "path": self.path, "cap": self.cap },
            "outside": self.outside,
        })
    }

    /// One write per line, so sessions never interleave; the counters file is rewritten after it.
    fn append(&mut self, kind: &str, line: &str) -> bool {
        let file = self.dir.join(format!("server-{kind}.jsonl"));
        let ok = std::fs::OpenOptions::new().create(true).append(true).open(file)
            .and_then(|mut f| f.write_all(format!("{line}\n").as_bytes()))
            .is_ok();
        if ok {
            self.appended += 1;
        }
        self.write_counters();
        ok
    }

    fn acknowledged(&mut self) {
        self.acknowledged += 1;
        self.write_counters();
    }

    fn write_counters(&self) {
        let _ = std::fs::write(self.dir.join("server-counters.json"), self.counters().to_string());
    }
}

fn fields() -> &'static Value {
    static F: OnceLock<Value> = OnceLock::new();
    F.get_or_init(|| serde_json::from_str(FIELDS).expect("report-fields.json"))
}

fn receiver(dir: &str) -> &'static Mutex<Receiver> {
    static R: OnceLock<Mutex<Receiver>> = OnceLock::new();
    let mutant = std::env::var("WTPACS_SESSION_REPORT_MUTANT").as_deref() == Ok("ack-before-write");
    R.get_or_init(|| Mutex::new(Receiver::new(dir.into(), mutant)))
}

fn fits(read: usize, more: usize) -> bool {
    read + more <= MAX_RECORD
}

/// The record's bytes to FIN, or `None` past 16 KiB or on a stream error.
async fn read(recv: &mut wtransport::RecvStream) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match recv.read(&mut buf).await {
            Ok(Some(n)) if fits(bytes.len(), n) => bytes.extend_from_slice(&buf[..n]),
            Ok(None) => return Some(bytes),
            _ => return None,
        }
    }
}

fn path_now(connection: &wtransport::quinn::Connection) -> Value {
    let p = connection.stats().path;
    json!({ "rtt_us": p.rtt.as_micros() as u64, "cwnd": p.cwnd, "lost_packets": p.lost_packets,
            "congestion_events": p.congestion_events })
}

/// Serves `WTPACS_SESSION_REPORT_DIR`'s receiver (`WTPACS_SESSION_REPORT_MUTANT=ack-before-write`: §7.4's mutant) on a session whose control stream is already accepted: one report
/// stream at a time, on a task apart from the frame pipeline.
pub async fn run(connection: wtransport::Connection) {
    let Ok(dir) = std::env::var("WTPACS_SESSION_REPORT_DIR") else {
        return;
    };
    let receiver = receiver(&dir);
    let mut n = 0;
    while let Ok((mut send, mut recv)) = connection.accept_bi().await {
        n += 1;
        let bytes = if n > MAX_RECORDS { None } else { read(&mut recv).await };
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        let answer = receiver.lock().unwrap().file(n, bytes.as_deref(), path_now(connection.quic_connection()), t);
        if answer == Answer::Reset {
            let _ = send.reset(VarInt::from_u32(0));
            recv.stop(VarInt::from_u32(0));
            continue;
        }
        if send.write_all(&[1]).await.is_ok() && send.finish().await.is_ok() {
            receiver.lock().unwrap().acknowledged();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rx() -> Receiver {
        Receiver::new(std::env::temp_dir(), false)
    }

    fn take(r: &mut Receiver, v: Value) -> Option<Value> {
        let (_, line) = r.take(Some(v.to_string().as_bytes()), json!({ "rtt_us": 7 }), 1)?;
        Some(serde_json::from_str(&line).unwrap())
    }

    /// A record is one JSON object of kind `load` or `safety`; it is filed with the receipt time and the path the
    /// server holds at that moment, outside `r`, so the read tool's field check sees only what the page sent.
    #[test]
    fn a_record_is_filed_by_kind_with_the_path_at_receipt() {
        let mut r = rx();
        let line = take(&mut r, json!({ "v": 1, "kind": "safety", "reportId": "a", "load": "L", "frame": 10 })).unwrap();
        assert_eq!(line["t"], 1);
        assert_eq!(line["r"]["frame"], 10);
        assert_eq!(line["path"]["rtt_us"], 7);
        let (kind, _) = r.take(Some(br#"{"kind":"load","seq":0}"#), json!({}), 1).unwrap();
        assert_eq!(kind, "load");
        let c = r.counters();
        assert_eq!((c["received"].clone(), c["byKind"]["safety"].clone(), c["byKind"]["load"].clone()), (json!(2), json!(1), json!(1)));
    }

    /// Past 16 KiB, anything but one object, or another kind: refused and counted by why, nothing filed.
    #[test]
    fn refusals_are_counted_by_why() {
        let mut r = rx();
        assert!(r.take(None, json!({}), 1).is_none());
        assert!(r.take(Some(b"[1]"), json!({}), 1).is_none());
        assert!(r.take(Some(b"not json"), json!({}), 1).is_none());
        assert!(r.take(Some(br#"{"kind":"link"}"#), json!({}), 1).is_none());
        let c = r.counters();
        assert_eq!(c["refused"], json!({ "notObject": 2, "tooLarge": 1, "path": 1, "cap": 0 }));
        assert_eq!(c["received"], 4);
    }

    /// The field-outside mutant against the server: a field report-fields.json does not list for the record's kind
    /// is dropped and counted; the listed ones stay.
    #[test]
    fn a_field_outside_the_list_is_dropped_and_counted() {
        let mut r = rx();
        let line = take(&mut r, json!({ "kind": "load", "seq": 0, "labOnly": 1, "frame": 3 })).unwrap();
        assert!(line["r"].get("labOnly").is_none());
        assert!(line["r"].get("frame").is_none(), "frame is a safety field, not a load one");
        assert_eq!(line["r"]["seq"], 0);
        assert_eq!(r.counters()["outside"], 2);
    }

    /// A second copy of a reportId is filed and counted as a duplicate, as the sink does; the read tool drops it.
    #[test]
    fn a_second_copy_is_counted() {
        let mut r = rx();
        let rec = json!({ "kind": "safety", "reportId": "dup" });
        assert!(take(&mut r, rec.clone()).is_some());
        assert!(take(&mut r, rec).is_some());
        assert!(take(&mut r, json!({ "kind": "safety" })).is_some());
        assert_eq!(r.counters()["duplicates"], 1);
    }

    /// Appended means written: the line is in the file, and counted.
    #[test]
    fn append_writes_the_line_and_counts_it() {
        let dir = std::env::temp_dir().join(format!("session-report-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut r = Receiver::new(dir.clone(), false);
        let (kind, line) = r.take(Some(br#"{"kind":"load","seq":0}"#), json!({}), 1).unwrap();
        assert!(r.append(kind, &line));
        let filed = std::fs::read_to_string(dir.join("server-load.jsonl")).unwrap();
        assert_eq!(filed, format!("{line}\n"));
        let counters: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("server-counters.json")).unwrap()).unwrap();
        assert_eq!(counters["appended"], 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A line that could not be written is not appended.
    #[test]
    fn a_failed_write_is_not_appended() {
        let mut r = Receiver::new(std::env::temp_dir().join("session-report-no-such-dir/x"), false);
        let (kind, line) = r.take(Some(br#"{"kind":"load","seq":0}"#), json!({}), 1).unwrap();
        assert!(!r.append(kind, &line));
        assert_eq!(r.counters()["appended"], 0);
    }

    /// The counters file counts the acknowledgement too, not only the append before it.
    #[test]
    fn the_counters_file_follows_the_acknowledgement() {
        let dir = std::env::temp_dir().join(format!("session-report-ack-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut r = Receiver::new(dir.clone(), false);
        r.acknowledged();
        let counters: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("server-counters.json")).unwrap()).unwrap();
        assert_eq!(counters["acknowledged"], 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("session-report-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const LOAD: &[u8] = br#"{"kind":"load","seq":0}"#;

    /// The stream's byte is sent only for a line that is in the file.
    #[test]
    fn the_byte_answers_a_written_line() {
        let d = dir("file");
        let mut r = Receiver::new(d.clone(), false);
        assert_eq!(r.file(1, Some(LOAD), json!({}), 1), Answer::Byte);
        assert_eq!(std::fs::read_to_string(d.join("server-load.jsonl")).unwrap().lines().count(), 1);
        std::fs::remove_dir_all(d).unwrap();
    }

    /// A line that could not be written, or a record refused, gets a reset, never the byte.
    #[test]
    fn a_failed_write_or_a_refusal_is_reset() {
        let mut r = Receiver::new(std::env::temp_dir().join("session-report-no-such-dir/x"), false);
        assert_eq!(r.file(1, Some(LOAD), json!({}), 1), Answer::Reset);
        assert_eq!(r.file(2, Some(b"[1]"), json!({}), 1), Answer::Reset);
        assert_eq!(r.counters()["appended"], 0);
    }

    /// The 512th record of a session is filed; the 513th is reset unread and counted as the cap.
    #[test]
    fn past_the_session_cap_records_are_reset() {
        let d = dir("cap");
        let mut r = Receiver::new(d.clone(), false);
        assert_eq!(r.file(MAX_RECORDS, Some(LOAD), json!({}), 1), Answer::Byte);
        assert_eq!(r.file(MAX_RECORDS + 1, Some(LOAD), json!({}), 1), Answer::Reset);
        let c = r.counters();
        assert_eq!((c["refused"]["cap"].clone(), c["received"].clone()), (json!(1), json!(1)));
        std::fs::remove_dir_all(d).unwrap();
    }

    /// The ack-before-write mutant sends the byte and writes nothing, so appended falls below acknowledged.
    #[test]
    fn ack_before_write_sends_the_byte_and_writes_nothing() {
        let d = dir("mutant");
        let mut r = Receiver::new(d.clone(), true);
        assert_eq!(r.file(1, Some(LOAD), json!({}), 1), Answer::Byte);
        r.acknowledged();
        assert!(!d.join("server-load.jsonl").exists());
        let c = r.counters();
        assert_eq!((c["appended"].clone(), c["acknowledged"].clone()), (json!(0), json!(1)));
        std::fs::remove_dir_all(d).unwrap();
    }

    /// A record of exactly 16 KiB is read whole; one byte more is refused as too large.
    #[test]
    fn records_are_capped_at_16_kib() {
        assert!(fits(MAX_RECORD, 0));
        assert!(!fits(MAX_RECORD, 1));
    }
}
