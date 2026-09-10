//! Length-prefixed FoD read/write on WebTransport streams.

use anyhow::{Context, Result};
use fod::{decode_fod_body, encode_fod_msg, FodMsg};
use std::future::poll_fn;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context as TaskContext, Poll, Wake, Waker};
use tokio::io::{AsyncRead, ReadBuf};
use wtransport::stream::{RecvStream, SendStream};

/// Largest FoD message the server will read. Asks are small; a `RequestFrames` of 700 k
/// indices fits. Anything larger is a broken or hostile peer, not a study.
pub const MAX_FOD_LEN: usize = 4 * 1024 * 1024;

/// The wire-supplied length is checked before a single byte is allocated for it.
pub fn check_fod_len(len: usize) -> Result<()> {
    if len == 0 {
        anyhow::bail!("FoD message length 0");
    }
    if len > MAX_FOD_LEN {
        anyhow::bail!("FoD message length {len} exceeds {MAX_FOD_LEN}");
    }
    Ok(())
}

/// Partial bytes live here so a dropped poll is not a desync.
/// `docs/adr-frame-framing-and-loop-shape.md` §6d.
pub struct FodReader {
    recv: RecvStream,
    parse: FodParse,
}

impl FodReader {
    pub fn new(recv: RecvStream) -> Self {
        Self {
            recv,
            parse: FodParse::new(),
        }
    }

    pub async fn recv_msg(&mut self) -> Result<FodMsg> {
        poll_fn(|cx| self.poll_msg(cx)).await
    }

    pub fn try_recv_msg(&mut self) -> Option<Result<FodMsg>> {
        let waker = Waker::from(Arc::new(Noop));
        match self.poll_msg(&mut TaskContext::from_waker(&waker)) {
            Poll::Ready(r) => Some(r),
            Poll::Pending => None,
        }
    }

    fn poll_msg(&mut self, cx: &mut TaskContext<'_>) -> Poll<Result<FodMsg>> {
        loop {
            let n = {
                let dest = self.parse.dest();
                if dest.is_empty() {
                    return Poll::Ready(Err(anyhow::anyhow!("FoD parser dest is empty")));
                }
                let mut rb = ReadBuf::new(dest);
                match Pin::new(&mut self.recv).poll_read(cx, &mut rb) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Err(e)) => return Poll::Ready(Err(e.into())),
                    Poll::Ready(Ok(())) => {
                        let n = rb.filled().len();
                        if n == 0 {
                            return Poll::Ready(Err(anyhow::anyhow!(
                                "stream ended before {} bytes",
                                self.parse.needed()
                            )));
                        }
                        n
                    }
                }
            };
            match self.parse.took(n) {
                Ok(Some(msg)) => return Poll::Ready(Ok(msg)),
                Ok(None) => continue,
                Err(e) => return Poll::Ready(Err(e)),
            }
        }
    }
}

struct Noop;
impl Wake for Noop {
    fn wake(self: Arc<Self>) {}
}

struct FodParse {
    len_buf: [u8; 4],
    len_got: usize,
    body: Vec<u8>,
    body_got: usize,
}

impl FodParse {
    fn new() -> Self {
        Self {
            len_buf: [0; 4],
            len_got: 0,
            body: Vec::new(),
            body_got: 0,
        }
    }

    fn needed(&self) -> usize {
        if self.len_got < 4 {
            4 - self.len_got
        } else {
            self.body.len() - self.body_got
        }
    }

    fn dest(&mut self) -> &mut [u8] {
        if self.len_got < 4 {
            &mut self.len_buf[self.len_got..]
        } else {
            &mut self.body[self.body_got..]
        }
    }

    fn took(&mut self, n: usize) -> Result<Option<FodMsg>> {
        if self.len_got < 4 {
            self.len_got += n;
            if self.len_got < 4 {
                return Ok(None);
            }
            let len = u32::from_le_bytes(self.len_buf) as usize;
            check_fod_len(len)?;
            self.body.resize(len, 0);
            self.body_got = 0;
            return Ok(None);
        }
        self.body_got += n;
        if self.body_got < self.body.len() {
            return Ok(None);
        }
        let body = std::mem::take(&mut self.body);
        self.len_got = 0;
        self.body_got = 0;
        decode_fod_body(&body).map(Some)
    }

    fn push(&mut self, mut bytes: &[u8]) -> Result<Vec<FodMsg>> {
        let mut out = Vec::new();
        while !bytes.is_empty() {
            let n = {
                let dest = self.dest();
                let n = dest.len().min(bytes.len());
                dest[..n].copy_from_slice(&bytes[..n]);
                n
            };
            bytes = &bytes[n..];
            if let Some(msg) = self.took(n)? {
                out.push(msg);
            }
        }
        Ok(out)
    }
}

pub async fn write_fod_msg(send: &mut SendStream, msg: &FodMsg) -> Result<()> {
    let bytes = encode_fod_msg(msg)?;
    send.write_all(&bytes).await.context("write FoD")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fod_len_zero_and_huge_are_refused_before_allocation() {
        assert!(check_fod_len(0).is_err());
        assert!(check_fod_len(1).is_ok());
        assert!(check_fod_len(MAX_FOD_LEN).is_ok());
        assert!(check_fod_len(MAX_FOD_LEN + 1).is_err());
        assert!(
            check_fod_len(u32::MAX as usize).is_err(),
            "a 4 GB length prefix is refused"
        );
    }

    /// A dropped read mid-message keeps the bytes already taken — the reason the
    /// session task can poll this without a reader task. Mutate: reset `len_got`
    /// in `took` and the second push cannot finish the same prefix.
    #[test]
    fn a_partial_prefix_survives_so_a_dropped_poll_is_not_a_desync() {
        let msg = FodMsg::RequestFrame { frame: 7 };
        let enc = encode_fod_msg(&msg).unwrap();
        let mut parse = FodParse::new();
        assert!(
            parse.push(&enc[..2]).unwrap().is_empty(),
            "half a length prefix decoded a message"
        );
        assert_eq!(parse.len_got, 2, "partial prefix was discarded");
        let got = parse.push(&enc[2..]).unwrap();
        assert_eq!(
            got,
            vec![msg],
            "the rest of the bytes did not finish the ask"
        );
    }

    /// Two asks in one chunk both come out, so `try_recv` on a coalesced read
    /// supplies `upcoming` without a second hop.
    #[test]
    fn two_asks_in_one_chunk_are_both_returned() {
        let a = encode_fod_msg(&FodMsg::RequestFrame { frame: 1 }).unwrap();
        let b = encode_fod_msg(&FodMsg::RequestFrame { frame: 2 }).unwrap();
        let mut bytes = a;
        bytes.extend_from_slice(&b);
        let got = FodParse::new().push(&bytes).unwrap();
        assert_eq!(
            got,
            vec![
                FodMsg::RequestFrame { frame: 1 },
                FodMsg::RequestFrame { frame: 2 }
            ]
        );
    }
}
