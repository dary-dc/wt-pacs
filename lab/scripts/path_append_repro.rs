// Standalone reproduction of the loss-regime sampler's concurrent-append defect.
//
//   rustc -O -o /tmp/repro lab/scripts/path_append_repro.rs && /tmp/repro
//
// `append_current` is the shape `server/src/record/path.rs::append_row` had before
// 2026-09-07: `writeln!(f, "{line}")` on an unbuffered `File`, which issues TWO write
// calls — the formatted argument, then the newline. Under O_APPEND each is individually
// atomic, so concurrent samplers interleave as `{row A}{row B}\n\n`: one line carrying two
// concatenated objects, one empty line.
//
// Measured before the fix: 8 threads 38 % intact, 32 threads 29 %, 64 threads 36 %.
// `append_fixed` — the newline in the same buffer, one write — is 100 % intact at every
// concurrency tested.
//
// Kept as a script rather than a test because it is the *evidence*, and because the
// regression test that guards the fix lives in path.rs where it belongs. A single-client
// validator could not have caught this, and did not: see docs/measurements/regime/README.md.

use std::io::Write;
use std::thread;

// Exactly the shape of server/src/record/path.rs::append_row
fn append_current(path: &str, line: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}

// One write call: the newline is part of the same buffer.
fn append_fixed(path: &str, line: &str) {
    let mut buf = String::with_capacity(line.len() + 1);
    buf.push_str(line);
    buf.push('\n');
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(buf.as_bytes());
    }
}

fn run(name: &str, f: fn(&str, &str), threads: usize, rows: usize) {
    let path = format!("/tmp/repro/{name}.jsonl");
    let _ = std::fs::remove_file(&path);
    let mut hs = Vec::new();
    for t in 0..threads {
        let p = path.clone();
        hs.push(thread::spawn(move || {
            for i in 0..rows {
                // Realistic PathSample-sized row (~200 bytes, as the docs state).
                let line = format!("{{\"session_id\":{t},\"seq\":{i},\"rtt_us\":{},\"cwnd\":{},\"lost_packets\":{},\"sent_packets\":{},\"pad\":\"{}\"}}",
                    12345 + i, 65535, i % 7, i * 13, "x".repeat(120));
                f(&p, &line);
            }
        }));
    }
    for h in hs { h.join().unwrap(); }

    let data = std::fs::read_to_string(&path).unwrap();
    let total = data.lines().count();
    let mut good = 0; let mut empty = 0; let mut bad = 0;
    for l in data.lines() {
        if l.is_empty() { empty += 1; }
        else if serde_ok(l) { good += 1; }
        else { bad += 1; }
    }
    println!("{name:9} threads={threads:2} rows={rows:4} -> expected {:5} | lines {:5} | good {:5} | CORRUPT {:4} | EMPTY {:4}",
             threads * rows, total, good, bad, empty);
}

// Minimal "is this one complete JSON object" check: starts {, ends }, balanced braces.
fn serde_ok(l: &str) -> bool {
    if !l.starts_with('{') || !l.ends_with('}') { return false; }
    let mut d = 0i32;
    for c in l.chars() {
        if c == '{' { d += 1; } else if c == '}' { d -= 1; }
        if d == 0 && !l.ends_with('}') { return false; }
    }
    d == 0 && l.matches("session_id").count() == 1
}

fn main() {
    for (threads, rows) in [(8usize, 200usize), (32, 200), (64, 100)] {
        run("current", append_current, threads, rows);
        run("fixed",   append_fixed,   threads, rows);
        println!();
    }
}
