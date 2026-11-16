| `cargo test -p carrier --features quic --quiet` | 18 passed, 0 failed, 0 ignored |
| `cargo test -p carrier --quiet` | 17 passed, 0 failed, 0 ignored |
| `cargo test -p fod -p frame-envelope -p from-disk -p series-bundle -p study-db -p pack-series -p check-fastpath -p pacs-verify --quiet` | 42 passed, 0 failed, 0 ignored |
| `cargo test -p from-parser --quiet` | 11 passed, 0 failed, 0 ignored |
| `cargo test -p native-client --features decode --quiet -- decode:: view::` | 11 passed, 0 failed, 0 ignored |
| `cargo test -p native-client --quiet` | 16 passed, 0 failed, 1 ignored |
| `cargo test -p pacs-receiver --quiet -- --nocapture` | 49 passed, 0 failed, 0 ignored |
| `cargo test -p sender --quiet` | 11 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-classify --quiet -- classify` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-levers --quiet -- held stalled lab_lever` | 5 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features telemetry --quiet -- --nocapture` | 164 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --quiet -- --nocapture` | 161 passed, 0 failed, 0 ignored |
| `cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench -p cc-classify -p server-telemetry -p metadata-store --quiet` | 77 passed, 0 failed, 0 ignored |
| `env VK_ICD_FILENAMES="$lvp" cargo test -p native-client --features paint --lib --quiet paint::` | 2 passed, 0 failed, 0 ignored |
