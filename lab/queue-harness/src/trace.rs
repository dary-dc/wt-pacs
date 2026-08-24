use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct TraceSpec {
    pub name: String,
    pub max_step: u32,
    #[serde(default = "default_interval")]
    pub step_interval_ms: u64,
    #[serde(default)]
    pub burst_count: u32,
    #[serde(default = "default_modulo")]
    pub frame_modulo: u32,
    #[serde(default)]
    pub steps: Vec<TraceStep>,
    pub settle_on: SettleOn,
    #[serde(default = "default_true")]
    pub send_cancel_on_settle: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TraceStep {
    pub frame: u32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettleOn {
    LastAsked,
}

fn default_interval() -> u64 {
    16
}

fn default_modulo() -> u32 {
    3
}

fn default_true() -> bool {
    true
}

impl TraceSpec {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let text = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&text)?)
    }

    pub fn frame_schedule(&self) -> Vec<u32> {
        if !self.steps.is_empty() {
            return self.steps.iter().map(|s| s.frame).collect();
        }
        (0..self.burst_count)
            .map(|i| i % self.frame_modulo)
            .collect()
    }
}
