# Client transports

| Path | Role |
|------|------|
| `client/transport-wasm/` | Rust WASM via `web_sys::WebTransport` |
| `client/transport-ts/` | TypeScript / browser ESM (`session.ts` + `wire.ts`; `build.sh` → gitignored `dist/`) |

Same Media-complete wire as the server: FoD on one bidi control stream, envelope payloads on server uni streams.

The TypeScript client keeps an optional ask window (2026-09-14): `connect(url, hash,
{ window: { depth: 4 } })` holds `requestExactFrame` to a fixed depth in ask order, and
`{ depth: "auto", initial: 2 }` re-derives the depth from the link every eight frames —
`D = ceil(0.95 × (1 + RTT / Tf))`, RTT from the browser's `getStats().smoothedRtt`, `Tf` the median
time between arrivals, or from asks sent into an idle window where the browser has no `getStats`
(Chromium 141 has none; two are needed, so a reader that never pauses holds `initial`). Without a window,
`requestExactFrame` is one ask and depth is whatever the caller leaves outstanding, which is
still the WASM client's only shape. Fill is `startStreamFrames` (one `StreamFrames`). The window
ADR is [`adr-client-window-depth.md`](adr-client-window-depth.md); which depth ships is L2's
question ([`lanes/L2-ask-policy.md`](lanes/L2-ask-policy.md)); the rest of the open work is
[`transport/NEXT.md`](transport/NEXT.md).
