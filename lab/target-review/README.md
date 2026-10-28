# target-review

Throwaway probes behind the independent design in [`docs/adr/frame-path.md`](../../docs/adr/frame-path.md)
§An independent design (2026-10-28). Each runs in this container's headless engines, so its numbers are
indicative only: a 4-core container with software GL is not a phone. A decisive measurement is one of the
design's protocol items, pre-registered there before any data.

| probe | claim it checks |
| --- | --- |
| `opfs/` | what a file per frame costs through `FileSystemSyncAccessHandle` from a dedicated worker and from a nested one: the two handle calls, a write and a read of one frame, three writers at once, a listing of 1 000 entries, `navigator.storage.estimate()` in a worker |
| `one-worker/` | one dedicated worker holding WebGL2 on a transferred canvas, OPFS sync handles, `requestAnimationFrame` and `WebTransport`; a step from disk (open, read, upload, draw) against a step from memory; frames painted while the page's thread is blocked |

Each folder's `README.md` says what ran, on which engine and version, and how to run it again.
