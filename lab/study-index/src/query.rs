//! A QIDO-RS Search query string, as SQL for the index and as a filter over the generator's studies.

use crate::gen::{dicom_date, Study};
use crate::engine::{Engine, P};
use crate::lite::{pn_glob, pn_key};

pub const MAX_LIMIT: u64 = 200;

#[derive(Debug, Default, Clone)]
pub struct Search {
    pub patient_name: Option<String>,
    pub patient_id: Option<String>,
    pub issuer: Option<String>,
    pub accession: Option<String>,
    pub study_uid: Option<String>,
    /// Inclusive `YYYYMMDD` bounds; either may be open.
    pub date: Option<(Option<String>, Option<String>)>,
    pub modality: Option<String>,
    pub limit: u64,
    pub offset: u64,
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(b) => {
                        out.push(b);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'*' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

impl Search {
    pub fn parse(query: &str) -> Result<Search, String> {
        let mut s = Search { limit: 50, ..Default::default() };
        for pair in query.split('&').filter(|p| !p.is_empty()) {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            let v = decode(v);
            let v = || Some(v.clone()).filter(|v| !v.is_empty());
            match k {
                "PatientName" | "00100010" => s.patient_name = v(),
                "PatientID" | "00100020" => s.patient_id = v(),
                "IssuerOfPatientID" | "00100021" => s.issuer = v(),
                "AccessionNumber" | "00080050" => s.accession = v(),
                "StudyInstanceUID" | "0020000D" => s.study_uid = v(),
                "ModalitiesInStudy" | "00080061" => s.modality = v(),
                "StudyDate" | "00080020" => {
                    let raw = v().ok_or("empty StudyDate")?;
                    let ok = |d: &str| d.len() == 8 && d.bytes().all(|b| b.is_ascii_digit());
                    let (a, b) = raw.split_once('-').unwrap_or((&raw, &raw));
                    if !(a.is_empty() || ok(a)) || !(b.is_empty() || ok(b)) {
                        return Err(format!("bad StudyDate {raw}"));
                    }
                    let some = |d: &str| Some(d.to_string()).filter(|d| !d.is_empty());
                    s.date = Some((some(a), some(b)));
                }
                "limit" => s.limit = v().and_then(|v| v.parse().ok()).ok_or("bad limit")?,
                "offset" => s.offset = v().and_then(|v| v.parse().ok()).ok_or("bad offset")?,
                "includefield" | "fuzzymatching" => {}
                _ => return Err(format!("unsupported key {k}")),
            }
        }
        s.limit = s.limit.min(MAX_LIMIT);
        Ok(s)
    }

    pub fn to_query(&self) -> String {
        let mut q = Vec::new();
        let mut add = |k: &str, v: &Option<String>| {
            if let Some(v) = v {
                q.push(format!("{k}={}", encode(v)));
            }
        };
        add("PatientName", &self.patient_name);
        add("PatientID", &self.patient_id);
        add("IssuerOfPatientID", &self.issuer);
        add("AccessionNumber", &self.accession);
        add("StudyInstanceUID", &self.study_uid);
        add("ModalitiesInStudy", &self.modality);
        if let Some((a, b)) = &self.date {
            q.push(format!("StudyDate={}-{}", a.as_deref().unwrap_or(""), b.as_deref().unwrap_or("")));
        }
        q.push(format!("limit={}&offset={}", self.limit, self.offset));
        q.join("&")
    }

    /// The statement and its parameters; `keys` are the caller's access keys, never the client's. `tuned` is
    /// README §Arms' shape: the page's UIDs from the covering index first, then only their rows.
    pub fn sql(&self, keys: &[String], tuned: bool, engine: Engine) -> (String, Vec<P>) {
        let all = match engine {
            Engine::My => STUDY_COLUMNS,
            Engine::Pg => PG_STUDY_COLUMNS,
            Engine::Lite => LITE_STUDY_COLUMNS,
        };
        let columns = if tuned { "st.study_uid, st.study_date, st.study_time" } else { all };
        let mut sql = format!("SELECT {columns} FROM study st WHERE st.access_key IN ({})", vec!["?"; keys.len()].join(","));
        let mut params: Vec<P> = keys.iter().map(|k| k.as_str().into()).collect();
        if let Some(name) = &self.patient_name {
            name_filter(engine, name, &mut sql, &mut params);
        }
        for (column, v) in [
            ("patient_id", &self.patient_id),
            ("issuer_of_patient_id", &self.issuer),
            ("accession_number", &self.accession),
            ("study_uid", &self.study_uid),
        ] {
            if let Some(v) = v {
                sql += &format!(" AND st.{column} = ?");
                params.push(v.as_str().into());
            }
        }
        if let Some((a, b)) = &self.date {
            let bound = if engine == Engine::Pg { "CAST(? AS date)" } else { "?" };
            if let Some(a) = a {
                sql += &format!(" AND st.study_date >= {bound}");
                params.push(a.as_str().into());
            }
            if let Some(b) = b {
                sql += &format!(" AND st.study_date <= {bound}");
                params.push(b.as_str().into());
            }
        }
        if let Some(m) = &self.modality {
            sql += match (tuned, engine) {
                (false, _) => " AND EXISTS (SELECT 1 FROM series se WHERE se.study_uid = st.study_uid AND se.modality = ?)",
                (true, Engine::My) => " AND FIND_IN_SET(?, REPLACE(st.modalities_in_study, '\\\\', ','))",
                (true, Engine::Pg) => " AND ? = ANY (string_to_array(st.modalities_in_study, '\\'))",
                (true, Engine::Lite) => " AND instr('\\' || st.modalities_in_study || '\\', '\\' || ? || '\\') > 0",
            };
            params.push(m.as_str().into());
        }
        let order = " ORDER BY st.study_date DESC, st.study_time DESC, st.study_uid DESC";
        sql += order;
        sql += " LIMIT ? OFFSET ?";
        params.push(self.limit.into());
        params.push(self.offset.into());
        if tuned {
            sql = format!("SELECT {all} FROM study st JOIN ({sql}) page USING (study_uid){order}");
        }
        (sql, params)
    }

    /// The same match, by brute force over the generator's studies, for the checks.
    pub fn matches(&self, s: &Study, keys: &[String]) -> bool {
        let eq = |want: &Option<String>, have: &str| want.as_ref().is_none_or(|w| w == have);
        keys.contains(&s.access_key)
            && self.patient_name.as_ref().is_none_or(|p| pn_match(p, &s.patient_name))
            && eq(&self.patient_id, &s.patient_id)
            && eq(&self.issuer, &s.issuer)
            && eq(&self.accession, &s.accession)
            && eq(&self.study_uid, &s.uid)
            && self.date.as_ref().is_none_or(|(a, b)| {
                let d = dicom_date(s.date);
                a.as_ref().is_none_or(|a| &d >= a) && b.as_ref().is_none_or(|b| &d <= b)
            })
            && self.modality.as_ref().is_none_or(|m| s.series.iter().any(|r| r.modality == m))
    }
}

pub const STUDY_COLUMNS: &str = "st.study_uid, st.host, st.patient_name, st.patient_id, st.issuer_of_patient_id, \
    DATE_FORMAT(st.patient_birth_date, '%Y%m%d'), st.patient_sex, DATE_FORMAT(st.study_date, '%Y%m%d'), \
    TIME_FORMAT(st.study_time, '%H%i%s'), st.accession_number, st.study_id, st.referring_physician_name, \
    st.modalities_in_study, st.study_description, st.number_of_series, st.number_of_instances";

pub const PG_STUDY_COLUMNS: &str = "st.study_uid, st.host, st.patient_name, st.patient_id, st.issuer_of_patient_id, \
    to_char(st.patient_birth_date, 'YYYYMMDD'), st.patient_sex, to_char(st.study_date, 'YYYYMMDD'), \
    to_char(st.study_time, 'HH24MISS'), st.accession_number, st.study_id, st.referring_physician_name, \
    st.modalities_in_study, st.study_description, st.number_of_series, st.number_of_instances";

pub const LITE_STUDY_COLUMNS: &str = "st.study_uid, st.host, st.patient_name, st.patient_id, st.issuer_of_patient_id, \
    st.patient_birth_date, st.patient_sex, st.study_date, st.study_time, st.accession_number, st.study_id, \
    st.referring_physician_name, st.modalities_in_study, st.study_description, st.number_of_series, \
    st.number_of_instances";

/// MySQL compares under the column's `_ai_ci` collation; the others compare the folded `name_key`, a wild-card
/// pattern by its literal prefix as an index range, so that a generic plan keeps the range. PostgreSQL folds the
/// pattern once in a sub-select, not once per row.
fn name_filter(engine: Engine, name: &str, sql: &mut String, params: &mut Vec<P>) {
    let wild = name.contains(['*', '?']);
    match engine {
        Engine::My if wild => {
            *sql += " AND st.patient_name LIKE ?";
            params.push(like_pattern(name).as_str().into());
        }
        Engine::My => {
            *sql += " AND st.patient_name = ?";
            params.push(name.into());
        }
        Engine::Pg if wild => {
            let literal: String = name.chars().take_while(|c| !matches!(c, '*' | '?')).collect();
            if !literal.is_empty() {
                *sql += " AND st.name_key >= pn_fold(?) AND st.name_key < pn_fold(?) || chr(1114111)";
                params.extend([literal.as_str().into(), literal.as_str().into()]);
            }
            *sql += " AND st.name_key LIKE (SELECT pn_fold(?))";
            params.push(like_pattern(name).as_str().into());
        }
        Engine::Pg => {
            *sql += " AND st.name_key = pn_fold(?)";
            params.push(name.into());
        }
        Engine::Lite if wild => {
            let (literal, glob) = pn_glob(name);
            if !literal.is_empty() {
                *sql += " AND st.name_key >= ? AND st.name_key < ?";
                params.extend([literal.as_str().into(), format!("{literal}\u{10FFFF}").as_str().into()]);
            }
            *sql += " AND st.name_key GLOB ?";
            params.push(glob.as_str().into());
        }
        Engine::Lite => {
            *sql += " AND st.name_key = ?";
            params.push(pn_key(name).as_str().into());
        }
    }
}

/// PS3.4 §C.2.2.2.4 wild cards as `LIKE`: `*` any run, `?` one character; `%`, `_` and `\` literal.
pub fn like_pattern(pn: &str) -> String {
    pn.chars()
        .map(|c| match c {
            '*' => "%".to_string(),
            '?' => "_".to_string(),
            '%' | '_' | '\\' => format!("\\{c}"),
            c => c.to_string(),
        })
        .collect()
}

/// Case- and accent-insensitive, as `utf8mb4_0900_ai_ci` compares the letters the generator writes.
pub fn fold(s: &str) -> String {
    s.chars()
        .flat_map(|c| {
            let base = match c {
                'á' | 'à' | 'Á' | 'À' => 'a',
                'é' | 'É' => 'e',
                'í' | 'Í' => 'i',
                'ó' | 'Ó' => 'o',
                'ú' | 'ü' | 'Ú' | 'Ü' => 'u',
                'ñ' | 'Ñ' => 'n',
                c => c,
            };
            base.to_lowercase()
        })
        .collect()
}

fn pn_match(pattern: &str, name: &str) -> bool {
    fn go(p: &[char], n: &[char]) -> bool {
        match p.split_first() {
            None => n.is_empty(),
            Some(('*', rest)) => (0..=n.len()).any(|i| go(rest, &n[i..])),
            Some(('?', rest)) => !n.is_empty() && go(rest, &n[1..]),
            Some((c, rest)) => n.first() == Some(c) && go(rest, &n[1..]),
        }
    }
    let p: Vec<char> = fold(pattern).chars().collect();
    let n: Vec<char> = fold(name).chars().collect();
    go(&p, &n)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A name prefix matches across case and accents, and only as a prefix.
    #[test]
    fn person_name_matching() {
        assert!(pn_match("PÉREZ GARCÍA^J*", "Perez Garcia^Juan"));
        assert!(pn_match("PÉREZ*", "Perez Garcia^Juan"));
        assert!(pn_match("perez*", "PÉREZ GARCÍA^JUAN"));
        assert!(pn_match("PEÑA^ANA", "Pena^Ana"));
        assert!(pn_match("Peña^Ana", "PENA^ANA"));
        assert!(!pn_match("PÉREZ^J*", "Lopez Perez^Juan"));
        assert!(!pn_match("PÉREZ^J", "Perez^Juan"));
    }

    /// Wild cards become LIKE's, and LIKE's own metacharacters are escaped.
    #[test]
    fn like() {
        assert_eq!(like_pattern("O'B?I*"), "O'B_I%");
        assert_eq!(like_pattern("50%_\\*"), "50\\%\\_\\\\%");
    }

    /// A query string survives a round trip, percent-encoded names and ranges included.
    #[test]
    fn round_trip() {
        let s = Search::parse("PatientName=P%C3%89REZ%5EJ*&StudyDate=20260101-20260107&ModalitiesInStudy=CT&limit=50&offset=1000").unwrap();
        assert_eq!(s.patient_name.as_deref(), Some("PÉREZ^J*"));
        assert_eq!(s.date, Some((Some("20260101".into()), Some("20260107".into()))));
        let again = Search::parse(&s.to_query()).unwrap();
        assert_eq!(again.patient_name, s.patient_name);
        assert_eq!((again.limit, again.offset), (50, 1000));
        assert!(Search::parse("Unknown=1").is_err());
        assert!(Search::parse("StudyDate=2026").is_err());
    }
}
