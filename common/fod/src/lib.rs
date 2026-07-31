//! FoD control messages on the WebTransport **bidirectional control stream**.
//!
//! Wire: LE u32 length + JSON body.
//! Media-complete: frame completion is one envelope payload on a server uni stream.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum FodMsg {
    RequestFrame { frame: u32 },
    RequestFrames { frames: Vec<u32> },
    RequestPath { from: u32, to: u32, stride: u32 },
    EndSession,
    FrameError {
        frame_index: u32,
        #[serde(default)]
