# Real devices: what the lab cannot settle, and the runs that settle it

*Queue row 190, DEVICEPLAN, 2026-10-14. A plan: nothing here was run. Each run below becomes its own `local` row,
measured by a session given only that run's protocol and rule ([`av1/queue.md`](av1/queue.md) §Protocol, *theory
first*).*

**The question.** What is the smallest set of real-device runs that settles what the container could not?

**The answer, short.** Five runs, in this order, the first two in one evening:

| # | run | settles | where | evening |
| --- | --- | --- | --- | --- |
| D0 | **capability page** — what the phone's browsers actually offer | WebKit's "not checked" cells ([`CLIENTS.md`](CLIENTS.md) §WebKit), which decoder a phone gets | phone → Oracle, any link | 1 (15 min) |
| D1 | **decode and paint on the phone** — HTJ2K, dav1d-WASM, WebCodecs, frames already in memory | [`rig-limits.md`](rig-limits.md) §7 for decode; whether the 4× cgroup stand-in predicts a phone (rows 9, 44, 182) | phone, no network in the timed part | 1 (45 min) |
| D2 | **fill and ask on the phone's own links** — today against asks-first and the 38 400-byte window, Wi-Fi and cellular as they come | rows 180 and 181 on a real receive path and a real queue; the first view of the trade the target conditions decide | phone → Oracle | 1 (1–1.5 h) |
| D3 | **the controlled grid** — rate, RTT, loss random and bursty, one stream against several | row 193's cells on the phone's receive path, where the relay and the container saturated (rows 171, 174, 180, 181) | phone → local machine over Wi-Fi, `netem` on the local machine | 2 |
| D4 | **open and the repeated Initial** — row 189's four arms, swallowed first flight and the field | rows 187 and 189 on a phone's stack and a carrier's NAT | phone → relay on the local machine → Oracle; then the field | 3 |
| D5 | **memory and energy** — a worker per decoder at the largest frames, a long fill unplugged | row 38's 31.6 MB against what a phone kills a tab by; energy per series, Android only | phone, `adb` from the local machine | 3 |

D0–D2 give a view in one evening: what the phone runs, how much slower it decodes than the container's 4×, and
whether rows 180 and 181 hold on a real link. D3–D5 need the rig of §3 and the relay of §4.

---

## 1. The devices

| device | what it is | role |
| --- | --- | --- |
| **the phone** | *asked of the owner, written here before D0:* model, SoC, RAM, OS and version, each browser and version, carrier and plan (data cap) | the client |
| **the local machine** | the workstation of [`rig-limits.md`](rig-limits.md) (8 cores, Linux, root) unless the owner says otherwise | D3's server and shaper, D4's relay, `adb` host, D2's desktop control client |
| **the Oracle machine** | *asked of the owner:* whether it is §9's cloud rig (2 vCPU EPYC 7551, burstable, 954 MB, Ubuntu 24.04) | the server on the public internet (D0, D1's page, D2, D4) |

A phone with Android and Chrome is the fuller rig: `adb` reads memory and the battery's charge counter, and `adb
reverse` gives the page a secure origin over USB. An iPhone runs D0–D4 from the page alone; D5 needs Xcode on a Mac
(Instruments), else it is skipped and says so. Both, if the owner has both, double D0–D2 and nothing else.

## 2. What each run decides

Every timed run interleaves its arms in a Williams order ([`../lab/order.mjs`](../lab/order.mjs)), n ≥ 10 rounds,
reports the median ratio of paired visits with its spread, prints each arm's full settings, and checks every frame
against the encoder-input digest the store carries (the viewer's `exact`). A visit that is not exact voids its pair. A
run that voids more than its bar reports *strict* and *round-paired* (§Protocol). The rules below are stated now; a
run's own row may only tighten them.

### D0 — capability

**Records**, per browser: `WebTransport` present; a dial with `serverCertificateHashes` to the Oracle server (`ready`
or the error); `crossOriginIsolated` and `SharedArrayBuffer`; WASM SIMD128; nested module workers; `VideoDecoder`
and the per-layout exact probe the client already runs (`client/decode/av1-probe.js`); `measureUserAgentSpecificMemory`;
`navigator.deviceMemory`, `hardwareConcurrency`, `connection` (Chrome only); the Battery API; `performance.now()`'s
step. **Decides:** which decoder each phone browser gets (the client's own choice, [`../client/README.md`](../client/README.md)
§Which decoder), and whether the Oracle server needs a CA-signed certificate for WebKit (hashes refused → yes). Fills
[`CLIENTS.md`](CLIENTS.md) §WebKit's "not checked" cells in place, measured on the named device.

### D1 — decode and paint

**Arms:** OpenJPH (the shipped package), dav1d-WASM (the product's build), WebCodecs where D0's probe found it exact.
**Content:** sound sets only ([`FIXTURES.md`](FIXTURES.md) §Provenance): `rf_fluoro` (12-bit, WebCodecs refuses),
`mr_ispy1`, `dbt10_ea1141` (10-bit, all three arms; the largest frames), each in the layout rows 44 and 182 chose for
it. **How:** the page fetches every arm's frames first, then decodes them in a worker, one arm a turn in Williams
order, 10 rounds; per frame, decode time and exactness; then paint (2D and WebGL, [`../lab/paint-floor/README.md`](../lab/paint-floor/README.md))
at the phone's own device-pixel ratio. The phone is plugged in, screen on (a Wake Lock), and the page records battery
temperature where it can and the decode time of round 1 against round 10 (thermal drift).
**Decides:**
* *the stand-in*: if the phone's AV1-to-HTJ2K decode ratio per series lies inside the container's 1×–4× range (rows 9,
  44), the verdicts that rest on the 4× arm (rows 23, 44, 182) carry to this phone; if it lies outside, they are
  re-derived with the phone's ratio and say so;
* *the turn*: the phone's decode rate per series against D2's measured link rate places it on row 182's map (wire-bound
  or decode-bound), which is what decides HTJ2K against AV1 per series on that phone.

### D2 — the field: the phone's own links

**Arms**, four servers on the Oracle machine, one port each, the same binary: `shared` (today), `per-frame-asks-first`
(row 180), `--initial-window-bytes 12000` (quinn's, row 191's default), `--initial-window-bytes 38400` (row 181). Every
arm prints its settings; they differ in the lever alone (the port aside). **Content:** `dbt10_ea1141`, row 180's
volume, HTJ2K; one visit is a fill with an ask during it (row 180's shape) followed by a fresh ask on a new session
(row 181's shape). **Links**, as they come and each recorded, never chosen for the result: home Wi-Fi; cellular indoors
at rest; cellular with another flow running (a video playing in another app, the condition row 174 says makes a
stream's window bind). Before and after each block the page times 20 pings over the session (idle RTT) and the fill's
own rate. **Control:** the local machine's Chrome on the same Wi-Fi, same arms, interleaved with the phone's blocks: it
separates the phone's receive path ([`rig-limits.md`](rig-limits.md) §1) from the wire. **Decides:** for each lever,
the paired ratio on fill and ask per link class, read against each row's own rule: row 180's (asks-first's ask
≥ 15 % better than `shared` in every short-queue class and not worse beyond the spread in any, else a trade-off,
[`native/quic-compared.md`](native/quic-compared.md) §9.5) and row 181's (38 400 holds if no class is worse beyond its
spread but a shallow-buffer one, disclosed, [`transport/link-conditions.md`](transport/link-conditions.md) *IWDEEP*);
whichever class the target conditions put first decides the trade (the owner, 2026-10-13). A link class where the strict and round-paired readings disagree is "not conclusive" and goes to D3.

### D3 — the controlled grid

**Rig:** the phone on the local machine's Wi-Fi (or a hotspot it runs); the server on the local machine; shaping by
`tc` on the local machine's interface toward the phone only (a filter on the phone's address): `netem` rate, delay,
`limit` (the queue), `loss` iid and `loss gemodel` (Gilbert–Elliott; the cellular and Wi-Fi parameters row 193 cites),
`fq_codel` for the AQM cells. **Cells and arms:** row 193's, where its model says the arms part ([`native/quic-compared.md`](native/quic-compared.md)
§9.6, *Predictions*): `shared` and `per-frame` each under `cubic-restart` and `bbr`, 103 Mbit/s at 26 and 92 ms behind
20 ms of FIFO at 0.1 % and 1 %, iid and in bursts, and 309 Mbit/s at 92 ms behind 360 ms where the Wi-Fi holds it;
plus `per-frame-asks-first` for row 180's trade. Several connections, which §9.6 finds the "several" that wins under
random loss, need a second session on the wire and are not an arm until the owner asks for one. **Pre-flight,
every evening:** the unshaped Wi-Fi's rate and RTT, read the same way; a cell whose rate the unshaped link cannot hold
is not run (*say where the host saturates*), and the shaping is proven before a number is read through it (goodput
caps at the rate, the server's loss count matches the configured loss; [`rig-limits.md`](rig-limits.md) §9). A LAN
control cell (unshaped, 1 ms) runs with every block. **Decides:** each of row 193's predictions held or not, by its rule.

### D4 — opening: the repeated Initial

**Arms:** row 189's four — today, today again, `--reply-repeated-initial`, `--initial-rtt-ms 100`
([`../lab/irtt/README.md`](../lab/irtt/README.md)). **Controlled:** the relay (`lab/scripts/link_impair.py`) on the
local machine between the phone and the Oracle server, swallowing the first flight at 40/80/150 ms as row 189 does;
the page dials, waits for `ready`, closes, repeats unattended (a dial a few seconds; n = 20 a cell needs minutes, not
an evening). **Field:** the same loop on cellular, ≥ 1 000 opens per arm over several days, interleaved; a lost first
flight is rare there, so the field reads the tail (p99 of open) and the count of repeated Initials the server saw.
**Decides:** row 187's prediction (+699 ± 50 ms on a swallowed flight for a browser) on the phone's stack, by row
189's rule; the field adds whether the lever is ever exercised.

### D5 — memory and energy

**Memory:** row 38's cell on the phone — one decoder worker per arm at `dbt10_ea1141`'s and the largest sound
mammography frames, then 2 and 4 workers; readings from `measureUserAgentSpecificMemory` and, on Android, the
renderer's PSS (`adb shell dumpsys meminfo`). Then raise the worker count until the tab is killed or the page
reports a failure, and record where. **Decides:** the pool size a phone can hold, against the product's default.
**Energy (Android):** unplugged, screen at a fixed brightness, the same series filled and decoded in a loop for 10
minutes per arm (HTJ2K, AV1 in the layout D1 found faster), interleaved in 10-minute blocks; the battery's charge
counter (`/sys/class/power_supply/battery/charge_counter` via `adb`, µAh) read at each block's edges, an idle
block between arms as the floor. **Decides:** energy per series per arm over the idle floor; a difference under the
idle blocks' own spread is a tie. An iPhone without Xcode records nothing here, and the row says so.

## 3. Running a run on a phone

**The page drives, nothing else does.** A DevTools session changes what a browser does ([`rig-limits.md`](rig-limits.md)
§8), so no driver is attached during a timed run. A runner page (not built yet: the first item of each
run's row) holds the arms and the Williams order, opens each visit as the viewer with `?post=` (its result shape
already carries per-frame arrival, last byte, `exact` and digests: [`../client/viewer/viewer.js`](../client/viewer/viewer.js),
`report`), keeps every result in IndexedDB as it lands, and posts the lot to a collector on the server's host at the
end and after every round; a "save" button writes the JSON if the post fails. The owner taps start and leaves the
phone screen-on, on a stand, with nothing else running but what the cell asks for.

**Recorded with every round:** the page's build and every arm's settings; user agent; D0's capability line; link class
(the owner's tap: Wi-Fi, cellular, cellular + video), `navigator.connection` where present; battery level and charging
state; the idle RTT and rate of the pre-flight; wall-clock start.

## 4. The server side

* **The image** is [`../deploy/`](../deploy/README.md)'s, built on the local machine and copied (the Oracle machine
  cannot build: [`rig-limits.md`](rig-limits.md) §9). D2 runs four `series-server` processes on four ports, each with
  its arm's flags through `server-start.sh`'s `"$@"`.
* **TLS.** The page needs a secure context, so it is served over HTTPS with a certificate the phone trusts: a domain
  name the owner controls and a Let's Encrypt certificate by DNS-01 (no port 80 to open), mounted as `TLS_DIR`. The
  WebTransport endpoint uses the same certificate if D0 finds WebKit refuses `serverCertificateHashes`; that needs
  `server-start.sh` to take a supplied certificate instead of minting its own (a small deploy change, D0's row). For
  D3 on the LAN: on Android, `adb reverse tcp:8765 tcp:8765` makes the page `localhost` (a secure context) and the
  hash-pinned dial goes to the local machine's LAN address; on an iPhone, a name under the same domain pointing at the
  LAN address, with the same certificate.
* **Ports.** In the cloud's security list *and* the host firewall: TCP 443 (the page and the collector), UDP 4435 and
  three more for D2's arms. §9 found 4436 and 4437 pass the host firewall but no session arrives — the security list is
  the first suspect; D0 dials each port before anything else. 4437 belongs to the field server and stays off.
* **Rig-limits that apply.** §9: two burstable cores with stolen CPU, so no server-CPU claim and nothing past a median
  is read from the Oracle machine, and its 954 MB holds one volume in page cache (warm it before a block; §4's misses
  are not this plan's subject). §1: the phone's receive path is what D2 and D3 measure, not a limit to remove. §6:
  one statistic survives; §7 is what this plan lifts.
* **The fixtures** are CC BY ([`av1/licensing.md`](av1/licensing.md) §Data): a page that serves them carries their
  citations, and serving the decoders carries their notices. The server is on the public internet, so the page and
  collector sit behind a token in the URL, never committed.

**What the public repository must not carry:** the Oracle machine's address or name, the domain if it identifies the
owner, any key or certificate, the collector's token, the phone's serial (`adb devices` prints it), location or
carrier account. Scripts read them from the environment (`CLOUD_HOST`, as [`../lab/scripts/cloud_common.sh`](../lab/scripts/cloud_common.sh)
does); raw rows are written with them stripped and grepped for the address before they are committed. The gate scans
for none of this ([`../scripts/check_personal_paths.sh`](../scripts/check_personal_paths.sh) covers home paths
only), so the run script does it.

## 5. Who runs it

A cloud session cannot reach the Oracle machine or the phone ([`rig-limits.md`](rig-limits.md) §9, *Who can reach it*).
Every run here is a `local` row: built and driven by the owner or a local agent, raw rows and an execution log in
their own commit, the reading in the document that owns the subject (decode in [`decode/README.md`](decode/README.md),
transport in [`transport/link-conditions.md`](transport/link-conditions.md) §Re-measured, capabilities in
[`CLIENTS.md`](CLIENTS.md)).
