use clap::Parser;
use series_server::{run_server, ServeConfig};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "series-server")]
struct Args {
    #[command(flatten)]
    serve: ServeConfig,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("series_server=info".parse()?))
        .init();

    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls crypto provider already installed"))?;

    let server = run_server(Args::parse().serve);

    tokio::select! {
        result = server => result,
        () = shutdown_signal() => {
            tracing::info!("shutdown signal received");
            // Lab builds: write the telemetry report before the process goes away. The harvest
            // sends SIGTERM between runs; without this the drain thread dies with its rows.
            #[cfg(feature = "telemetry")]
            series_server::record::flush_on_exit();
            Ok(())
        }
    }
}

/// Resolves on SIGINT or SIGTERM.
async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = match signal(SignalKind::terminate()) {
        Ok(stream) => stream,
        Err(err) => {
            tracing::warn!(%err, "SIGTERM handler unavailable; SIGINT only");
            let _ = tokio::signal::ctrl_c().await;
            return;
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use series_server::{Congestion, TransportTuning};

    fn parse(flags: &[&str]) -> ServeConfig {
        Args::try_parse_from([&["series-server", "--series", "s.sbnd"], flags].concat()).expect("parses").serve
    }

    /// The restart after a silence is the default controller: it won every dropped blink and tied
    /// everywhere else. docs/transport/transport-conclusions.md §3.
    #[test]
    fn the_default_controller_is_cubic_restart() {
        assert_eq!(parse(&[]).tuning.congestion, Congestion::CubicRestart);
        assert_eq!(parse(&["--congestion", "cubic"]).tuning.congestion, Congestion::Cubic);
        assert_eq!(parse(&["--congestion", "bbr-bound"]).tuning.congestion, Congestion::BbrBound);
    }

    /// `cubic-classify` is the lab's: a build without `lab-classify` refuses the flag.
    #[cfg(not(feature = "lab-classify"))]
    #[test]
    fn the_default_build_has_no_cubic_classify() {
        assert!(Args::try_parse_from(["series-server", "--series", "s.sbnd", "--congestion", "cubic-classify"]).is_err());
    }

    /// Under `lab-classify` the flag names the lab's controller.
    #[cfg(feature = "lab-classify")]
    #[test]
    fn cubic_classify_parses_under_its_feature() {
        assert_eq!(parse(&["--congestion", "cubic-classify"]).tuning.congestion, Congestion::CubicClassify);
    }

    /// The opening ask is on unless turned off, and the bare flag the lab scripts pass still parses.
    #[test]
    fn the_opening_ask_is_on_by_default_with_a_way_off() {
        assert!(parse(&[]).opening_ask);
        assert!(parse(&["--opening-ask"]).opening_ask);
        assert!(!parse(&["--opening-ask", "false"]).opening_ask);
    }

    /// `TransportTuning::default()` is what the server runs with when no transport flag is given.
    #[test]
    fn no_transport_flag_parses_to_the_default_tuning() {
        assert_eq!(parse(&[]).tuning, TransportTuning::default());
        assert_eq!(parse(&[]).tuning.initial_window, None);
    }

    /// Every transport flag `lab/` passes still parses, under its old name, into its field.
    #[test]
    fn every_transport_flag_the_lab_passes_parses() {
        let flags = [
            "--send-window-bytes", "1",
            "--max-idle-timeout-ms", "2",
            "--keep-alive-interval-ms", "3",
            "--congestion", "bbr",
            "--initial-window-bytes", "4",
            "--initial-rtt-ms", "5",
            "--reply-repeated-initial",
            "--segmentation-offload", "false",
        ];
        let tuning = TransportTuning {
            send_window: Some(1),
            max_idle_timeout_ms: Some(2),
            keep_alive_interval_ms: Some(3),
            congestion: Congestion::Bbr,
            initial_window: Some(4),
            initial_rtt_ms: Some(5),
            reply_repeated_initial: true,
            segmentation_offload: false,
        };
        assert_eq!(parse(&flags).tuning, tuning);
    }
}
