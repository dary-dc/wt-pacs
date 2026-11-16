//! report-receiver --port 8791 --dir out/ --fields lab/report-arms/report-fields.json [--cap-bytes N]
//! [--mutant ack-before-write]. One request a connection, from the nginx in front (report-plan.md §3.5).

use report_receiver::{Fields, Receiver, MAX_BODY};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

const MAX_HEAD: usize = 8 * 1024;
const DEFAULT_CAP: u64 = 1 << 30;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let port = arg("--port").unwrap_or("8791".into());
    let dir = arg("--dir").expect("--dir");
    let fields = std::fs::read_to_string(arg("--fields").expect("--fields")).expect("the field list");
    let fields = Fields::parse(&fields).expect("the field list");
    let cap = arg("--cap-bytes").map_or(DEFAULT_CAP, |c| c.parse().expect("--cap-bytes"));
    let mutant = arg("--mutant").as_deref() == Some("ack-before-write");
    let receiver = Arc::new(Mutex::new(Receiver::new(dir.into(), fields, cap, mutant)));
    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).await.expect("bind");
    println!("READY {}", listener.local_addr().unwrap().port());
    loop {
        let Ok((conn, _)) = listener.accept().await else { continue };
        let receiver = receiver.clone();
        tokio::spawn(async move {
            let _ = serve(conn, receiver).await;
        });
    }
}

async fn serve(mut conn: TcpStream, receiver: Arc<Mutex<Receiver>>) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(MAX_HEAD);
    let (method, path, length, head_len) = loop {
        let mut chunk = [0u8; 4096];
        let n = conn.read(&mut chunk).await?;
        if n == 0 || buf.len() > MAX_HEAD {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
        let mut headers = [httparse::EMPTY_HEADER; 32];
        let mut req = httparse::Request::new(&mut headers);
        if let Ok(httparse::Status::Complete(head_len)) = req.parse(&buf) {
            let length = req.headers.iter().find(|h| h.name.eq_ignore_ascii_case("content-length"))
                .and_then(|h| std::str::from_utf8(h.value).ok()?.trim().parse::<usize>().ok()).unwrap_or(0);
            break (req.method.unwrap_or("").to_string(), req.path.unwrap_or("").to_string(), length, head_len);
        }
    };
    let body = if length > MAX_BODY {
        None
    } else {
        while buf.len() < head_len + length {
            let mut chunk = [0u8; 4096];
            let n = conn.read(&mut chunk).await?;
            if n == 0 {
                return Ok(());
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        Some(&buf[head_len..head_len + length])
    };
    let answer = receiver.lock().await.handle(&method, &path, body);
    let body = answer.body.unwrap_or_default();
    let kind = if body.is_empty() { "" } else { "Content-Type: application/json\r\n" };
    let head = format!("HTTP/1.1 {} -\r\n{kind}Content-Length: {}\r\nConnection: close\r\n\r\n", answer.status, body.len());
    conn.write_all(head.as_bytes()).await?;
    conn.write_all(body.as_bytes()).await?;
    conn.shutdown().await
}
