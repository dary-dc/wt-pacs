use super::*;
use crate::Step;
use std::os::unix::process::ExitStatusExt;
use std::process::{Command, Stdio};
use std::sync::PoisonError;

const STEPS: [Step; 8] = [
    Step::Checked,
    Step::Staged,
    Step::ReadBack,
    Step::Placed,
    Step::Recorded,
    Step::Verified,
    Step::Confirmed,
    Step::Cleaned,
];

/// The process the crash test kills: it receives one package and aborts at the step it is given.
#[test]
fn crash_child() {
    let Ok(step) = std::env::var("RECEIVER_CRASH_STEP") else {
        return;
    };
    let var = |k: &str| PathBuf::from(std::env::var(k).unwrap());
    let receiver =
        Receiver::open(&var("RECEIVER_CRASH_ROOT"), &var("RECEIVER_CRASH_INCOMING")).unwrap();
    let name = std::env::var("RECEIVER_CRASH_PACKAGE").unwrap();
    receiver
        .receive_at(&name, &mut |s| {
            if format!("{s:?}") == step {
                std::process::abort()
            }
        })
        .unwrap();
    panic!("step {step} was never reached");
}

/// What a reader of the serving tree sees: the bundle, if any, and every group row.
#[derive(Debug, Clone, PartialEq)]
struct Served {
    bundle: Option<Vec<u8>>,
    rows: Vec<(String, String, Vec<u8>)>,
}

fn served(site: &Site) -> Served {
    if site.study().join(study_db::FILE).exists() {
        let check: String = site
            .db()
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(check, "ok");
    }
    let mut extra = Site::files(&site.root);
    extra.retain(|f| {
        let f = f.strip_prefix(&format!("{}/", c(STUDY))).unwrap_or(f);
        ![
            study_db::FILE,
            "study.db-wal",
            "study.db-shm",
            &format!("{}.sbnd", c(SERIES)),
        ]
        .contains(&f)
    });
    assert!(extra.is_empty(), "the serving tree holds {extra:?}");
    Served {
        bundle: fs_read(&site.bundle_path(SERIES)),
        rows: site.rows(),
    }
}

fn fs_read(path: &Path) -> Option<Vec<u8>> {
    std::fs::read(path).ok()
}

fn scenarios() -> Vec<(&'static str, Vec<Package>, Package)> {
    let first = Package::series(
        SERIES,
        1,
        "DOE^JANE",
        &[("1.2.826.0.1.7.1.1", 2), ("1.2.826.0.1.7.1.2", 1)],
        10,
    );
    let mut update = Package::new("update", &c(STUDY), 1);
    update.group(format!("{}/--", c(STUDY)), exam_group("ROE^JOHN"));
    vec![
        ("a new study", vec![], first.clone()),
        (
            "a series' next revision",
            vec![first.clone()],
            Package::series(SERIES, 2, "DOE^JANE", &[("1.2.826.0.1.7.1.3", 2)], 40),
        ),
        ("an update", vec![first], update),
    ]
}

/// Killed after any step and restarted, the receiver ends where an uninterrupted run ends, and at
/// the kill the serving tree is whole: the bundle is the old one or the new one, the rows are all
/// the old ones or all the new ones, and new rows are never served beside the old bundle.
#[test]
fn a_crash_between_any_two_steps_leaves_the_serving_tree_whole() {
    for (what, before, package) in scenarios() {
        let reference = Site::new("crash-reference");
        for p in &before {
            assert_eq!(reference.receive(p), Outcome::Stored);
        }
        let old = served(&reference);
        assert_eq!(reference.receive(&package), Outcome::Stored);
        let new = served(&reference);
        for step in STEPS {
            let site = Site::new("crash");
            for p in &before {
                assert_eq!(site.receive(p), Outcome::Stored);
            }
            let name = site.arrive(&package);
            let fork = FORK.write().unwrap_or_else(PoisonError::into_inner);
            let child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "tests::crash::crash_child",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env("RECEIVER_CRASH_STEP", format!("{step:?}"))
                .env("RECEIVER_CRASH_ROOT", &site.root)
                .env("RECEIVER_CRASH_INCOMING", &site.incoming)
                .env("RECEIVER_CRASH_PACKAGE", &name)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            drop(fork);
            let status = child.wait_with_output().unwrap().status;
            assert_eq!(
                status.signal(),
                Some(libc::SIGABRT),
                "{what}, {step:?}: the child was not killed there"
            );

            let at_kill = served(&site);
            assert!(
                at_kill.bundle == old.bundle || at_kill.bundle == new.bundle,
                "{what}, {step:?}: a bundle neither old nor new"
            );
            assert!(
                at_kill.rows == old.rows || at_kill.rows == new.rows,
                "{what}, {step:?}: rows neither all old nor all new"
            );
            assert!(
                at_kill.rows == old.rows || at_kill.bundle == new.bundle,
                "{what}, {step:?}: new rows beside the old bundle"
            );

            let ran = site.receiver().run().unwrap();
            if step == Step::Cleaned {
                assert!(ran.is_empty(), "{what}: a cleaned package was taken again");
            } else {
                assert_eq!(ran, [(name.clone(), Outcome::Stored)], "{what}, {step:?}");
            }
            assert_eq!(
                served(&site),
                new,
                "{what}, {step:?}: the restart did not end where a run ends"
            );
            assert_eq!(site.status(&name), "stored\n");
            assert_eq!(
                site.audit().len(),
                before.len() + 1,
                "{what}, {step:?}: the package recorded twice"
            );
            let left: Vec<String> = Site::files(&site.incoming)
                .into_iter()
                .filter(|f| !f.starts_with("status/"))
                .collect();
            assert!(
                left.is_empty(),
                "{what}, {step:?}: incoming/ holds {left:?}"
            );
        }
    }
}
