| `cargo test -p fod -p frame-envelope -p series-bundle -p pack-series -p check-fastpath --quiet` | 19 passed, 0 failed, 0 ignored |
| `cargo test -p from-parser --quiet` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-classify --quiet -- classify` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-levers --quiet -- held stalled lab_lever` | 5 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features telemetry --quiet -- --nocapture` | 138 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --quiet -- --nocapture` | 135 passed, 0 failed, 0 ignored |
| `cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench -p cc-classify -p server-telemetry --quiet` | 68 passed, 0 failed, 0 ignored |
