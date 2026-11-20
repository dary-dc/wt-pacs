//! The list queries of docs/adr/study-index.md §11 against the API, arms interleaved; and their brute-force check.

use crate::gen::{accented, dicom_date, Rng, Study};
use crate::query::{encode, fold, Search};
use serde_json::Value as Json;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Instant;

/// The fixed mix; every one but `series` also at `offset=1000`.
pub const CELLS: [&str; 8] =
    ["newest", "name_accented", "name_plain", "name_family", "patient_id", "accession", "date7_modality", "series"];

pub struct Reply {
    pub status: u16,
    pub client_us: u64,
    pub db_us: u64,
    pub app_us: u64,
    pub body: Vec<u8>,
}

/// HTTP/1.1 on one kept-alive connection; the API answers with a `Content-Length`.
pub struct Client {
    addr: String,
    token: String,
    reader: BufReader<TcpStream>,
}

impl Client {
    pub fn connect(addr: &str, token: &str) -> std::io::Result<Client> {
        let s = TcpStream::connect(addr)?;
        s.set_nodelay(true)?;
        Ok(Client { addr: addr.to_string(), token: token.to_string(), reader: BufReader::new(s) })
    }

    pub fn get(&mut self, path: &str) -> std::io::Result<Reply> {
        let start = Instant::now();
        let req = format!("GET {path} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\n\r\n", self.addr, self.token);
        self.reader.get_mut().write_all(req.as_bytes())?;
        let mut line = String::new();
        self.reader.read_line(&mut line)?;
        let status = line.split(' ').nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        let (mut length, mut db_us, mut app_us) = (0usize, 0, 0);
        loop {
            line.clear();
            self.reader.read_line(&mut line)?;
            let l = line.trim_end();
            if l.is_empty() {
                break;
            }
            let (k, v) = l.split_once(':').unwrap_or((l, ""));
            match k.to_ascii_lowercase().as_str() {
                "content-length" => length = v.trim().parse().unwrap_or(0),
                "server-timing" => {
                    for part in v.split(',') {
                        let dur = part.split("dur=").nth(1).and_then(|d| d.trim().parse().ok()).unwrap_or(0);
                        if part.trim().starts_with("db") {
                            db_us = dur;
                        } else if part.trim().starts_with("app") {
                            app_us = dur;
                        }
                    }
                }
                _ => {}
            }
        }
        let mut body = vec![0; length];
        self.reader.read_exact(&mut body)?;
        Ok(Reply { status, client_us: start.elapsed().as_micros() as u64, db_us, app_us, body })
    }
}

/// The studies a token sees, for drawing each request's parameters.
pub struct Samples<'a> {
    pub visible: Vec<&'a Study>,
}

impl<'a> Samples<'a> {
    pub fn new(all: &'a [Study], key: &str) -> Self {
        Samples { visible: all.iter().filter(|s| s.access_key == key).collect() }
    }

    /// The search for `cell` at `offset`, or for `series` the study whose series to list.
    pub fn draw(&self, cell: &str, offset: u64, rng: &mut Rng) -> (Search, &'a Study) {
        let s = self.visible[rng.below(self.visible.len())];
        let mut q = Search { limit: 50, offset, ..Default::default() };
        let (family, given) = s.patient_name.split_once('^').unwrap_or((&s.patient_name, ""));
        let initial: String = given.chars().take(1).collect();
        match cell {
            "newest" | "series" => {}
            "name_accented" => q.patient_name = Some(accented(&format!("{family}^{initial}*"))),
            "name_plain" => q.patient_name = Some(fold(&format!("{family}^{initial}*"))),
            "name_family" => q.patient_name = Some(format!("{}*", accented(family.split(' ').next().unwrap_or("")))),
            "patient_id" => q.patient_id = Some(s.patient_id.clone()),
            "accession" => {
                q.accession = Some(s.accession.clone()).filter(|a| !a.is_empty()).or(Some("A0000000000".into()))
            }
            "date7_modality" => {
                q.date = Some((Some(dicom_date(s.date)), Some(dicom_date(s.date + 6))));
                q.modality = Some(s.series[0].modality.to_string());
            }
            _ => panic!("unknown cell {cell}"),
        }
        (q, s)
    }
}

pub fn path(cell: &str, q: &Search, s: &Study) -> String {
    if cell == "series" {
        format!("/studies/{}/series", encode(&s.uid))
    } else {
        format!("/studies?{}", q.to_query())
    }
}

pub fn uids(body: &[u8], tag: &str) -> Vec<String> {
    let rows: Vec<Json> = serde_json::from_slice(body).unwrap_or_default();
    rows.iter().filter_map(|r| r[tag]["Value"][0].as_str().map(str::to_string)).collect()
}

/// What the index must return, by brute force: matches ordered newest first, then paged.
pub fn expected(all: &[&Study], cell: &str, q: &Search, s: &Study, keys: &[String]) -> Vec<String> {
    if cell == "series" {
        let mut series: Vec<_> = s.series.iter().collect();
        series.sort_by_key(|r| r.number);
        return series.iter().map(|r| r.uid.clone()).collect();
    }
    let mut hits: Vec<&&Study> = all.iter().filter(|x| q.matches(x, keys)).collect();
    hits.sort_by(|a, b| (b.date, b.time, &b.uid).cmp(&(a.date, a.time, &a.uid)));
    hits.iter().skip(q.offset as usize).take(q.limit as usize).map(|x| x.uid.clone()).collect()
}
