use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use wtransport::{Endpoint, Identity, ServerConfig};

use crate::doc::{self, Source};
use crate::prepare::study_dir;

struct State {
    root: PathBuf,
    frame: Vec<u8>,
    /// The bundle digest per (study, series): what a frame server knows from the `.sbnd` it opened, not the DB.
    digests: HashMap<(String, String), String>,
}

/// Letters and digits only: a name never reaches the filesystem otherwise.
fn plain(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn query<'a>(q: &'a str, key: &str) -> Option<&'a str> {
    q.split('&').find_map(|kv| kv.strip_prefix(key)?.strip_prefix('='))
}

/// The owner's option at one open: the study DB opened, read in one transaction, the document built and gzipped.
pub fn open_and_read(root: &Path, study: &str, name: &str, source: Source) -> Result<Vec<u8>> {
    let mut conn = doc::open_read(&study_dir(root, study))?;
    Ok(doc::gzip(&doc::document(&doc::read(&mut conn, name, source)?)))
}

async fn read_blocking(root: PathBuf, study: String, name: String, source: Source) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || open_and_read(&root, &study, &name, source)).await?
}

/// `GET /meta/<study>/<series>?from=instances|ready`, HTTP/1.0 from nginx, one request a connection.
async fn answer(mut tcp: TcpStream, root: PathBuf) -> Result<()> {
    let mut buf = vec![0u8; 8192];
    let mut n = 0;
    while !buf[..n].windows(4).any(|w| w == b"\r\n\r\n") {
        if n == buf.len() {
            bail!("request head over {} B", buf.len());
        }
        let k = tcp.read(&mut buf[n..]).await?;
        if k == 0 {
            bail!("closed before the request head ended");
        }
        n += k;
    }
    let head = std::str::from_utf8(&buf[..n])?;
    let target = head.split_whitespace().nth(1).context("request line")?;
    let if_none_match = head.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.eq_ignore_ascii_case("if-none-match").then(|| v.trim().to_string())
    });
    let (path, q) = target.split_once('?').unwrap_or((target, ""));
    let mut parts = path.trim_start_matches('/').split('/');
    let found = match (parts.next(), parts.next(), parts.next(), query(q, "from").and_then(Source::parse)) {
        (Some("meta"), Some(study), Some(name), Some(source)) if plain(study) && plain(name) => {
            read_blocking(root, study.into(), name.into(), source).await.ok()
        }
        _ => None,
    };
    let response = match found {
        None => b"HTTP/1.0 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec(),
        Some(gz) => {
            let tag = doc::etag(&gz);
            let fresh = if_none_match.as_deref() == Some(tag.as_str());
            let mut r = format!(
                "HTTP/1.0 {}\r\nContent-Type: application/json\r\nContent-Encoding: gzip\r\nCache-Control: no-cache\r\n\
                 ETag: {tag}\r\nContent-Length: {}\r\n\r\n",
                if fresh { "304 Not Modified" } else { "200 OK" },
                if fresh { 0 } else { gz.len() }
            )
            .into_bytes();
            if !fresh {
                r.extend_from_slice(&gz);
            }
            r
        }
    };
    tcp.write_all(&response).await?;
    tcp.shutdown().await?;
    Ok(())
}

async fn session(incoming: wtransport::endpoint::IncomingSession, state: Arc<State>) -> Result<()> {
    let request = incoming.await?;
    let q = request.path().split_once('?').map_or("", |(_, q)| q).to_string();
    let study = query(&q, "study").filter(|s| plain(s)).context("study")?.to_string();
    let name = query(&q, "series").filter(|s| plain(s)).context("series")?.to_string();
    let reading = match query(&q, "from").and_then(Source::parse) {
        Some(source) => Some(tokio::spawn(read_blocking(state.root.clone(), study.clone(), name.clone(), source))),
        None => {
            let digest = state.digests.get(&(study.clone(), name.clone())).context("unknown series")?;
            if query(&q, "digest") != Some(digest.as_str()) {
                request.not_found().await;
                return Ok(());
            }
            None
        }
    };
    let connection = request.accept().await?;
    let mut stream = connection.open_uni().await?.await?;
    if let Some(reading) = reading {
        let gz = reading.await??;
        stream.write_all(&(gz.len() as u32).to_be_bytes()).await?;
        stream.write_all(&gz).await?;
    }
    stream.write_all(&(state.frame.len() as u32).to_be_bytes()).await?;
    stream.write_all(&state.frame).await?;
    stream.finish().await?;
    connection.closed().await;
    Ok(())
}

fn digests(root: &Path) -> Result<HashMap<(String, String), String>> {
    let mut out = HashMap::new();
    for entry in std::fs::read_dir(root.join("studies"))? {
        let dir = entry?.path();
        let study = dir.file_name().and_then(|s| s.to_str()).context("study name")?.to_string();
        let conn = doc::open_read(&dir)?;
        for name in doc::series_names(&conn)? {
            let (_, digest) = doc::series_uid(&conn, &name)?;
            out.insert((study.clone(), name), digest);
        }
    }
    Ok(out)
}

pub async fn run(root: PathBuf, http: SocketAddr, wt: SocketAddr, cert: &Path, key: &Path) -> Result<()> {
    let state = Arc::new(State { frame: std::fs::read(root.join("frame0.gz"))?, digests: digests(&root)?, root });
    let identity = Identity::load_pemfiles(cert, key).await?;
    let config = ServerConfig::builder()
        .with_bind_address(wt)
        .with_identity(identity)
        .keep_alive_interval(Some(Duration::from_secs(3)))
        .build();
    let endpoint = Endpoint::server(config)?;
    let listener = TcpListener::bind(http).await?;
    let root = state.root.clone();
    tokio::spawn(async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else { continue };
            tokio::spawn(answer(tcp, root.clone()));
        }
    });
    eprintln!("serving: http {http}, webtransport {wt}");
    loop {
        let incoming = endpoint.accept().await;
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(err) = session(incoming, state).await {
                eprintln!("session: {err:#}");
            }
        });
    }
}
