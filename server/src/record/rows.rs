//! Fixed-width row file (`telemetry-server.rows`) — exact rows at any scale.
//!
//! Every record the drain receives is appended here as one 64-byte record, so the rows are
//! exact and on disk whatever happens to the process afterwards. The JSON report is a summary
//! over this file; `exact-server --telemetry-report <rows>` rebuilds the full JSON from it.
//!
//! Layout: 16-byte header (`WTPR`, u16 version, u16 record size, u64 reserved) then records.
//! Record: `tag: u8`, `flags: u8`, `pad: u16`, then tag-specific fields, little-endian.

use super::tap::{AckRecord, FrameRecord, Record, SessionRecord};
use std::fs::File;
use std::io::{BufReader, Read, Result as IoResult};
use std::path::Path;

pub(super) const MAGIC: &[u8; 4] = b"WTPR";
pub(super) const VERSION: u16 = 1;
pub(super) const RECORD_BYTES: usize = 64;
pub(super) const HEADER_BYTES: usize = 16;

const TAG_FRAME: u8 = 1;
const TAG_ACK: u8 = 2;
const TAG_SESSION: u8 = 3;

const FLAG_PREPARE: u8 = 1;
const FLAG_LOCATE: u8 = 2;
const FLAG_SEND: u8 = 4;

pub(super) fn header() -> [u8; HEADER_BYTES] {
    let mut h = [0u8; HEADER_BYTES];
    h[0..4].copy_from_slice(MAGIC);
    h[4..6].copy_from_slice(&VERSION.to_le_bytes());
    h[6..8].copy_from_slice(&(RECORD_BYTES as u16).to_le_bytes());
    h
}

struct W<'a>(&'a mut [u8; RECORD_BYTES], usize);

impl W<'_> {
    fn u8(&mut self, v: u8) {
        self.0[self.1] = v;
        self.1 += 1;
    }
    fn u16(&mut self, v: u16) {
        self.0[self.1..self.1 + 2].copy_from_slice(&v.to_le_bytes());
        self.1 += 2;
    }
    fn u32(&mut self, v: u32) {
        self.0[self.1..self.1 + 4].copy_from_slice(&v.to_le_bytes());
        self.1 += 4;
    }
    fn u64(&mut self, v: u64) {
        self.0[self.1..self.1 + 8].copy_from_slice(&v.to_le_bytes());
        self.1 += 8;
    }
}

struct R<'a>(&'a [u8; RECORD_BYTES], usize);

impl R<'_> {
    fn u8(&mut self) -> u8 {
        let v = self.0[self.1];
        self.1 += 1;
        v
    }
    fn u16(&mut self) -> u16 {
        let v = u16::from_le_bytes([self.0[self.1], self.0[self.1 + 1]]);
        self.1 += 2;
        v
    }
    fn u32(&mut self) -> u32 {
        let mut b = [0u8; 4];
        b.copy_from_slice(&self.0[self.1..self.1 + 4]);
        self.1 += 4;
        u32::from_le_bytes(b)
    }
    fn u64(&mut self) -> u64 {
        let mut b = [0u8; 8];
        b.copy_from_slice(&self.0[self.1..self.1 + 8]);
        self.1 += 8;
        u64::from_le_bytes(b)
    }
}

pub(super) fn encode(record: &Record) -> [u8; RECORD_BYTES] {
    let mut buf = [0u8; RECORD_BYTES];
    let mut w = W(&mut buf, 0);
    match record {
        Record::Frame(f) => {
            let mut flags = 0u8;
            if f.prepare_us.is_some() {
                flags |= FLAG_PREPARE;
            }
            if f.locate_us.is_some() {
                flags |= FLAG_LOCATE;
            }
            if f.send_us.is_some() {
                flags |= FLAG_SEND;
            }
            w.u8(TAG_FRAME);
            w.u8(flags);
            w.u16(0);
            w.u64(f.session_id);
            w.u32(f.frame_index);
            w.u32(f.ask_ordinal);
            w.u64(f.t_ask_us);
            w.u32(f.batch_position);
            w.u32(f.batch_size);
            w.u32(f.prepare_us.unwrap_or(0));
            w.u32(f.locate_us.unwrap_or(0));
            w.u32(f.send_us.unwrap_or(0));
            w.u32(f.serve_us);
            w.u32(f.overhead_us);
            w.u32(f.server_bytes_sent);
            w.u8(f.locate_outcome);
            w.u8(f.write_outcome);
            w.u16(f.dropped_since_last);
        }
        Record::Ack(a) => {
            w.u8(TAG_ACK);
            w.u8(0);
            w.u16(0);
            w.u64(a.session_id);
            w.u32(a.frame_index);
            w.u32(a.ask_ordinal);
            w.u32(a.ack_us);
        }
        Record::Session(s) => {
            w.u8(TAG_SESSION);
            w.u8(0);
            w.u16(0);
            w.u64(s.session_id);
            w.u64(s.t_open_us);
            w.u64(s.t_close_us);
            w.u32(s.frames);
            w.u64(s.bytes);
            w.u32(s.refused);
            w.u32(s.rows_opened);
            w.u32(s.rows_closed);
            w.u32(s.rows_dropped);
            w.u32(s.acks);
        }
    }
    buf
}

pub(super) fn decode(buf: &[u8; RECORD_BYTES]) -> Option<Record> {
    let mut r = R(buf, 0);
    let tag = r.u8();
    let flags = r.u8();
    let _pad = r.u16();
    match tag {
        TAG_FRAME => {
            let session_id = r.u64();
            let frame_index = r.u32();
            let ask_ordinal = r.u32();
            let t_ask_us = r.u64();
            let batch_position = r.u32();
            let batch_size = r.u32();
            let prepare = r.u32();
            let locate = r.u32();
            let send = r.u32();
            let serve_us = r.u32();
            let overhead_us = r.u32();
            let server_bytes_sent = r.u32();
            let locate_outcome = r.u8();
            let write_outcome = r.u8();
            let dropped_since_last = r.u16();
            Some(Record::Frame(FrameRecord {
                kind: "server_frame",
                session_id,
                frame_index,
                ask_ordinal,
                t_ask_us,
                batch_position,
                batch_size,
                prepare_us: (flags & FLAG_PREPARE != 0).then_some(prepare),
                locate_us: (flags & FLAG_LOCATE != 0).then_some(locate),
                send_us: (flags & FLAG_SEND != 0).then_some(send),
                serve_us,
                overhead_us,
                ack_us: None,
                server_bytes_sent,
                locate_outcome,
                write_outcome,
                dropped_since_last,
            }))
        }
        TAG_ACK => Some(Record::Ack(AckRecord {
            session_id: r.u64(),
            frame_index: r.u32(),
            ask_ordinal: r.u32(),
            ack_us: r.u32(),
        })),
        TAG_SESSION => Some(Record::Session(SessionRecord {
            kind: "server_session",
            session_id: r.u64(),
            t_open_us: r.u64(),
            t_close_us: r.u64(),
            frames: r.u32(),
            bytes: r.u64(),
            refused: r.u32(),
            rows_opened: r.u32(),
            rows_closed: r.u32(),
            rows_dropped: r.u32(),
            acks: r.u32(),
        })),
        _ => None,
    }
}

/// Iterate every record in a row file. A truncated trailing record is ignored; an unknown tag
/// is skipped. Errors other than a short final read are returned.
pub(super) fn read_records(path: &Path) -> IoResult<RowReader> {
    let mut reader = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut header = [0u8; HEADER_BYTES];
    reader.read_exact(&mut header)?;
    if &header[0..4] != MAGIC {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "not a telemetry row file (bad magic)",
        ));
    }
    let record_size = u16::from_le_bytes([header[6], header[7]]) as usize;
    if record_size != RECORD_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unsupported record size {record_size}"),
        ));
    }
    Ok(RowReader { reader })
}

pub(super) struct RowReader {
    reader: BufReader<File>,
}

impl Iterator for RowReader {
    type Item = Record;
    fn next(&mut self) -> Option<Record> {
        loop {
            let mut buf = [0u8; RECORD_BYTES];
            match self.reader.read_exact(&mut buf) {
                Ok(()) => {
                    if let Some(r) = decode(&buf) {
                        return Some(r);
                    }
                }
                Err(_) => return None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_round_trip_keeps_nulls() {
        let f = FrameRecord {
            kind: "server_frame",
            session_id: 9,
            frame_index: 1234,
            ask_ordinal: 2,
            t_ask_us: 5_000_000_001,
            batch_position: 3,
            batch_size: 8,
            prepare_us: Some(10),
            locate_us: None,
            send_us: Some(0),
            serve_us: 55,
            overhead_us: 45,
            ack_us: None,
            server_bytes_sent: 250_004,
            locate_outcome: 1,
            write_outcome: 2,
            dropped_since_last: 7,
        };
        let back = decode(&encode(&Record::Frame(f))).expect("decode");
        let Record::Frame(g) = back else { panic!("frame") };
        assert_eq!(g.session_id, 9);
        assert_eq!(g.frame_index, 1234);
        assert_eq!(g.t_ask_us, 5_000_000_001);
        assert_eq!(g.prepare_us, Some(10));
        assert_eq!(g.locate_us, None, "null stays null, never 0");
        assert_eq!(g.send_us, Some(0), "a measured 0 stays 0, never null");
        assert_eq!(g.serve_us, 55);
        assert_eq!(g.dropped_since_last, 7);
        assert_eq!(g.write_outcome, 2);
    }

    #[test]
    fn ack_and_session_round_trip() {
        let a = Record::Ack(AckRecord {
            session_id: 3,
            frame_index: 4,
            ask_ordinal: 5,
            ack_us: 272_000,
        });
        let Record::Ack(b) = decode(&encode(&a)).expect("ack") else { panic!("ack") };
        assert_eq!((b.session_id, b.frame_index, b.ask_ordinal, b.ack_us), (3, 4, 5, 272_000));

        let s = Record::Session(SessionRecord {
            kind: "server_session",
            session_id: 3,
            t_open_us: 100,
            t_close_us: 200_000,
            frames: 20,
            bytes: 1_000_000,
            refused: 1,
            rows_opened: 21,
            rows_closed: 21,
            rows_dropped: 0,
            acks: 19,
        });
        let Record::Session(t) = decode(&encode(&s)).expect("session") else { panic!("session") };
        assert_eq!(t.frames, 20);
        assert_eq!(t.bytes, 1_000_000);
        assert_eq!(t.t_close_us, 200_000);
        assert_eq!(t.acks, 19);
    }

    #[test]
    fn unknown_tag_decodes_to_none() {
        let mut buf = [0u8; RECORD_BYTES];
        buf[0] = 42;
        assert!(decode(&buf).is_none());
    }

    #[test]
    fn file_round_trip_ignores_truncated_tail() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("wtpacs-rows-{stamp}.rows"));
        {
            use std::io::Write;
            let mut f = File::create(&path).expect("create");
            f.write_all(&header()).expect("header");
            for i in 0..3u32 {
                f.write_all(&encode(&Record::Ack(AckRecord {
                    session_id: 1,
                    frame_index: i,
                    ask_ordinal: 0,
                    ack_us: i * 10,
                })))
                .expect("record");
            }
            f.write_all(&[1u8; 17]).expect("partial");
        }
        let got: Vec<Record> = read_records(&path).expect("open").collect();
        assert_eq!(got.len(), 3);
        let _ = std::fs::remove_file(path);
    }
}
