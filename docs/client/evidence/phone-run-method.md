# How the client is run on a phone, and what the first run counted

**The question:** how is the client measured on a real phone so that a run decides something, and what did the first
run of 2026-11-11 count against its own rules? The results the run gave are in their own files:
[`view-target.md`](view-target.md), [`congestion-controller.md`](congestion-controller.md),
[`fill-bound-on-phone.md`](fill-bound-on-phone.md), [`link-profiles.md`](link-profiles.md),
[`lossless-after-a-failed-ask.md`](lossless-after-a-failed-ask.md), [`hidden-page-decode.md`](hidden-page-decode.md).

*Folded 2026-11-14 from `claude/phone-protocol:docs/devices.md` §7 *Second amendment* and its *Note* (`ecd31836`),
`claude/phone-tools:docs/lines/optimal-quality.md` (`962226e8`), `claude/fill-split:docs/phone-rows/README.md`
(`28810f62`) and `claude/fill-split:docs/reviews/phone-blind-read.md` (also on `claude/phone-rows`, `5c54f446`). The
protocol before the Second amendment, and its first Amendment, are on this branch: [`../../devices.md`](../../devices.md) §7.*

## 1 · The protocol, pre-registered (2026-11-11, by a session that ran none of it)

§7 of `devices.md` compares the page view against the view worker, tether against Wi-Fi; its **Amendment** (on this
branch) adds the controller arm (`cubic-restart` against `bbr`) as four arms A–D in a Williams square of quads. The
**Second amendment** (`claude/phone-protocol` `ecd31836`; on this branch §7 stops at the first Amendment) holds over
both, and changes:

* **The run commit.** Every timed load runs the phone tools' tip, not the demo commit. Verdicts carry to the demo
  commit only where `git diff --stat <run commit> <demo commit> -- client/ server/ common/` changes no file the fill
  passes through, and the result lists every file that diff names. Only ratios decide; each image's revision label
  must name the run commit.
* **Loads by a runner page.** It presses *Lossless* only after the fill's end mark, then again once the label reads
  *Lossless*; a label not at *Lossless* within 30 s, or not back at *Optimal quality* within 10 s of the second press,
  fails the load. **A fixed 15 s gap** between loads. The runner stops on any failure; a failed load is a correctness
  result and is not rerun. The phone stays awake and charging, untouched during counted loads.
* **What a load records** is the client beacon's line (series, view, controller, per frame route, KB and decode ms,
  the fill, the label's changes and the presses, errors). A load with no beacon line is *missing*, not failed.
* **The fill (Part B)** is the beacon's: from just before the optimal-quality session's `WebTransport` is constructed
  to the series' last frame stored (`received === n`), both on `performance.timeOrigin + performance.now()`.
* **Links alternated load by load**, both up for the whole run: the laptop wired to the home router, the phone on its
  Wi-Fi and on USB tethering at once, each origin picking its link. Two checks before the first counted load: the
  tether takes no default route; and each warm-up's bytes grow on its own link's device, under 1 % on the other.
* **The order.** An *octet* is eight counted loads, links alternating, the tether first in odd octets. Each link plays
  one quad row of the Williams square per octet: six octets, the tether's rows 1 2 3 4 1 2 and Wi-Fi's 3 4 1 2 3 4,
  after four warm-ups (`view=page` at each of the four origins).
* **Missing loads** remove the ratios they enter; the sign rule's threshold follows the ratios left (12 or 11: ≥ 10
  below 1; 10: ≥ 9; 9: ≥ 8; 8: all 8; under 8: *not decided*), the median ≤ 0.95 kept.
* **Size, and the 10-minute rule.** *Assumption:* about 40 s a load, ~40 minutes unattended. "If octet 1 takes more
  than 10 minutes, the run stops after octet 4 … The time saved is not spent on more octets in this run."
* **The Wi-Fi arm** is one radio hop to a server one switch away. **Servers** run as the test-only image with the
  telemetry feature, `--network host`, the production seccomp profile and limits; their read path is recorded and
  must agree on all four. **A prod-like check**, not counted: four loads with rootless podman's publish in place of
  host networking.
* **No adb, DevTools, trace or Performance recording in a timed load** (adb rides the tether's cable, so it would load
  that arm alone). Anything through `lab/scripts/link_impair.py` is labelled *simulated* and never pooled.
* **Note** (2026-11-11, before any timed load): rootless crun refused a 64 MiB memlock on the run's laptop (hard limit
  8 MiB), so every arm ran `--ulimit memlock=8388608:8388608`; the read path did not change
  (`read_fast_path=preadv2`, `read_ring=refused`, SELinux refusing the ring whatever the limit).

## 2 · The tools (2026-11-11, `claude/phone-tools`, `962226e8`; older form `claude/phone-devtools` `eb028344`)

Each image labelled with its commit (OCI `revision`); a test-only server image with the telemetry feature (the
default image unchanged); `claude/phone-tools:lab/phone/read-path.sh`, which read path a running server took; under `claude/phone-tools:lab/phone/`, loaded
only through the lab gate, a client beacon (`?beacon=`, sent after the fill or on page hide; `dev-server.py --beacon
FILE`) and a runner page walking the octets above. **Checked headless on loopback on a synthetic pair, not on a phone,
not under SELinux.** As built, the status line's fill starts at the page's issue, before the downloader dials, so it is
the *longer* of the two by 12–30 ms on loopback (the amendment had it the other way); ratios are unaffected. The beacon
is to become a switch over the product's load report ([`load-report.md`](load-report.md)).

## 3 · The first run (2026-11-11 evening): what it counted

**Fixtures:** one Galaxy S23 (Android 16, Chrome 157), one Fedora laptop without root, one home router, one evening;
series `dbts_b1-q8-g8` (50 frames, 23,208,296 B) and its exact series; run commit `962226e8`, not the demo commit; 48
counted loads. Raw rows `claude/fill-split:docs/phone-rows/raw/` (not read here; 54k lines).

**Correctness, per load** (§7's rule, from the beacon; the run session and the blind read agree):

| link | passed | failed | missing |
| --- | --- | --- | --- |
| tether | 23 | 0 | 1 (load 7: the tether came back on another address after USB debugging was toggled) |
| Wi-Fi, server wired | 22 | 2, both `bbr`: load 6 (worker) and load 13 (page) | 0 |

Every passing load received 50 of 50 frames, all `av1-webcodecs`, no error, labels *Optimal quality* → *fetching
lossless…* → *Lossless* → *Optimal quality*. Load 6 ended on *Lossless check failed* with its exact session at a
handshake only ([`lossless-after-a-failed-ask.md`](lossless-after-a-failed-ask.md)); load 13 received 29 of 50
([`hidden-page-decode.md`](hidden-page-decode.md)).

**Where the run departed from the protocol** (run session, README §Where the run departed): load 7 missing; loads 6
and 8 run a second time and load 9 interrupted, all three left out by id (the first, failed, load 6 stands); the gap
not always 15 s (the page's timer stops while the screen sleeps: 170 s before load 9, 148 s before load 11, 1 237 s
before load 12); the owner touched the phone during counted loads (Settings, around load 13); Chrome had 53 tabs open;
**the prod-like check was not run**; no Wi-Fi eye verdict exists.

## 4 · The blind read (2026-11-12, by a session that wrote none of the protocol and ran none of the loads)

It read the raw rows and the protocol alone, then compared the run session's README. It agrees on correctness, all
four six-octet fill verdicts, the loss table, the round trips and the wire times. **Three of its thirteen differences
matter:**

1. **The 10-minute rule fired.** Octet 1 took 99 minutes (21:13:47 to 22:52:51), mostly the stop after load 6 and the
   gaps; by its letter the run stops after octet 4, and read so **every fill comparison is *not decided*** (tether 7
   ratios each, Wi-Fi 6, under the 8 the rule needs). Octets 5 and 6 ran anyway. The rule names no exception for time
   stopped after a failure.
2. **The run commit's reach.** `962226e8` differs from the demo commit `157b7109` (not its ancestor) in 20 files on the
   fill's path (`client/decode/av1-webcodecs.js`, `av1.js`; `client/view/controller.js`, `view-worker.js`, `view.js`;
   `client/viewer/head.js`, `viewer.js`; `server/src/main.rs`, `transport/tuning.rs`, … listed in the blind read §7
   item 2). **By the run-commit rule no verdict carries to the demo commit.**
3. **Loads 6 and 10 were slow decodes, not the wire** (median 524 and 872 ms a frame against 124–179 ms; wire about
   1 and 1.5 s) ([`fill-bound-on-phone.md`](fill-bound-on-phone.md)).

**For the owner, still owed** (`claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §5): whether the 10-minute rule
stands as written or the six-octet reading is accepted as a departure; whether the two `bbr` failures withdraw `bbr`
under the Amendment's rule; that no verdict carries to the demo commit. The next round's amendment waits for a
hands-off runner (the run needed a start tap and three pauses' taps, and a sleeping screen stopped it).

**Verdict, scope:** the method is pre-registered and was followed except where §3 says; the first run decides
correctness per load on one phone, one link, one evening, at the run commit, and decides no speed comparison by its
own rule unless the owner accepts the departure.
