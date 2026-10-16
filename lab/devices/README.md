# The device kit (row DEVICEKIT)

What a device evening needs, so it is setup-free: [`../../docs/devices.md`](../../docs/devices.md) is the plan and
owns every reading; [`evening.md`](evening.md) is the owner's checklist, taps in order.

```text
local machine ──deploy.sh up──▶ Oracle machine
                                 ├─ collector.py, TCP $COLLECT_PORT (8443), the certificate of PUBLIC_NAME
                                 │    /?t=TOKEN → the runner page · /kit.json · /bundles/*.sbnd · POST /collect
                                 └─ wt-pacs-server ×4, D2's arms (arms.json), UDP 4435 4436 4438 4439
phone ── https://PUBLIC_NAME:8443/?t=TOKEN ── the runner page, D0 → D1 → D2, rows in IndexedDB, posted each round
```

| file | what |
| --- | --- |
| `index.html`, `runner.js` | the runner page: link class and mode taps, D0–D2, every row kept in IndexedDB as it lands, posted after every round, a save button |
| `plan.mjs` | the arms, the Williams schedule (`../order.mjs`), quick and full mode, the paired reading shown on the phone |
| `caps.js` | D0: WebTransport and a dial to each arm, isolation, SIMD128, nested module workers, the client's WebCodecs probe per layout, `measureUserAgentSpecificMemory`, the device line, the clock's step |
| `decode-worker.js` | D1: one arm decodes a set's frames already in memory, each frame timed and checked against the store's XXH3-64 |
| `visit.js` | D2: a fill with an ask for its last frame at half (row 180's shape), then a fresh ask-only session (row 181's), decoding off |
| `sbnd.js` | a bundle read whole in the page |
| `collector.py` | the host: the page and the client's code, the bundles, each arm's transport file and printed settings, the rows; all behind `DEVICES_TOKEN` |
| `arms.json` | D2's four arms: name, UDP port, the server's flags |
| `deploy.sh` | `up`, `fetch DIR`, `down` on the Oracle machine, from the local machine |
| `make_bundles.sh` | each set as `SET.htj2k.sbnd` and `SET.av1.sbnd` through `ingest/coded-frames/ingest.py` |
| `dry_run.mjs` | the page through a deployed kit in headless Chromium, quick mode: exits 0 when every visit is exact |

**Quick and full.** Quick is 3 rounds of D1 on `dbt10_ea1141` alone (the largest frames, all three decoders) and
D2's `shared`, `asksfirst` and `iw38400`; the reading prints on the phone as soon as each run ends, marked
provisional. Full is 10 rounds, D1's three sets and D2's four arms (`iw12000` is today's default again: an A/A pair
for the spread). A reading is the median of in-round ratios against the reference arm with their range and n; a pair
either of whose visits is not exact, or failed, is void and dropped (*strict*); the rows keep everything for the
round-paired reading ([`../../docs/av1/queue.md`](../../docs/av1/queue.md) §Protocol).

**Exactness.** D1 checks every decoded frame against the bundle's digests, which ingest took from the encoder's
input. D2 decodes nothing while timed: before its rounds it decodes the whole bundle as fetched and stops unless
every frame is exact, then compares every frame a visit receives with the bundle's bytes. `?mutate` flips a sample
in every D1 frame, so every D1 visit must read not exact.

**Certificates.** The page needs a certificate the phone trusts: `TLS_DIR`'s, for `PUBLIC_NAME`. The arms mint
their own and pin it by hash, unless `SUPPLY_CERT=1` hands them the same certificate; then the transport file
carries no hash and the client dials unpinned (`client/transport/ts/session.ts`). D0 says which a browser needs.
The WASM session (`client/transport/wasm`) always pins; the kit uses the default TypeScript one.

**Nothing identifying is committed** ([`../../docs/devices.md`](../../docs/devices.md) §4): the host, the name, the
token and the certificate come from the environment; `deploy.sh fetch` replaces the host's names in the rows and
fails if one is left.

**Tested in the container** (row DEVICEKIT): `plan.test.mjs`, `collector_test.py` and `deploy/server_start_test.sh` in
the gate, each failing under its mutations; the whole loop — `deploy.sh up` over SSH to the container itself, the
image, the four arms, the collector over TLS, `dry_run.mjs` in quick mode, `fetch`, `down` — as
[`../../docs/devices.md`](../../docs/devices.md) §6 records. Not tested: a phone, the Oracle machine, its security
list, WebKit, Firefox.
