# Client transports

| Path | Role |
|------|------|
| `client/transport-wasm/` | Rust WASM via `web_sys::WebTransport` |
| `client/transport-ts/` | TypeScript / browser ESM (`session.ts` + `wire.ts`; `build.sh` → gitignored `dist/`) |

Same Media-complete wire as the server: FoD on one bidi control stream, envelope payloads on server uni streams.

Neither client keeps an ask window: `requestExactFrame` is one ask, and depth is whatever the
caller leaves outstanding. Fill is `startStreamFrames` (one `StreamFrames`). The window ADR is
[`adr-client-window-depth.md`](adr-client-window-depth.md); open work is
[`transport/why-these-changes.md` §10](transport/why-these-changes.md#10--latency-and-throughput-on-one-tree-where-they-part-and-what-joins-them).
