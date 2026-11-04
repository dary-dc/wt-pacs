# Top first: the split's high bits shown before its low bits

*Row TOPFIRST. Theory and a protocol, 2026-11-04; nothing in this file was measured for it. Every number is
read off committed tables and marked* derived *where it is computed from them.*

## Top first protocol, pre-registered

**Asked.** Can a slice be shown from its top stream alone while its low stream is still on the wire, when would that
picture appear against the scalable (SVC) base and HTJ2K, and what does it cost?
**Answer, derived.** Yes, and within one frame the payload already sends the top first, so no format change is
needed for that; but the top is 63–71 % of the bytes, so it is a late, near-exact preview, not a fast one.
**The numbers that decide it.** At 20 Mbit/s the top-only first picture is predicted 0.12–0.29 s before the
shipped payload's (≈ 0.64–0.91 s, against the SVC base's 0.07–0.10 s and HTJ2K's 0.73–1.12 s), and every slice has
its top at 0.63–0.71 of the shipped payload's time to exact (17.9–25.5 s, against the SVC base's 0.24–0.45 s).
**It rests on** the per-slice byte arrays of three DBT volumes, `dbts_a1`, `dbts_b1` and `dbts_c1`, and on decode
times measured on 16 slices of each; it claims nothing for other series.
**Left:** the measurement below, for a separate session; Firefox's path; and the owner's call on whether a picture
off by at most 3 source levels at two-thirds of the exact time is worth a change to the store.

### Terms

* **The split.** The shipped lossless AV1 payload ([`payload-format.md`](payload-format.md)) codes a sample v of b
  bits as two AV1 streams: the **top stream**, v ≫ k, and the **low stream**, v & (2^k − 1), an 8-bit stream.
  For these volumes k = 2, so the top is 10 bits (b = 12) or 8 bits (b = 10) and the low holds the two lowest bits.
  The decoder rebuilds v = (top ≪ k) | low.
* **Top-only picture.** top ≪ k shown before the low arrives: every sample is v − low, so it is off by 0 to
  2^k − 1 = 3 source levels, never more. It is a **preview** in [`../glossary.md`](../glossary.md)'s sense: shown
  before the exact picture and replaced by it.
* **SVC base.** In the scalable-preview work (branch `claude/av1-svc-preview`) a slice is coded as
  layers of one scalable AV1 stream; the base is a quarter-size lossy picture sent for every slice before any
  exact frame (layer-major order). Its timings are in that branch's (at `f4c396c8`)
  `lab/av1/delivery/scalable/tool/svc-results.md` (20 Mbit/s and `none`), `svc-results-r5000.md` and
  `svc-results-r50000.md`.
* **`k2`.** The shipped payload, split at k = 2, `allintra` 7, decoded by the product through WebCodecs (both
  streams ≤ 10 bits).
* **Systems A, B and C.** The three digital breast tomosynthesis (DBT) reconstruction systems of the EA1141
  collection ([`../FIXTURES.md`](../FIXTURES.md) §AV1 data): A and C reconstruct at 12 bits, B at 10.
  `dbts_a1` is 56 × 1142×1785 from A; `dbts_b1` 50 × 2560×3328 from B; `dbts_c1` 69 × 976×2513 from C.
* **t_X**, seconds from the fill's issue until every slice is exact; **t_T,all**, until every slice shows its
  top-only picture or its exact one; **first picture**, until any slice shows anything.

### 1 · Can the top be sent first without changing the format?

**Within a frame: it already is.** [`payload-format.md`](payload-format.md) §Payload: "frame := … u32le top length ·
top unit · low unit when split > 0", after a 16-byte header and one 4-byte length (n = 1). The wire carries the
entry as stored: "The coded frame is the bundle's entry as stored, whatever its codec" ([`../WIRE.md`](../WIRE.md)
§The envelope). So the top's last byte is byte 8 + 24 + top length of the envelope, and every byte after it is the
low. Nothing in the format, the store, the server or the wire changes. What changes is the client: today "a frame is
complete when its envelope's last byte arrives" ([`../WIRE.md`](../WIRE.md)), and the transport reads the whole
envelope into one buffer before the decoder sees it (`client/transport/ts/frame-session.ts`, its BYOB read). It
would read the envelope in two reads and hand the prefix to the decoder first. This is **top first in the frame**.

**Across the series: not without a change to the store.** One entry holds a slice's top and low together, so the
tops of every slice can come before any low only if they are separate entries: entry i the top of slice i, entry
F + i its low, as [`adr-unit.md`](adr-unit.md) §5 lays out a scalable frame's layers (its option A: "the top entry
holds only the top's OBUs"; there the base). That changes the bundle's layout and metadata, the ingest and the
downloader, which joins two entries into one exact frame: structural, proposed only if measured worth it. This is
**top first in the series**. Its bytes, *derived*: each slice gains a second payload header (16 B), a length (4 B)
and an envelope head (8 B), and loses the 4-byte top length, so +24 B a slice, under 3 × 10⁻⁵ of the payload. Sending the top
twice instead (option B's shape, top entries plus whole payloads) would cost 63–71 % more bytes, *derived* from
the table below, and is not considered further.

### 2 · The top's share of the bytes, derived

From the per-slice arrays committed on `claude/av1-profile-carriers` at `ec0e991e`
(`lab/av1/delivery/carriers/results/dbts_{a1,b1,c1}.json`): `k2_bytes`, each slice's shipped payload, whose sums
equal the shipped bytes of the SVC branch's `svc-shapes.tsv` to the byte, and `low_bytes`, each slice's low stream
as the SVC tool coded it (`low.ivf`, not read out of the shipped payloads). The top is taken as `k2_bytes −
low_bytes`, so it includes the payload's 24 bytes of framing and any difference between the tool's low coding and
the shipped one; stage 1 below reads the exact top length out of each payload.

| volume | b, top | slices | top, MB | low, MB | top ÷ payload, whole | per slice, min–max | top ÷ HTJ2K |
| --- | --- | --: | --: | --: | --: | --- | --: |
| `dbts_a1` | 12, 10-bit | 56 | 44.8 | 19.5 | 0.697 | 0.665–0.699 | 0.661 |
| `dbts_b1` | 10, 8-bit | 50 | 63.7 | 37.1 | 0.632 | 0.630–0.635 | 0.593 |
| `dbts_c1` | 12, 10-bit | 69 | 47.2 | 19.7 | 0.705 | 0.703–0.709 | 0.668 |

The low two bits are 29–37 % of the payload: near the noise floor, they compress least
([`../../lab/av1/bytes/low-stream/README.md`](../../lab/av1/bytes/low-stream/README.md): "The low two bits cost AV1
1.34–2.01 bits a sample"). That is what makes the top cheap to show and expensive to wait for.

### 3 · When the top-only picture appears, derived

Where the link is the clock, a byte count over the link rate R is its time. The table's times are bytes × 8 ÷ R at
the nominal rate (the 5 Mbit/s sitting measured 4.87–4.91 Mbit/s, so they are a few per cent low there); a
fill's fixed overhead is not in them. *First picture, predicted* is the SVC sittings' measured `k2` first picture
minus slice 0's low over R, the gain top first in the frame would make on a link-bound cell, *derived* across
sittings.

| volume, R | slice 0 low, s | `k2` first picture, measured 1× · 4× | top-only first, predicted 1× · 4× | all tops, s | `k2` t_X, wire, s | HTJ2K, wire, s |
| --- | --: | --- | --- | --: | --: | --: |
| `dbts_a1` 5 Mbit/s | 0.58 | 2.59 · — | 2.01 · — | 71.7 | 102.9 | 108.5 |
| `dbts_a1` 20 | 0.15 | 0.81 · 1.07 | 0.66 · 0.92 | 17.9 | 25.7 | 27.1 |
| `dbts_a1` 50 | 0.06 | 0.53 · 0.87 | 0.47 · 0.81 | 7.2 | 10.3 | 10.8 |
| `dbts_b1` 5 | 1.16 | — · — | — · — | 102.0 | 161.4 | 171.9 |
| `dbts_b1` 20 | 0.29 | 1.20 · 1.71 | 0.91 · 1.42 | 25.5 | 40.3 | 43.0 |
| `dbts_b1` 50 | 0.12 | 0.85 · 1.77 | 0.73 · 1.65 | 10.2 | 16.1 | 17.2 |
| `dbts_c1` 5 | 0.49 | 2.54 · 2.88 | 2.05 · 2.39 | 75.6 | 107.1 | 113.1 |
| `dbts_c1` 20 | 0.12 | 0.76 · 1.03 | 0.64 · 0.91 | 18.9 | 26.8 | 28.3 |
| `dbts_c1` 50 | 0.05 | 0.48 · 0.81 | 0.43 · 0.76 | 7.6 | 10.7 | 11.3 |

A dash: the 5 Mbit/s sitting kept no `k2` visit in that cell. Against the SVC base, measured in the same sittings:
first picture 0.07–0.10 s at 20 Mbit/s 1× (0.11–0.16 s at 4×), 0.07–0.10 at 50 Mbit/s 1×, 0.08–0.12 at 5 Mbit/s
1× (`a2-*` and `p2-*`); a base on every slice 0.24–0.45 s at 20 Mbit/s 1×. HTJ2K's first exact slice: 0.73–1.12 s at 20 Mbit/s 1×,
0.44–0.77 at 50, 2.58–3.91 at 5.

**What it says.** Top first in the frame takes one low's wire time off each slice's first picture: 0.05–1.16 s,
largest on `dbts_b1` (whose 8-bit top leaves 37 % of the bytes in the low) and at 5 Mbit/s. That puts its first
picture near HTJ2K's first exact slice, still 6–10× the SVC base's. Every slice gets its top only a low's time
before its exact frame, so t_T,all is t_X less one low, about t_X. Top first in the series puts every top up at
0.63–0.71 of `k2`'s t_X (0.59–0.67 of HTJ2K's), against 0.009–0.018 for the SVC base at 20 Mbit/s. The SVC rule's
preview clause, "t_P ≤ 0.2 × HTJ2K's exact series" (§4), fails by 3×, *derived*. What top first offers in exchange
is fidelity: the top-only picture is off by at most 3 levels, where the SVC base is off by up to 1 098–1 500 and a
full-size SVC middle by 229–560 (`svc-shapes.tsv`, max |Δ|). Through each volume's own window (a width of 717,
512 and 969 levels over 256 display levels, from the series headers in the carriers JSON) 3 levels is about 1.1,
1.5 and 0.8 display levels, *derived*. Assuming the low bits uniform (*unverified*: stage 1 measures it), its
PSNR against the full range is 66.8 dB at 12 bits and 54.8 dB at 10, *derived* from MSE = (0 + 1 + 4 + 9) ÷ 4.

**Decode of the top alone**, measured by the decode breakdown on the middle 16 slices of the same three volumes
(`good` 6, not the shipped `allintra` 7; Chromium 141; [`../../lab/av1/decode/breakdown/report.md`](../../lab/av1/decode/breakdown/report.md)
§Stages, W), each stream's own time, ms, 1× · 4×: top 96 · 378, 170 · 668, 93 · 354; the whole frame through
WebCodecs, both streams at once, 113 · 438, 233 · 930, 112 · 431. On WebCodecs the top is the longer stream on A
and C and level with the low on B, so showing the top from a complete envelope gains only the merge on
WebCodecs; on dav1d-WASM, which decodes one stream after the other, the low is 36–39 % of the frame (§Stages, D),
*derived*. Where the client could fall behind: one decoder places a top every 96–378 ms; the top of a slice of
`dbts_a1` takes 0.33 s on the wire at 20 Mbit/s and 0.13 s at 50. So at 4× on 20 and 50 Mbit/s the top phase
of top first in the series is predicted to be CPU-bound on one decoder, *derived*; how many decoders the rig runs
decides it, and stage 2 records it.

**Client work, derived from the code.** `client/decode/decoder.js` already posts a preview (`preview: true`) and
then the exact frame, and the rig's checks already count late and stray previews. A top-only frame is
`end(begin(top, payload))` of `av1-frame.js` without the low (`place` with the shift and no OR), into its own
buffer, since the exact frame's buffer is written in place: one more output buffer a frame in flight (2 bytes a
sample: 17 MB for a `dbts_b1` slice) and one more pass. Top first in the frame needs the transport to post a
prefix; top first in the series needs the downloader to hold each slice's top until its low arrives, and to join
the two into the shipped payload, byte for byte, before the product decodes it. Neither form has a production
check for the preview: the frame digests cover the exact samples only
([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §2), so a top-only picture would be
shown unchecked until its exact frame replaces it.

### 4 · The protocol

For a separate session that reads only this section. Budget **≤ 4.5 h on a 4-vCPU cloud host**, ~15 GB of disk
free after the fetch. Headless Chromium 153, as the SVC sittings, for every visit. Planned: setup (tools, fetch,
payloads, HTJ2K, the rig ported) ≤ 1 h, stage 1 ~20 min, stage 2 ~2 h 20 min, the write-up ~30 min.

**Fixtures.** `dbts_a1`, `dbts_b1` and `dbts_c1`, fetched by `lab/av1/fetch_data.sh` and SHA-256-checked by it. The
repo has few cine-like breast series and repeated searches found no more; every result is claimed for these three
volumes only.

**The rig.** The SVC sittings' total-time rig at `f4c396c8` (branch `claude/av1-svc-preview`): take
`lab/av1/delivery/total-time/` and `lab/av1/delivery/scalable/tool/` from that commit, and keep this branch's
`client/` (the product as it ships; the two differ in `client/decode/`). If the rig does not run against this
client within 30 minutes of porting, run the whole of `f4c396c8` instead and record which. A fresh server, relay
and browser a visit; links `r5000`, `r20000`, `r50000` (fixed rate, 20 ms each way); CPU 1× and 4×
(`lab/scripts/cpu_throttle.mjs`). New code goes in `lab/av1/delivery/top-first/`; the product's files are not
changed.

**Arms**, all from the same shipped payloads (`split-rule/make_frames.py --preset allintra:7 --k 2`):

| arm | what is sent, in what order | what the client does |
| --- | --- | --- |
| `htj2k` | the served HTJ2K, slice order | as shipped |
| `k2` | the shipped payload, slice order | as shipped |
| `k2-aa` | the same as `k2`: the A/A arm | as shipped |
| `tf-frame` | the same bundle as `k2` | a lab copy of the transport reads each envelope in two reads (head and payload up to the end of its top, then the rest) and posts the prefix; the worker wraps the top unit as a top-only payload (below), decodes it through the product's `av1.js`, posts top ≪ k as a preview, then decodes the whole payload as shipped |
| `tf-series` | 2F entries: entry i a top-only payload of slice i, entry F + i a low-only payload, one `stream_frames` over all | the worker posts entry i's top ≪ k as a preview and keeps its bytes; at entry F + i it rebuilds the shipped payload from the two units and decodes it through the product's `av1.js` |

A **top-only payload** is a valid shipped payload with split 0: bits b − k, depth the top's (10 for A and C, 8 for
B), the top unit as its one frame. A **low-only payload** is bits 8, depth 8, split 0. Both are cut from the shipped
payload's bytes, nothing re-encoded. Both `tf-*` arms decode the top twice, once for the preview and once inside the
whole payload; decoding it once and OR-ing the low into the placed top (what `begin`/`end` already do in two passes)
is the product form, not measured here, so their t_X is an upper bound for it.

**Stage 1, offline (~20 min).**

1. Every payload of the three volumes: the top length field and the low unit's length; the top's share per slice and
   whole, which replaces §2's.
2. Every top-only and low-only payload cut and rebuilt: the rebuilt payload equal to the shipped one byte for byte.
3. Every top unit decoded by native dav1d 1.5.4 equal to the source ≫ 2, sample for sample, in the source's type.
4. The top-only picture's error against the source, per slice: max |Δ|, PSNR over the full range, the share of
   samples whose low bits are each of 0–3, and through each series' window (as the SVC tool's `layer_error.py`) the
   share of pixels that move by at least one display level.
5. Decode, through the product's `av1.js` in headless Chromium, every 8th slice (23 frames): d_T, the top-only
   payload, and d_X, the whole payload, the two interleaved frame by frame, 1× and 4× interleaved, 5 rounds.

**Stage 2, end to end (~2 h 20 min of visits).**

* **Whole fills** at `r20000` and `r50000`, 1× and 4×: 12 cells × 5 arms, **3 rounds** (~33 min a round, *derived*
  from the wire times in §3 plus ~10 s a visit).
* **Head fills** at `r5000`, 1× and 4×: bundles of each volume's first 8 slices only, built as above for every arm
  (`tf-series`: 16 entries), 6 cells × 5 arms, **3 rounds** (~14 min a round). A whole fill at 5 Mbit/s takes
  105–175 s a visit and does not fit the budget; t_X and t_T,all at 5 Mbit/s for the whole volumes are therefore
  **derived** from the head fills' measured wire rate and the bytes, and said so.
* **Order.** Every round runs every cell; cells in a Williams order (`lab/order.mjs`), the arms in a Williams order
  inside each cell, so no arm always runs first or last; each `run.mjs` process's temporary directory removed after
  its round (the SVC sitting's disk filled without it). Three rounds is the fewest at which `lab/scripts/aa_rule.py`
  can flag a difference at all (its `can_flag`), so a session that cannot finish three rounds of a fill kind
  reports those cells as not decided.
* **Per visit:** per slice, t_T(i) when its top-only picture reached the page and t_X(i) when its exact frame did;
  first picture; t_T,all; t_X; wire bytes; the rig's `VOID` flag (the relay's self-timing). On the scroll at 15
  slices/s from the issue, the share of slices reached that show the top, the exact frame or nothing, as the SVC
  tables read it off the per-frame times.

**Checks, every visit, `VOID` ones included.** (a) Every exact frame against its frame digest. (b) Every top-only
picture against the SHA-256 of (source ≫ 2) ≪ 2 as the page holds it (the rig's `previewTruth`). (c) No top-only
picture posted after its exact frame (`late`), none posted as exact (`stray`).

**Mutations**, each run once on `dbts_a1` at `r50000` 1× before stage 2, each to be caught, or the check is mended
and the mutation run again:

| mutation | caught by |
| --- | --- |
| one sample of one exact frame flipped (the rig's `--mutate sample`) | (a), that frame |
| the preview as (top ≪ 2) \| 1 | (b), every slice |
| the preview shifted by 1, not 2 | (b), every slice |
| `tf-series` joins entry F + i with the top of slice i + 1 | (a), every slice but the last |
| the low dropped: the exact frame built as top ≪ 2 | (a), every slice whose low bits are not all 0 |
| the preview posted after its exact frame | (c) `late` |
| the preview posted unmarked | (c) `stray` |
| stage 1.3 compared against source ≫ 1 | stage 1.3, every slice |
| stage 1.2 with one byte of one low unit changed | stage 1.2, that slice |

**Host.** Report per cell what the clock is: wire bits ÷ the last byte's time against R, the last exact frame's lag
behind the last byte, and t_X at 4× ÷ at 1×. A cell is link-bound when its arms' t_X follows their bytes ÷ R and 4×
does not move it; where 4× moves it, the CPU is the clock, and that cell's result is about this host's three slowed
cores, not a client's. The browser's receive ceiling, ~100 MB/s ([`../rig-limits.md`](../rig-limits.md) §1), is far
above 50 Mbit/s; the relay's `VOID` rate is reported per cell. Nothing is claimed past the fastest link run.

**What is quoted.** Latencies: seconds from the fill's issue, medians and ranges over kept visits, and each arm's
round-paired ratio to `k2`. Bytes as shares. No throughput.

**Against the SVC base.** No SVC arm runs here: building its streams does not fit the budget. Its numbers are the
SVC sittings', bridged through `k2`, which both sittings run: each SVC figure ÷ that sitting's `k2` in the same cell,
against each `tf-*` figure ÷ this sitting's `k2`. The comparison is *across sittings* and says so.

**Decision rule.** Each clause names its source; none is set here.

1. **Exact or refused.** An arm with any exact frame wrong, any top-only picture unequal to (source ≫ 2) ≪ 2, or any
   late or stray preview, in any visit, is refused (the per-frame check,
   [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §2, 3: "the frame is not shown as exact"
   on a mismatch).
2. **Cost.** "t_X within 1.10× and bytes within 1.02× of the shipped representation's" in every cell run: the SVC
   protocol's cost clause (`docs/av1/README.md` at `f4c396c8`, §The scalable preview as a tool, 5), so the two
   previews are held to the same bar.
3. **A fast preview?** The same protocol's "t_P ≤ 0.2 × HTJ2K's exact series", with t_T,all for t_P, at 5 and 20
   Mbit/s, 1× and 4×, on at least two of the three volumes. §3 predicts it fails by about 3× for both arms.
4. **A first picture worth a client change?** `tf-frame`, which changes nothing but the client, is proposed if it
   passes 1 and 2 and its first picture is earlier than `k2`'s beyond the A/A resolution (`aa_rule.py`) and by at
   least 0.2 × `k2`'s first picture, on at least two volumes in every cell run. The 0.2 is the ordering rule's
   "E ≥ 0.2 × T" ([`README.md`](README.md) §Whether readers need some frames first — the rule, stated before the
   estimate), its bar for a change to the first picture to earn its place, applied here to the same quantity. §3
   predicts 0.10–0.24 of `k2`'s first picture, under 0.2 on every volume at 50 Mbit/s: a fail as written.
5. **`tf-series`** passes or fails 1–3 as written. If it passes 1 and 2, what it offers — a picture within 3 levels
   at t_T,all, against the SVC middle's full-size picture within 229–560 levels sooner — is a trade no clause here
   prices. The owner decides it, from the tables; it changes the store, so it would be proposed separately.

**Stop rule.** Push the rows after every round. At 4.5 h, stop at the round's end, report each cell's n, and mark any
clause a missing cell would decide as *not decided*.

**Results go** to a README in the new lab directory above (commands, rows, the tables) and a *Measured* paragraph under
this section; this section is not edited after the measurement starts, except to correct a fact, in place and dated.

## Top first, measured

*2026-11-04, a separate session given only §4. Harness, rows and tables: [`lab/av1/delivery/top-first`](../../lab/av1/delivery/top-first/README.md).*

**Run.** §4 as written: stage 1 offline on all 175 slices, and stage 2's five arms over 270 visits, three rounds of every cell.
**Shows.** Both forms are exact (clause 1 passes). Top first in the frame takes 4–29 % off the first picture when the link is the clock, but no time off a whole series.
**Verdict.** By the rule, neither form passes: both fail clause 2 where this host's CPU is the clock, both fail clause 3 by 3–5×, and `tf-frame` is not proposed (clause 4).
**Rests on** three DBT volumes, `dbts_a1`, `dbts_b1` and `dbts_c1`, on one 4-vCPU host, and is claimed for those only.
**Left:** Firefox; any link above 50 Mbit/s; the owner's call on `tf-series` (clause 5), which this run does not price.

### Terms used here

* **Visit**: one fill of one arm, in a fresh server, relay and browser.
* **VOID**: a visit the relay's self-timing condemns (p99 over 1 ms). It is checked but not timed.
* **Kept**: the visits that are not VOID.
* **Head fill**: a bundle of a volume's first 8 slices, at 5 Mbit/s only (§4).
* **÷ k2**: the median over rounds of each round's value divided by `k2`'s in the same round and cell.
* **A/A**: `k2-aa`, the same bytes as `k2` run as a second arm. Its spread is the resolution `aa_rule.py` holds every other arm to.
* **Link-bound**: the last byte arrives at R and 4× does not move t_X.
* **CPU-bound**: 4× moves t_X.

### What ran, and where it departs from §4

* **Rig.** f4c396c8's total-time rig, ported. This branch's `client/` is unchanged.
* **Browser and decoders.** Headless Chromium 153. All 11 220 exact AV1 frames decoded through WebCodecs and every HTJ2K frame through OpenJPH. dav1d-WASM was not built and was never needed.
* **`tf-frame`'s entries.**
  * The lab transport delivers slice i's prefix as entry 2i and its whole payload as entry 2i + 1, in groups of 2. The downloader's own group rule then gives both to one decoder, prefix first, which is §4's "posts the preview, then decodes the whole payload".
  * A first build left the two to separate decoders. That build posted 23 of 56 previews after their exact frame on `dbts_a1` at 50 Mbit/s, so it was replaced before any measured visit.
* **`tf-series`'s tops.** A slice's low may reach a different decoder than its top, so the workers share each top-only payload over a `BroadcastChannel`. The product form would hold the tops in the downloader instead.
* **Check (a).** Each exact frame is checked against the SHA-256 the fetch wrote, not against the product's XXH3 digests.
* **Restart.** The container restarted during round 2. Six whole-fill visits were run again under round 2: all of `dbts_c1` at 20 Mbit/s 1×, and its 4× `tf-series` visit. Round 2's head fills were also run then. Their arm order is not the Williams order.
* **One check mended.** The mutation "preview posted unmarked" first showed only 1 stray on `tf-frame`, because the page maps its entries to half-integers. The stray check was mended and the mutation run again: 56 strays.

### Stage 1, offline

| volume | top ÷ payload, whole · per slice | rejoined | tops = source ≫ 2 | max \|Δ\| | PSNR, dB | low bits 0 · 1 · 2 · 3 | pixels moved ≥ 1 display level |
| --- | --- | --- | --- | --: | --- | --- | --- |
| `dbts_a1` | 0.697 · 0.665–0.699 | 56/56 | 56/56 | 3 | 68.3–69.2 | 50 · 17 · 17 · 17 % | 24–29 % |
| `dbts_b1` | 0.632 · 0.630–0.634 | 50/50 | 50/50 | 3 | 59.3–59.5 | 74 · 9 · 9 · 9 % | 17–18 % |
| `dbts_c1` | 0.705 · 0.703–0.709 | 69/69 | 69/69 | 3 | 69.8–71.0 | 66 · 12 · 12 · 12 % | 11–14 % |

* The top's share is the one §2 derived, to the third digit.
* The low bits are not uniform: a third to three-quarters of samples carry 0. So §3's PSNR, which assumed them uniform, is low by 1.5–4.6 dB.
* The display window is each series header's: SIGMOID 1958/717 for A, LINEAR 512/512 for B, SIGMOID 2718/969 for C.
* "Moved" is the share of pixels whose display level changes between the top-only picture and the exact one. It is far from §3's "about 1 display level" reading of the error.
* Both stage-1 mutations failed as they should: a low byte changed gave 55/56 rejoined, and a comparison against source ≫ 1 gave 0/56 tops equal.

**Decode, item 5** (5 rounds, every 8th slice, 1× and 4× interleaved), median ms:

| volume | 1× d_T · d_X | 4× d_T · d_X | d_T ÷ d_X | exact |
| --- | --- | --- | --- | --- |
| `dbts_a1` | 99 · 98 | 391 · 372 | 1.02 · 1.07 | 140/140 |
| `dbts_b1` | 169 · 189 | 697 · 786 | 0.91 · 0.91 | 140/140 |
| `dbts_c1` | 89 · 89 | 362 · 357 | 0.99 · 1.04 | 180/180 |

The top alone decodes no faster than the whole frame on WebCodecs, as §3 expected: WebCodecs decodes the two streams at once.

### Stage 2, end to end

**Checks, every visit, VOID included: clause 1 passes for both arms.**
* Every arm: 2 244/2 244 exact frames.
* Both `tf-*` arms: 2 244/2 244 top-only pictures equal to (source ≫ 2) ≪ 2, 0 late, 0 stray.
* VOID: 3 of 270 visits (`k2-aa` `dbts_c1` 20 Mbit/s 1×; `tf-frame` and `tf-series` `dbts_a1` head, 5 Mbit/s 1×). n is 3 a cell everywhere else.
* Mutations on `dbts_a1` at 50 Mbit/s 1×, each caught:

| mutation | result |
| --- | --- |
| `--mutate sample` | 0 exact and 0 previews equal, every arm |
| preview (top ≪ 2) \| 1 | 0/56 previews equal |
| preview shifted by 1 | 0/56 previews equal |
| `tf-series` joins the next slice's top | 1/56 exact |
| low dropped | 0/56 exact |
| preview held until after its exact frame | 56 late |
| preview posted unmarked | 56 stray |

**Host.** 4 vCPU at 2.1 GHz and 15 GB. The relay has a core of its own; browser and server share three.
* **Link-bound** at 5 and 20 Mbit/s for every arm at 1×, and for HTJ2K, `k2` and `tf-frame` at 4×.
  * The last byte arrives at 0.977–0.979 of R.
  * The last exact frame lands 0.07–0.80 s after it (medians).
  * t_X at 4× ÷ 1× is 1.00–1.05.
* **CPU-bound** — the clock is this host's three slowed cores, not a client's:
  * 50 Mbit/s at 4×: `k2` itself 1.02–1.41×, `tf-frame` 1.75–2.31×, `tf-series` 1.72–2.05×.
  * `tf-series` at 20 Mbit/s 4×: 1.10–1.19×.
  * At 50 Mbit/s 1× the wire runs at 0.964–0.971 of R and `tf-series` lags it by up to 1.4 s.
* Nothing is claimed above 50 Mbit/s.

**Latencies**, s from the fill's issue, medians of n = 3 (2 where a VOID was dropped), each a ÷ k2:

| cell | `k2` first picture | `tf-frame` first ÷ k2 | `tf-series` first ÷ k2 | `tf-frame` t_T,all ÷ k2 · t_X ÷ k2 | `tf-series` t_T,all ÷ k2 · t_X ÷ k2 |
| --- | --- | --- | --- | --- | --- |
| 5 Mbit/s head, 1× | 2.54–3.82 | 0.709–0.734 | 0.708–0.730 | 0.954–0.975 · 0.998–1.016 | 0.639–0.709 · 0.999–1.000 |
| 5 Mbit/s head, 4× | 2.84–4.42 | 0.741–0.760 | 0.753–0.761 | 0.958–0.977 · 1.002–1.006 | 0.646–0.720 · 1.002–1.004 |
| 20 Mbit/s, 1× | 0.81–1.23 | 0.719–0.922 | 0.698–0.913 | 0.993–0.997 · 1.000 | 0.635–0.708 · 1.000–1.004 |
| 20 Mbit/s, 4× | 1.12–1.83 | 0.779–0.962 | 0.797–0.995 | 0.995–0.999 · 1.006–1.031 | 0.642–0.712 · 1.085–1.180 |
| 50 Mbit/s, 1× | 0.48–0.85 | 0.814–0.931 | 0.844–0.929 | 0.997–1.005 · 1.004–1.023 | 0.645–0.716 · 1.043–1.069 |
| 50 Mbit/s, 4× | 0.81–1.81 | 0.733–1.023 | 0.731–1.015 | 1.636–1.753 · 1.673–1.782 | 0.694–0.878 · 1.557–1.857 |

* **First picture, 20 Mbit/s 1×.** `tf-frame` 0.58–0.94 s, against §3's prediction of 0.64–0.91.
* **Every slice's top.** `tf-series` showed every slice's top at 18.5–26.3 s at 20 Mbit/s 1×, against §3's 17.9–25.5 s on the wire alone.
* **Every slice showing something.** `tf-frame` reached that point a low's time before t_X: 0.09–0.36 s of 26–41 s at 20 Mbit/s 1×.
* **Bytes.** `tf-frame` 1.00000 of `k2`'s; `tf-series` 1.00001–1.00002, which is +16 B a slice.
* **Scroll.** At 15 slices/s, every arm on every link showed nothing on 100 % of the slices a reader reaches: no arm's pictures arrive that fast here, so this reading does not separate the arms.

**5 Mbit/s, whole volumes, *derived*.**
* The head fills' wire rate measured 4.88–4.90 Mbit/s.
* At that rate HTJ2K's t_X is 111–176 s and `k2`'s 105–165 s.
* `tf-frame`'s t_T,all is 105–164 s (0.932–0.944 of HTJ2K's t_X); `tf-series`'s is 73–104 s (0.593–0.668).

**Against the SVC base, *across sittings*.**

| quantity, each ÷ its own sitting's `k2` | SVC base (f4c396c8's `a2-q20` rows) | `tf-frame` | `tf-series` |
| --- | --- | --- | --- |
| first picture, 20 and 50 Mbit/s | 0.070–0.157 | 0.719–1.023 | 0.698–1.015 |
| first picture, 5 Mbit/s | 0.026–0.049 | 0.709–0.760 | 0.708–0.761 |
| every slice showing something (t_P or t_T,all) ÷ `k2`'s t_X | 0.010–0.049 | 0.993–1.753 | 0.635–0.878 |

### The rule, as written

1. **Exact or refused.** Both arms pass: no wrong frame, no wrong top-only picture, no late and no stray preview, in any visit.
2. **Cost: both arms fail.** Bytes pass for both (1.00000–1.00002). t_X fails:
   * `tf-frame` is within 1.10× in every cell but 50 Mbit/s 4× (1.673–1.782).
   * `tf-series` fails at 20 Mbit/s 4× on `dbts_b1` (1.180) and `dbts_c1` (1.125), and at 50 Mbit/s 4× (1.557–1.857).
   * Each failing cell is CPU-bound on this host. The rule names no exception, so neither does this report.
3. **A fast preview: both fail.** t_T,all ÷ HTJ2K's t_X should be ≤ 0.2:
   * `tf-frame`: 0.936–0.955 at 20 Mbit/s, *derived* 0.932–0.944 at 5.
   * `tf-series`: 0.598–0.681 at 20 Mbit/s, *derived* 0.593–0.668 at 5.
   * §3 predicted about 3×: `tf-series` misses by 3.0–3.4×, `tf-frame` by 4.7–4.8×.
4. **`tf-frame` is not proposed.** It fails clause 2. Apart from that:
   * Its first-picture gain on `k2` reaches 0.2 beyond the A/A on at least two volumes only at 5 Mbit/s: gains 0.24–0.29, though `dbts_a1` at 1× had n = 2, too few for `aa_rule.py` to flag.
   * At 20 Mbit/s 1× two volumes clear 0.2 (gains 0.08, 0.25, 0.28), but `dbts_c1` cannot be flagged (its A/A arm kept n = 2), so only one counts.
   * At 20 Mbit/s 4× only one volume clears 0.2 (gains 0.04–0.22).
   * At 50 Mbit/s 1× none clears 0.2 (gains 0.07–0.19).
   * At 50 Mbit/s 4× only one clears 0.2 (gains −0.02–0.27).
   * §3 predicted 0.10–0.24 at 20 and 50 Mbit/s, a fail as written. That held.
5. **`tf-series`** fails clauses 2 and 3. It does give a picture within 3 levels of every slice at 0.64–0.72 of `k2`'s t_X where the link is the clock. Whether that trade is worth a change to the store is the owner's call, from the tables above; no clause here prices it.
