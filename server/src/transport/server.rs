//! FoD ask → envelope on server uni stream (Media-complete).

use crate::media::frame_store::FrameStore;
use crate::transport::tls::load_pem_cert;
use crate::transport::wire::{read_fod_msg, write_fod_msg};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::wrap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};
use wtransport::{Endpoint, Identity, ServerConfig};

pub struct ServeConfig {
    pub wt_port: u16,
    pub study_path: PathBuf,
    pub cert_pem: PathBuf,
    pub key_pem: PathBuf,
}

pub async fn run_server(config: ServeConfig) -> Result<()> {
    let cert_pem = std::fs::read_to_string(&config.cert_pem)
        .with_context(|| format!("read {}", config.cert_pem.display()))?;
    let key_pem = std::fs::read_to_string(&config.key_pem)
        .with_context(|| format!("read {}", config.key_pem.display()))?;
    let cert = load_pem_cert(&cert_pem, &key_pem)?;

    let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
        .await
        .context("load wtransport identity")?;
