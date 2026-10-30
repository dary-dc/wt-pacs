//! A session that resumes: silence while frames are owed, or a session closed under them, is answered by a re-dial,
//! after which the caller asks again for what it still owes. The browser downloader's deadlines and rules:
//! `docs/ARCHITECTURE.md` §Detection by the bytes; `docs/native/README.md` §Parity.

use crate::transport::{dial_bounded, Event, Session, Windows};
use anyhow::{Context, Result};
use std::time::{Duration, Instant};

/// `client/transport/downloader.js`'s `deadlines`, less `decodeMs`.
#[derive(Clone, Copy, Debug)]
pub struct Deadlines {
    pub stall: Duration,
    pub redial: Duration,
    pub tries: u32,
    pub dial: Duration,
}

impl Default for Deadlines {
    fn default() -> Self {
        let ms = Duration::from_millis;
        Self { stall: ms(3000), redial: ms(1000), tries: 5, dial: ms(5000) }
    }
}

pub enum Heard {
    Event(Event),
    /// A new session is up: what was owed on the old one is owed again and must be asked again.
    Resumed,
    /// Every re-dial failed: what was owed fails, with this reason. The next ask dials afresh.
    Lost(String),
}

pub struct ResumingSession {
    url: String,
    cert_sha256: [u8; 32],
    windows: Windows,
    held: usize,
    deadlines: Deadlines,
    session: Option<Session>,
    /// The silence that condemns the session; doubled by each stall.
    quiet: Duration,
    /// When the session last moved: a stream frame arrived, an event was handed on, or the caller sent work.
    moved: Instant,
    stream_frames: u64,
    redials: u32,
}

impl ResumingSession {
    /// The first dial, tried again on a timeout as a re-dial is; any other failure is returned at once.
    pub async fn open(url: &str, cert_sha256: [u8; 32], windows: Windows, held: usize, deadlines: Deadlines) -> Result<Self> {
        let mut s = Self {
            url: url.into(),
            cert_sha256,
            windows,
            held,
            deadlines,
            session: None,
            quiet: deadlines.stall,
            moved: Instant::now(),
            stream_frames: 0,
            redials: 0,
        };
        for n in 1.. {
            match tokio::time::timeout(deadlines.dial, s.dial()).await {
                Ok(dialled) => return dialled.map(|()| s),
                Err(_) if n < deadlines.tries => tokio::time::sleep(deadlines.redial).await,
                Err(_) => break,
            }
        }
        anyhow::bail!("the first dial timed out {} times", deadlines.tries)
    }

    async fn dial(&mut self) -> Result<()> {
        let session = dial_bounded(&self.url, self.cert_sha256, &self.windows, self.held).await?;
        self.stream_frames = session.stream_frames();
        self.moved = Instant::now();
        self.session = Some(session);
        Ok(())
    }

    /// The session, dialled afresh if the last one was lost with nothing owed.
    async fn live(&mut self) -> Result<&mut Session> {
        if self.session.is_none() {
            tokio::time::timeout(self.deadlines.dial, self.dial()).await.context("the dial timed out")??;
        }
        self.moved = Instant::now();
        Ok(self.session.as_mut().expect("dialled"))
    }

    pub async fn ask(&mut self, frame: u32) -> Result<()> {
        self.live().await?.ask(frame).await
    }

    pub async fn fill(&mut self, from: u32, to: u32) -> Result<()> {
        self.live().await?.fill(from, to).await
    }

    /// Ends a running fill; nothing to end on a session already lost.
    pub async fn end_stream(&mut self) -> Result<()> {
        match &mut self.session {
            Some(session) => session.end_stream().await,
            None => Ok(()),
        }
    }

    /// The next event. `owed` is whether the caller owes frames, the only time silence condemns the session; with
    /// nothing owed a lost session waits for the next ask to re-dial it. Cancel-safe: every deadline is a field.
    pub async fn next(&mut self, owed: bool) -> Result<Heard> {
        loop {
            let Some(session) = &mut self.session else {
                if owed {
                    return Ok(self.resume().await);
                }
                return std::future::pending().await;
            };
            let condemned = self.moved + self.quiet;
            let event = tokio::select! {
                event = session.next() => Some(event),
                _ = tokio::time::sleep_until(condemned.into()), if owed => None,
            };
            match event {
                Some(Some(Ok(event))) => {
                    if matches!(event, Event::Frame { .. }) {
                        self.redials = 0;
                    }
                    self.moved = Instant::now();
                    return Ok(Heard::Event(event));
                }
                Some(Some(Err(e))) if !session.closed() => return Err(e),
                Some(_) => self.drop_session(),
                None => {
                    let seen = session.stream_frames();
                    if seen != self.stream_frames {
                        (self.stream_frames, self.moved) = (seen, Instant::now());
                        continue;
                    }
                    println!("stalled quiet_ms={}", self.quiet.as_millis());
                    self.quiet *= 2;
                    self.drop_session();
                }
            }
        }
    }

    fn drop_session(&mut self) {
        if let Some(session) = self.session.take() {
            session.close();
        }
    }

    /// A new session within `tries` re-dials since a frame last arrived, else `Lost`.
    async fn resume(&mut self) -> Heard {
        while self.redials < self.deadlines.tries {
            self.redials += 1;
            match tokio::time::timeout(self.deadlines.dial, self.dial()).await {
                Ok(Ok(())) => {
                    println!("resumed redials={}", self.redials);
                    return Heard::Resumed;
                }
                _ => tokio::time::sleep(self.deadlines.redial).await,
            }
        }
        self.redials = 0;
        Heard::Lost("the session was lost and could not be re-dialled".into())
    }

    pub fn close(&mut self) {
        self.drop_session();
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::net::SocketAddr;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tokio::net::UdpSocket;

    /// A UDP relay in front of the server. `cut` makes every path open at that moment silent for good, as a dead
    /// network does; `dead` drops every packet, old path or new, until it is cleared.
    pub(crate) struct Relay {
        pub url: String,
        paths: Arc<std::sync::Mutex<HashMap<SocketAddr, (Arc<UdpSocket>, Arc<AtomicBool>)>>>,
        pub dead: Arc<AtomicBool>,
        /// Each packet to the client waits this many ms, one after another: a slow link that still moves.
        pub slow_ms: Arc<std::sync::atomic::AtomicU64>,
    }

    impl Relay {
        pub(crate) async fn to(server: &str) -> Self {
            let upstream: SocketAddr = server.trim_start_matches("https://").trim_end_matches('/').parse().unwrap();
            let front = Arc::new(UdpSocket::bind("127.0.0.1:0").await.unwrap());
            let url = format!("https://{}/", front.local_addr().unwrap());
            let paths: Arc<std::sync::Mutex<HashMap<SocketAddr, (Arc<UdpSocket>, Arc<AtomicBool>)>>> = Default::default();
            let dead = Arc::new(AtomicBool::new(false));
            let slow_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
            let (p, d, slow) = (paths.clone(), dead.clone(), slow_ms.clone());
            tokio::spawn(async move {
                let mut buf = vec![0u8; 65536];
                loop {
                    let (n, client) = front.recv_from(&mut buf).await.unwrap();
                    let path = p.lock().unwrap().get(&client).cloned();
                    let (back, cut) = match path {
                        Some(path) => path,
                        None => {
                            let back = Arc::new(UdpSocket::bind("127.0.0.1:0").await.unwrap());
                            back.connect(upstream).await.unwrap();
                            let cut = Arc::new(AtomicBool::new(false));
                            p.lock().unwrap().insert(client, (back.clone(), cut.clone()));
                            let (to_client, from_server, silent, dead, slow) = (front.clone(), back.clone(), cut.clone(), d.clone(), slow.clone());
                            tokio::spawn(async move {
                                let mut buf = vec![0u8; 65536];
                                while let Ok(n) = from_server.recv(&mut buf).await {
                                    tokio::time::sleep(Duration::from_millis(slow.load(Ordering::Relaxed))).await;
                                    if !silent.load(Ordering::Relaxed) && !dead.load(Ordering::Relaxed) {
                                        let _ = to_client.send_to(&buf[..n], client).await;
                                    }
                                }
                            });
                            (back, cut)
                        }
                    };
                    if !cut.load(Ordering::Relaxed) && !d.load(Ordering::Relaxed) {
                        let _ = back.send(&buf[..n]).await;
                    }
                }
            });
            Self { url, paths, dead, slow_ms }
        }

        /// Client addresses seen: one per dial.
        pub(crate) fn paths(&self) -> usize {
            self.paths.lock().unwrap().len()
        }

        pub(crate) fn cut(&self) {
            for (_, cut) in self.paths.lock().unwrap().values() {
                cut.store(true, Ordering::Relaxed);
            }
        }
    }

    pub(crate) fn quick() -> Deadlines {
        let ms = Duration::from_millis;
        Deadlines { stall: ms(300), redial: ms(50), tries: 3, dial: ms(500) }
    }

    /// **Every re-dial failing fails what is owed, and the next ask dials afresh.** With every packet dropped, an ask
    /// owed is answered by `Lost` once the stall and `tries` re-dials have run out; with the path back, the next ask
    /// re-dials and its frame arrives.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_session_that_cannot_be_redialled_is_lost_then_dialled_afresh() {
        let dir = crate::transport::tests::temp_dir("resume-lost");
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/us_cine_smoke/us_cine_smoke.sbnd");
        let (url, hash) = crate::transport::tests::serve(&dir, &fixture, "shared").await;
        let relay = Relay::to(&url).await;
        let mut session = crate::transport::tests::until_up(|| ResumingSession::open(&relay.url, hash, Windows::default(), 1, quick())).await;
        relay.dead.store(true, Ordering::Relaxed);
        session.ask(1).await.unwrap();
        let heard = tokio::time::timeout(Duration::from_secs(10), session.next(true)).await.expect("never declared lost").unwrap();
        assert!(matches!(heard, Heard::Lost(_)), "the dead path was not declared lost");
        relay.dead.store(false, Ordering::Relaxed);
        session.ask(1).await.unwrap();
        let heard = tokio::time::timeout(Duration::from_secs(10), session.next(true)).await.expect("the fresh dial stalled").unwrap();
        assert!(matches!(heard, Heard::Event(Event::Frame { index: 1, .. })), "the ask after a loss was not served");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **A frame slower than the stall is not a death while its bytes keep coming, and silence with nothing owed is
    /// none.** Over a relay passing one packet each 10 ms, a 256 KiB frame takes several times the 300 ms stall and
    /// arrives on the first session; idle for four stalls with nothing owed, the session is not re-dialled.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_slow_frame_is_not_a_stall_and_idle_is_not_silence() {
        let dir = crate::transport::tests::temp_dir("resume-slow");
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/us_cine_smoke/us_cine_smoke.sbnd");
        let metadata = series_bundle::read_layout(&std::fs::File::open(fixture).unwrap()).unwrap().metadata;
        let big = vec![7u8; 256 << 10];
        let bundle = dir.join("big.sbnd");
        series_bundle::write_bundle(&bundle, metadata.as_bytes(), &[&big[..], &big[..], &big[..]]).unwrap();
        let (url, hash) = crate::transport::tests::serve(&dir, &bundle, "shared").await;
        let relay = Relay::to(&url).await;
        let mut session = crate::transport::tests::until_up(|| ResumingSession::open(&relay.url, hash, Windows::default(), 1, quick())).await;
        let dialled = relay.paths();
        let idle = tokio::time::timeout(4 * quick().stall, session.next(false)).await;
        assert!(idle.is_err() && relay.paths() == dialled, "a session owing nothing was condemned for its silence");
        relay.slow_ms.store(10, Ordering::Relaxed);
        let start = Instant::now();
        session.ask(2).await.unwrap();
        let heard = tokio::time::timeout(Duration::from_secs(30), session.next(true)).await.expect("the slow frame never came").unwrap();
        assert!(matches!(heard, Heard::Event(Event::Frame { index: 2, .. })), "the slow frame's session was condemned");
        assert!(start.elapsed() > 2 * quick().stall, "the frame was not slower than the stall: {:?}", start.elapsed());
        assert_eq!(relay.paths(), dialled, "the session was re-dialled");
        std::fs::remove_dir_all(&dir).ok();
    }
}
