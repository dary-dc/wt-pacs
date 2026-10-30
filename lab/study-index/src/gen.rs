//! A seeded synthetic index: no real identifiers. The distributions are README §Data.

use std::fmt::Write as _;

pub const SITES: usize = 20;
pub const HOSTS: [(&str, f64); 3] = [("pacs-1", 0.5), ("pacs-2", 0.3), ("pacs-3", 0.2)];
/// Days since 1970-01-01 of 2026-10-25, the newest study date.
pub const TODAY: i32 = 20_751;

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed)
    }
    /// SplitMix64.
    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    pub fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    pub fn range(&mut self, lo: u32, hi: u32) -> u32 {
        lo + (self.next() % (hi - lo + 1) as u64) as u32
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
    /// An index drawn with weight `1 / (i + 1)^s`.
    pub fn zipf(&mut self, n: usize, s: f64) -> usize {
        let total: f64 = (1..=n).map(|i| (i as f64).powf(-s)).sum();
        let mut x = self.unit() * total;
        for i in 0..n {
            x -= ((i + 1) as f64).powf(-s);
            if x <= 0.0 {
                return i;
            }
        }
        n - 1
    }
    pub fn weighted<'a, T>(&mut self, items: &'a [(T, f64)]) -> &'a T {
        let total: f64 = items.iter().map(|(_, w)| w).sum();
        let mut x = self.unit() * total;
        for (item, w) in items {
            x -= w;
            if x <= 0.0 {
                return item;
            }
        }
        &items[items.len() - 1].0
    }
}

const FAMILY: &[&str] = &[
    "García", "Rodríguez", "González", "Fernández", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Martín",
    "Jiménez", "Ruiz", "Hernández", "Díaz", "Moreno", "Muñoz", "Álvarez", "Romero", "Alonso", "Gutiérrez",
    "Navarro", "Torres", "Domínguez", "Vázquez", "Ramos", "Gil", "Ramírez", "Serrano", "Blanco", "Molina",
    "Morales", "Suárez", "Ortega", "Delgado", "Castro", "Ortiz", "Rubio", "Marín", "Sanz", "Núñez", "Iglesias",
    "Medina", "Garrido", "Cortés", "Castillo", "Santos", "Lozano", "Guerrero", "Cano", "Prieto", "Méndez",
    "Cruz", "Calvo", "Gallego", "Vidal", "León", "Márquez", "Herrera", "Peña", "Flores", "Cabrera", "Campos",
    "Vega", "Fuentes", "Carrasco", "Díez", "Caballero", "Reyes", "Nieto", "Aguilar", "Pascual", "Santana",
    "Herrero", "Lorenzo", "Montero", "Hidalgo", "Giménez", "Ibáñez", "Ferrer", "Durán", "Santiago", "Benítez",
    "Mora", "Vicente", "Vargas", "Arias", "Carmona", "Crespo", "Román", "Pastor", "Soto", "Sáez", "Velasco",
    "Moya", "Soler", "Parra", "Esteban", "Bravo", "Gallardo", "Rojas", "Pardo", "Merino", "Franco", "Espinosa",
    "Izquierdo", "Lara", "Rivas", "Silva", "Rivera", "Casado", "Arroyo", "Redondo", "Camacho", "Rey", "Vera",
    "Otero", "Luque", "Galán", "Montes", "Ríos", "Sierra", "Segura", "Carrillo", "Marcos", "Marti", "Soriano",
    "Mendoza", "Robles", "Bernal", "Vila", "Valero", "Palacios", "Pereira", "Benito", "Varela", "Andrés",
    "Hernando", "Bermúdez", "Gálvez", "Quintero", "Acosta", "Cuesta", "Calderón", "Toledo", "Beltrán", "Ávila",
];
const OTHER_FAMILY: &[&str] = &["Smith", "Müller", "Nguyen", "Kowalski", "O'Brien", "Rossi", "Dubois", "Chen"];
const GIVEN_F: &[&str] = &[
    "María", "Carmen", "Ana", "Isabel", "Laura", "Lucía", "Cristina", "Marta", "Elena", "Rosa", "Pilar",
    "Dolores", "Sofía", "Paula", "Raquel", "Mercedes", "Julia", "Beatriz", "Silvia", "Teresa", "Inés", "Ángela",
    "Yanet", "Yaimara", "Dayana", "Mónica", "Patricia", "Sandra", "Noemí", "Begoña",
];
const GIVEN_M: &[&str] = &[
    "José", "Antonio", "Manuel", "Francisco", "David", "Juan", "Javier", "Daniel", "Carlos", "Jesús",
    "Alejandro", "Miguel", "Rafael", "Pedro", "Pablo", "Ángel", "Sergio", "Fernando", "Jorge", "Luis",
    "Alberto", "Álvaro", "Adrián", "Raúl", "Ramón", "Andrés", "Joaquín", "Yoel", "Yasmany", "Rubén",
];

/// (modality, weight, series range, extra modalities that may join it, descriptions).
type ModalityRow = (&'static str, f64, (u32, u32), &'static [&'static str], &'static [&'static str]);
const MODALITIES: &[ModalityRow] = &[
    ("CR", 22.0, (1, 3), &[], &["RX TÓRAX PA", "RX TÓRAX PA Y LATERAL", "RX RODILLA AP Y LAT", "RX COLUMNA LUMBAR", "RX ABDOMEN SIMPLE"]),
    ("DX", 12.0, (1, 3), &[], &["RX TÓRAX PORTÁTIL", "RX MANO", "RX PELVIS", "RX HOMBRO"]),
    ("CT", 20.0, (3, 12), &["SR"], &["TAC CRÁNEO SIMPLE", "TAC TÓRAX CON CONTRASTE", "TAC ABDOMEN Y PELVIS", "ANGIO-TAC PULMONAR", "TAC COLUMNA CERVICAL"]),
    ("MR", 12.0, (5, 15), &[], &["RM CEREBRO", "RM RODILLA DERECHA", "RM COLUMNA LUMBAR", "RM HOMBRO IZQUIERDO", "RM PRÓSTATA MULTIPARAMÉTRICA"]),
    ("US", 15.0, (1, 4), &[], &["ECOGRAFÍA ABDOMINAL", "ECOGRAFÍA OBSTÉTRICA", "ECO DOPPLER CAROTÍDEO", "ECOCARDIOGRAMA"]),
    ("MG", 8.0, (4, 8), &[], &["MAMOGRAFÍA BILATERAL", "MAMOGRAFÍA DE CRIBADO", "TOMOSÍNTESIS MAMARIA"]),
    ("XA", 3.0, (1, 6), &[], &["CORONARIOGRAFÍA", "ARTERIOGRAFÍA MMII"]),
    ("NM", 2.0, (1, 4), &[], &["GAMMAGRAFÍA ÓSEA", "SPECT MIOCÁRDICO"]),
    ("PT", 2.0, (4, 8), &["CT"], &["PET-TC CUERPO ENTERO"]),
    ("RF", 2.0, (1, 5), &[], &["ESOFAGOGRAMA", "TRÁNSITO INTESTINAL"]),
    ("OT", 2.0, (1, 1), &[], &["DOCUMENTO ESCANEADO"]),
];

pub struct Series {
    pub uid: String,
    pub modality: &'static str,
    pub number: u32,
    pub description: String,
    pub instances: u32,
    pub frames: u32,
    pub codec: &'static str,
}

pub struct Study {
    pub uid: String,
    pub host: &'static str,
    pub revision: u64,
    pub access_key: String,
    pub patient_name: String,
    pub patient_id: String,
    pub issuer: String,
    pub birth_date: i32,
    pub sex: &'static str,
    /// Days since 1970-01-01.
    pub date: i32,
    /// Seconds since midnight.
    pub time: u32,
    pub accession: String,
    pub study_id: String,
    pub referring: String,
    pub description: String,
    pub series: Vec<Series>,
}

impl Study {
    pub fn modalities(&self) -> String {
        let mut mods: Vec<&str> = Vec::new();
        for s in &self.series {
            if !mods.contains(&s.modality) {
                mods.push(s.modality);
            }
        }
        mods.join("\\")
    }
    pub fn instances(&self) -> u32 {
        self.series.iter().map(|s| s.instances).sum()
    }
}

pub fn uid(rng: &mut Rng) -> String {
    let v = ((rng.next() as u128) << 64 | rng.next() as u128) >> 1;
    format!("2.25.{v}")
}

fn fold_accents(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' | 'Á' => 'A',
            'é' | 'É' => 'E',
            'í' | 'Í' => 'I',
            'ó' | 'Ó' => 'O',
            'ú' | 'Ú' | 'ü' | 'Ü' => 'U',
            'ñ' | 'Ñ' => 'N',
            c => c.to_ascii_uppercase(),
        })
        .collect()
}

/// The accented spelling of a name the generator wrote either way, word by word: `PEREZ` → `Pérez`.
pub fn accented(name: &str) -> String {
    let table = || FAMILY.iter().chain(OTHER_FAMILY).chain(GIVEN_F).chain(GIVEN_M);
    let word = |w: &str| table().find(|t| fold_accents(t) == fold_accents(w)).map_or(w.to_string(), |t| t.to_string());
    name.split('^')
        .map(|part| part.split(' ').map(word).collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("^")
}

/// A site writes names one way: `upper` is the ASCII capitals many modalities send, else mixed case with accents.
pub fn person_name(family: &[&str], given: &[&str], upper: bool) -> String {
    let n = format!("{}^{}", family.join(" "), given.join(" "));
    if upper {
        fold_accents(&n)
    } else {
        n
    }
}

fn person(rng: &mut Rng, female: bool, upper: bool) -> String {
    let fam = |rng: &mut Rng| if rng.unit() < 0.04 { *rng.pick(OTHER_FAMILY) } else { FAMILY[rng.zipf(FAMILY.len(), 0.9)] };
    let (f1, f2) = (fam(rng), fam(rng));
    let names = if female { GIVEN_F } else { GIVEN_M };
    let g1 = names[rng.zipf(names.len(), 0.8)];
    let given: Vec<&str> = if rng.unit() < 0.45 { vec![g1, names[rng.zipf(names.len(), 0.8)]] } else { vec![g1] };
    person_name(&[f1, f2], &given, upper)
}

/// Twelve years back, each year 0.82 of the next's volume, weekends at 0.35.
fn study_date(rng: &mut Rng) -> i32 {
    loop {
        let years: Vec<(i32, f64)> = (0..12).map(|y| (y, 0.82f64.powi(y))).collect();
        let y = *rng.weighted(&years);
        let d = TODAY - y * 365 - rng.below(365) as i32;
        let weekday = (d + 3).rem_euclid(7);
        if weekday < 5 || rng.unit() < 0.35 {
            return d;
        }
    }
}

fn study_time(rng: &mut Rng) -> u32 {
    let hour = if rng.unit() < 0.9 { rng.range(7, 19) } else { rng.range(0, 23) };
    hour * 3600 + rng.range(0, 3599)
}

fn series_for(rng: &mut Rng, row: &ModalityRow) -> Vec<Series> {
    let (modality, _, (lo, hi), extra, _) = *row;
    let mut out = Vec::new();
    let mut add = |rng: &mut Rng, modality: &'static str, desc: String| {
        let cine = matches!(modality, "US" | "XA" | "RF") && rng.unit() < 0.4;
        let (instances, frames) = match modality {
            "CT" | "MR" | "PT" => (rng.range(1, 2), rng.range(20, 600)),
            "US" | "XA" | "RF" if cine => (1, rng.range(30, 300)),
            "SR" | "KO" | "PR" | "OT" => (1, 1),
            _ => (1, 1),
        };
        let codec = if cine { "AV01" } else { "HTJ2" };
        let number = out.len() as u32 + 1;
        out.push(Series { uid: uid(rng), modality, number, description: desc, instances, frames, codec });
    };
    for i in 0..rng.range(lo, hi) {
        add(rng, modality, format!("{modality} serie {}", i + 1));
    }
    for m in extra {
        if *m == "SR" && rng.unit() > 0.7 {
            continue;
        }
        add(rng, m, format!("{m} complementaria"));
    }
    if rng.unit() < 0.1 {
        add(rng, "KO", "Imágenes clave".to_string());
    }
    out
}

/// `n` studies, deterministic in `seed`; patients have about 2.5 studies each, sites are Zipf-sized.
pub fn studies(n: usize, seed: u64) -> Vec<Study> {
    let mut rng = Rng::new(seed);
    let site_upper: Vec<bool> = (0..SITES).map(|_| rng.unit() < 0.6).collect();
    let mut out = Vec::with_capacity(n);
    let mut patient_seq = vec![0u32; SITES];
    let mut accession_seq = vec![0u32; SITES];
    let modality_weights: Vec<(usize, f64)> = MODALITIES.iter().enumerate().map(|(i, m)| (i, m.1)).collect();
    while out.len() < n {
        let site = rng.zipf(SITES, 1.0);
        let female = rng.unit() < 0.52;
        let name = person(&mut rng, female, site_upper[site]);
        patient_seq[site] += 1;
        let patient_id = format!("{:08}", 10_000_000 + patient_seq[site] * 7 + rng.range(0, 6));
        let age_days = (rng.range(0, 60) + rng.range(0, 40)) as i32 * 365 + rng.below(365) as i32;
        let host = *rng.weighted(&HOSTS);
        let count = 1 + (-(rng.unit().max(1e-12)).ln() * 1.5) as usize;
        for _ in 0..count.min(n - out.len()) {
            let row = &MODALITIES[*rng.weighted(&modality_weights)];
            let series = series_for(&mut rng, row);
            accession_seq[site] += 1;
            let accession = if rng.unit() < 0.03 { String::new() } else { format!("A{:02}{:08}", site + 1, accession_seq[site] * 13 % 100_000_000) };
            let date = study_date(&mut rng);
            let referring = if rng.unit() < 0.1 {
                String::new()
            } else {
                let female = rng.unit() < 0.5;
                person(&mut rng, female, site_upper[site])
            };
            out.push(Study {
                uid: uid(&mut rng),
                host,
                revision: if rng.unit() < 0.03 { rng.range(2, 3) as u64 } else { 1 },
                access_key: site_key(site),
                patient_name: name.clone(),
                patient_id: patient_id.clone(),
                issuer: format!("ISS-{:02}", site + 1),
                birth_date: TODAY - age_days,
                sex: if female { "F" } else { "M" },
                date,
                time: study_time(&mut rng),
                accession,
                study_id: rng.range(1, 9999).to_string(),
                referring,
                description: rng.pick(row.4).to_string(),
                series,
            });
        }
    }
    out
}

pub fn site_key(site: usize) -> String {
    format!("site-{:02}", site + 1)
}

/// Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
pub fn ymd(days: i32) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i32::from(m <= 2), m, d)
}

pub fn dicom_date(days: i32) -> String {
    let (y, m, d) = ymd(days);
    format!("{y:04}{m:02}{d:02}")
}

fn sql_date(days: i32) -> String {
    let (y, m, d) = ymd(days);
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn sql_time(secs: u32) -> String {
    format!("{:02}:{:02}:{:02}", secs / 3600, secs / 60 % 60, secs % 60)
}

fn tsv(s: &str) -> String {
    if s.is_empty() {
        "\\N".to_string()
    } else {
        s.replace('\\', "\\\\")
    }
}

/// One line per study and per series, in `schema.sql`'s column order, for `LOAD DATA`.
pub fn write_tsv(studies: &[Study], study_out: &mut String, series_out: &mut String) {
    for s in studies {
        let _ = writeln!(
            study_out,
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            s.uid, s.host, s.revision, s.access_key, s.patient_name, s.patient_id, s.issuer,
            sql_date(s.birth_date), s.sex, sql_date(s.date), sql_time(s.time), tsv(&s.accession), s.study_id,
            tsv(&s.referring), tsv(&s.modalities()), s.description, s.series.len(), s.instances()
        );
        for r in &s.series {
            let _ = writeln!(
                series_out,
                "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                r.uid, s.uid, r.modality, r.number, r.description, r.instances, r.frames, r.codec
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same seed gives the same index, and a different seed a different one.
    #[test]
    fn deterministic() {
        let a = studies(500, 7);
        let b = studies(500, 7);
        let c = studies(500, 8);
        assert!(a.iter().zip(&b).all(|(x, y)| x.uid == y.uid && x.patient_name == y.patient_name));
        assert_ne!(a[0].uid, c[0].uid);
    }

    /// Dates convert both ways at the known points, and every generated date is on or before TODAY.
    #[test]
    fn dates() {
        assert_eq!(dicom_date(0), "19700101");
        assert_eq!(dicom_date(TODAY), "20261025");
        assert!(studies(2000, 1).iter().all(|s| s.date <= TODAY && s.date > TODAY - 12 * 366));
    }

    /// Recent years outweigh old ones, and both name styles occur.
    #[test]
    fn distributions() {
        let s = studies(20_000, 3);
        let recent = s.iter().filter(|x| x.date > TODAY - 365).count();
        let old = s.iter().filter(|x| x.date <= TODAY - 10 * 365).count();
        assert!(recent > 3 * old, "{recent} vs {old}");
        assert!(s.iter().any(|x| x.patient_name.contains('é')));
        assert!(s.iter().any(|x| x.patient_name.chars().all(|c| !c.is_lowercase())));
    }
}
