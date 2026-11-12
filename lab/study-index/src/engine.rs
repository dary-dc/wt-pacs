//! The study index behind one interface, on MySQL (`index.rs`), PostgreSQL (`pg.rs`) or SQLite (`lite.rs`).

use crate::index::{self, Applied, Record};
use crate::{lite, pg};
use mysql_async::prelude::Queryable;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    My,
    Pg,
    Lite,
}

/// A statement parameter, typed as the three drivers need it.
#[derive(Clone, Debug)]
pub enum P {
    Text(String),
    Null,
    Int(i64),
}

impl From<&str> for P {
    fn from(s: &str) -> P {
        P::Text(s.to_string())
    }
}

impl From<u64> for P {
    fn from(v: u64) -> P {
        P::Int(v as i64)
    }
}

pub fn null_if_empty(s: &str) -> P {
    if s.is_empty() {
        P::Null
    } else {
        s.into()
    }
}

pub type Rows = Vec<Vec<Option<String>>>;

#[derive(Clone)]
pub enum Index {
    My(mysql_async::Pool),
    Pg(deadpool_postgres::Pool),
    Lite(Arc<lite::Lite>),
}

impl Index {
    /// `mysql://…`, `postgresql://…` or `sqlite:PATH`.
    pub fn open(url: &str) -> anyhow::Result<Index> {
        if url.starts_with("mysql:") {
            Ok(Index::My(index::pool(url)?))
        } else if url.starts_with("postgres") {
            Ok(Index::Pg(pg::pool(url)?))
        } else if let Some(path) = url.strip_prefix("sqlite:") {
            Ok(Index::Lite(Arc::new(lite::Lite::open(path)?)))
        } else {
            anyhow::bail!("unknown index url {url}")
        }
    }

    pub fn engine(&self) -> Engine {
        match self {
            Index::My(_) => Engine::My,
            Index::Pg(_) => Engine::Pg,
            Index::Lite(_) => Engine::Lite,
        }
    }

    pub async fn apply(&self, r: &Record) -> anyhow::Result<Applied> {
        match self {
            Index::My(p) => Ok(index::apply(p, r).await?),
            Index::Pg(p) => pg::apply(p, r).await,
            Index::Lite(l) => l.clone().write(r.clone()).await,
        }
    }

    pub async fn remove(&self, uid: &str) -> anyhow::Result<()> {
        match self {
            Index::My(p) => Ok(index::remove(p, uid).await?),
            Index::Pg(p) => pg::remove(p, uid).await,
            Index::Lite(l) => l.clone().remove(uid.to_string()).await,
        }
    }

    /// Every row as text; `?` placeholders, numbered here for PostgreSQL.
    pub async fn rows(&self, sql: String, params: Vec<P>) -> anyhow::Result<Rows> {
        match self {
            Index::My(p) => {
                let params: Vec<mysql_async::Value> = params.into_iter().map(my_value).collect();
                let rows: Vec<mysql_async::Row> = p.get_conn().await?.exec(sql, params).await?;
                Ok(rows.iter().map(|r| (0..r.len()).map(|i| my_text(r, i)).collect()).collect())
            }
            Index::Pg(p) => pg::rows(p, &sql, &params).await,
            Index::Lite(l) => l.clone().rows(sql, params).await,
        }
    }

    /// A connection opened and a trivial statement run, without touching the index's pages.
    pub async fn ping(&self) -> anyhow::Result<()> {
        self.rows("SELECT 1".to_string(), Vec::new()).await.map(drop)
    }

    pub async fn clear_host(&self, host: &str) -> anyhow::Result<()> {
        let series = match self.engine() {
            Engine::My => "DELETE se FROM series se JOIN study st USING (study_uid) WHERE st.host = ?",
            _ => "DELETE FROM series WHERE study_uid IN (SELECT study_uid FROM study WHERE host = ?)",
        };
        self.rows(series.to_string(), vec![host.into()]).await?;
        self.rows("DELETE FROM study WHERE host = ?".to_string(), vec![host.into()]).await?;
        Ok(())
    }

    pub async fn revisions(&self, host: &str) -> anyhow::Result<Vec<(String, u64)>> {
        let rows = self.rows("SELECT study_uid, revision FROM study WHERE host = ?".to_string(), vec![host.into()]).await?;
        Ok(rows.into_iter().map(|r| (r[0].clone().unwrap_or_default(), num(&r[1]))).collect())
    }
}

pub fn num(v: &Option<String>) -> u64 {
    v.as_deref().and_then(|v| v.parse().ok()).unwrap_or(0)
}

fn my_value(p: P) -> mysql_async::Value {
    match p {
        P::Text(s) => s.into(),
        P::Null => mysql_async::Value::NULL,
        P::Int(v) => v.into(),
    }
}

fn my_text(row: &mysql_async::Row, i: usize) -> Option<String> {
    use mysql_async::Value;
    match row.as_ref(i)? {
        Value::NULL => None,
        Value::Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
        v => Some(v.as_sql(true).trim_matches('\'').to_string()),
    }
}
