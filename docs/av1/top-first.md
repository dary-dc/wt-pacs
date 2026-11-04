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
