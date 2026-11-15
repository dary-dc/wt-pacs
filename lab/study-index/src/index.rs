//! The index side of docs/adr/study-index.md §7: one transaction per study, applied only for a higher revision.

use mysql_async::prelude::Queryable;
use mysql_async::{Pool, TxOpts, Value};

/// A study's list-time fields as its study DB holds them, the unit the index replaces whole.
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub uid: String,
    pub host: String,
    pub revision: u64,
    pub deleted: bool,
    pub access_key: String,
    pub patient_name: String,
    pub patient_id: String,
    pub issuer: String,
    /// `YYYY-MM-DD`.
    pub birth_date: String,
    pub sex: String,
    /// `YYYY-MM-DD`.
    pub date: String,
    /// `HH:MM:SS`.
    pub time: String,
    pub accession: String,
    pub study_id: String,
    pub referring: String,
    pub description: String,
    pub series: Vec<SeriesRecord>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SeriesRecord {
    pub uid: String,
    pub modality: String,
    pub number: u32,
    pub description: String,
    pub instances: u32,
    pub frames: u32,
    pub codec: String,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Applied {
    Replaced,
    Deleted,
    /// The index already holds this revision or a higher one.
    Stale,
}

fn null_if_empty(s: &str) -> Value {
    if s.is_empty() {
        Value::NULL
    } else {
        s.into()
    }
}

/// READ COMMITTED on every connection: the study's row lock is the only lock a publish needs, no gap locks.
pub fn pool(url: &str) -> anyhow::Result<Pool> {
    let opts = mysql_async::Opts::from_url(url)?;
    let init = vec!["SET SESSION transaction_isolation = 'READ-COMMITTED'".to_string()];
    Ok(Pool::new(mysql_async::OptsBuilder::from_opts(opts).init(init)))
}

pub async fn apply(pool: &Pool, r: &Record) -> mysql_async::Result<Applied> {
    let mut c = pool.get_conn().await?;
    let mut tx = c.start_transaction(TxOpts::default()).await?;
    let stored: Option<u64> =
        tx.exec_first("SELECT revision FROM study WHERE study_uid = ? FOR UPDATE", (r.uid.as_str(),)).await?;
    if stored.is_some_and(|s| s >= r.revision) {
        tx.rollback().await?;
        return Ok(Applied::Stale);
    }
    tx.exec_drop("DELETE FROM series WHERE study_uid = ?", (r.uid.as_str(),)).await?;
    if r.deleted {
        tx.exec_drop("DELETE FROM study WHERE study_uid = ?", (r.uid.as_str(),)).await?;
        tx.commit().await?;
        return Ok(Applied::Deleted);
    }
    let mut mods: Vec<&str> = Vec::new();
    for s in &r.series {
        if !mods.contains(&s.modality.as_str()) {
            mods.push(&s.modality);
        }
    }
    let instances: u32 = r.series.iter().map(|s| s.instances).sum();
    let params: Vec<Value> = vec![
        r.uid.as_str().into(), r.host.as_str().into(), r.revision.into(), r.access_key.as_str().into(),
        r.patient_name.as_str().into(), r.patient_id.as_str().into(), r.issuer.as_str().into(),
        null_if_empty(&r.birth_date), null_if_empty(&r.sex), r.date.as_str().into(), r.time.as_str().into(),
        null_if_empty(&r.accession), null_if_empty(&r.study_id), null_if_empty(&r.referring),
        null_if_empty(&mods.join("\\")), null_if_empty(&r.description), (r.series.len() as u32).into(), instances.into(),
    ];
    tx.exec_drop(
        "INSERT INTO study (study_uid, host, revision, access_key, patient_name, patient_id, issuer_of_patient_id, \
         patient_birth_date, patient_sex, study_date, study_time, accession_number, study_id, \
         referring_physician_name, modalities_in_study, study_description, number_of_series, number_of_instances) \
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) AS new ON DUPLICATE KEY UPDATE host = new.host, \
         revision = new.revision, access_key = new.access_key, patient_name = new.patient_name, \
         patient_id = new.patient_id, issuer_of_patient_id = new.issuer_of_patient_id, \
         patient_birth_date = new.patient_birth_date, patient_sex = new.patient_sex, study_date = new.study_date, \
         study_time = new.study_time, accession_number = new.accession_number, study_id = new.study_id, \
         referring_physician_name = new.referring_physician_name, modalities_in_study = new.modalities_in_study, \
         study_description = new.study_description, number_of_series = new.number_of_series, \
         number_of_instances = new.number_of_instances",
        params,
    )
    .await?;
    if !r.series.is_empty() {
        let sql = format!(
            "INSERT INTO series (series_uid, study_uid, modality, series_number, series_description, \
             number_of_instances, number_of_frames, codec) VALUES {}",
            vec!["(?,?,?,?,?,?,?,?)"; r.series.len()].join(",")
        );
        let mut params: Vec<Value> = Vec::with_capacity(8 * r.series.len());
        for s in &r.series {
            params.extend([
                s.uid.as_str().into(), r.uid.as_str().into(), s.modality.as_str().into(), s.number.into(),
                null_if_empty(&s.description), s.instances.into(), s.frames.into(), s.codec.as_str().into(),
            ]);
        }
        tx.exec_drop(sql, params).await?;
    }
    tx.commit().await?;
    Ok(Applied::Replaced)
}

/// A study whose study DB is gone: its rows go whatever their revision, since no newer truth can exist.
pub async fn remove(pool: &Pool, uid: &str) -> mysql_async::Result<()> {
    let mut c = pool.get_conn().await?;
    let mut tx = c.start_transaction(TxOpts::default()).await?;
    tx.exec_drop("DELETE FROM series WHERE study_uid = ?", (uid,)).await?;
    tx.exec_drop("DELETE FROM study WHERE study_uid = ?", (uid,)).await?;
    tx.commit().await
}
