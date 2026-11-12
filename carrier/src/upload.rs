//! The resumable upload of draft-ietf-httpbis-resumable-upload-14 at interop version 10, the
//! subset of docs/ingest/link.md §12.1, written once against `http` types for every listener.
use crate::handoff::{write_durably, Class, PackageName, Root, Verdict};
use bytes::Bytes;
use http::{header, request::Parts, HeaderMap, Method, Response, StatusCode};
use ring::rand::{SecureRandom, SystemRandom};
use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Notify, OwnedMutexGuard};
use tracing::{info, warn};

pub const INTEROP_VERSION: &str = "10";
const PARTIAL_UPLOAD: &str = "application/partial-upload";

/// A request's content as its listener delivers it, chunk by chunk.
pub trait Content: Send {
    fn chunk(&mut self) -> impl Future<Output = Option<io::Result<Bytes>>> + Send;
}

pub struct Limits {
    /// Bytes: the draft's `max-size`, announced in `Upload-Limit`.
    pub max_size: u64,
    /// How long a request's content may send nothing before the carrier stops reading it.
    pub stall: Duration,
}

pub struct Carrier {
    root: Root,
    limits: Limits,
    slots: Mutex<HashMap<String, Arc<Slot>>>,
}

/// One per revision in use: the newest request on it holds the turn and every older one stops (§10).
#[derive(Default)]
struct Slot {
    lock: Arc<tokio::sync::Mutex<()>>,
    newest: AtomicU64,
    superseded: Notify,
}

struct Turn {
    slot: Arc<Slot>,
    ticket: u64,
    _held: OwnedMutexGuard<()>,
}

/// One revision's upload as the carrier keeps it, in `uploads/<unit>/<revision>`.
struct Upload {
    hash: String,
    site: String,
    token: String,
    length: Option<u64>,
}

enum State {
    Uploading(u64),
    Received,
    Judged(Verdict),
    Gone,
}

enum Next {
    Data(Bytes),
    End,
    Interrupted,
}

impl Carrier {
    pub fn new(root: Root, limits: Limits) -> Carrier {
        Carrier {
            root,
            limits,
            slots: Mutex::default(),
        }
    }

    /// `site` is the one the client's certificate is enrolled for; the listener has checked it.
    pub async fn handle(
        &self,
        site: &str,
        request: Parts,
        content: impl Content,
    ) -> Response<String> {
        let response = self
            .route(site, &request, content)
            .await
            .unwrap_or_else(|err| {
                warn!(site, path = request.uri.path(), %err, "request failed");
                plain(StatusCode::INTERNAL_SERVER_ERROR, "")
            });
        self.slots
            .lock()
            .unwrap()
            .retain(|_, slot| Arc::strong_count(slot) > 1);
        response
    }

    async fn route(
        &self,
        site: &str,
        request: &Parts,
        content: impl Content,
    ) -> io::Result<Response<String>> {
        let segments: Vec<&str> = request
            .uri
            .path()
            .trim_start_matches('/')
            .split('/')
            .collect();
        let headers = &request.headers;
        match (&request.method, segments.as_slice()) {
            (&Method::POST, ["packages", name]) => self.create(site, name, headers, content).await,
            (&Method::GET, ["packages", name]) => self.reply_of(site, name),
            (&Method::HEAD | &Method::GET, ["uploads", name, token]) => {
                self.offset(site, name, token).await
            }
            (&Method::PATCH, ["uploads", name, token]) => {
                self.append(site, name, token, headers, content).await
            }
            (&Method::DELETE, ["uploads", name, token]) => self.cancel(site, name, token).await,
            (_, ["packages", _] | ["uploads", _, _]) => {
                Ok(plain(StatusCode::METHOD_NOT_ALLOWED, ""))
            }
            _ => Ok(plain(StatusCode::NOT_FOUND, "")),
        }
    }

    /// A careful creation (empty, `Upload-Complete: ?0`) or a one-shot upload (`?1`, or none).
    async fn create(
        &self,
        site: &str,
        name: &str,
        headers: &HeaderMap,
        content: impl Content,
    ) -> io::Result<Response<String>> {
        let Some(name) = PackageName::parse(name) else {
            return Ok(plain(StatusCode::BAD_REQUEST, "not a package name\n"));
        };
        let complete = flag(headers, "upload-complete");
        if complete.is_some() && !interop(headers) {
            return Ok(plain(
                StatusCode::BAD_REQUEST,
                "Upload-Draft-Interop-Version: 10 required\n",
            ));
        }
        let length = integer(headers, "upload-length");
        if complete == Some(false) && length.is_none() {
            return Ok(plain(StatusCode::BAD_REQUEST, "Upload-Length required\n"));
        }
        if length.is_some_and(|length| length > self.limits.max_size) {
            return Ok(self.limit(plain(StatusCode::PAYLOAD_TOO_LARGE, "")));
        }
        let turn = self.turn(&name).await;
        if let Some(early) = self.claim(site, &name)? {
            return Ok(early);
        }
        let upload = Upload {
            hash: name.hash.clone(),
            site: site.to_string(),
            token: token()?,
            length,
        };
        self.write_upload(&name, &upload)?;
        fs::File::create(self.root.partial(&name))?;
        let location = format!("/uploads/{name}/{}", upload.token);
        self.append_at(
            &turn,
            &name,
            upload,
            0,
            complete.unwrap_or(true),
            content,
            Some(location),
        )
        .await
    }

    /// What an existing upload of this revision makes of a new one: `None` lets it start.
    fn claim(&self, site: &str, name: &PackageName) -> io::Result<Option<Response<String>>> {
        let dir = self.root.uploads(&name.unit);
        fs::create_dir_all(&dir)?;
        let mine = dir.join(format!(".owner.{}", token()?));
        fs::write(&mine, site)?;
        let linked = fs::hard_link(&mine, dir.join("owner"));
        fs::remove_file(&mine)?;
        match linked {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
                if fs::read_to_string(dir.join("owner"))? != site {
                    return Ok(Some(answer(
                        StatusCode::FORBIDDEN,
                        "refused final not-authorised",
                    )));
                }
            }
            Err(err) => return Err(err),
        }
        let Some(upload) = self.read_upload(name)? else {
            return Ok(None);
        };
        let held = PackageName {
            hash: upload.hash,
            ..name.clone()
        };
        let same = held == *name;
        Ok(match self.state(&held)? {
            State::Received if same => Some(answer(StatusCode::OK, "received")),
            State::Judged(Verdict::Committed) if same => Some(answer(StatusCode::OK, "committed")),
            State::Received | State::Judged(Verdict::Committed) => Some(answer(
                StatusCode::CONFLICT,
                &format!("refused final conflict with {held}"),
            )),
            State::Judged(verdict @ Verdict::Refused(Class::Final, _)) if same => {
                Some(answer(StatusCode::CONFLICT, &verdict.to_string()))
            }
            State::Judged(Verdict::Refused(..)) => {
                remove(&self.root.status(&held))?;
                None
            }
            State::Uploading(_) => {
                remove(&self.root.partial(&held))?;
                None
            }
            State::Gone => None,
        })
    }

    fn reply_of(&self, site: &str, name: &str) -> io::Result<Response<String>> {
        let Some(name) = PackageName::parse(name) else {
            return Ok(plain(StatusCode::BAD_REQUEST, "not a package name\n"));
        };
        if !self
            .read_upload(&name)?
            .is_some_and(|upload| upload.hash == name.hash && upload.site == site)
        {
            return Ok(plain(StatusCode::NOT_FOUND, ""));
        }
        Ok(match self.state(&name)? {
            State::Uploading(offset) => plain(StatusCode::OK, &format!("uploading {offset}\n")),
            State::Received => plain(StatusCode::OK, "received\n"),
            State::Judged(verdict) => plain(StatusCode::OK, &format!("{verdict}\n")),
            State::Gone => plain(StatusCode::NOT_FOUND, ""),
        })
    }

    async fn offset(&self, site: &str, name: &str, token: &str) -> io::Result<Response<String>> {
        let Some((name, upload)) = self.find_upload(site, name, token)? else {
            return Ok(plain(StatusCode::NOT_FOUND, ""));
        };
        let _turn = self.turn(&name).await;
        let (offset, complete) = match self.state(&name)? {
            State::Uploading(offset) => (offset, "?0"),
            State::Received | State::Judged(_) => (upload.length.unwrap_or_default(), "?1"),
            State::Gone => return Ok(plain(StatusCode::NOT_FOUND, "")),
        };
        let mut response = self.limit(plain(StatusCode::NO_CONTENT, ""));
        set(&mut response, "upload-offset", offset.to_string());
        set(&mut response, "upload-complete", complete.to_string());
        if let Some(length) = upload.length {
            set(&mut response, "upload-length", length.to_string());
        }
        Ok(response)
    }

    async fn append(
        &self,
        site: &str,
        name: &str,
        token: &str,
        headers: &HeaderMap,
        content: impl Content,
    ) -> io::Result<Response<String>> {
        let Some((name, upload)) = self.find_upload(site, name, token)? else {
            return Ok(plain(StatusCode::NOT_FOUND, ""));
        };
        if headers
            .get(header::CONTENT_TYPE)
            .is_none_or(|kind| kind != PARTIAL_UPLOAD)
        {
            return Ok(plain(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Content-Type: application/partial-upload\n",
            ));
        }
        let (Some(complete), Some(offset), true) = (
            flag(headers, "upload-complete"),
            integer(headers, "upload-offset"),
            interop(headers),
        ) else {
            return Ok(plain(
                StatusCode::BAD_REQUEST,
                "Upload-Complete, Upload-Offset and interop version 10\n",
            ));
        };
        if integer(headers, "upload-length").is_some_and(|length| Some(length) != upload.length) {
            return Ok(inconsistent_length());
        }
        let turn = self.turn(&name).await;
        match self.state(&name)? {
            State::Uploading(_) => {
                self.append_at(&turn, &name, upload, offset, complete, content, None)
                    .await
            }
            State::Received => Ok(answer(StatusCode::OK, "received")),
            State::Judged(verdict) => Ok(answer(StatusCode::OK, &verdict.to_string())),
            State::Gone => Ok(plain(StatusCode::NOT_FOUND, "")),
        }
    }

    async fn cancel(&self, site: &str, name: &str, token: &str) -> io::Result<Response<String>> {
        let Some((name, _)) = self.find_upload(site, name, token)? else {
            return Ok(plain(StatusCode::NOT_FOUND, ""));
        };
        let _turn = self.turn(&name).await;
        if !matches!(self.state(&name)?, State::Uploading(_)) {
            return Ok(answer(StatusCode::CONFLICT, "complete"));
        }
        self.deactivate(&name)?;
        Ok(plain(StatusCode::NO_CONTENT, ""))
    }

    /// Appends the content at `offset`, which must be the partial file's length; `created` is
    /// the new upload's address when this is its creation request.
    #[allow(clippy::too_many_arguments)]
    async fn append_at(
        &self,
        turn: &Turn,
        name: &PackageName,
        mut upload: Upload,
        offset: u64,
        complete: bool,
        mut content: impl Content,
        created: Option<String>,
    ) -> io::Result<Response<String>> {
        let partial = self.root.partial(name);
        let mut file = tokio::fs::OpenOptions::new()
            .append(true)
            .open(&partial)
            .await?;
        let mut at = file.metadata().await?.len();
        if offset != at {
            let mut response = plain(StatusCode::CONFLICT, &mismatching_offset(at, offset));
            set(&mut response, "upload-offset", at.to_string());
            set(&mut response, "upload-complete", "?0".to_string());
            set(
                &mut response,
                "content-type",
                "application/problem+json".to_string(),
            );
            return Ok(response);
        }
        let limit = upload.length.unwrap_or(self.limits.max_size);
        let ended = loop {
            match self.next(turn, &mut content).await {
                Next::Data(bytes) if at + bytes.len() as u64 > limit => {
                    drop(file);
                    self.deactivate(name)?;
                    return Ok(match upload.length {
                        Some(_) => inconsistent_length(),
                        None => self.limit(plain(StatusCode::PAYLOAD_TOO_LARGE, "")),
                    });
                }
                Next::Data(bytes) => {
                    file.write_all(&bytes).await?;
                    at += bytes.len() as u64;
                }
                Next::End => break true,
                Next::Interrupted => break false,
            }
        };
        file.flush().await?;
        if !ended || !complete {
            let status = match (ended, &created) {
                (false, _) => StatusCode::BAD_REQUEST,
                (true, Some(_)) => StatusCode::CREATED,
                (true, None) => StatusCode::NO_CONTENT,
            };
            let mut response = self.limit(plain(status, ""));
            set(&mut response, "upload-offset", at.to_string());
            set(&mut response, "upload-complete", "?0".to_string());
            if let Some(location) = created {
                set(&mut response, "location", location);
            }
            return Ok(response);
        }
        if upload.length.is_some_and(|length| length != at) {
            drop(file);
            self.deactivate(name)?;
            return Ok(inconsistent_length());
        }
        if upload.length.is_none() {
            upload.length = Some(at);
            self.write_upload(name, &upload)?;
        }
        file.sync_all().await?;
        drop(file);
        fs::rename(&partial, self.root.incoming(name))?;
        fs::File::open(self.root.incoming(name).parent().expect("incoming/"))?.sync_all()?;
        info!(site = upload.site, %name, bytes = at, "received");
        let mut response = answer(StatusCode::ACCEPTED, "received");
        set(&mut response, "location", format!("/packages/{name}"));
        Ok(response)
    }

    /// The next chunk, unless a newer request on this upload took the turn, the content stalled
    /// past the limit, or the connection broke.
    async fn next(&self, turn: &Turn, content: &mut impl Content) -> Next {
        let superseded = turn.slot.superseded.notified();
        tokio::pin!(superseded);
        superseded.as_mut().enable();
        if turn.slot.newest.load(Ordering::SeqCst) != turn.ticket {
            return Next::Interrupted;
        }
        tokio::select! {
            _ = superseded => Next::Interrupted,
            chunk = tokio::time::timeout(self.limits.stall, content.chunk()) => match chunk {
                Ok(Some(Ok(bytes))) => Next::Data(bytes),
                Ok(None) => Next::End,
                Ok(Some(Err(_))) | Err(_) => Next::Interrupted,
            },
        }
    }

    async fn turn(&self, name: &PackageName) -> Turn {
        let key = format!("{}.{}", name.unit, name.revision);
        let slot = self.slots.lock().unwrap().entry(key).or_default().clone();
        let ticket = slot.newest.fetch_add(1, Ordering::SeqCst) + 1;
        slot.superseded.notify_waiters();
        let held = slot.lock.clone().lock_owned().await;
        Turn {
            slot,
            ticket,
            _held: held,
        }
    }

    /// Reads in the order the files change: the verdict, then the partial, then the package.
    fn state(&self, name: &PackageName) -> io::Result<State> {
        if let Some(verdict) = self.root.read_verdict(name)? {
            return Ok(State::Judged(verdict));
        }
        match fs::metadata(self.root.partial(name)) {
            Ok(partial) => return Ok(State::Uploading(partial.len())),
            Err(err) if err.kind() != io::ErrorKind::NotFound => return Err(err),
            Err(_) => {}
        }
        if self.root.incoming(name).exists() {
            return Ok(State::Received);
        }
        Ok(self
            .root
            .read_verdict(name)?
            .map_or(State::Gone, State::Judged))
    }

    fn find_upload(
        &self,
        site: &str,
        name: &str,
        token: &str,
    ) -> io::Result<Option<(PackageName, Upload)>> {
        let Some(name) = PackageName::parse(name) else {
            return Ok(None);
        };
        let upload = self.read_upload(&name)?;
        Ok(upload
            .filter(|r| r.hash == name.hash && r.site == site && r.token == token)
            .map(|r| (name, r)))
    }

    fn deactivate(&self, name: &PackageName) -> io::Result<()> {
        remove(&self.root.partial(name))?;
        remove(
            &self
                .root
                .uploads(&name.unit)
                .join(name.revision.to_string()),
        )
    }

    fn read_upload(&self, name: &PackageName) -> io::Result<Option<Upload>> {
        let line = match fs::read_to_string(
            self.root
                .uploads(&name.unit)
                .join(name.revision.to_string()),
        ) {
            Ok(line) => line,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err),
        };
        let fields: Vec<&str> = line.split_whitespace().collect();
        let [hash, site, token, length] = fields[..] else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("upload of {name}: {line:?}"),
            ));
        };
        let length = length.parse().ok();
        Ok(Some(Upload {
            hash: hash.into(),
            site: site.into(),
            token: token.into(),
            length,
        }))
    }

    fn write_upload(&self, name: &PackageName, upload: &Upload) -> io::Result<()> {
        let length = upload
            .length
            .map_or("-".to_string(), |length| length.to_string());
        let line = format!(
            "{} {} {} {length}\n",
            upload.hash, upload.site, upload.token
        );
        write_durably(
            &self
                .root
                .uploads(&name.unit)
                .join(name.revision.to_string()),
            line.as_bytes(),
        )
    }

    fn limit(&self, mut response: Response<String>) -> Response<String> {
        set(
            &mut response,
            "upload-limit",
            format!("max-size={}", self.limits.max_size),
        );
        response
    }
}

/// The receiver's or the carrier's word on a package: `Upload-Complete: ?1` says it comes from
/// the package's resource, not from the upload's.
fn answer(status: StatusCode, line: &str) -> Response<String> {
    let mut response = plain(status, &format!("{line}\n"));
    set(&mut response, "upload-complete", "?1".to_string());
    response
}

fn plain(status: StatusCode, body: &str) -> Response<String> {
    let mut response = Response::new(body.to_string());
    *response.status_mut() = status;
    set(&mut response, "cache-control", "no-store".to_string());
    if !body.is_empty() {
        set(&mut response, "content-type", "text/plain".to_string());
    }
    response
}

fn set(response: &mut Response<String>, name: &'static str, value: String) {
    response
        .headers_mut()
        .insert(name, value.parse().expect("an ASCII header value"));
}

fn inconsistent_length() -> Response<String> {
    let body =
        r#"{"type":"https://iana.org/assignments/http-problem-types#inconsistent-upload-length"}"#;
    let mut response = plain(StatusCode::BAD_REQUEST, body);
    set(
        &mut response,
        "content-type",
        "application/problem+json".to_string(),
    );
    set(&mut response, "upload-complete", "?0".to_string());
    response
}

fn mismatching_offset(expected: u64, provided: u64) -> String {
    format!(
        r#"{{"type":"https://iana.org/assignments/http-problem-types#mismatching-upload-offset","expected-offset":{expected},"provided-offset":{provided}}}"#
    )
}

/// A structured-field Boolean; any other value is ignored, as the draft says (§4.2.1).
fn flag(headers: &HeaderMap, name: &str) -> Option<bool> {
    match headers.get(name)?.as_bytes() {
        b"?1" => Some(true),
        b"?0" => Some(false),
        _ => None,
    }
}

/// A non-negative structured-field Integer, at most 15 digits; any other value is ignored (§4.1.1).
fn integer(headers: &HeaderMap, name: &str) -> Option<u64> {
    let value = headers.get(name)?.to_str().ok()?;
    let digits = (1..=15).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_digit());
    digits.then(|| value.parse().ok())?
}

fn interop(headers: &HeaderMap) -> bool {
    headers
        .get("upload-draft-interop-version")
        .is_some_and(|version| version == INTEROP_VERSION)
}

fn token() -> io::Result<String> {
    let mut bytes = [0u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| io::Error::other("no system randomness"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn remove(path: &std::path::Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}
