//! The sender binary against the carrier on loopback, through `send-package.sh`, with a stand-in
//! receiver judging each arrival: docs/adr/pcs-transfer.md §15.10.
#[path = "../../tests/common/mod.rs"]
mod common;
mod exam;

use carrier::handoff::{Class, PackageName, Root, Verdict};
use common::Setup;
use exam::*;
use sender::outbox::Outbox;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

type Judge = Box<dyn FnMut(usize, &[u8]) -> Verdict + Send>;

/// Judges each package arriving in `incoming/` by `judge(arrival index, bytes)` while `judging`
/// holds: the verdict first, then the package moved out. Returns every arrival's bytes.
fn receiver(setup: &Setup, judging: Arc<AtomicBool>, mut judge: Judge) -> Arc<Mutex<Vec<Vec<u8>>>> {
    let root = Root::open(&setup.dir.join("root")).unwrap();
    let incoming = setup.dir.join("root/incoming");
    let arrivals = Arc::new(Mutex::new(Vec::new()));
    let seen = arrivals.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(20)).await;
            if !judging.load(Ordering::SeqCst) {
                continue;
            }
            for entry in fs::read_dir(&incoming).unwrap() {
                let path = entry.unwrap().path();
                let Some(name) = PackageName::parse(&path.file_name().unwrap().to_string_lossy())
                else {
                    continue;
                };
                let bytes = fs::read(&path).unwrap();
                let verdict = judge(seen.lock().unwrap().len(), &bytes);
                seen.lock().unwrap().push(bytes);
                root.write_verdict(&name, &verdict).unwrap();
                fs::remove_file(&path).unwrap();
            }
        }
    });
    arrivals
}

fn profile(setup: &Setup, outbox: &Path, extra: &str) -> PathBuf {
    let path = setup.dir.join("profile");
    let text = format!(
        "transport tcp\nmetadata zstd\ncarrier https://{}\ncert {}\nkey {}\ncacert {}\n\
         stall 5\nbackoff 1\npoll 1\noutbox {}\n{extra}",
        setup.addr,
        setup.site_a.cert_pem.display(),
        setup.site_a.key_pem.display(),
        setup.server_pem.display(),
        outbox.display()
    );
    fs::write(&path, text).unwrap();
    path
}

async fn run(profile: &Path, exam: &Path) -> Output {
    let call = tokio::process::Command::new(env!("CARGO_BIN_EXE_sender"))
        .arg("--profile")
        .arg(profile)
        .arg(exam)
        .arg(UNIT)
        .output();
    tokio::time::timeout(Duration::from_secs(60), call)
        .await
        .expect("the sender never finished")
        .unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

fn retry() -> Verdict {
    Verdict::Refused(Class::Retry, "hash mismatch".into())
}

/// Sent once and stored: the kept package is dropped, the revision marked stored, and a second
/// call sends nothing.
#[tokio::test]
async fn a_stored_package_is_dropped_and_not_sent_again() {
    let setup = Setup::start("sender-stored", Duration::from_secs(5)).await;
    let exam = exam(&scratch("stored"));
    let outbox = setup.dir.join("outbox");
    let profile = profile(&setup, &outbox, "");
    let arrivals = receiver(
        &setup,
        Arc::new(AtomicBool::new(true)),
        Box::new(|_, _| Verdict::Committed),
    );
    let out = run(&profile, &exam).await;
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let again = run(&profile, &exam).await;
    assert_eq!(again.status.code(), Some(0), "{}", stderr(&again));
    assert_eq!(arrivals.lock().unwrap().len(), 1);
    let outbox = Outbox::open(&outbox).unwrap();
    assert!(outbox.stored(UNIT, 1));
    assert!(
        outbox.kept(UNIT, 1).unwrap().is_empty(),
        "kept after stored"
    );
}

/// The kept package deleted after `received`: the next call rebuilds it to the same name, the
/// carrier already holds it, and nothing is uploaded twice.
#[tokio::test]
async fn a_lost_package_is_rebuilt_and_not_sent_twice() {
    let setup = Setup::start("sender-lost", Duration::from_secs(5)).await;
    let exam = exam(&scratch("lost"));
    let outbox = setup.dir.join("outbox");
    let profile = profile(&setup, &outbox, "wait 2\n");
    let judging = Arc::new(AtomicBool::new(false));
    let arrivals = receiver(&setup, judging.clone(), Box::new(|_, _| Verdict::Committed));
    let out = run(&profile, &exam).await;
    assert_eq!(
        out.status.code(),
        Some(4),
        "no verdict yet: {}",
        stderr(&out)
    );
    let kept = Outbox::open(&outbox).unwrap().kept(UNIT, 1).unwrap();
    fs::remove_file(&kept[0]).unwrap();
    judging.store(true, Ordering::SeqCst);
    let out = run(&profile, &exam).await;
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(arrivals.lock().unwrap().len(), 1);
}

/// `refused retry` is answered with the kept bytes again; a kept file that fails its name is
/// rebuilt before it is sent; a second refusal is exit 3, the package still kept.
#[tokio::test]
async fn a_refusal_resends_the_kept_bytes() {
    let setup = Setup::start("sender-refused", Duration::from_secs(5)).await;
    let exam = exam(&scratch("refused"));
    let outbox_dir = setup.dir.join("outbox");
    let profile = profile(&setup, &outbox_dir, "");
    let outbox = Outbox::open(&outbox_dir).unwrap();
    sender::next(&outbox, &exam, UNIT, true).unwrap();
    let good = fs::read(kept(&outbox_dir)).unwrap();
    let mut bad = good.clone();
    bad[2000] ^= 1;
    fs::write(kept(&outbox_dir), bad).unwrap();
    let expected = good.clone();
    let judge = move |i: usize, bytes: &[u8]| match i {
        0 if bytes == expected => retry(),
        1 if bytes == expected => Verdict::Committed,
        0 | 1 => Verdict::Refused(Class::Final, "not the bytes built".into()),
        _ => retry(),
    };
    let arrivals = receiver(&setup, Arc::new(AtomicBool::new(true)), Box::new(judge));
    let out = run(&profile, &exam).await;
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(arrivals.lock().unwrap().iter().all(|a| *a == good));
    assert_eq!(arrivals.lock().unwrap().len(), 2);

    instance(&exam, UNIT, "In04", false);
    let out = run(&profile, &exam).await;
    assert_eq!(out.status.code(), Some(3), "{}", stderr(&out));
    assert_eq!(arrivals.lock().unwrap().len(), 4, "not exactly one resend");
    assert_eq!(
        outbox.kept(UNIT, 2).unwrap().len(),
        1,
        "the refused package not kept"
    );
}

/// A profile asking for QUIC is refused at start: this sender's upload is the script's, over TCP.
#[tokio::test]
async fn a_quic_profile_is_refused_at_start() {
    let setup = Setup::start("sender-quic", Duration::from_secs(5)).await;
    let exam = exam(&scratch("quic"));
    let profile = profile(&setup, &setup.dir.join("outbox"), "transport quic\n");
    let out = run(&profile, &exam).await;
    assert_eq!(out.status.code(), Some(2), "{}", stderr(&out));
    assert!(!setup.dir.join("outbox").exists(), "built before refusing");
}
