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
| **the phone** | **a Samsung on Android 16, Chrome and Firefox** (the owner, 2026-10-14); model, browser versions, `deviceMemory` and cores as D0 reads them (its first row); carrier and plan (data cap) asked of the owner | the client |
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
§8), so no driver is attached during a timed run. The runner page ([`../lab/devices`](../lab/devices/README.md), row
DEVICEKIT) holds the arms and the Williams order, runs each visit in the page through the product's downloader
(D2) or decoders (D1), keeps every result in IndexedDB as it lands, and posts it to a collector on the server's host
after every round; a "save" button writes the JSON if a post fails. **Quick mode** — 3 rounds, D1 on `dbt10_ea1141`
alone, D2's `shared`, `asksfirst` and `iw38400` — prints a provisional reading on the phone's screen in about 15
minutes, before the full n = 10; the owner's taps are [`../lab/devices/evening.md`](../lab/devices/evening.md). The owner taps start and leaves the
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
  WebTransport endpoint uses the same certificate if D0 finds WebKit refuses `serverCertificateHashes`; `server-start.sh`
  takes one mounted at `/supplied` instead of minting its own, and the transport file then carries no hash, so the
  client dials unpinned (row DEVICEKIT; both sessions, the WASM one since row 265). For
  D3 on the LAN: on Android, `adb reverse tcp:8765 tcp:8765` makes the page `localhost` (a secure context) and the
  hash-pinned dial goes to the local machine's LAN address; on an iPhone, a name under the same domain pointing at the
  LAN address, with the same certificate.
* **Ports.** In the cloud's security list *and* the host firewall: TCP 8443 (the page and the collector, `COLLECT_PORT`;
  unprivileged, so the collector runs as the login user), UDP 4435, 4436, 4438 and 4439 for D2's arms
  ([`../lab/devices/arms.json`](../lab/devices/arms.json)); `deploy.sh up` checks each is free and let in by the host
  firewall before it starts anything. §9 found 4436 and 4437 pass the host firewall but no session arrives — the security list is
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

## 6. The kit, tested in the container

*Row DEVICEKIT, 2026-10-14: plumbing, not a measurement — loopback, a desktop CPU, headless Chromium 141.* The
container stood in for the Oracle machine: `deploy.sh up` over SSH to itself, the `deploy/` image built from this
row's tree, the four arms in Docker, the collector over TLS; `dry_run.mjs` drove the runner page in quick mode. Bundles:
`make_bundles.sh dbt10_ea1141 mr_ispy1` at `PRESET=good:6` (the evening uses `cpu0`), every payload exact at ingest.

* **The quick evening ran whole in 16 s** — D0, D1's 9 visits, D2's proof and 9 visits — with every frame exact
  (D1 9/9, D2 9/9) and all 22 rows posted. On a phone it is decode- and link-bound; the ~15 minutes is a target, not
  measured.
* **Each check fails when it should.** `?mutate` voids all 9 D1 visits and stops D2 at its proof (24 of 24 frames not
  exact); one byte flipped in the bundle the arms serve voids all 9 D2 visits; the collector's token, path and
  bundle-name guards, the plan's pairing and order, the bundle reader and `server-start.sh` each fail under their
  mutations (`plan.test.mjs`, `collector_test.py`, `deploy/server_start_test.sh`, in the gate). `up` stops on a taken UDP
  port and on a host firewall that rejects a port — an `ACCEPT` after the catch-all `REJECT` included — and passes
  Oracle's shape (`ACCEPT`s first); `fetch` replaces the host's names and refuses, writing nothing, if one is left.
* **The CA-verified arms, up to the handshake.** With `SUPPLY_CERT=1` the arms present the page's certificate and the
  client dials with no hash; Chromium 141 trusted the stand-in's local CA for the page but refused it for
  WebTransport (`certificate unknown` in the server's log), so the path past the handshake needs the real Let's
  Encrypt certificate and is D0's to confirm.
* **Not tested:** a phone, Firefox, WebKit, the Oracle machine and its security list.


## 7. The demo's phone run: page view against view worker, tether against Wi-Fi

*Row PHONE-PROTOCOL, 2026-11-11. Theory and a pre-registered protocol, written before anyone measures; nothing here
was run on a phone. The owner runs it on the laptop without installs (README §Demo, "On a phone, from a laptop without
installs", on `claude/phone-no-install`); the commands below need that branch in the demo's (`dev-server.py --bind`,
`OPENSSL=` in `gen_dev_cert.sh`).* *Amended before any run (row PHONE-AMEND, 2026-11-11): a controller arm, one timed
series, and new commands; where the two differ, **Amendment** at the end of this section holds.*

**What it compares.** Two arms, `?view=page` (the frames held and painted on the page, today's default) and
`?view=worker` (the view worker, the client's target, [`lines/client.md`](lines/client.md)), on the same series and
link, alternated load by load. Two links, USB tethering and Wi-Fi, in blocks, since a link change restarts the static
host. Series: `dbts_a1-q8-g8-cut` (the show list's first, 4.6 MB), then `dbts_b1-q8-g8` (its largest frame, 23 MB).

**Theory.** Both arms run the same downloader, decoder workers and WebCodecs route; they differ in where the frame
map, the controller and the WebGL painter live (the page's thread, or one worker). On a phone the page's thread is
also the browser's input and layout thread, so the worker should not be slower; whether it is faster depends on how
much of the fill the page's thread holds up, which nothing measured here says (*an assumption, no band*). Bytes on
the wire are the same in both arms. Tether against Wi-Fi: USB is a wired link with no airtime contention; Wi-Fi as it
comes. Neither difference is predicted in size.

**What the phone can show, and what it cannot** (checked on the demo tip's `client/viewer/index.html`, not on a
phone):

* **The overlay** (`?overlay=1`) wraps, so it shows whole: the painted frame's route, wire KB, decode ms, and Q, G and
  depth.
* **The status line is one line, cut with an ellipsis** (`#bar` `white-space: nowrap`, `#status` `text-overflow:
  ellipsis`). With the page's CSS in headless Chromium (desktop fonts; a phone's differ), a 205-character status line
  showed its first 49 characters at 412 px wide, `frame 1 of 56 · client ts · view worker · receiv`, and stopped at
  `… decoders: av1-webcodecs 56 · codec a` at 915 px. Portrait shows the view; landscape adds the received, exact,
  unchecked and per-route counts. **The fill time, the renderer and the last error are visible in neither.**
* **Touch cannot step slices**: stepping is the wheel and the keys; a drag is window and level. A phone without a
  keyboard has the cine button, the **lossless** button and the drag; `End`, a jump mid-group and the `?fill=0` jump
  of the show list are not reachable.
* **The laptop** reads each session's path when it closes, in Terminal 1: `session path` with `rtt_us`, `sent` and
  `lost` (`server/src/transport/server.rs`, `report_path`), one line per page load.
* **The eye** judges what no reading carries: the label's order, the picture (no blank, no blocks or stripes; the
  narrow window under *Optimal quality* against *Lossless*).

So the run has two parts. **Part A** (correctness and the eye) runs on today's page. **Part B** (fill time) needs the
status line shown whole, a change to the page for the owner's word (FIX-1); until it lands Part B is not run, and Part
A claims nothing about speed.

**Each load records**, from one screenshot in landscape after the fill (power and volume-down), transcribed afterwards
(the screenshots name the laptop's address: keep them off the repository): link, view (the status line's `view …`),
`received N` of the series' N, the per-route counts, the overlay's route, KB and decode ms for frame 1; Part B, the
`fill … ms`; then **lossless** pressed: the label's states as seen, and **lossless** again; Terminal 1's `rtt_us`,
`sent`, `lost` for that load (it prints when the next load closes the session).

**Order.** Per series and link, a block: one warm-up load (`view=page`, not counted: it fills the browser's cache of
the page's files), then ten counted loads, `page worker worker page page worker worker page page worker`, five pairs
of adjacent loads with each arm first in alternate pairs. Blocks in the order tether, Wi-Fi, Wi-Fi, tether: ten pairs
per link per series, forty counted loads a series.

**What decides what** (written now; a run may only tighten it):

* **Correctness, per load.** A load passes when every frame is received, every frame takes `av1-webcodecs`, the label
  reads *Optimal quality*, **lossless** gives *fetching lossless…* then *Lossless*, and **lossless** again gives
  *Optimal quality*. The worker meets the page's bar on this phone when no load of it fails in a way no load of the
  page does. A failure in both arms alike is the link's or the series', not a view's, and is reported as such.
* **Fill (Part B), per link and series.** The ten paired ratios worker / page. *Worker faster*: at least nine of ten
  below 1 (a sign test, two-sided p = 0.021) and the median at most 0.95; *page faster* the mirror; otherwise *no
  difference shown at n = 10*, with the median and range. Decode ms of frame 1 the same way, reported, not deciding
  (one frame a load).
* **The view the demo shows** stays the owner's. This run gives it: whether the worker met the page's bar, and Part
  B's verdict per link. A worker that fails where the page does not, or is slower on either link, is not proposed.
* **The link the demo uses.** Tethering, unless it fails a load where Wi-Fi fails none; with Part B, the page view's
  median fill per link is quoted beside it, not compared by a rule (the links are not interleaved load by load).
* **The eye.** One verdict per block: the label's order as seen on every load, and the picture, "no difference seen"
  or what was seen, on which frame and window.

**Where a phone run shows nothing.** One phone and one Chrome version (D0 names them); three DBT volumes of one
dataset, two series of them here, no ultrasound cine; two links at one place and hour, unshaped (no root on the
laptop, so no `netem`, and lossy wireless is the link as it comes, not a controlled loss); software decode (the product
asks `prefer-software`, README §The viewer on an Android phone, step 6), so nothing about hardware decode; no console
(DevTools needs adb). The link's rate is not measured, so a fill time cannot be split into wire and decode, and no
rate is claimed. Ten pairs see a consistent direction only; a small difference reads *no difference shown*.

**The commands, from any state**, at the repository's root on the demo's branch with `claude/phone-no-install` in it,
after its "Once per laptop" (the `rust` image, `series-server` built, `demo-series/` copied). The phone on the
laptop's Wi-Fi network, one that lets clients see each other, and plugged in with USB tethering on:

```bash
# Every terminal first
tether_if() { for d in /sys/class/net/*; do case $(readlink -f "$d/device/driver") in */rndis_host|*/cdc_ncm|*/cdc_ether) echo "${d##*/}";; esac; done | head -1; }
wifi_if() { nmcli -t -f DEVICE,TYPE,STATE device | awk -F: '$2=="wifi" && $3=="connected" {print $1; exit}'; }
addr() { [ -n "$1" ] && ip -4 -o addr show dev "$1" | awk '{print $4}' | cut -d/ -f1 | head -1; }
ID=dbts_a1-q8-g8-cut; EXACT=${ID%%-*}; mkdir -p target/phone-run server/dev-cert
# Terminal 1, before the others, once per series — leftovers stopped, the certificate, the optimal-quality series
pkill -f 'release/series-server' ; pkill -f 'server/dev-server.py'
OPENSSL="podman run --rm -i --network none -v $PWD/server/dev-cert:$PWD/server/dev-cert:z rust openssl" \
  ./server/scripts/gen_dev_cert.sh --if-needed
echo "flag origins: http://$(addr "$(tether_if)"):8765,http://$(addr "$(wifi_if)"):8765"
target/release/series-server --port 4433 --series demo-series/$ID.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem 2>&1 | tee -a target/phone-run/$ID-4433.log
# Terminal 2, once per series — its exact series
target/release/series-server --port 4434 --series demo-series/$EXACT.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem 2>&1 | tee -a target/phone-run/$ID-4434.log
# Terminal 3, once per block — LINK=tether with USB tethering on, LINK=wifi with it off
LINK=tether
pkill -f 'server/dev-server.py'
IF=$([ "$LINK" = tether ] && tether_if || wifi_if); LAPTOP_IP=$(addr "$IF")
[ -n "$LAPTOP_IP" ] || echo "no $LINK interface with an IPv4 address" >&2
HASH=$(jq -r .cert_sha256 client/dev-transport.json)
for p in 4433 4434; do
  printf '{"wt_url": "https://%s:%s/", "cert_sha256": "%s"}\n' "$LAPTOP_IP" "$p" "$HASH" > target/phone-transport-$p.json
done
echo "$(date -u +%FT%TZ) $ID $LINK http://$LAPTOP_IP:8765" | tee -a target/phone-run/blocks.log
python3 server/dev-server.py --bind "$LAPTOP_IP" --port 8765 --metadata demo-series/$ID.metadata.json \
  --transport target/phone-transport-4433.json \
  --exact-metadata demo-series/$EXACT.metadata.json --exact-transport target/phone-transport-4434.json
```

On the phone, once per run: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, the two origins Terminal 1
printed, comma-separated (the flag takes a list), **Enabled**, **Relaunch**. Each load: the block's origin with
`/?overlay=1&view=page` or `/?overlay=1&view=worker`, in the order above. When a block prints an origin the flag does
not hold (the tether may give another address on another plug-in), enter it in the flag again. For the second series,
stop the three terminals, set `ID=dbts_b1-q8-g8` in each, and start again from Terminal 1. Afterwards, USB tethering
off; `target/phone-run/` keeps the session lines and the blocks' times, which name the laptop's addresses: strip them
before anything is committed (§4). Nothing arriving: README §Demo's variant, its last paragraph.

### Amendment: the controller arm, the run's size, the commands

*Row PHONE-AMEND, 2026-11-11, written before any phone run by a session that will not run it. Nothing here was run on a
phone; the build line below was compiled in a cloud container. It changes §7's series, pair counts and commands, and
adds an arm; §7's readings, eye checks, correctness rule and "where a phone run shows nothing" stand.*

**The controller arm.** Both servers of the pair, the optimal-quality one and its exact one, run under
`--congestion cubic-restart` (the default) in one arm and `--congestion bbr` in the other, on the same real links,
tether and Wi-Fi, with no `netem`. The owner's decision of 2026-11-11 keeps `cubic-restart` the default until
real-world runs with both decide; P1's "adopt" covered random loss on a 1 000-packet buffer only
([`transport/transport-conclusions.md`](transport/transport-conclusions.md) §1). Each arm has its own two servers and
its own static host, so the controller is chosen by the page's port, `8765` for `cubic-restart` and `8766` for `bbr`,
and the arms alternate load by load with no restart. Each arm is the option as shipped: quinn's BBR is BBRv1 and starts
at quinn's 240 000-byte window, the Cubic arms at 12 000 ([`../lab/cc-classify/README.md`](../lab/cc-classify/README.md),
*The arms*), so a `bbr` win on a link that lost nothing is its start and pacing, not its answer to loss.

**The 2 × 2, in quads.** Arms A = page·`cubic-restart`, B = worker·`cubic-restart`, C = worker·`bbr`,
D = page·`bbr`. A quad is four counted loads in one row of the Williams square for four, so each arm takes each position
once and follows each other arm once:

| row | loads |
| --- | --- |
| 1 | A B D C |
| 2 | B C A D |
| 3 | C D B A |
| 4 | D A C B |

A block is two warm-up loads (`8765/?overlay=1&view=page`, then `8766/?overlay=1&view=page`, not counted: each origin
has its own cache of the page's files) and three quads. Blocks tether, Wi-Fi, Wi-Fi, tether, with rows 1 2 3, 1 2 3,
4 1 2, 4 1 2. Per link that is six quads, which give twelve worker / page ratios (six under each controller) and twelve
`bbr` / `cubic-restart` ratios (six under each view).

**The server's reading of each session.** Every arm runs one build, `series-server` with the lab feature `telemetry`
([`../lab/server-telemetry`](../lab/server-telemetry)), and the same three environment variables:

* the `session path` line every build prints when a session closes (`server/src/transport/server.rs`,
  `report_path`): `rtt_us` (smoothed, at the close), `cwnd`, `sent`, `lost` (packets), `congestion_events`, `mtu`;
* `WTPACS_LOSS_TRACE`: one JSON line per congestion event (`cc_trace.rs`, `Loss`): `rtt_latest_us` (the last
  acknowledged packet's round trip before the event), `srtt_us`, `min_rtt_us`, `lost_bytes`, the window before and
  after;
* `WTPACS_PATH_TELEMETRY=1` with `WTPACS_PATH_TELEMETRY_MS=250`: a row every 250 ms per session (`path.rs`), with
  `rtt_us`, `min_rtt_us` and the cumulative `sent_packets`, `lost_packets`, `congestion_events`, so the round trip's
  course before each loss can be read, and the wire time of a fill to within 250 ms.

`WTPACS_CC_TRACE` (a line per batch of acknowledgements) stays unset: it is the one recorder whose writes grow with the
traffic. The frame tap (`WTPACS_TELEMETRY`) stays unset too.

**Whether the recording changes the timing.** With these variables set, the controller sits behind the trace wrapper,
which copies three round-trip values on every acknowledgement and returns before writing on every batch; it writes one
line, under a mutex on the connection's thread, per congestion event; the sampler wakes once per 250 ms on the
server's runtime and appends one line. *Assumption, not measured:* well under 1 % of a fill that takes seconds. It
cannot favour an arm, since every arm, both views included, runs the same build with the same variables; it moves
every absolute time alike, so this run's fill times are the telemetry build's, and only its ratios decide.

**Each loss, random or congestive.** Per congestion event, the queue it met, `q = rtt_latest_us − min_rtt_us`, against
`q* = max(4 ms, min_rtt/8)`, RFC 9406's threshold and row LOSSCLASS's: *congestive* when `q ≥ q*` (the round trip rose
before the loss), *random* when under it (flat). On the relay, with the truth known, that rule erred little under
`cubic-restart` (congestive read as random 0 %, random read as congestive 1–2 %) and badly under `bbr`, which keeps a
queue standing (random read as congestive 30–41 % on shallow queues)
([`transport/transport-conclusions.md`](transport/transport-conclusions.md) §1, *R2 LOSSCLASS*). So **the loss mix is
read from the `cubic-restart` sessions alone**; the `bbr` sessions' events are counted, not classed. Wi-Fi's own
delay jitter above `q*` (4 ms while the minimum round trip is under 32 ms) reads a random loss as congestive, so the
reading errs toward Cubic's case.

**What one home link, one phone and minutes of runs can tell about the loss mix, and what not.**

* **The tether carries no radio.** USB tethering joins the phone to the laptop by cable; the phone's cellular radio is
  not on the path. A loss there is a queue's (a USB network adapter's or a host's) or none: the tether is the run's
  control, not a lossy link.
* **Wi-Fi is the run's one wireless link**: one access point, one channel, one room, one hour. It can show whether a
  23 MB fill on it loses packets at all, how many of the losses met a queue, and whether either controller fills
  faster there. It cannot give the mix of a population of links, of other access points, or of busier hours.
* **Nothing about cellular.** Neither link uses the phone's radio, so §1's inverted prior (LTE and 5G losing to queues,
  not to the radio) is neither confirmed nor refuted.
* **No neighbour.** No other flow shares the bottleneck, so BBR's cost to a neighbour in a shallow FIFO (§1, 1.2 % of
  a 5 Mbit link left to kernel TCP) cannot appear, and whether the access point's queue is a FIFO or fq_codel is not
  known.
* **Counts, not rates.** Each controller has 12 counted sessions per link. Fewer than about 20 events give a count
  ("3 of 5 random"), not a share. With no loss in N sessions the run says so, and puts the chance that a session loses
  anything under 3/N (the rule of three, 95 %).

**What decides what** (written now; a run may only tighten it). §7's rules hold, with these changes:

* **Correctness, per load**, as §7, over four arms. A failure in one controller's loads alone is that controller's.
* **Fill (Part B), per link.** For a comparison of twelve paired ratios: *the numerator faster* when at least ten of
  twelve are below 1 (sign test, two-sided p = 0.039) and the median is at most 0.95; the mirror for the denominator;
  otherwise *no difference shown at n = 12*, with the median and range. The view: worker / page, the two controllers'
  ratios pooled. The controller: `bbr` / `cubic-restart`, the two views' ratios pooled. If the six ratios under each
  level of the other factor have medians on opposite sides of 1, the verdict is *depends on* that factor, and none is
  pooled. Each level's six are reported, never deciding (six of six is p = 0.031, the only result they could show).
* **What a controller verdict can change.** Nothing in the default from this run alone. A `bbr` load failing where
  `cubic-restart` does not withdraws `bbr` from what the next runs try. `bbr` faster on Wi-Fi with random losses read in
  the `cubic-restart` sessions asks for the same arm on more links (cellular, another home) before the default is
  reopened; `bbr` faster with no loss read is its start, reported as such. `cubic-restart` faster or no difference is
  this link's evidence for the default.
* **The loss reading** decides nothing; per link and controller: sessions with any loss, `sent`, `lost`,
  `congestion_events`, and for `cubic-restart` the events classed random and congestive, by count.
* **Part B still waits** on the status line shown whole (§7). Without it, the server's wire time from the path rows
  (the first and last 250 ms rows in which `sent_packets` grows) is reported as a stand-in, labelled so, never
  deciding: it omits the phone's decode and paint.

**Size: about two hours.** *Assumption:* a counted load takes about 60 s of the owner's hands (open the address, the
fill, a screenshot, **lossless** twice) and 30 s of transcription afterwards; setup, four link changes and packing up
take about 30 minutes. §7 as written, with the controller arm added, would be 2 series × 4 arms × 2 links × 10 pairs
= 160 counted loads and 16 warm-ups, about 4.4 hours and the overheads. The cuts, series and pairs first, no arm and no
link:

1. **One timed series, `dbts_b1-q8-g8`** (10-bit at its own depth, 50 frames, 23.2 MB, the largest frame). It keeps
   about five times the packets of `dbts_a1-q8-g8-cut`, so a fill has more to lose, and a fill long enough to weigh a
   controller's steady state more than its start. *What the cut costs:* no fill verdict on the show list's first series,
   on the depth cut, or on a 4.6 MB fill, where the start (and so `bbr`'s larger first window) weighs most.
   `dbts_a1-q8-g8-cut` keeps an eye check: two loads (page, worker; `cubic-restart`; tether) before the timed blocks,
   for correctness and the picture of the cut, not counted. Saves 88 loads.
2. **Twelve ratios per link per comparison**, pooled over the other factor, in place of ten per arm level. *What the cut
   costs:* each level of the other factor alone has six, which can show a direction only at six of six; pooling assumes
   the other factor does not reverse the effect, which the opposite-medians rule checks. Saves 32 loads against ten per
   level.

That leaves 4 blocks × (2 warm-ups + 12) = **56 loads, about 84 minutes, and about 30 minutes of the rest: about 1 h
55 min**. If the first block takes longer than 20 minutes (from its line in `blocks.log` to the next block's), drop each later block's third quad:
eight ratios per link, and the rule becomes eight of eight (p = 0.0078; seven of eight is p = 0.070).

**The stored form is out of the run**, timed and eye check alike (the owner, 2026-11-11: the optimal-quality series is
always ≤ 10 bits on the demo path). The run needs four files of `demo-series/` and their `.metadata.json`:
`dbts_b1-q8-g8.sbnd`, `dbts_b1.sbnd`, `dbts_a1-q8-g8-cut.sbnd` and `dbts_a1.sbnd` (README §Demo's variant lists
their sizes); not `dbts_a1-q8-g16-stored`.

**The commands, from any state**, replacing §7's. At the repository's root on the demo's branch with
`claude/phone-no-install` in it, after its "Once per laptop", plus this build, once (gcc and crates.io, as the
product's; its own target directory, so the product's binary is untouched):

```bash
cargo build --release -p series-server --features telemetry --target-dir target/telemetry
```

The phone on the laptop's Wi-Fi network, one that lets clients see each other, and plugged in with USB tethering on:

```bash
# Every terminal first
tether_if() { for d in /sys/class/net/*; do case $(readlink -f "$d/device/driver") in */rndis_host|*/cdc_ncm|*/cdc_ether) echo "${d##*/}";; esac; done | head -1; }
wifi_if() { nmcli -t -f DEVICE,TYPE,STATE device | awk -F: '$2=="wifi" && $3=="connected" {print $1; exit}'; }
addr() { [ -n "$1" ] && ip -4 -o addr show dev "$1" | awk '{print $4}' | cut -d/ -f1 | head -1; }
serve() {  # PORT CONGESTION SERIES — one series server, its session lines and traces under target/phone-run/
  echo "== $(date -u +%FT%TZ) $3 $2" >> target/phone-run/server-$1.log
  WTPACS_LOSS_TRACE=target/phone-run/loss-$1.jsonl WTPACS_PATH_TELEMETRY=1 WTPACS_PATH_TELEMETRY_MS=250 \
  WTPACS_PATH_TELEMETRY_PATH=target/phone-run/path-$1.jsonl \
    target/telemetry/release/series-server --port "$1" --congestion "$2" --series "demo-series/$3.sbnd" \
      --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem >> target/phone-run/server-$1.log 2>&1 &
}
mkdir -p target/phone-run server/dev-cert
ID=dbts_a1-q8-g8-cut; EXACT=${ID%%-*}   # the eye check; ID=dbts_b1-q8-g8 for the timed blocks, in both terminals
# Terminal 1, once per series
pkill -f 'release/series-server' ; pkill -f 'server/dev-server.py' ; sleep 1
OPENSSL="podman run --rm -i --network none -v $PWD/server/dev-cert:$PWD/server/dev-cert:z rust openssl" \
  ./server/scripts/gen_dev_cert.sh --if-needed
serve 4433 cubic-restart "$ID"; serve 4434 cubic-restart "$EXACT"; serve 4443 bbr "$ID"; serve 4444 bbr "$EXACT"
sleep 2; grep -h '^transport=' target/phone-run/server-44{33,34,43,44}.log | tail -4   # each names its controller
T=$(addr "$(tether_if)"); W=$(addr "$(wifi_if)")
echo "flag origins: http://$T:8765,http://$T:8766,http://$W:8765,http://$W:8766"
# Terminal 2, once per block, after Terminal 1 — LINK=tether with USB tethering on, LINK=wifi with it off
LINK=tether
pkill -f 'server/dev-server.py' ; sleep 1
IF=$([ "$LINK" = tether ] && tether_if || wifi_if); LAPTOP_IP=$(addr "$IF")
[ -n "$LAPTOP_IP" ] || echo "no $LINK interface with an IPv4 address" >&2
HASH=$(jq -r .cert_sha256 client/dev-transport.json)
for p in 4433 4434 4443 4444; do
  printf '{"wt_url": "https://%s:%s/", "cert_sha256": "%s"}\n' "$LAPTOP_IP" "$p" "$HASH" > target/phone-transport-$p.json
done
static() {  # PAGE_PORT SERIES_PORT EXACT_PORT
  python3 server/dev-server.py --bind "$LAPTOP_IP" --port "$1" --metadata demo-series/$ID.metadata.json \
    --transport target/phone-transport-$2.json \
    --exact-metadata demo-series/$EXACT.metadata.json --exact-transport target/phone-transport-$3.json &
}
static 8765 4433 4434; static 8766 4443 4444
echo "$(date -u +%FT%TZ) $ID $LINK cubic-restart http://$LAPTOP_IP:8765 bbr http://$LAPTOP_IP:8766" | tee -a target/phone-run/blocks.log
```

On the phone, once per run: `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
the four origins Terminal 1 printed, comma-separated, **Enabled**, **Relaunch**. The eye check first: Terminal 1 with
`ID=dbts_a1-q8-g8-cut`, Terminal 2 with `LINK=tether`, then `http://<tether address>:8765/?overlay=1&view=page` and
`…&view=worker`, each with **lossless** twice. Then `ID=dbts_b1-q8-g8; EXACT=${ID%%-*}` in both terminals and Terminal 1 again (it stops every server and
starts the four anew, so each server's sessions count from the timed run's first), and the blocks, each from Terminal 2
with its `LINK`: its two warm-ups, then its three quads' loads, arm A at `:8765/?overlay=1&view=page`, B at
`:8765/?overlay=1&view=worker`, C at `:8766/?overlay=1&view=worker`, D at `:8766/?overlay=1&view=page`. The address
bar's port names the controller on each screenshot. When a block prints an origin the flag does not hold, enter it in
the flag again.

Each server's `k`-th session after its `==` line is the `k`-th load of its controller in the order above, warm-ups
included; a session line's timestamp places it among `blocks.log`'s lines. A load that shows `received 0` or a reload
adds or drops a session: note it on the sheet. Afterwards, USB tethering off; `pkill -f 'release/series-server' ; pkill
-f 'server/dev-server.py'`. `target/phone-run/` (session lines, the two traces per server, the blocks' times) names
the laptop's addresses: strip them before anything is committed (§4).

## 8. The demo room's network

The demo's page dials both servers of the pair over WebTransport, which is QUIC, over UDP; nothing on the demo path
falls back to TCP. The spec would allow one — `requireUnreliable` "When set to true, the WebTransport session cannot
be established over an HTTP/2 connection if an HTTP/3 connection is not possible" ([WebTransport, W3C Candidate
Recommendation Snapshot, 30 July 2026](https://www.w3.org/TR/webtransport/), §6.9 Configuration) — but
`series-server` answers WebTransport over HTTP/3 alone, and its TCP path, WebSocket, is off unless `--websocket` and
not dialed by the page (`server/Cargo.toml`, [`WIRE.md`](WIRE.md) §The WebSocket mapping). So a room that drops UDP
shows the page and no picture.

**What a room's network may do**, from the IETF's own guidance on QUIC:

* Block UDP: "Measurement studies have shown between 3% [Trammell16] and 5% [Swett16] of networks block all UDP
  traffic […] all applications running on top of QUIC must either be prepared to accept connectivity failure on such
  networks or be engineered to fall back to some other transport protocol" ([RFC 9308](https://www.rfc-editor.org/rfc/rfc9308)
  §2).
* Throttle it: "One possible response to this threat is to throttle UDP traffic on the network, allocating a fixed
  portion of the network capacity to UDP and blocking UDP datagrams over that cap" ([RFC 9312](https://www.rfc-editor.org/rfc/rfc9312)
  §4.6), and "blocking a random fraction of QUIC packets across 4-tuples will allow many QUIC handshakes to complete,
  preventing TCP fallback, but these connections will suffer from severe packet loss" (*ibid.*). A throttled room
  fills, slowly: the status line's fill time against the rehearsal's on the same link is the only sign.
* Isolate clients: many access points keep Wi-Fi clients from reaching each other. That is a vendor setting, not a
  standard's behaviour; *not sourced*. The phone then cannot load the page at all.

**The check** has two halves. On the laptop, [`scripts/demo-network.py`](../scripts/demo-network.py): the page's TCP
port and both series' UDP ports listening on the address the phone dials, both transport files pinning the
certificate's hash, and the certificate within the spec's two weeks and valid past `--until` (a day from now by
default); its test, `scripts/demo-network.test.py`, runs in the gate. It cannot see the room: no packet from the
phone reaches a check without root on the laptop, and the phone's browser sends UDP only as WebTransport. So the
phone's half is the page itself, read as README.md §Demo's *On arrival* table does: no page is TCP or isolation; the
page with `error: connect:` and nothing received is UDP to the optimal-quality server; no **Lossless** button and
`error: lossless:` is UDP to the exact server; *✓ Lossless* in blue is the room carrying the pair. *Unverified* on a
phone in a room: the readings come from the page's code (`client/viewer/viewer.js`'s `connect:` and `lossless:`
failures), and the namespace check of §Demo's no-install block.

**The fallbacks, in order**: the phone's own hotspot with the laptop joined to it (one radio hop the phone controls;
no room in between); the tether over the cable; the screen recording made at the rehearsal. Each change of link
changes the laptop's address, so the transport files, the static host's `--bind` and the phone's flag follow it.

**What expires.** The dev certificate is pinned by hash, and pinning requires "the current time MUST be within the
validity period of the certificate […] and the total length of the validity period MUST NOT exceed two weeks"
(WebTransport, *custom certificate requirements*; the spec's reason: "the expiry period is limited to two weeks"
as "a balance between setting the expiry limit as low as possible to minimize consequences of a key compromise, and
maintaining it sufficiently high to accomodate for clock skew across devices", §14.4). `gen_dev_cert.sh`
makes one for 10 days, starting the moment it runs. Renew it at the rehearsal, a day or more before the demo and at
most nine: then it holds through the demo, `--if-needed` leaves it alone on the day, and its start is hours behind
the phone's clock, not seconds — a certificate made on arrival fails on a phone whose clock runs behind the laptop's,
*derived* from "the current time MUST be within the validity period", not tried. A renewal changes the hash: the
transport files are written again and both servers restarted, as §Demo's blocks do in that order.
