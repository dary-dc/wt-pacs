//! RECEIVER (docs/client/evidence/report-plan.md §3.5): one record checked, appended as one line, then answered.

use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_BODY: usize = 16 * 1024;
pub const MAX_STRING: usize = 512;
const KINDS: [&str; 2] = ["load", "safety"];
// PS3.5 §9.1: a UID is at most 64 characters.
const MAX_UID: usize = 64;

/// The field list per kind, `report-fields.json`, the one the page's test and the read tool read.
pub struct Fields(HashMap<String, HashSet<String>>);

impl Fields {
    pub fn parse(text: &str) -> Result<Self, String> {
        let v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let mut kinds = HashMap::new();
        for kind in KINDS {
            let names = v[kind].as_array().ok_or(format!("no field list for {kind}"))?;
            kinds.insert(kind.to_string(), names.iter().filter_map(|n| n.as_str().map(String::from)).collect());
        }
        Ok(Fields(kinds))
    }
}

#[derive(Debug, PartialEq)]
pub enum Refusal {
    NotObject,
    TooLarge,
}

#[derive(Debug)]
pub struct Checked {
    pub record: Map<String, Value>,
    pub outside: Vec<String>,
}

/// The record as it may be kept: fields outside the list dropped (named, never their values), UID-shaped runs in
/// `errors[].message` replaced by `<uid>`, every string capped at `MAX_STRING` bytes.
pub fn check(kind: &str, body: &[u8], fields: &Fields) -> Result<Checked, Refusal> {
    if body.len() > MAX_BODY {
        return Err(Refusal::TooLarge);
    }
    let Ok(Value::Object(mut record)) = serde_json::from_slice::<Value>(body) else { return Err(Refusal::NotObject) };
    let allowed = &fields.0[kind];
    let outside: Vec<String> = record.keys().filter(|k| !allowed.contains(*k)).map(|k| format!("{kind}.{k}")).collect();
    record.retain(|k, _| allowed.contains(k));
    if let Some(Value::Array(errors)) = record.get_mut("errors") {
        for e in errors {
            if let Some(Value::String(m)) = e.get_mut("message") {
                *m = scrub_uids(m);
            }
        }
    }
    for v in record.values_mut() {
        cap_strings(v);
    }
    Ok(Checked { record, outside })
}

fn cap_strings(v: &mut Value) {
    match v {
        Value::String(s) if s.len() > MAX_STRING => {
            let mut end = MAX_STRING;
            while !s.is_char_boundary(end) {
                end -= 1;
            }
            s.truncate(end);
        }
        Value::Array(a) => a.iter_mut().for_each(cap_strings),
        Value::Object(o) => o.values_mut().for_each(cap_strings),
        _ => {}
    }
}

/// Each run of digits and dots shaped like a UID of four or more components (PS3.5 §9.1) becomes `<uid>`.
pub fn scrub_uids(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        let body = run.trim_end_matches('.');
        if is_uid(body) {
            out.push_str("<uid>");
            out.push_str(&run[body.len()..]);
        } else {
            out.push_str(run);
        }
        run.clear();
    };
    for c in text.chars() {
        if c.is_ascii_digit() || c == '.' {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
            out.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

fn is_uid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    s.len() <= MAX_UID
        && parts.len() >= 4
        && matches!(parts[0], "0" | "1" | "2")
        && parts.iter().all(|p| !p.is_empty() && (p.len() == 1 || !p.starts_with('0')))
}

#[derive(Default)]
pub struct Counters {
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
}

impl Counters {
    /// The sink's counters (`lab/report-arms/sink.mjs`), with the cap's drops and the dropped fields.
    pub fn to_json(&self) -> Value {
        json!({ "received": self.received, "appended": self.appended, "acknowledged": self.acknowledged,
                "duplicates": self.duplicates, "byKind": { "load": self.load, "safety": self.safety },
                "refused": { "notObject": self.not_object, "tooLarge": self.too_large, "path": self.path,
                             "cap": self.cap },
                "outside": self.outside })
    }
}

pub struct Receiver {
    pub dir: PathBuf,
    pub fields: Fields,
    /// Load-report bytes a UTC day; safety reports are never capped.
    pub cap_bytes: u64,
    pub ack_before_write: bool,
    pub counters: Counters,
    seen: HashSet<String>,
    day: String,
    day_bytes: u64,
}

pub struct Answer {
    pub status: u16,
    pub body: Option<String>,
}

const fn answer(status: u16) -> Answer {
    Answer { status, body: None }
}

impl Receiver {
    pub fn new(dir: PathBuf, fields: Fields, cap_bytes: u64, ack_before_write: bool) -> Self {
        Receiver { dir, fields, cap_bytes, ack_before_write, counters: Counters::default(), seen: HashSet::new(),
                   day: String::new(), day_bytes: 0 }
    }

    /// `body` is `None` when the request announced more than `MAX_BODY` and was not read.
    pub fn handle(&mut self, method: &str, path: &str, body: Option<&[u8]>) -> Answer {
        if path == "/report/counters" {
            return Answer { status: 200, body: Some(self.counters.to_json().to_string()) };
        }
        let Some(kind) = path.strip_prefix("/report/") else { return answer(404) };
        if method != "POST" {
            return answer(405);
        }
        self.counters.received += 1;
        if !KINDS.contains(&kind) {
            self.counters.path += 1;
            return answer(404);
        }
        let checked = match body.ok_or(Refusal::TooLarge).and_then(|b| check(kind, b, &self.fields)) {
            Ok(c) => c,
            Err(Refusal::TooLarge) => return (self.counters.too_large += 1, answer(413)).1,
            Err(Refusal::NotObject) => return (self.counters.not_object += 1, answer(400)).1,
        };
        if let Some(id) = checked.record.get("reportId").and_then(Value::as_str) {
            if !self.seen.insert(id.to_string()) {
                self.counters.duplicates += 1;
            }
        }
        if kind == "load" { self.counters.load += 1 } else { self.counters.safety += 1 }
        if !checked.outside.is_empty() {
            self.counters.outside += checked.outside.len() as u64;
            eprintln!("WARN report fields outside the list dropped: {}", checked.outside.join(", "));
        }
        let t = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        let day = utc_date(t / 1000);
        if day != self.day {
            self.day = day.clone();
            self.day_bytes = 0;
        }
        let record = Value::Object(checked.record);
        let line = format!("{}\n", json!({ "t": t, "r": record }));
        if kind == "load" && self.day_bytes + line.len() as u64 > self.cap_bytes {
            self.counters.cap += 1;
            return answer(204);
        }
        if self.ack_before_write {
            self.counters.acknowledged += 1;
            return answer(204);
        }
        if let Err(e) = self.append(kind, &day, &line) {
            eprintln!("ERROR report not written: {e}");
            return answer(500);
        }
        if kind == "load" {
            self.day_bytes += line.len() as u64;
        }
        self.counters.appended += 1;
        self.counters.acknowledged += 1;
        if kind == "safety" {
            let f = |k: &str| record.get(k).map_or("-".into(), |v| v.to_string());
            eprintln!("ERROR safety report reportId={} source={} frame={} route={} engine={}",
                      f("reportId"), f("source"), f("frame"), f("route"), f("engine"));
        }
        answer(204)
    }

    fn append(&self, kind: &str, day: &str, line: &str) -> std::io::Result<()> {
        let mut file = OpenOptions::new().create(true).append(true).open(self.dir.join(format!("{kind}-{day}.jsonl")))?;
        file.write_all(line.as_bytes())?;
        if kind == "safety" {
            file.sync_data()?;
        }
        Ok(())
    }
}

/// `YYYY-MM-DD` of a Unix time in seconds, UTC (the proleptic Gregorian civil date).
pub fn utc_date(secs: u64) -> String {
    let days = (secs / 86_400) as i64 + 719_468;
    let era = days.div_euclid(146_097);
    let doe = days.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const FIELDS: &str = include_str!("../../report-fields.json");

    fn receiver(name: &str, cap: u64, ack_before_write: bool) -> Receiver {
        let dir = std::env::temp_dir().join(format!("report-receiver-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Receiver::new(dir, Fields::parse(FIELDS).unwrap(), cap, ack_before_write)
    }

    fn lines(r: &Receiver, kind: &str) -> Vec<Value> {
        let day = utc_date(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs());
        fs::read_to_string(r.dir.join(format!("{kind}-{day}.jsonl"))).unwrap_or_default().lines()
            .map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    fn post(r: &mut Receiver, kind: &str, body: &str) -> u16 {
        r.handle("POST", &format!("/report/{kind}"), Some(body.as_bytes())).status
    }

    /// A record is appended as one line `{t, r}` to its kind's file of the UTC day before its 204.
    #[test]
    fn a_record_is_one_line_in_its_kinds_file_of_the_day() {
        let mut r = receiver("line", u64::MAX, false);
        assert_eq!(post(&mut r, "load", r#"{"kind":"load","reportId":"a","load":"L"}"#), 204);
        assert_eq!(post(&mut r, "safety", r#"{"kind":"safety","reportId":"s","load":"L"}"#), 204);
        let load = lines(&r, "load");
        assert_eq!(load.len(), 1);
        assert_eq!(load[0]["r"]["reportId"], "a");
        assert!(load[0]["t"].is_u64());
        assert_eq!(lines(&r, "safety").len(), 1);
        let c = r.counters.to_json();
        assert_eq!((c["appended"].as_u64(), c["acknowledged"].as_u64()), (Some(2), Some(2)));
        assert_eq!((c["byKind"]["load"].as_u64(), c["byKind"]["safety"].as_u64()), (Some(1), Some(1)));
    }

    /// A body over 16 KiB, read or only announced, is a counted 413 and no line.
    #[test]
    fn over_16_kib_is_refused() {
        let mut r = receiver("large", u64::MAX, false);
        let big = format!(r#"{{"kind":"load","build":"{}"}}"#, "x".repeat(MAX_BODY));
        assert_eq!(post(&mut r, "load", &big), 413);
        assert_eq!(r.handle("POST", "/report/load", None).status, 413);
        assert_eq!(r.counters.to_json()["refused"]["tooLarge"], 2);
        assert!(lines(&r, "load").is_empty());
    }

    /// Anything but one JSON object is a counted 400 and no line.
    #[test]
    fn not_one_object_is_refused() {
        let mut r = receiver("object", u64::MAX, false);
        for body in ["[1,2]", "not json", "null", "\"s\""] {
            assert_eq!(post(&mut r, "load", body), 400, "{body}");
        }
        assert_eq!(r.counters.to_json()["refused"]["notObject"], 4);
        assert!(lines(&r, "load").is_empty());
    }

    /// A field outside the list is dropped before the write and counted, the record kept, its value never written.
    #[test]
    fn a_field_outside_the_list_is_dropped_and_counted() {
        let mut r = receiver("outside", u64::MAX, false);
        assert_eq!(post(&mut r, "load", r#"{"kind":"load","reportId":"a","labOnly":"SECRET"}"#), 204);
        let load = lines(&r, "load");
        assert_eq!(load.len(), 1);
        assert_eq!(load[0]["r"]["reportId"], "a");
        assert!(!load[0].to_string().contains("SECRET"));
        assert_eq!(r.counters.to_json()["outside"], 1);
        let c = check("load", br#"{"labOnly":1}"#, &Fields::parse(FIELDS).unwrap()).unwrap();
        assert_eq!(c.outside, vec!["load.labOnly"]);
    }

    /// A UID-shaped run in an error's message becomes `<uid>`; a version string stays.
    #[test]
    fn a_uid_in_a_message_is_scrubbed() {
        let mut r = receiver("uid", u64::MAX, false);
        let body = r#"{"kind":"load","errors":[{"message":"frame 1.2.840.10008.5.1.4 failed, build 1.2.3"}]}"#;
        assert_eq!(post(&mut r, "load", body), 204);
        assert_eq!(lines(&r, "load")[0]["r"]["errors"][0]["message"], "frame <uid> failed, build 1.2.3");
        assert_eq!(scrub_uids("2.25.1.0."), "<uid>.");
        assert_eq!(scrub_uids("3.25.1.0"), "3.25.1.0");
        assert_eq!(scrub_uids("1.02.3.4"), "1.02.3.4");
        assert_eq!(scrub_uids(&format!("1.2.3.{}", "4".repeat(64))), format!("1.2.3.{}", "4".repeat(64)));
    }

    /// Every string is cut to 512 bytes, on a character boundary.
    #[test]
    fn every_string_is_capped() {
        let fields = Fields::parse(FIELDS).unwrap();
        let body = format!(r#"{{"build":"{}","errors":[{{"message":"{}é"}}]}}"#, "b".repeat(600), "m".repeat(511));
        let c = check("load", body.as_bytes(), &fields).unwrap();
        assert_eq!(c.record["build"].as_str().unwrap().len(), MAX_STRING);
        assert_eq!(c.record["errors"][0]["message"].as_str().unwrap().len(), MAX_STRING - 1);
    }

    /// Past the day's cap a load report is answered and dropped, counted; a safety report is never capped.
    #[test]
    fn the_cap_drops_load_reports_only() {
        let mut r = receiver("cap", 100, false);
        assert_eq!(post(&mut r, "load", r#"{"kind":"load","reportId":"a"}"#), 204);
        assert_eq!(post(&mut r, "load", r#"{"kind":"load","reportId":"b"}"#), 204);
        assert_eq!(post(&mut r, "safety", r#"{"kind":"safety","reportId":"s"}"#), 204);
        assert_eq!(lines(&r, "load").len(), 1);
        assert_eq!(lines(&r, "safety").len(), 1);
        assert_eq!(r.counters.to_json()["refused"]["cap"], 1);
    }

    /// A second record with a seen reportId is kept and counted as a duplicate (the dedup is the read tool's).
    #[test]
    fn duplicates_are_counted() {
        let mut r = receiver("dup", u64::MAX, false);
        post(&mut r, "load", r#"{"kind":"load","reportId":"a"}"#);
        post(&mut r, "load", r#"{"kind":"load","reportId":"a"}"#);
        assert_eq!(lines(&r, "load").len(), 2);
        assert_eq!(r.counters.to_json()["duplicates"], 1);
    }

    /// Another kind is a counted 404; a method but POST is a 405.
    #[test]
    fn another_kind_or_method_is_refused() {
        let mut r = receiver("path", u64::MAX, false);
        assert_eq!(post(&mut r, "other", "{}"), 404);
        assert_eq!(r.handle("GET", "/report/load", None).status, 405);
        assert_eq!(r.counters.to_json()["refused"]["path"], 1);
    }

    /// A write that fails is answered 500 and counted neither appended nor acknowledged.
    #[test]
    fn a_failed_write_is_not_acknowledged() {
        let mut r = receiver("fail", u64::MAX, false);
        r.dir = r.dir.join("missing");
        assert_eq!(post(&mut r, "safety", r#"{"kind":"safety"}"#), 500);
        let c = r.counters.to_json();
        assert_eq!((c["appended"].as_u64(), c["acknowledged"].as_u64()), (Some(0), Some(0)));
    }

    /// The ack-before-write mutant answers 204 and writes nothing, so appended falls below acknowledged.
    #[test]
    fn ack_before_write_leaves_appended_below_acknowledged() {
        let mut r = receiver("mutant", u64::MAX, true);
        assert_eq!(post(&mut r, "load", r#"{"kind":"load"}"#), 204);
        let c = r.counters.to_json();
        assert_eq!((c["appended"].as_u64(), c["acknowledged"].as_u64()), (Some(0), Some(1)));
        assert!(lines(&r, "load").is_empty());
    }

    /// The counters answer GET /report/counters in the sink's shape.
    #[test]
    fn the_counters_are_served() {
        let mut r = receiver("counters", u64::MAX, false);
        let a = r.handle("GET", "/report/counters", None);
        let c: Value = serde_json::from_str(&a.body.unwrap()).unwrap();
        assert_eq!(a.status, 200);
        assert!(c["refused"]["notObject"].is_u64() && c["byKind"]["safety"].is_u64());
    }

    /// The UTC date of known instants, leap day and century included.
    #[test]
    fn utc_dates() {
        assert_eq!(utc_date(0), "1970-01-01");
        assert_eq!(utc_date(951_782_400), "2000-02-29");
        assert_eq!(utc_date(1_795_305_599), "2026-11-21");
    }
}
