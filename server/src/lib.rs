pub mod media;
pub mod record;
pub mod transport;

pub use transport::{run_server, serve, Congestion, ServeConfig, StreamMode, TransportTuning};

#[cfg(test)]
mod tests {
    /// The Quinn GSO delta is `patches/quinn-0.11.11-mtu-gso.patch`: 65_527 / MTU, so 45 at 1452.
    #[test]
    fn quinn_gso_patch_derives_segments_from_mtu() {
        let p = include_str!("../../patches/quinn-0.11.11-mtu-gso.patch");
        assert!(
            p.contains(".min(max_transmit_segments(self.inner.current_mtu()))"),
            "drive_transmit must cap GSO from the MTU"
        );
        assert!(
            p.contains("65_527 / usize::from(mtu.max(1))"),
            "segments must be kernel GSO payload / MTU"
        );
        assert!(p.contains("const MAX_TRANSMIT_DATAGRAMS: usize = 64"));
        assert_eq!(65_527 / 1452, 45);
        assert_eq!(65_527 / 1472, 44);
    }
}
