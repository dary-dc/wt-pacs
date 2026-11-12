mod common;

use carrier::handoff::{Class, Verdict};
use common::*;
use std::time::Duration;

const STALL: Duration = Duration::from_secs(5);

/// A connection dropped mid-`PATCH` keeps the bytes that arrived; `HEAD` reports them as the
/// offset and a `PATCH` from there completes the package byte for byte.
#[tokio::test]
async fn a_dropped_upload_resumes_from_the_offset() {
    let setup = Setup::start("resume", STALL).await;
    let bytes = package(300_000);
    let created = create(&setup, &setup.site_a, NAME, bytes.len()).await;
    assert_eq!(
        (created.status, created.header("upload-complete")),
        (201, Some("?0"))
    );
    let location = created.header("location").unwrap().to_string();

    let mut stream = connect(setup.addr, Some(&setup.site_a)).await.unwrap();
    let headers = [
        DRAFT,
        ("content-type", "application/partial-upload"),
        ("upload-offset", "0"),
        ("upload-complete", "?1"),
    ];
    begin(
        &mut stream,
        "PATCH",
        &location,
        &headers,
        bytes.len(),
        &bytes[..120_000],
    )
    .await;
    let partial = setup.root.partial(&setup.name());
    eventually("the first part on disk", || {
        std::fs::metadata(&partial).is_ok_and(|m| m.len() == 120_000)
    })
    .await;
    drop(stream);

    let head = request(setup.addr, &setup.site_a, "HEAD", &location, &[DRAFT], b"").await;
    assert_eq!(head.status, 204);
    assert_eq!(head.header("upload-offset"), Some("120000"));
    assert_eq!(head.header("upload-complete"), Some("?0"));
    assert_eq!(head.header("upload-length"), Some("300000"));

    let done = patch(
        &setup,
        &setup.site_a,
        &location,
        120_000,
        &bytes[120_000..],
        true,
    )
    .await;
    assert_eq!(
        (
            done.status,
            done.body.as_str(),
            done.header("upload-complete")
        ),
        (202, "received\n", Some("?1"))
    );
    assert_eq!(
        std::fs::read(setup.root.incoming(&setup.name())).unwrap(),
        bytes
    );
    assert!(!partial.exists());
    assert_eq!(
        get(&setup, &setup.site_a, &format!("/packages/{NAME}"))
            .await
            .body,
        "received\n"
    );
}

/// A `PATCH` at any offset but the server's is refused with 409 and the right offset (§8.2).
#[tokio::test]
async fn a_wrong_offset_is_told_the_right_one() {
    let setup = Setup::start("offset", STALL).await;
    let bytes = package(1000);
    let location = create(&setup, &setup.site_a, NAME, bytes.len())
        .await
        .header("location")
        .unwrap()
        .to_string();
    assert_eq!(
        patch(&setup, &setup.site_a, &location, 0, &bytes[..400], false)
            .await
            .status,
        204
    );
    let wrong = patch(&setup, &setup.site_a, &location, 300, &bytes[300..], true).await;
    assert_eq!(
        (wrong.status, wrong.header("upload-offset")),
        (409, Some("400"))
    );
    assert_eq!(
        std::fs::metadata(setup.root.partial(&setup.name()))
            .unwrap()
            .len(),
        400
    );
}

/// A newer request on an upload ends an older one still open, so a resume never waits for the
/// server to notice the dead connection (§10).
#[tokio::test]
async fn a_newer_request_ends_an_open_one() {
    let setup = Setup::start("supersede", Duration::from_secs(120)).await;
    let bytes = package(10_000);
    let location = create(&setup, &setup.site_a, NAME, bytes.len())
        .await
        .header("location")
        .unwrap()
        .to_string();
    let mut stalled = connect(setup.addr, Some(&setup.site_a)).await.unwrap();
    let headers = [
        DRAFT,
        ("content-type", "application/partial-upload"),
        ("upload-offset", "0"),
        ("upload-complete", "?1"),
    ];
    begin(
        &mut stalled,
        "PATCH",
        &location,
        &headers,
        bytes.len(),
        &bytes[..4000],
    )
    .await;
    let partial = setup.root.partial(&setup.name());
    eventually("the first part on disk", || {
        std::fs::metadata(&partial).is_ok_and(|m| m.len() == 4000)
    })
    .await;

    let head = tokio::time::timeout(
        Duration::from_secs(10),
        request(setup.addr, &setup.site_a, "HEAD", &location, &[DRAFT], b""),
    )
    .await
    .expect("HEAD waited for the stalled PATCH");
    assert_eq!(head.header("upload-offset"), Some("4000"));
    let done = patch(&setup, &setup.site_a, &location, 4000, &bytes[4000..], true).await;
    assert_eq!(done.status, 202);
    assert_eq!(
        std::fs::read(setup.root.incoming(&setup.name())).unwrap(),
        bytes
    );
    drop(stalled);
}

/// The same package sent again is answered from what the carrier holds, never written again:
/// "received" while it waits for the receiver, "committed" after.
#[tokio::test]
async fn a_duplicate_upload_is_idempotent() {
    let setup = Setup::start("duplicate", STALL).await;
    let bytes = package(5000);
    let first = one_shot(&setup, &setup.site_a, NAME, &bytes).await;
    assert_eq!((first.status, first.body.as_str()), (202, "received\n"));

    let other_bytes = package(6000);
    let again = one_shot(&setup, &setup.site_a, NAME, &other_bytes).await;
    assert_eq!(
        (
            again.status,
            again.body.as_str(),
            again.header("upload-complete")
        ),
        (200, "received\n", Some("?1"))
    );
    let careful = create(&setup, &setup.site_a, NAME, bytes.len()).await;
    assert_eq!((careful.status, careful.body.as_str()), (200, "received\n"));
    assert_eq!(
        std::fs::read(setup.root.incoming(&setup.name())).unwrap(),
        bytes
    );
    assert!(!setup.root.partial(&setup.name()).exists());

    setup
        .root
        .write_verdict(&setup.name(), &Verdict::Committed)
        .unwrap();
    std::fs::remove_file(setup.root.incoming(&setup.name())).unwrap();
    let after = one_shot(&setup, &setup.site_a, NAME, &bytes).await;
    assert_eq!((after.status, after.body.as_str()), (200, "committed\n"));
    assert!(!setup.root.incoming(&setup.name()).exists());
}

/// Another package claiming a committed revision is a conflict, final, for the operator.
#[tokio::test]
async fn another_hash_for_a_committed_revision_conflicts() {
    let setup = Setup::start("conflict", STALL).await;
    assert_eq!(
        one_shot(&setup, &setup.site_a, NAME, &package(100))
            .await
            .status,
        202
    );
    setup
        .root
        .write_verdict(&setup.name(), &Verdict::Committed)
        .unwrap();
    let rival = one_shot(
        &setup,
        &setup.site_a,
        "U1.1.fedcba9876543210.tar",
        &package(100),
    )
    .await;
    assert_eq!(rival.status, 409);
    assert!(
        rival.body.starts_with("refused final conflict"),
        "{}",
        rival.body
    );
}

/// A certificate not on the allow list, or none, gets no request through; an enrolled one from
/// another site cannot see, resume or overwrite this site's package.
#[tokio::test]
async fn only_an_enrolled_certificate_of_the_owning_site_gets_in() {
    let setup = Setup::start("mtls", STALL).await;
    for who in [Some(&setup.stranger), None] {
        let refused = async {
            let mut stream = connect(setup.addr, who).await?;
            begin(
                &mut stream,
                "GET",
                &format!("/packages/{NAME}"),
                &[],
                0,
                b"",
            )
            .await;
            finish(stream).await
        };
        assert!(
            refused.await.is_err(),
            "a request got through without an enrolled certificate"
        );
    }
    let location = create(&setup, &setup.site_a, NAME, 10)
        .await
        .header("location")
        .unwrap()
        .to_string();
    assert_eq!(
        get(&setup, &setup.site_b, &format!("/packages/{NAME}"))
            .await
            .status,
        404
    );
    assert_eq!(
        request(setup.addr, &setup.site_b, "HEAD", &location, &[DRAFT], b"")
            .await
            .status,
        404
    );
    assert_eq!(
        patch(&setup, &setup.site_b, &location, 0, &package(10), true)
            .await
            .status,
        404
    );
    let taken = one_shot(&setup, &setup.site_b, NAME, &package(10)).await;
    assert_eq!(
        (taken.status, taken.body.as_str()),
        (403, "refused final not-authorised\n")
    );
    assert_eq!(
        get(&setup, &setup.site_a, &format!("/packages/{NAME}"))
            .await
            .body,
        "uploading 0\n"
    );
}

/// A package refused for retry is accepted again under a new upload address, its old one dead;
/// one refused as final is not, until an operator clears it.
#[tokio::test]
async fn a_refused_package_is_resent_unless_final() {
    let setup = Setup::start("refused", STALL).await;
    let bytes = package(2000);
    let first = create(&setup, &setup.site_a, NAME, bytes.len())
        .await
        .header("location")
        .unwrap()
        .to_string();
    assert_eq!(
        patch(&setup, &setup.site_a, &first, 0, &bytes, true)
            .await
            .status,
        202
    );
    setup
        .root
        .write_verdict(
            &setup.name(),
            &Verdict::Refused(Class::Retry, "hash mismatch".into()),
        )
        .unwrap();
    std::fs::remove_file(setup.root.incoming(&setup.name())).unwrap();
    assert_eq!(
        get(&setup, &setup.site_a, &format!("/packages/{NAME}"))
            .await
            .body,
        "refused retry hash mismatch\n"
    );

    let resent = create(&setup, &setup.site_a, NAME, bytes.len()).await;
    assert_eq!(resent.status, 201);
    let second = resent.header("location").unwrap().to_string();
    assert_ne!(first, second);
    assert_eq!(
        patch(&setup, &setup.site_a, &first, 0, &bytes, true)
            .await
            .status,
        404
    );
    assert_eq!(
        patch(&setup, &setup.site_a, &second, 0, &bytes, true)
            .await
            .status,
        202
    );
    assert_eq!(
        get(&setup, &setup.site_a, &format!("/packages/{NAME}"))
            .await
            .body,
        "received\n"
    );

    setup
        .root
        .write_verdict(
            &setup.name(),
            &Verdict::Refused(Class::Final, "content invalid".into()),
        )
        .unwrap();
    std::fs::remove_file(setup.root.incoming(&setup.name())).unwrap();
    let held = create(&setup, &setup.site_a, NAME, bytes.len()).await;
    assert_eq!(
        (held.status, held.body.as_str()),
        (409, "refused final content invalid\n")
    );
}

/// More content than the declared length deactivates the upload (§8.2); creation past
/// `max-size` is refused before a byte is stored (§5.1.1).
#[tokio::test]
async fn lengths_are_held_to() {
    let setup = Setup::start("length", STALL).await;
    let location = create(&setup, &setup.site_a, NAME, 100)
        .await
        .header("location")
        .unwrap()
        .to_string();
    let over = patch(&setup, &setup.site_a, &location, 0, &package(150), false).await;
    assert_eq!(over.status, 400);
    assert!(!setup.root.partial(&setup.name()).exists());
    assert_eq!(
        request(setup.addr, &setup.site_a, "HEAD", &location, &[DRAFT], b"")
            .await
            .status,
        404
    );
    let huge = create(&setup, &setup.site_a, NAME, 2 << 30).await;
    assert_eq!(
        (huge.status, huge.header("upload-limit")),
        (413, Some("max-size=1073741824"))
    );
}

struct Whole(Option<bytes::Bytes>);

impl carrier::upload::Content for Whole {
    async fn chunk(&mut self) -> Option<std::io::Result<bytes::Bytes>> {
        self.0.take().map(Ok)
    }
}

/// New units' revisions sent at once by their site all start: a unit's owner is never seen
/// half-written. The handler is called directly, so the requests meet without a handshake
/// between them.
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn a_new_units_revisions_sent_at_once_all_start() {
    let setup = Setup::start("owner-race", STALL).await;
    let mut sends = tokio::task::JoinSet::new();
    for unit in 0..16 {
        for revision in 1..=32 {
            let carrier = setup.carrier.clone();
            sends.spawn(async move {
                let (parts, ()) = http::Request::post(format!(
                    "/packages/N{unit}.{revision}.0123456789abcdef.tar"
                ))
                .header("upload-draft-interop-version", "10")
                .header("upload-complete", "?1")
                .body(())
                .unwrap()
                .into_parts();
                let content = Whole(Some(bytes::Bytes::from_static(b"package")));
                carrier
                    .handle("site-a", parts, content)
                    .await
                    .status()
                    .as_u16()
            });
        }
    }
    let statuses = sends.join_all().await;
    assert!(statuses.iter().all(|&status| status == 202), "{statuses:?}");
}
