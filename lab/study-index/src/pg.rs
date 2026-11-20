//! The index on PostgreSQL 18: `pg.sql`'s schema, the same transaction per study as `index.rs`.

use crate::engine::{null_if_empty, Rows, P};
use crate::index::{Applied, Record};
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use tokio_postgres::types::{ToSql, Type};
use tokio_postgres::NoTls;

pub const POOL_MAX: usize = 80;

pub fn pool(url: &str) -> anyhow::Result<Pool> {
    let config: tokio_postgres::Config = url.parse()?;
    let manager = Manager::from_config(config, NoTls, ManagerConfig { recycling_method: RecyclingMethod::Fast });
    Ok(Pool::builder(manager).max_size(POOL_MAX).build()?)
}

/// `?` → `$1, $2, …`; no statement here has a `?` inside a literal.
pub fn numbered(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len() + 16);
    let mut n = 0;
    for c in sql.chars() {
        if c == '?' {
            n += 1;
            out += &format!("${n}");
        } else {
            out.push(c);
        }
    }
    out
}

fn typed(params: &[P]) -> (Vec<Type>, Vec<Box<dyn ToSql + Sync + Send>>) {
    params
        .iter()
        .map(|p| -> (Type, Box<dyn ToSql + Sync + Send>) {
            match p {
                P::Text(s) => (Type::TEXT, Box::new(s.clone())),
                P::Null => (Type::TEXT, Box::new(None::<String>)),
                P::Int(v) => (Type::INT8, Box::new(*v)),
            }
        })
        .unzip()
}

fn text(row: &tokio_postgres::Row, i: usize) -> Option<String> {
    let t = row.columns()[i].type_();
    match *t {
        Type::INT2 => row.get::<_, Option<i16>>(i).map(|v| v.to_string()),
        Type::INT4 => row.get::<_, Option<i32>>(i).map(|v| v.to_string()),
        Type::INT8 => row.get::<_, Option<i64>>(i).map(|v| v.to_string()),
        Type::BOOL => row.get::<_, Option<bool>>(i).map(|v| v.to_string()),
        _ => row.get::<_, Option<String>>(i),
    }
}

async fn exec(c: &deadpool_postgres::ClientWrapper, sql: &str, params: &[P]) -> anyhow::Result<Vec<tokio_postgres::Row>> {
    let (types, values) = typed(params);
    let st = c.prepare_typed_cached(&numbered(sql), &types).await?;
    let refs: Vec<&(dyn ToSql + Sync)> = values.iter().map(|v| v.as_ref() as &(dyn ToSql + Sync)).collect();
    Ok(c.query(&st, &refs).await?)
}

pub async fn rows(pool: &Pool, sql: &str, params: &[P]) -> anyhow::Result<Rows> {
    let c = pool.get().await?;
    let rows = exec(&c, sql, params).await?;
    Ok(rows.iter().map(|r| (0..r.len()).map(|i| text(r, i)).collect()).collect())
}

const UPSERT: &str = "INSERT INTO study (study_uid, host, revision, access_key, patient_name, patient_id, \
    issuer_of_patient_id, patient_birth_date, patient_sex, study_date, study_time, accession_number, study_id, \
    referring_physician_name, modalities_in_study, study_description, number_of_series, number_of_instances) \
    VALUES (?,?,?,?,?,?,?,CAST(? AS date),?,CAST(? AS date),CAST(? AS time),?,?,?,?,?,?,?) \
    ON CONFLICT (study_uid) DO UPDATE SET host = EXCLUDED.host, revision = EXCLUDED.revision, \
    access_key = EXCLUDED.access_key, patient_name = EXCLUDED.patient_name, patient_id = EXCLUDED.patient_id, \
    issuer_of_patient_id = EXCLUDED.issuer_of_patient_id, patient_birth_date = EXCLUDED.patient_birth_date, \
    patient_sex = EXCLUDED.patient_sex, study_date = EXCLUDED.study_date, study_time = EXCLUDED.study_time, \
    accession_number = EXCLUDED.accession_number, study_id = EXCLUDED.study_id, \
    referring_physician_name = EXCLUDED.referring_physician_name, modalities_in_study = EXCLUDED.modalities_in_study, \
    study_description = EXCLUDED.study_description, number_of_series = EXCLUDED.number_of_series, \
    number_of_instances = EXCLUDED.number_of_instances, updated_at = now()";

/// The study row's parameters in `UPSERT`'s order, shared with SQLite's.
pub fn study_params(r: &Record) -> Vec<P> {
    let mut mods: Vec<&str> = Vec::new();
    for s in &r.series {
        if !mods.contains(&s.modality.as_str()) {
            mods.push(&s.modality);
        }
    }
    let instances: u64 = r.series.iter().map(|s| s.instances as u64).sum();
    vec![
        r.uid.as_str().into(), r.host.as_str().into(), r.revision.into(), r.access_key.as_str().into(),
        r.patient_name.as_str().into(), r.patient_id.as_str().into(), r.issuer.as_str().into(),
        null_if_empty(&r.birth_date), null_if_empty(&r.sex), r.date.as_str().into(), r.time.as_str().into(),
        null_if_empty(&r.accession), null_if_empty(&r.study_id), null_if_empty(&r.referring),
        null_if_empty(&mods.join("\\")), null_if_empty(&r.description), (r.series.len() as u64).into(), instances.into(),
    ]
}

pub fn series_insert(r: &Record) -> (String, Vec<P>) {
    let sql = format!(
        "INSERT INTO series (series_uid, study_uid, modality, series_number, series_description, \
         number_of_instances, number_of_frames, codec) VALUES {}",
        vec!["(?,?,?,?,?,?,?,?)"; r.series.len()].join(",")
    );
    let mut params = Vec::with_capacity(8 * r.series.len());
    for s in &r.series {
        params.extend([
            s.uid.as_str().into(), r.uid.as_str().into(), s.modality.as_str().into(), (s.number as u64).into(),
            null_if_empty(&s.description), (s.instances as u64).into(), (s.frames as u64).into(), s.codec.as_str().into(),
        ]);
    }
    (sql, params)
}

pub async fn apply(pool: &Pool, r: &Record) -> anyhow::Result<Applied> {
    let mut c = pool.get().await?;
    let tx = c.transaction().await?;
    let (types, values) = typed(&[r.uid.as_str().into()]);
    let lock = tx.prepare_typed_cached("SELECT revision FROM study WHERE study_uid = $1 FOR UPDATE", &types).await?;
    let refs: Vec<&(dyn ToSql + Sync)> = values.iter().map(|v| v.as_ref() as &(dyn ToSql + Sync)).collect();
    let stored: Option<i64> = tx.query_opt(&lock, &refs).await?.map(|row| row.get(0));
    if stored.is_some_and(|s| s as u64 >= r.revision) {
        tx.rollback().await?;
        return Ok(Applied::Stale);
    }
    let run = |sql: String, params: Vec<P>| {
        let tx = &tx;
        async move {
            let (types, values) = typed(&params);
            let st = tx.prepare_typed_cached(&numbered(&sql), &types).await?;
            let refs: Vec<&(dyn ToSql + Sync)> = values.iter().map(|v| v.as_ref() as &(dyn ToSql + Sync)).collect();
            tx.execute(&st, &refs).await
        }
    };
    run("DELETE FROM series WHERE study_uid = ?".into(), vec![r.uid.as_str().into()]).await?;
    if r.deleted {
        run("DELETE FROM study WHERE study_uid = ?".into(), vec![r.uid.as_str().into()]).await?;
        tx.commit().await?;
        return Ok(Applied::Deleted);
    }
    run(UPSERT.into(), study_params(r)).await?;
    if !r.series.is_empty() {
        let (sql, params) = series_insert(r);
        run(sql, params).await?;
    }
    tx.commit().await?;
    Ok(Applied::Replaced)
}

pub async fn remove(pool: &Pool, uid: &str) -> anyhow::Result<()> {
    let mut c = pool.get().await?;
    let tx = c.transaction().await?;
    tx.execute("DELETE FROM series WHERE study_uid = $1", &[&uid]).await?;
    tx.execute("DELETE FROM study WHERE study_uid = $1", &[&uid]).await?;
    Ok(tx.commit().await?)
}
