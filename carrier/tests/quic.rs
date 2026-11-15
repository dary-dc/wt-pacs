//! The same handler behind the experimental HTTP/3 listener, driven by h3's own client.
#![cfg(feature = "quic")]
mod common;

use bytes::{Buf, Bytes};
use common::*;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

struct H3 {
    endpoint: quinn::Endpoint,
    connection: quinn::Connection,
    send: h3::client::SendRequest<h3_quinn::OpenStreams, Bytes>,
}

async fn dial(addr: SocketAddr, who: Option<&Identity>) -> Result<H3, Box<dyn std::error::Error>> {
    let tls = client_config(who, b"h3");
    let mut endpoint = quinn::Endpoint::client("127.0.0.1:0".parse()?)?;
    endpoint.set_default_client_config(quinn::ClientConfig::new(Arc::new(
        quinn::crypto::rustls::QuicClientConfig::try_from(tls)?,
    )));
    let connection = endpoint.connect(addr, "localhost")?.await?;
    let (mut driver, send) = h3::client::new(h3_quinn::Connection::new(connection.clone())).await?;
    tokio::spawn(async move { driver.wait_idle().await });
    Ok(H3 {
        endpoint,
        connection,
        send,
    })
}

async fn call(
    h3: &mut H3,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Reply {
    let mut request = http::Request::builder()
        .method(method)
        .uri(format!("https://localhost{path}"));
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let mut stream = h3
        .send
        .send_request(request.body(()).unwrap())
        .await
        .unwrap();
    if !body.is_empty() {
        stream
            .send_data(Bytes::copy_from_slice(body))
            .await
            .unwrap();
    }
    stream.finish().await.unwrap();
    let response = stream.recv_response().await.unwrap();
    let mut text = Vec::new();
    while let Some(mut chunk) = stream.recv_data().await.unwrap() {
        text.extend_from_slice(&chunk.copy_to_bytes(chunk.remaining()));
    }
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap().to_string()))
        .collect();
    Reply {
        status: response.status().as_u16(),
        headers,
        body: String::from_utf8(text).unwrap(),
    }
}

/// Over HTTP/3 as over TCP: an enrolled certificate only, the careful creation, a connection lost
/// mid-`PATCH`, the offset from `HEAD` on a new connection, completion, and the reply.
#[tokio::test]
async fn http3_carries_the_same_upload() {
    let setup = Setup::start("quic", Duration::from_secs(120)).await;
    let endpoint = carrier::quic::bind("127.0.0.1:0".parse().unwrap(), setup.tls.clone()).unwrap();
    let addr = endpoint.local_addr().unwrap();
    tokio::spawn(carrier::quic::serve(
        endpoint,
        setup.allow.clone(),
        setup.carrier.clone(),
    ));

    for who in [Some(&setup.stranger), None] {
        let refused = async {
            let mut h3 = dial(addr, who).await.map_err(|err| err.to_string())?;
            let mut stream = h3
                .send
                .send_request(http::Request::get("https://localhost/").body(()).unwrap())
                .await;
            match &mut stream {
                Ok(stream) => stream
                    .recv_response()
                    .await
                    .map(|_| ())
                    .map_err(|err| err.to_string()),
                Err(err) => Err(err.to_string()),
            }
        };
        assert!(tokio::time::timeout(Duration::from_secs(10), refused)
            .await
            .unwrap()
            .is_err());
    }

    let bytes = package(400_000);
    let length = bytes.len().to_string();
    let mut h3 = dial(addr, Some(&setup.site_a)).await.unwrap();
    let headers = [
        DRAFT,
        ("upload-complete", "?0"),
        ("upload-length", length.as_str()),
    ];
    let created = call(&mut h3, "POST", &format!("/packages/{NAME}"), &headers, b"").await;
    assert_eq!(created.status, 201);
    let location = created.header("location").unwrap().to_string();

    let patching = [
        DRAFT,
        ("content-type", "application/partial-upload"),
        ("upload-offset", "0"),
        ("upload-complete", "?1"),
    ];
    let mut request = http::Request::patch(format!("https://localhost{location}"));
    for (name, value) in patching {
        request = request.header(name, value);
    }
    let mut stream = h3
        .send
        .send_request(request.body(()).unwrap())
        .await
        .unwrap();
    stream
        .send_data(Bytes::copy_from_slice(&bytes[..150_000]))
        .await
        .unwrap();
    let partial = setup.root.partial(&setup.name());
    eventually("the first part on disk", || {
        std::fs::metadata(&partial).is_ok_and(|m| m.len() == 150_000)
    })
    .await;
    h3.connection.close(0u32.into(), b"dropped");
    h3.endpoint.wait_idle().await;

    let mut h3 = dial(addr, Some(&setup.site_a)).await.unwrap();
    let head = call(&mut h3, "HEAD", &location, &[DRAFT], b"").await;
    assert_eq!(
        (head.status, head.header("upload-offset")),
        (204, Some("150000"))
    );
    let offset = head.header("upload-offset").unwrap().to_string();
    let rest = [
        DRAFT,
        ("content-type", "application/partial-upload"),
        ("upload-offset", offset.as_str()),
        ("upload-complete", "?1"),
    ];
    let done = call(&mut h3, "PATCH", &location, &rest, &bytes[150_000..]).await;
    assert_eq!((done.status, done.body.as_str()), (202, "received\n"));
    assert_eq!(
        std::fs::read(setup.root.incoming(&setup.name())).unwrap(),
        bytes
    );
    let reply = call(&mut h3, "GET", &format!("/packages/{NAME}"), &[], b"").await;
    assert_eq!(reply.body, "received\n");
}
