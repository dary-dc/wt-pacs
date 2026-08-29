# Task A — raw cell results
Evidence: T2 (local e2e against running exact-server + Chromium harness).
| cell | pass | mismatches |
| --- | --- | --- |
| `frames_250k_per-frame_ts` | True | 0 |
| `frames_250k_per-frame_wasm` | True | 0 |
| `frames_250k_shared_ts` | True | 0 |
| `frames_250k_shared_wasm` | True | 0 |
| `queue_large_per-frame_ts` | True | 0 |
| `queue_large_per-frame_wasm` | True | 0 |
| `queue_large_shared_ts` | True | 0 |
| `queue_large_shared_wasm` | True | 0 |

## Mismatches

(none)

## Console 404 resource (named)

On WASM harness load, Chromium console: `Failed to load resource: the server responded with a status of 404 (File not found)`.
CDP `Network.responseReceived`: **`http://127.0.0.1:8765/favicon.ico`** status 404.
Other harness resources (wasm js/wasm, `dev-transport.json`, `/harness/`) returned 200 in the same load.
