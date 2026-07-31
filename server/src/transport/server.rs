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
