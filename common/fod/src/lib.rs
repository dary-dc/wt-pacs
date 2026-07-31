//! FoD control messages on the WebTransport **bidirectional control stream**.
//!
//! Wire: LE u32 length + JSON body.
//! Media-complete: frame completion is one envelope payload on a server uni stream.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
