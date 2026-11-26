//! The PCS's script, `pcs/send-package.sh` with stock curl, against the carrier through a proxy
//! that can cut or stall the link, and a stand-in receiver that judges each arrival.
mod common;

use carrier::handoff::{Class, Verdict};
use common::*;
use std::path::Path;
use std::process::Output;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Clone, Copy)]
enum Fault {
    None,
    /// Closes the first connection that carries more than this many bytes to the carrier.
    Drop(usize),
    /// Stops forwarding on it both ways instead, holding it open.
    Stall(usize),
}

/// Forwards loopback TCP to `to`, applying the fault once; returns its port and whether it fired.
async fn proxy(to: std::net::SocketAddr, fault: Fault) -> (u16, Arc<AtomicBool>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let fired = Arc::new(AtomicBool::new(false));
    let flag = fired.clone();
    tokio::spawn(async move {
        loop {
            let (client, _) = listener.accept().await.unwrap();
            let server = TcpStream::connect(to).await.unwrap();
            let flag = flag.clone();
            tokio::spawn(async move {
                let (mut client_read, mut client_write) = client.into_split();
                let (mut server_read, mut server_write) = server.into_split();
                let silent = Arc::new(AtomicBool::new(false));
                let hush = silent.clone();
                let back = tokio::spawn(async move {
                    let mut buf = vec![0u8; 16 * 1024];
                    while let Ok(n @ 1..) = server_read.read(&mut buf).await {
                        if hush.load(Ordering::SeqCst) {
                            tokio::time::sleep(Duration::from_secs(3600)).await;
                        }
                        if client_write.write_all(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                });
                let mut buf = vec![0u8; 16 * 1024];
                let mut sent = 0;
                while let Ok(n @ 1..) = client_read.read(&mut buf).await {
                    sent += n;
                    let limit = match fault {
                        Fault::Drop(limit) | Fault::Stall(limit) => Some(limit),
                        Fault::None => None,
                    };
                    if limit.is_some_and(|limit| sent > limit) && !flag.swap(true, Ordering::SeqCst)
                    {
                        if let Fault::Stall(_) = fault {
                            silent.store(true, Ordering::SeqCst);
                            tokio::time::sleep(Duration::from_secs(3600)).await;
                        }
                        back.abort();
                        return;
                    }
                    if server_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                let _ = server_write.shutdown().await;
                let _ = back.await;
            });
        }
    });
    (port, fired)
}

/// Judges each arrival in turn with the next verdict, as the receiver would: the verdict first,
/// then the package moved out of `incoming/`. A package not byte-equal to `expected` is refused.
fn receiver(
    setup: &Setup,
    expected: Vec<u8>,
    verdicts: Vec<Verdict>,
) -> tokio::task::JoinHandle<usize> {
    let root = carrier::handoff::Root::open(&setup.dir.join("root")).unwrap();
    let name = setup.name();
    tokio::spawn(async move {
        let mut judged = 0;
        for verdict in verdicts {
            let incoming = root.incoming(&name);
            while !incoming.exists() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            let verdict = match std::fs::read(&incoming).unwrap() == expected {
                true => verdict,
                false => Verdict::Refused(Class::Final, "not the bytes sent".into()),
            };
            root.write_verdict(&name, &verdict).unwrap();
            std::fs::remove_file(&incoming).unwrap();
            judged += 1;
        }
        judged
    })
}

async fn send(setup: &Setup, port: u16, package: &Path, stall_secs: u64) -> Output {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("pcs/send-package.sh");
    let run = tokio::process::Command::new("sh")
        .arg(script)
        .arg(package)
        .env("CARRIER", format!("https://127.0.0.1:{port}"))
        .env("CERT", &setup.site_a.cert_pem)
        .env("KEY", &setup.site_a.key_pem)
        .env("CACERT", &setup.server_pem)
        .env("STALL_SECS", stall_secs.to_string())
        .env("POLL_SECS", "1")
        .env("BACKOFF_SECS", "1")
        .output();
    tokio::time::timeout(Duration::from_secs(60), run)
        .await
        .expect("the script never finished")
        .unwrap()
}

fn write_package(setup: &Setup, len: usize) -> (std::path::PathBuf, Vec<u8>) {
    let bytes = package(len);
    let path = setup.dir.join(NAME);
    std::fs::write(&path, &bytes).unwrap();
    (path, bytes)
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).to_string()
}

/// A connection cut mid-upload: the script asks the offset and sends only the rest, and the
/// receiver gets the package byte for byte.
#[tokio::test]
async fn the_script_resumes_after_a_drop() {
    let setup = Setup::start("pcs-drop", Duration::from_secs(5)).await;
    let (path, bytes) = write_package(&setup, 2_000_000);
    let (port, fired) = proxy(setup.addr, Fault::Drop(600_000)).await;
    let judged = receiver(&setup, bytes, vec![Verdict::Committed]);
    let out = send(&setup, port, &path, 5).await;
    assert!(fired.load(Ordering::SeqCst), "the link was never cut");
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        format!("committed {NAME}\n")
    );
    let resumed = stderr(&out)
        .lines()
        .find_map(|l| l.split("resume at ").nth(1)?.parse::<u64>().ok());
    assert!(
        resumed.is_some_and(|offset| offset > 0),
        "never resumed past 0: {}",
        stderr(&out)
    );
    assert_eq!(judged.await.unwrap(), 1);
}

/// A link that goes silent without closing: the script's stall timeout ends the request long
/// before the carrier's would, and its resume takes the upload from the stalled request.
#[tokio::test]
async fn the_script_resumes_after_a_stall() {
    let setup = Setup::start("pcs-stall", Duration::from_secs(120)).await;
    let (path, bytes) = write_package(&setup, 2_000_000);
    let (port, fired) = proxy(setup.addr, Fault::Stall(600_000)).await;
    let judged = receiver(&setup, bytes, vec![Verdict::Committed]);
    let out = send(&setup, port, &path, 2).await;
    assert!(fired.load(Ordering::SeqCst), "the link never stalled");
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(
        stderr(&out).contains("curl: (28) Operation too slow"),
        "{}",
        stderr(&out)
    );
    assert!(stderr(&out).contains("resume at "), "{}", stderr(&out));
    assert_eq!(judged.await.unwrap(), 1);
}

/// "refused retry" makes the script send the package once more; a second refusal stops it.
#[tokio::test]
async fn the_script_resends_once_on_a_refusal() {
    let setup = Setup::start("pcs-refused", Duration::from_secs(5)).await;
    let (path, bytes) = write_package(&setup, 100_000);
    let (port, _) = proxy(setup.addr, Fault::None).await;
    let retry = || Verdict::Refused(Class::Retry, "hash mismatch".into());

    let judged = receiver(&setup, bytes.clone(), vec![retry(), Verdict::Committed]);
    let out = send(&setup, port, &path, 5).await;
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(judged.await.unwrap(), 2);

    let other = "U1.2.0123456789abcdef.tar";
    let path = setup.dir.join(other);
    std::fs::write(&path, &bytes).unwrap();
    let root = carrier::handoff::Root::open(&setup.dir.join("root")).unwrap();
    let name = carrier::handoff::PackageName::parse(other).unwrap();
    let judge = tokio::spawn(async move {
        for _ in 0..3 {
            let incoming = root.incoming(&name);
            for _ in 0..200 {
                if incoming.exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            if !incoming.exists() {
                return false;
            }
            root.write_verdict(
                &name,
                &Verdict::Refused(Class::Retry, "hash mismatch".into()),
            )
            .unwrap();
            std::fs::remove_file(&incoming).unwrap();
        }
        true
    });
    let out = send(&setup, port, &path, 5).await;
    assert_eq!(out.status.code(), Some(3), "{}", stderr(&out));
    assert!(
        stderr(&out).contains("refused retry hash mismatch"),
        "{}",
        stderr(&out)
    );
    assert!(!judge.await.unwrap(), "the script sent a third time");
}

/// Sending a committed package again is answered "committed" at once, with nothing uploaded.
#[tokio::test]
async fn the_script_sends_a_committed_package_once() {
    let setup = Setup::start("pcs-twice", Duration::from_secs(5)).await;
    let (path, bytes) = write_package(&setup, 100_000);
    let (port, _) = proxy(setup.addr, Fault::None).await;
    let judged = receiver(&setup, bytes, vec![Verdict::Committed]);
    assert_eq!(send(&setup, port, &path, 5).await.status.code(), Some(0));
    assert_eq!(judged.await.unwrap(), 1);
    let again = send(&setup, port, &path, 5).await;
    assert_eq!(again.status.code(), Some(0), "{}", stderr(&again));
    assert!(!setup.root.incoming(&setup.name()).exists());
    assert!(!setup.root.partial(&setup.name()).exists());
}
