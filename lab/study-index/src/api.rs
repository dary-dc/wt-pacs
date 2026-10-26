//! The list API, shaped like QIDO-RS Search (PS3.18 §10.6): `/studies` and `/studies/{uid}/series`, PS3.18 JSON.

use crate::query::Search;
use axum::extract::{Path, RawQuery, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use mysql_async::prelude::Queryable;
use mysql_async::{Pool, Row, Value};
use serde_json::{json, Map, Value as Json};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

pub struct Api {
    pub pool: Pool,
    /// Bearer token → the access keys its holder may see.
    pub grants: HashMap<String, Vec<String>>,
    pub tuned: bool,
}

pub fn router(api: Arc<Api>) -> Router {
    Router::new()
        .route("/studies", get(studies))
        .route("/studies/{uid}/series", get(series))
        .route("/health", get(health))
        .with_state(api)
}

fn keys<'a>(api: &'a Api, headers: &HeaderMap) -> Option<&'a Vec<String>> {
    let token = headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ")?;
    api.grants.get(token)
}

fn attr(vr: &str, value: Option<String>) -> Json {
    match value.filter(|v| !v.is_empty()) {
        None => json!({ "vr": vr }),
        Some(v) if vr == "PN" => json!({ "vr": vr, "Value": [{ "Alphabetic": v }] }),
        Some(v) if vr == "IS" => json!({ "vr": vr, "Value": [v.parse::<i64>().unwrap_or(0)] }),
        Some(v) if vr == "CS" => json!({ "vr": vr, "Value": v.split('\\').collect::<Vec<_>>() }),
        Some(v) => json!({ "vr": vr, "Value": [v] }),
    }
}

fn text(row: &Row, i: usize) -> Option<String> {
    match row.as_ref(i)? {
        Value::NULL => None,
        Value::Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
        v => Some(v.as_sql(true).trim_matches('\'').to_string()),
    }
}

/// One study as PS3.18 JSON; `host` is this index's extra field, and the Retrieve URL is derived from it.
fn study_json(row: &Row) -> Json {
    let t = |i| text(row, i);
    let (uid, host) = (t(0).unwrap_or_default(), t(1).unwrap_or_default());
    let mut m = Map::new();
    for (tag, vr, v) in [
        ("0020000D", "UI", Some(uid.clone())),
        ("00100010", "PN", t(2)),
        ("00100020", "LO", t(3)),
        ("00100021", "LO", t(4)),
        ("00100030", "DA", t(5)),
        ("00100040", "CS", t(6)),
        ("00080020", "DA", t(7)),
        ("00080030", "TM", t(8)),
        ("00080050", "SH", t(9)),
        ("00200010", "SH", t(10)),
        ("00080090", "PN", t(11)),
        ("00080061", "CS", t(12)),
        ("00081030", "LO", t(13)),
        ("00201206", "IS", t(14)),
        ("00201208", "IS", t(15)),
        ("00081190", "UR", Some(format!("https://{host}/studies/{uid}"))),
    ] {
        m.insert(tag.to_string(), attr(vr, v));
    }
    m.insert("host".to_string(), json!(host));
    Json::Object(m)
}

fn series_json(row: &Row) -> Json {
    let t = |i| text(row, i);
    let mut m = Map::new();
    for (tag, vr, v) in [
        ("0020000E", "UI", t(0)),
        ("00080060", "CS", t(1)),
        ("00200011", "IS", t(2)),
        ("0008103E", "LO", t(3)),
        ("00201209", "IS", t(4)),
        ("00280008", "IS", t(5)),
    ] {
        m.insert(tag.to_string(), attr(vr, v));
    }
    m.insert("codec".to_string(), json!(t(6)));
    Json::Object(m)
}

/// `Server-Timing`: `db` from statement sent to last row read, `app` the handler whole, both in µs.
fn reply(start: Instant, db_us: u128, body: Vec<Json>) -> Response {
    let body = serde_json::to_vec(&body).expect("json");
    let app_us = start.elapsed().as_micros();
    let mut r = (StatusCode::OK, body).into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/dicom+json"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert("server-timing", HeaderValue::from_str(&format!("db;dur={db_us}, app;dur={app_us}")).expect("ascii"));
    r
}

/// Opens a pooled connection without touching the index's pages.
async fn health(State(api): State<Arc<Api>>) -> Response {
    match async { api.pool.get_conn().await?.query_drop("DO 1").await }.await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(e) => fail(StatusCode::SERVICE_UNAVAILABLE, e),
    }
}

fn fail(status: StatusCode, why: impl ToString) -> Response {
    (status, why.to_string()).into_response()
}

async fn studies(State(api): State<Arc<Api>>, headers: HeaderMap, RawQuery(q): RawQuery) -> Response {
    let start = Instant::now();
    let Some(keys) = keys(&api, &headers) else { return fail(StatusCode::UNAUTHORIZED, "no grant") };
    let search = match Search::parse(q.as_deref().unwrap_or("")) {
        Ok(s) => s,
        Err(e) => return fail(StatusCode::BAD_REQUEST, e),
    };
    let (sql, params) = search.sql(keys, api.tuned);
    let db = Instant::now();
    let rows: Result<Vec<Row>, _> = async { api.pool.get_conn().await?.exec(sql, params).await }.await;
    let db_us = db.elapsed().as_micros();
    match rows {
        Ok(rows) => reply(start, db_us, rows.iter().map(study_json).collect()),
        Err(e) => fail(StatusCode::SERVICE_UNAVAILABLE, e),
    }
}

async fn series(State(api): State<Arc<Api>>, headers: HeaderMap, Path(uid): Path<String>) -> Response {
    let start = Instant::now();
    let Some(keys) = keys(&api, &headers) else { return fail(StatusCode::UNAUTHORIZED, "no grant") };
    let sql = format!(
        "SELECT se.series_uid, se.modality, se.series_number, se.series_description, se.number_of_instances, \
         se.number_of_frames, se.codec FROM series se JOIN study st ON st.study_uid = se.study_uid \
         WHERE se.study_uid = ? AND st.access_key IN ({}) ORDER BY se.series_number",
        vec!["?"; keys.len()].join(",")
    );
    let mut params: Vec<Value> = vec![uid.into()];
    params.extend(keys.iter().map(|k| Value::from(k.as_str())));
    let db = Instant::now();
    let rows: Result<Vec<Row>, _> = async { api.pool.get_conn().await?.exec(sql, params).await }.await;
    let db_us = db.elapsed().as_micros();
    match rows {
        Ok(rows) => reply(start, db_us, rows.iter().map(series_json).collect()),
        Err(e) => fail(StatusCode::SERVICE_UNAVAILABLE, e),
    }
}
