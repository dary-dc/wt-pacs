| `cargo test -p fod -p frame-envelope -p series-bundle -p pack-series -p check-fastpath --quiet` | 20 passed, 0 failed, 0 ignored |
| `cargo test -p from-parser --quiet` | 11 passed, 0 failed, 0 ignored |
| `cargo test -p native-client --features decode --quiet -- decode:: view::` | 11 passed, 0 failed, 0 ignored |
| `cargo test -p native-client --quiet` | 16 passed, 0 failed, 1 ignored |
| `cargo test -p series-server --features lab-classify --quiet -- classify` | 2 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features lab-levers --quiet -- held stalled lab_lever` | 5 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --features telemetry --quiet -- --nocapture` | 137 passed, 0 failed, 0 ignored |
| `cargo test -p series-server --quiet -- --nocapture` | 134 passed, 0 failed, 0 ignored |
| `cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench -p cc-classify -p server-telemetry --quiet` | 68 passed, 0 failed, 0 ignored |
| `env VK_ICD_FILENAMES="$lvp" cargo test -p native-client --features paint --lib --quiet paint::` | 2 passed, 0 failed, 0 ignored |
