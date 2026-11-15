use pacs_receiver::Receiver;
use std::path::Path;
use std::process::ExitCode;

/// Recovers, then takes every package in `incoming/` once: docs/adr/pacs-receiver.md §3.
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [root, incoming] = &args[..] else {
        eprintln!("usage: pacs-receiver <root> <incoming>");
        return ExitCode::from(2);
    };
    match Receiver::open(Path::new(root), Path::new(incoming)).and_then(|r| r.run()) {
        Ok(received) => {
            for (name, outcome) in received {
                println!("{name} {outcome}");
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("pacs-receiver: {e:#}");
            ExitCode::FAILURE
        }
    }
}
