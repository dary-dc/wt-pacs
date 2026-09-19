//! Reading frame envelopes off whatever uni streams the server opens: the default stream mode
//! puts a whole fill on one of them, so a frame is the next envelope, not the next stream.

use anyhow::{bail, Context, Result};
use frame_envelope::unwrap;
use std::time::Duration;
use wtransport::stream::RecvStream;
use wtransport::Connection;

use crate::wire::MAX_FRAME_LEN;

pub struct Frames {
    pub connection: Connection,
    pub current: Option<RecvStream>,
}

impl Frames {
    pub async fn next(&mut self, timeout_ms: u64) -> Result<(u32, usize)> {
        loop {
            if self.current.is_none() {
                self.current = Some(
                    tokio::time::timeout(
                        Duration::from_millis(timeout_ms),
                        self.connection.accept_uni(),
                    )
                    .await
                    .map_err(|_| anyhow::anyhow!("no media stream within {timeout_ms} ms"))?
                    .context("accept uni")?,
                );
            }
            let uni = self.current.as_mut().expect("just set");
            let mut len = [0u8; 4];
            if !read_exact(uni, &mut len).await? {
                self.current = None;
                continue;
            }
            let n = u32::from_be_bytes(len) as usize;
            if n == 0 || n > MAX_FRAME_LEN {
                bail!("invalid frame length {n}");
            }
            let mut payload = vec![0u8; n];
            if !read_exact(uni, &mut payload).await? {
                bail!("stream ended mid-envelope");
            }
            let (index, body) = unwrap(&payload).map_err(|e| anyhow::anyhow!("envelope: {e}"))?;
            return Ok((index, body.len()));
        }
    }
}

/// `false` when the stream ended on an envelope boundary — the caller moves to the next uni.
async fn read_exact(recv: &mut RecvStream, buf: &mut [u8]) -> Result<bool> {
    let mut filled = 0;
    while filled < buf.len() {
        let n = recv.read(&mut buf[filled..]).await?.unwrap_or(0);
        if n == 0 {
            if filled != 0 {
                bail!("stream ended after {filled} bytes of an envelope");
            }
            return Ok(false);
        }
        filled += n;
    }
    Ok(true)
}
