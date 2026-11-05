# Profile carriers: one layered AV1 stream, or separate payloads

## Profile carriers protocol, pre-registered

*Row CARRIERS, 2026-11-04. Theory, a prediction and a protocol, written before any number of its own; a separate
session runs the protocol and changes nothing in it. Every input below is a measured row of this repository, named
with its file and commit, or a source quoted verbatim. Arithmetic of ours is* derived*; what no source holds is*
unverified*.*

1. **Asked.** As the carrier of three quality profiles — a cheap view, a high-quality view, and the exact frame on
   request — is one layered AV1 stream better, or separate payloads?
2. **Answer, predicted (not yet measured).** Separate payloads, for the roles that view and ask: the exact frame on
   request costs one HTJ2K frame's decode instead of 23–41× it on average, and the high-quality view 0.55–0.65× the
   bytes at equal PSNR. The layered stream wins storage (about 6 % less) and nothing a role sees.
3. **What decides it.** The layered stream's exact layer is predicted from its own previous exact frame, so one asked
   frame costs its group's frames up to it: on average 4.5 exact frames to decode, and 2.5–4.5 to download.
4. **It rests on** three DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`), libaom 3.15.1's two encoders as the lab
   pins them, dav1d 1.5.4, OpenJPH, headless Chromium, and one 4-core cloud host. Nothing else is claimed.
5. **Left:** the measurement below; breast ultrasound cine and ABUS (no sound fixture yet); a layered exact layer
   predicted from its middle alone (not built); phones; and which quality is visually lossless, the owner's call.

### Terms

* **Profile** — what a role receives: the **cheap view** (e.g. a patient's), the **high-quality view** (most
  clinical roles; meant to be visually lossless, a threshold this document does not set), the **exact frame on
  request** (a high-quality viewer asking one frame bit-exact). In the US, MQSA binds how FFDM and DBT are
  interpreted ([`visually-lossless.md`](visually-lossless.md) on `claude/av1-visually-lossless`, `95357d8`); the
  question here is viability and trade-offs, not that ruling.
* **Profile carrier** — how a profile's pictures are coded, stored and sent. Two carriers are compared; "carrier"
  alone means a transport elsewhere in the repository ([`../ARCHITECTURE.md`](../ARCHITECTURE.md)), never here.
* **Layered carrier (SVC)** — scalable coding in layers: one AV1 stream whose temporal units each hold a quarter-size
  lossy **base**, a full-size lossy **middle** predicted from it, and the exact **top** predicted from the middle; a
  client takes a prefix of each unit. On 12 bits the stream codes the top 10 bits and the two low bits ride beside
  it, as the shipped payload splits them ([`payload-format.md`](payload-format.md)). This is `p3-m*` of
  [`README.md`](README.md) §The scalable preview as a tool, 10, measured in 11.
* **Separate carrier** — a lossy AV1 stream per profile, plus, for the exact frame, either the HTJ2K **residual**
  (exact − lossy, per sample, plus one offset, coded losslessly in HTJ2K) or the **whole HTJ2K frame**
  (`lab/av1/profiles/README.md` §1e on `claude/av1-quality-profiles`; `lab/av1/delivery/residual/README.md` on
  `claude/av1-residual-apart`).
* **G** — frames coded together: a keyframe every G frames, each frame of a group predicted from the one before;
  G = 1 codes each frame alone. **k** is the same for the layered stream's keyframe interval (8 measured).
* **Q** — the lossy quantizer, libaom's 0–63 scale: 2 near-lossless … 56 heavy. The layered stream's middle at
  quantizer m is written **m** (10, 20, 30); its base is at 40.
* **Systems A, B, C** — the three DBT scanners of the EA1141 dataset; A and C store 12 bits, B 10.
  `dbts_a1` is A's (56 × 1142×1785), `dbts_b1` B's (50 × 2560×3328), `dbts_c1` C's (69 × 976×2513).
* **Ask** — a request for one frame ([`../glossary.md`](../glossary.md)); **fill** — frames pushed in order;
  **unit** — one AV1 temporal unit.
* **Shipped payload** (`k2`) — the product's lossless AV1 at G = 1, split on 12 bits ([`payload-format.md`](payload-format.md)).

### 1 · The two carriers, role by role

| role | layered carrier: what the client downloads | separate carrier: what the client downloads |
| --- | --- | --- |
| cheap view | each unit cut after the base: the quarter-size base | its own lossy stream (here: full size, Q 56, G = 16) — or the very same quarter-size base, which it may also choose |
| high-quality view | each unit cut after the middle: base + middle | its own lossy stream at Q 8, 16 or 32, G = 16 |
| exact frame on request, frame k | the tops of k's group up to k (each top predicted from the one before), the low bits of k on 12 bits | the residual of k, added to the lossy frame on screen — or the whole HTJ2K frame k |
| **server stores** | the one stream (+ the low bits on 12 bits) | every lossy stream, plus the residuals or the HTJ2K frames |

### 2 · Theory, with the numbers it predicts

**2a. Why the layered exact frame is a group prefix.** The measured `p3-*` streams are libaom 3.15.1's
`svc_encoder_rtc` layering mode 6 ([`../../lab/av1/delivery/scalable/tool/README.md`](../../lab/av1/delivery/scalable/tool/README.md)
§SVC metrics: "mode 6, `-r 1/4,1/1,1/1`, quantizers 40, m, 0, a keyframe every 8"). That mode's top layer, verbatim
from `examples/svc_encoder_rtc.cc` at `v3.15.1` [C2]:

> `} else if (layer_id->spatial_layer_id == 2) {`
> `// Reference LAST and GOLDEN. Set buffer_idx for LAST to slot 2`
> `// and GOLDEN (and all other refs) to slot 1.`
> `// Update slot 2 (LAST).`

Slot 2 is written only by the top, so LAST is the previous unit's top: each exact top is predicted from the exact
top before it, and from its own middle (slot 1). A keyframe cuts the chain: AV1 [C1] §uncompressed_header syntax,
"if ( frame_type == KEY_FRAME && show_frame ) { for ( i = 0; i < NUM_REF_FRAMES; i++ ) { RefValid[ i ] = 0", and
"if ( frame_type == SWITCH_FRAME || ( frame_type == KEY_FRAME && show_frame ) ) { refresh_frame_flags = allFrames }".
So to show exact frame k at position j = k mod 8 the client decodes the whole units of its group from the keyframe to
k, j + 1 of them, and downloads their tops (*derived*). Over the 8 positions, asked alike: **4.5 whole-unit decodes and
4.5 tops an ask** on average, 1 at a keyframe and 8 at the group's end. The mode also gives the top a long-term
reference "Update every 10 frames" (`enable_longterm_temporal_ref`, default 1 [C2]); inside a group of 8 it can only
point back within the group, so it changes nothing above (*derived*).

What one unit costs, measured (`svc-results.md` §5 offline, `ee572f7`; one dav1d-WASM decoder in order, ms a frame):
`p3-m20`'s whole unit 229 · 388 · 221 ms at 1× and 1 021 · 1 685 · 936 ms at 4× on `dbts_a1` · `b1` · `c1`, against
HTJ2K's 26 · 93 · 28 and 125 · 385 · 131 — **the 3.4–9.2× a frame** of the row this protocol was given. The residual
apart (RESIDAPART, `lab/av1/delivery/residual/README.md` §Residual apart, measured, `6a2994f`, 60 rounds): the
residual's decode plus the add, with the lossy frame on screen, **0.97–1.00× an HTJ2K frame** on the three volumes
(24.9 · 72.8 · 26.3 ms at 1×), "the same" by its rule, 5 % not resolved.

*Predicted* (*derived*, those rows times 4.5): **a layered ask decodes on average 1.0 · 1.7 · 1.0 s at 1× and 4.6 ·
7.6 · 4.2 s at 4×, 23–41× an HTJ2K frame, and 5–9× at a keyframe, 40–73× at a group's end** — before the low bits'
decode on the 12-bit volumes, which adds to it. The separate carrier's ask: 0.9–1.1× an HTJ2K frame, residual or whole.

What it downloads: a top is 0.983–0.999 of a shipped frame's bytes in the predicted shapes (§The scalable preview as
a tool, 6). On the 10-bit `dbts_b1` the top is the whole frame, so an ask is (j + 1) frames: **4.5× a frame on
average**. On the 12-bit volumes the low bits are sent for k only, so an ask is (j + 1)·t + l, t the top's share of the
frame and l = 1 − t the low bits': (1 + 3.5 t)× a frame on average. The low two bits of a 12-bit DBT sample whose noise
σ is 13–18 (profiles bytes run, §σ, ρ, crossover, bend) are close to white noise, which no predictor removes, so l is
large; t is not measured, and a guess of 0.4–0.8 gives **2.4–3.8× a frame** (*unverified* until the harness reads t).
Separate: 0.95–1.00× an HTJ2K frame by residual (RESIDAPART's bytes table: 0.981–0.998 at its row-17 quality), 1×
whole.

**A dweller amortizes it.** A reader who asks k and then k + 1 in the same group pays one more unit for k + 1 if the
client keeps the decoder that reached k (*derived*). The protocol times the cold ask (a fresh decoder), the worst
case a jump makes, and states the mean over positions; a stepping reader sits between one unit and that mean.

**The layered carrier at its best for asks: a keyframe in every unit** (`p3k1-m20`, `-k 1`). Then LAST and GOLDEN
hold only the unit's own lower layers and an ask is one unit, 3.4–9.2× an HTJ2K frame (the row as given), still not
1×. Its price: the base and the middle lose their prediction from the previous unit. The profiles bytes run measured
what that costs a lossy full-size stream: G = 16 is **30–80 % smaller than G = 1 once Q passes the noise** (§Profiles
bytes, measured: 38.7 · 18.3 · 33.7 % at Q 16 on these three). *Predicted:* `p3k1-m20`'s base + middle 1.2–1.6× `p3-m20`'s,
its stored stream within +3 % of `p3-m20`'s (the tops dominate it and lossless tops gain little from the previous top,
[`frame-groups.md`](frame-groups.md) §4: lossless G > 1 was 0.2–2.9 % larger than intra on 12 of 15 volumes). That a
`-k 1` stream codes at all is *unverified*; the session says so if it does not.

**2b. The high-quality view: base + middle against one stream.** At m 20 the base + middle is 0.0077 · 0.0333 ·
0.0105 of HTJ2K's bytes (`svc-results.md` §7: `lossy-m20` ÷ `k2`, less the second copy of the base), at 46.2 · 45.8 ·
46.9 dB (`svc-errors.jsonl`, median frame, full size). The profiles bytes run's G = 16 streams (`results/cells.jsonl`,
`b9e3e9e`; the 10-bit stream on `dbts_b1`, the 10-bit top on the others) give, log bytes interpolated linearly in PSNR
between rungs as that run does (§5, *Derived per series*), **0.0042 · 0.0218 · 0.0060 of HTJ2K at the middle's PSNR —
0.55 · 0.65 · 0.57 of the layered carrier's** (*derived*: one run's series PSNR against the other's median frame; the
harness measures both one way). Three reasons stack, none separable from these rows: the separate stream codes no
base, aomenc's `--good --cpu-used=6` searches harder than `svc_encoder_rtc`'s speed 7, and its group is 16, not 8.
The bytes are small either way: at 5 Mbit/s 0.8 · 5.7 · 1.2 s of link for the layered view against 0.5 · 3.8 · 0.7 s.

Decode a frame: the middle on dav1d-WASM 37 · 119 · 39 ms at 1×, 163 · 520 · 172 ms at 4× (`svc-results.md` §5
offline, `p3-m20` base · middle). The separate stream through the same decoder: no row on the 10-bit forms — the
profiles decode pilot timed `dbts_a1` at Q 16, G = 16 at 70 ms (12 bits) and 32 ms through WebCodecs (the 10-bit
top), 5 rounds, discarded by its own protocol (§Profiles decode, measured). *Predicted, weakly:* on one decoder the
two are within 0.5–1.5× of each other; through WebCodecs, which a single-layer 10-bit stream reaches in Chromium and a
middle has no measured path to (the specification names no operating point, §The scalable preview as a tool, 9), the
separate stream decodes in ≤ 1.0× the middle's dav1d-WASM time. Every slice at this quality is decode-bound for both
above about 5 Mbit/s (F × d against bytes ÷ R, *derived* from the rows above), so time to every slice follows decode.

**2c. The cheap view.** The layered base is 15.7 · 42.1 · 24.5 kB a volume at 38.0 · 38.7 · 38.4 dB upscaled
(`svc-shapes.tsv`, `svc-errors.jsonl`); it decodes in 2–6 ms at 1×. The separate carrier may send exactly that stream
(the base of an SVC unit is a standalone stream, `lossy-q20` in 11), so for this role it cannot lose on bytes or
decode (*derived*). Its own full-size choice, Q 56 at G = 16, is 0.0002 · 0.0003 · 0.0002 of HTJ2K (about 14 · 32 · 14 kB) at 40.4 ·
39.4 · 41.0 dB (profiles bytes run): **predicted smaller and 0.7–2.7 dB better than the quarter base, at 5–20× its decode**
(16× the pixels). Either way the cheap view's bytes are under 0.05 % of the exact volume's.

**2d. Server storage** (*derived* from the rows named). The layered carrier stores one stream: `p3-m20` is 0.940 ·
0.947 · 0.937 of HTJ2K (`svc-shapes.tsv`, `total_bytes`), 0.989–1.009 of the shipped payload. The separate carrier
stores the cheap and high-quality streams (≤ 0.044 of HTJ2K) plus the exact: by residual, lossy + residual is 1.003 ·
1.001 · 1.002 of HTJ2K at Q 16, G = 16 (profiles bytes run), so ≈ 1.005; by whole frame, HTJ2K + the streams, 1.008 ·
1.043 · 1.012. **Predicted: layered 0.94, separate 1.00–1.05 of HTJ2K: the layered carrier stores 6–10 % less.** Not
counted on either side: what the archive keeps anyway (if it keeps HTJ2K or the shipped payload for exact fills and
export, the residual is stored on top of it and the whole-frame form costs only the streams).

**2e. The exact volume** (a reader who fills every frame exact, the product today). Measured in 11: `p3-m20` fills at
0.999–1.044× the shipped payload's bytes and time at 20 Mbit/s. The separate carrier fills with the shipped payload or
HTJ2K (1.055–1.065× `k2`), or lossy + residual (≈ 1.06× `k2`, *derived*). Not re-measured here.

**2f. Client complexity**, counted, not timed (*derived* from the files named):

| | layered | separate |
| --- | --- | --- |
| decoders | dav1d-WASM with an operating point for the base and the middle (`two-layer/dav1d_wrap_op.c`, lab only); the exact unit on WebCodecs ≤ 10 bits or dav1d-WASM | WebCodecs ≤ 10 bits or dav1d-WASM for the lossy stream; OpenJPH-WASM for the residual or frame (the product's) |
| new code paths | unit cutting by `spatial_id`; group-prefix decode for an ask; the per-group ingest gate (§The scalable preview as a tool, 8, S1, not built) | the integer add and its offset (lab `shared.js` on the profiles branch); group-prefix decode for the lossy view's own jumps (G = 16) |
| exactness hazards (part 8 there) | S1–S10; Firefox loses 43 of 50 split exact frames on the alone variants (S9, 11) | the lossy frame must be bit-identical to the encoder's for the residual to be exact: AV1 [C1] §7.2, "When film_grain_params_present is equal to 0, decoders shall produce output frames that are identical in all respects"; a hardware decoder's read-back is not measured (RESIDAPART §Unverified); the whole frame has no hazard |

### 3 · Predictions, each with what refutes it

Per volume, on the three DBT volumes. "Ask" is the mean over the eight positions of a group unless named.

| # | prediction | refuted by |
| --- | --- | --- |
| **C1** | A layered ask (`p3-m20`) decodes **15–60×** HTJ2K's frame at 1× and at 4×; at position 0, 3–15×; at position 7, 25–100× | a volume outside a band |
| **C2** | A layered ask downloads **2.0–4.0×** a shipped frame on the 12-bit volumes and **4.0–5.0×** on `dbts_b1` | a volume outside its band |
| **C3** | The separate ask decodes **0.85–1.15×** HTJ2K's frame, residual + add and whole alike, 1× and 4× | a volume outside the band |
| **C4** | `p3k1-m20` codes, and its ask decodes **3–15×** HTJ2K's frame; its base + middle is **1.15–1.8×** `p3-m20`'s bytes; its stored stream **0.99–1.05×** `p3-m20`'s | a volume outside a band |
| **C5** | At the middle's measured PSNR the separate high-quality stream is **0.4–0.8×** the layered base + middle's bytes at m 10, 20 and 30 | a (volume, m) outside the band |
| **C6** | The separate high-quality stream on dav1d-WASM decodes a frame in **0.5–1.5×** the paired middle's time; through WebCodecs in **≤ 1.0×** | a (volume, m, CPU) outside |
| **C7** | The separate cheap stream (Q 56, G = 16) is **≤ 1.5×** the quarter base's bytes at **+0.5 to +3.5 dB** in full-size PSNR, and decodes **3–30×** slower a frame | a volume outside a band |
| **C8** | Storage: layered **0.93–0.95** of HTJ2K; separate by residual **0.99–1.02**, by whole frame **1.00–1.06** | a volume outside a band |

**What would refute the theory as a whole:** a layered ask at position 7 within 2× of position 0 would mean the top
is not predicted through its group (2a's reading of mode 6 wrong); C5 above 1.0 would mean the base's cost and the
encoder's effort do not show at these PSNRs.

### 4 · The protocol

**Fixtures, and the only ones.** `dbts_a1`, `dbts_b1`, `dbts_c1` (`lab/av1/fetch_data.sh`, SHA-256-checked; one volume
a system). The repository holds few cine-like breast series and repeated searches found no more: the ultrasound cine
in it is lossy-sourced (`usb_cine`, `us_liver`, profiles README §3) and ABUS is absent, so no result here is claimed
for ultrasound, and every result is claimed for these three volumes only.

**Tools** (`lab/av1/delivery/carriers/run.sh tools`). `lab/av1/tools/tools.sh aom dav1d` (libaom 3.15.1, dav1d
1.5.4, OpenJPH 0.31.0); the patched `svc_encoder_rtc` by `encoder/build.sh`'s own steps, not the script, whose call to
`tools.sh` also builds SVT-AV1 and AVM; `ojph_compress` (`lab/scripts/gen_htj2k_fixtures.sh` builds it); the lab's
dav1d-WASM with operating points (`two-layer/build_wasm.sh`); the OpenJPH the fill's HTJ2K arm runs
(`client/decode/wasm/fetch_openjph.sh`); playwright's headless Chromium. From the profiles branch, at its tip **`b9e3e9e7119898e055bbf930d60ccbea2a234b48`**:

```bash
git checkout b9e3e9e7119898e055bbf930d60ccbea2a234b48 -- lab/av1/profiles     # never committed on this branch
lab/av1/.venv/bin/python -m pip install --require-hashes -r lab/av1/profiles/requirements.txt
```

**Content, coded** (`lab/av1/delivery/carriers/`, §5; times on 4 cores *derived* from the runs that coded them):

1. The shipped payload, HTJ2K and the low bits: `split-rule/make_frames.py … --preset allintra:7 --k 2` as the SVC
   sittings ran it (`tool/README.md`).
2. The layered streams: `tool/shapes.py --shapes three-full-m10,three-full-m20,three-full-m30` (~15 min), each
   total equal to `svc-shapes.tsv`'s byte for byte or the session stops; then `p3k1-m20`, the same encode at `-k 1`
   (`content.py`).
3. The separate streams: the profiles encoder at Q 8, 16, 32, 56 and G = 16 only, the 10-bit stream on `dbts_b1` and
   the 10-bit top on the 12-bit volumes, with the G = 16 residual (`content.py`, calling `streams.py`'s `lossy`, which
   stops unless each stream's unit sizes and residual equal the profiles bytes run's row).
4. `content.py` then writes, per volume, the index the browser reads, every lossy frame's reference hash from native
   dav1d, each layered ask decoded natively from its keyframe and checked exact, and the bytes and quality tables.

**Quality, one way for both carriers** (`content.py`): every lossy frame against the source at the stored depth b,
back at b (the middle and the base as `shape.base_quality` takes them; the separate stream as `p ≪ 2` on 12 bits);
**PSNR over the volume** from the summed squared error, peak 2^b − 1, and over in-window samples (the series' first
header window, as the profiles run defines them); max |Δ|. No threshold: whether a layer is visually lossless is not
this protocol's to say.

**The browser harness** (`ask.mjs` driving `ask.js` in `index.html`). Every AV1 arm on the same dav1d-WASM build, one
thread, a fresh decoder per timed operation, so no product tuning favours one; WebCodecs as the profiles decode
protocol configures it (`prefer-software`, `optimizeForLatency`) on the separate stream only; OpenJPH one thread.

| arm | clock |
| --- | --- |
| **ask** `svc` | `p3-m20`: from the group's keyframe unit handed in to frame k's merged exact samples: units g … k on the full operating point, and k's low unit on its own decoder on 12 bits |
| **ask** `svc1` | `p3k1-m20`: unit k alone, the same way |
| **ask** `res` | the residual of k decoded and added to k's lossy frame (G = 16, Q 16), which is decoded before the clock |
| **ask** `htj2k`, `htj2k-aa` | HTJ2K frame k; the second copy is the A/A arm |
| **ask** `k2` | the shipped payload's frame k, top and low |
| **view** `base` | every quarter base of the volume in order, one decoder (operating point of the base) |
| **view** `mid-m10`, `mid-m20`, `mid-m30`, `mid1-m20` | every base + middle unit in order (the middle's operating point) |
| **view** `sep-q8`, `sep-q16`, `sep-q32`, `sep-q56` | every unit of the separate stream in order, dav1d-WASM |
| **view** `wc-q16`, `wc-q56` | the same streams through WebCodecs |

Each ask arm asks frames k = g … g + 7 of the volume's middle group of 8 (g = 8 · ⌊F / 16⌋: 24, 24, 32), every position
once a round in a Williams order of the eight; the HTJ2K, residual and `k2` asks are positionless and take the same k.
A view arm records each frame's decode, so it gives the per-frame decode, the volume's total decode, and the first
frame's. Latency in ms only; no throughput is quoted (CLAUDE.md §Measurement).

**From the measured to each role's times** (*derived*, `roles.py`): with each frame's decode d_i and unit bytes b_i,
a fill of a role's quality on a link of rate R is the pipeline t_i = max(t₀ + (b_0 + … + b_i)·8 / R, t_{i−1}) + d_i,
t₀ = 40 ms (the rig's 20 ms each way). **Time to the first picture** is t_0, **to every slice** t_{F−1}, at R = 5, 20
and 50 Mbit/s, 1× and 4×, per arm. An ask on the link adds its bytes ÷ R before its decode. These are a model fed with
measured decode, not a fill: §The scalable preview as a tool, 6 found the bases' model 0.15–0.7 s against 0.28–0.61 s
measured; for the separate stream the model is *unverified* against a fill.

**Order, rounds, throttle.** One round is, at 1× and at 4× (`lab/scripts/cpu_throttle.mjs`, `throttleTree`), each
volume in a fresh headless Chromium, its arms in a Williams order (`lab/order.mjs`); throttles and volumes rotate by
round. Each browser first decodes two units on every decoder, untimed. **7 rounds**, fixed by the budget, not by a
power target (the profiles decode protocol asked for 315 and ran none); an 8th if at least 30 min of the 4.5 h remain
when the 7th ends. Every row carries the arm that ran before it; an arm whose order effect (largest |median by
predecessor ÷ median − 1|, RESIDAPART's statistic) exceeds 10 % is printed by `roles.py`, reported and not read. A
cell that has not ended in 15 min is closed, written `VOID`, counted, and not re-run.

**The budget, 4.5 h on 4 cores**, timed by this session on the host (§5) except where it says:

| step | time |
| --- | --: |
| tools, the WASM build, the volumes (not timed here as one step; the patched encoder alone 2.0 min) | 25 min |
| content: the shipped payload 7.6 min, the layered streams 6.7 min, `content.py` 17.0 min | 31 min |
| mutations, each once | 8 min |
| one round: 4× 20.3 min (`dbts_b1` 11.6 of it), 1× 4.5 min | 25 min |
| 7 rounds | 2 h 55 min |
| **total** | **3 h 59 min**, and 31 min for two `VOID` cells or the 8th round |

If a round takes over 30 min, from the next on drop at 4× first `mid-m10` and `mid-m30`, then `sep-q8` and `sep-q32`;
a dropped arm reports its n and is not read under n = 3. If the session must stop, it stops after a whole round and
reports n; 3 rounds is the fewest at which `aa_rule.py`'s test can flag at all (`can_flag(3)`).

**Saturation.** One decode in flight, one thread a decoder: at 1× one core of four; at 4× every thread at a quarter
of one, `cpu_throttle.mjs --check` printed and quoted. WebCodecs runs its own threads and is not a one-core figure.
The host does not saturate in any arm, and nothing is claimed past 4×, for concurrent asks, a phone or another host.
The role times past the decode are a model of a link, not a link.

**Checked, every round:** every exact frame (`svc`, `svc1`, `res` after its add, `htj2k`, `htj2k-aa`, `k2`) against
the checksum written at the fetch; every lossy frame (`base`, `mid-*`, `sep-*`, `wc-*`, the frame `res` adds to)
against native dav1d's; a miss voids that arm's (volume, throttle, round) and is reported. **Mutated once before the
campaign**, each must turn its check to failure and leave the others whole: a sample flipped (`--mutate sample`);
a truth flipped (`--mutate truth`); the residual's offset off by one (`--mutate offset`: `res` 0 exact, its lossy
frames still as native); an ask begun one unit after its keyframe (`--mutate skip`: `svc` fails at every position but
0, by a decoder error or a wrong frame); the low bits of the wrong frame (`--mutate low`: `svc` and `k2` 0 exact on the
12-bit volumes). `roles.py`'s arithmetic has its own tests, each mutated.

**Decision rule** (derived from the lab's A/A rule and from the definitions; no bar of ours):

* **Time metrics** (decode a frame, an ask, the volume's total decode, the role times): per volume and throttle,
  the separate arm against the layered arm of the same role is **decided** when both hold: `aa_rule.py`'s one-sided
  Mann–Whitney (`mw_greater_p`, α = 0.05) on their round-paired ratios over `htj2k` separates them, and the median of
  their paired ratio lies outside the range of `htj2k-aa ÷ htj2k` over the rounds. Otherwise **not resolved**.
* **Bytes and storage** are deterministic: any difference is a difference, reported with its ratio.
* **Per role and volume:** a carrier is **better** if none of the role's metrics is decided against it and at least
  one is decided for it; **a trade** if each has one; **the same** if none is decided. The high-quality view compares
  bytes at equal PSNR (2b's interpolation) and times at the rung paired by nearest PSNR to each m (m 10 ↔ Q 8, m 20 ↔
  Q 16, m 30 ↔ Q 32 if the measured PSNRs pair so; the session reports the pairing and the gap).
* **The answer** holds "on these three volumes" if all three agree for a role; otherwise the table says which.
* C1–C8 are judged as written in 3.

**Reported**, in a section headed **`## Profile carriers, measured`** under this one: per role and volume the table
of bytes, first picture and every slice at 5 · 20 · 50 Mbit/s, decode a frame and in total, the ask's bytes and decode
(mean, and by position), storage, and the complexity table of 2f checked against the code that ran; then the rule's
verdict per role, C1–C8 held or refuted with their numbers, n per cell, the A/A range, order effects, checks and the
mutations' outcomes, the host and what was not run.

### 5 · The harness

[`lab/av1/delivery/carriers`](../../lab/av1/delivery/carriers/), built and run here on 2026-11-04 by this session, on
the protocol's host: 4 cores of an Intel Xeon @ 2.80 GHz, 15 GB, headless Chrome for Testing 153.0.8010.12
(playwright 1.63.0). `run.sh` runs §4 end to end (`tools`, `content`, `mutate`, `rounds`, `tables`).

| file | does |
| --- | --- |
| `content.py` | codes `p3k1-m20` with `shape.py`'s encoder at `-k 1`; codes the separate streams through `streams.py`'s `lossy` (profiles `b9e3e9e`), which stops unless each stream and residual equals that run's row; decodes every lossy frame natively for its reference hash and its quality; decodes every layered ask natively from its keyframe and checks it exact; writes one index a volume |
| `ask.mjs`, `ask.js`, `index.html` | §4's arms in a fresh Chromium a (round, throttle, volume); a cell that hangs past 15 min is closed, written `VOID` and counted |
| `roles.py` | §4's role tables, the link pipeline, bytes at equal PSNR, the decision rule (through `aa_rule.py`), order effects |
| `roles_test.py`, `mutate.py` | the claims `roles.py`'s arithmetic makes, and six breaks of it |

**Reproduced before anything was timed.** The `p3-m10/20/30` streams coded here equal `svc-shapes.tsv`'s totals byte
for byte on all three volumes (`run.sh` diffs them). Every separate stream and its residual equal the profiles bytes
run's rows (`streams.py` refuses otherwise), and the volume PSNRs this harness computes for them equal that run's, for
example 46.76 dB at Q 16 on `dbts_a1`. `p3k1-m20` codes: `-k 1` is accepted, and every top comes back exact.

**Checks, and their mutations** (`dbts_a1`, one round at 1×; the native ones on the volume's asked group):

| check | as run | mutated | verdict |
| --- | --- | --- | --- |
| a layered ask decoded natively from its keyframe, merged with k's low bits, against the fetch checksum | `p3-m20` and `p3k1-m20`, 8/8 on each volume (48/48) | `--mutate skip` (start one unit after the keyframe): `p3-m20` 1/8, the keyframe's own; `p3k1-m20` 8/8, having no group to skip into. `--mutate low` (k + 1's low bits): 0/8 on both | **sees it** |
| every exact frame in the browser against the fetch checksum | `svc`, `svc1`, `res`, `htj2k`, `htj2k-aa`, `k2`: 8/8 each | `sample` (a sample flipped): 0/8 every arm. `truth` (the checksum flipped): 0/8 every arm. `offset` (the residual's offset + 1): `res` 0/8, its lossy frames 8/8 as native. `skip`: `svc` 1/8, the other seven refused by dav1d (`-28`) and written failed, not wrong; `svc1` 8/8. `low`: `svc`, `svc1`, `k2` 0/8, every other arm 8/8 | **sees it** |
| every lossy frame in the browser against native dav1d's | the views' 616/616 (WebCodecs included) and `res`'s 8/8 | `sample`, `truth`: views 0/616 | **sees it**; `res`'s lossy check first ignored the mutation and was fixed: 0/8 under each, re-run |
| `roles.py` | `roles_test.py` 16/16 | `mutate.py`: the link ignoring the previous frame, bytes interpolated linearly, an ask begun one unit late, no A/A range, a trade read as a win, the order effect against another centre: each fails the test | **sees it** |

**Fixed while building, before any round counted:** the merge and the residual's add first ran a per-sample
callback, which slowed `res` against `htj2k` by the harness's own cost; they are now one loop a row, as a client would
write them. A decode error ended the run; it now fails its ask or view. Two cells of the first thirteen hung, one with
no browser left, one with its browser idle; the cause was not found (a WebCodecs unit that never gives its frame is one
candidate, *unverified*). Each WebCodecs unit is now bounded at 20 s, failing its view by name, and each cell at
15 min (`VOID`); six cells after that, none hung.

**What this session timed, and did not read.** One round, run while `content.py` still coded on the other cores, and
the timing round below. Their rows are not committed and not read here: the predictions in 3 were committed before
either ran (`4b12442`), and nothing in 2–4 changed after them but the budget.

### Sources

* [C1] AV1 Bitstream & Decoding Process Specification, <https://aomediacodec.github.io/av1-spec/>, read 2026-11-04;
  the page's SHA-256 `acf58a3fdb82…`, the same as [`README.md`](README.md)'s [P1] read of 2026-11-02. Sections by their headings.
* [C2] libaom v3.15.1, `examples/svc_encoder_rtc.cc`, `set_layer_pattern`, `case 6` and `enable_longterm_temporal_ref`,
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/examples/svc_encoder_rtc.cc>, read 2026-11-04 (SHA-256 of
  the file `73bdc5b48c0e…`). Source code, read for what the lab's encoder does.
* Measured rows: `lab/av1/delivery/scalable/tool/svc-results.md`, `svc-shapes.tsv`, `svc-errors.jsonl` (`ee572f7`, this
  branch's base); `lab/av1/profiles/README.md` and `results/` (`b9e3e9e`); `lab/av1/delivery/residual/README.md`
  (`6a2994f`).

## Profile carriers, measured

*2026-11-04, row CARRIERS, run by a session given only the protocol above; §4 as written, nothing in 1–5 changed.*

1. **Run:** §4 end to end on `dbts_a1`, `dbts_b1`, `dbts_c1`: content, every mutation, 10 rounds at 1× and 4× (3 540
   timed rows, every exact and lossy frame checked, none failing, no `VOID`).
2. **Rule's verdict, on these three volumes:** separate payloads are better for the exact frame on request (from
   `p3-m20`), the cheap view and the high-quality view; the layered stream stores less. A layered stream with a
   keyframe in every unit (`p3k1-m20`) is better than the separate carrier for the ask.
3. **What it shows:** every time metric is gated out by §4's order-effect rule, so each verdict above rests on bytes.
   The times, read without the gate, agree for the ask (the layered ask 23–35× an HTJ2K frame's decode) and go the other
   way for the cheap view (the quarter base decodes 8–12× faster a frame).
4. **Rests on:** these three DBT volumes only, this 4-core host up to 4×, dav1d-WASM one thread, Chromium's WebCodecs,
   a link that is a model fed with measured decode.
5. **Left:** ultrasound cine and ABUS (no fixture), phones, a hardware decoder, the exact-volume fill (2e, not
   re-measured), and an order-effect statistic that can be read at 10 rounds (below, *The gate*).

**Terms used here first.** *Order effect*: §4's statistic, the largest |median by preceding arm ÷ median − 1| of one
arm in one (volume, throttle). *Not read*: an arm whose order effect passes 10 %. *A/A range*: min–max over rounds of
`htj2k-aa ÷ htj2k`. *Strict*: a time metric is not read if any arm it uses is (the two compared, `htj2k` and
`htj2k-aa`, which the rule's ratios divide by); *compared only*: if either compared arm is. The verdict is the strict
reading; the other is printed beside it so that nothing is hidden.

### Host and saturation

4 cores of an Intel Xeon Processor @ 2.10 GHz (one thread a core), 15 GB, headless Chrome for Testing 153.0.8010.12,
playwright 1.63.0 — not the 2.80 GHz host of §5; every time here is this host's. `cpu_throttle.mjs --check 1,4`: page
thread 382 ms and worker 397 ms at 1×, 1 571 ms and 1 668 ms at 4× (median of 4), a factor of 4.1–4.2. One decode in
flight, one thread a decoder: one core of four at 1×; the host does not saturate in any arm. WebCodecs runs its own
threads and is not a one-core figure. Nothing is claimed past 4×, for concurrent asks, a phone or another host.

Environment, not protocol: `meson` was absent and installed with pip (1.12.1); the `rounds` job was stopped after round
6, whole, to outlast a shell time limit, and restarted with `FIRST=7` (each round's 354 rows present, none twice). The harness moved once under the run:
`e67b87d` (a 20 s bound on a WebCodecs unit, a failed view kept as a row) landed after `tools`; content and every
mutation ran on `e311fd3`'s `ask.js`, all 10 rounds on `e67b87d`'s. No round row carries an error.

### Content, checks and mutations

* `p3-m10/20/30` equal `svc-shapes.tsv`'s totals byte for byte on all three volumes; `streams.py` did not stop, so every
  separate stream and residual equals the profiles bytes run's row; `p3k1-m20` codes (`-k 1` accepted, C4's
  *unverified* resolved).
* Native layered asks from the keyframe, exact: 48/48. In the browser, 10 rounds: every exact frame (`svc`, `svc1`,
  `res`, `htj2k`, `htj2k-aa`, `k2`) equals the fetch checksum, every lossy frame native dav1d's.
* Mutations, once each on `dbts_a1` at 1×: `roles_test.py` 16/16, and each of `mutate.py`'s six breaks fails it. Native
  `skip`: `p3-m20` 1/8 (the keyframe's), `p3k1-m20` 8/8; native `low`: 0/8 on both. Browser `sample` and `truth`: 0/8
  every exact arm, 0/56 every view (`truth`'s first cell hung and was written `VOID` after 15 min; run again);
  `offset`: `res` 0/8, its lossy frames 8/8; `skip`: `svc` 1/8, `svc1` 8/8; `low`: `svc`, `svc1`, `k2` 0/8. Every
  other arm stayed whole under each. Each check sees its break.

### Bytes, storage, quality (deterministic)

`dbts_a1` · `dbts_b1` · `dbts_c1`. PSNR over the volume at the stored depth.

| quantity | layered | separate |
| --- | --- | --- |
| cheap view, bytes a volume (quarter base · Q 56) | 14 985 · 41 497 · 23 613 | 11 272 · 37 079 · 15 640 |
| cheap view, PSNR full size | 38.05 · 38.89 · 38.33 dB | 40.36 · 39.42 · 41.02 dB |
| high view, base + middle m 10 · 20 · 30 ÷ separate at its PSNR | `a1` 0.60 · 0.64 · 0.52; `b1` 0.67 · 0.66 · 0.57; `c1` 0.61 · 0.62 · 0.45 (separate ÷ layered) | |
| exact ask, bytes, mean of 8 positions (`p3-m20` · residual) | 4 006 706 · 8 997 658 · 3 366 240 | 1 242 777 · 2 088 261 · 1 034 815 |
| the same ÷ a shipped frame | 3.49 · 4.46 · 3.47 | 1.08 · 1.04 · 1.07 |
| exact ask, `p3k1-m20` · whole HTJ2K frame | 1 178 688 · 2 008 418 · 986 221 | 1 249 274 · 2 182 401 · 1 045 473 |
| storage ÷ HTJ2K (layered · by residual · by whole frame) | 0.940 · 0.947 · 0.937 | 1.004 · 1.001 · 1.002 · 1.008 · 1.043 · 1.012 |

The top's share t of top + low bits, which 2a left *unverified* at 0.4–0.8: **0.691 · — · 0.699** (`dbts_b1` has no low
bits). Pairing by nearest PSNR (§4): m 10 · 20 · 30 against Q 8 · 16 · 32 on `dbts_a1` (48.46 · 46.33 · 45.31 dB
against 49.94 · 46.76 · 45.02) and `dbts_c1` (49.59 · 46.98 · 45.77 against 51.42 · 47.54 · 45.61). On `dbts_b1` m 10
(49.23 dB) is nearer Q 16 (46.69, gap 2.54) than Q 8 (52.05, gap 2.82), so its times are read against Q 16.

### Times, 10 rounds (medians over rounds; ms unless s)

`dbts_a1` · `dbts_b1` · `dbts_c1`, 1× / 4×. An ask's decode is the mean of its 8 asks in a round.

| arm | 1× | 4× |
| --- | --- | --- |
| ask `svc` (`p3-m20`), mean | 707 · 1 494 · 594 | 2 971 · 6 668 · 2 621 |
| ask `svc`, position 0 … 7 | 229 … 1 161 · 414 … 2 637 · 204 … 991 | 1 025 … 5 047 · 1 798 … 11 579 · 868 … 4 288 |
| ask `svc1` (`p3k1-m20`) | 224 · 407 · 207 | 959 · 1 833 · 860 |
| ask `res` (residual + add) | 33.3 · 123 · 32.0 | 151 · 559 · 158 |
| ask `htj2k` · `htj2k-aa` | 19.8 · 64.9 · 20.4 / 21.3 · 68.2 · 20.4 | 97.3 · 289 · 97.5 / 101 · 282 · 99.0 |
| ask `k2` | 186 · 402 · 167 | 804 · 1 717 · 704 |
| A/A range | 0.89–1.31 · 0.85–1.55 · 0.75–1.19 | 0.78–1.25 · 0.82–1.12 · 0.86–1.12 |
| decode a frame `base` · `sep-q56` · `wc-q56` | 1.6 · 15.4 · 10.5; 4.3 · 51.8 · 41.0; 1.6 · 13.5 · 12.5 | 7.5 · 71.8 · 32.0; 19.7 · 236 · 127; 8.0 · 63.7 · 36.8 |
| decode a frame `mid-m20` · `sep-q16` · `wc-q16` | 32.1 · 39.6 · 14.4; 92.0 · 126 · 65.6; 29.0 · 35.9 · 16.9 | 147 · 177 · 34.1; 431 · 572 · 161; 129 · 164 · 40.6 |
| decode a frame `mid-m10` · `sep-q8`; `mid-m30` · `sep-q32` | 42.2 · 45.5, 28.9 · 33.7; 132 · 134, 85.3 · 93.4; 40.1 · 41.9, 26.7 · 27.6 | 190 · 204, 130 · 156; 594 · 609, 394 · 428; 185 · 184, 117 · 126 |
| decode in total `mid-m20` · `sep-q16` · `wc-q16` | 1.83 · 2.26 · 0.82 s; 4.82 · 6.34 · 3.31 s; 2.17 · 2.60 · 1.20 s | 8.46 · 10.1 · 2.04 s; 22.6 · 28.5 · 8.29 s; 9.59 · 11.5 · 2.99 s |

Every slice of the high view at 20 Mbit/s, 1× (`roles.py`'s link model): `mid-m20` 1.87 · 5.82 · 2.24 s, `sep-q16` 2.30
· 7.55 · 2.67 s, `wc-q16` 0.86 · 7.48 (link-bound) · 1.20 s; the cheap view's every slice 0.15 · 0.28 · 0.18 s by the
base, 1.01 · 3.11 · 1.21 s by `sep-q56`. An ask over 20 Mbit/s at 1×, bytes ÷ R + decode (*derived*): `p3-m20` 2.3 · 5.1
· 1.9 s, residual 0.53 · 0.96 · 0.45 s, whole HTJ2K 0.52 · 0.94 · 0.44 s, `p3k1-m20` 0.69 · 1.21 · 0.60 s. All
tables: [`results/roles.md`](../../lab/av1/delivery/carriers/results/roles.md).

### The decision rule, as written

**The gate.** Arms not read (order effect > 10 %), from `roles.py` (`verdict.py` lists the same):

| | 1× | 4× |
| --- | --- | --- |
| `dbts_a1` | base 38 %, htj2k 63 %, htj2k-aa 38 %, mid-m20 21 %, mid-m30 15 %, mid1-m20 15 %, res 17 %, sep-q32 15 %, sep-q56 15 %, sep-q8 16 %, svc 10 % | base 26 %, htj2k 11 %, htj2k-aa 18 %, mid-m20 11 %, wc-q16 49 % |
| `dbts_b1` | base 11 %, htj2k 17 %, htj2k-aa 27 %, k2 10 %, res 15 % | base 19 %, htj2k 20 %, htj2k-aa 22 %, res 12 % |
| `dbts_c1` | base 50 %, htj2k 18 %, htj2k-aa 12 %, k2 10 %, res 21 %, sep-q16 12 %, sep-q32 15 %, sep-q56 13 %, svc1 16 %, wc-q16 11 % | base 26 %, htj2k-aa 24 %, k2 14 %, mid-m10 11 %, res 25 %, svc 14 %, wc-q16 11 % |

`htj2k` or `htj2k-aa` is not read in every (volume, throttle), so under the strict reading **no time metric is read
anywhere**, and each role is decided by its bytes alone. With 17 arms in a Williams order over 10 rounds each arm has
about one value a predecessor, so the statistic is mostly round-to-round spread (*derived* from the order; a reason,
not a change to the rule).

**Verdict per role** (`verdict.py`; [`results/verdict.md`](../../lab/av1/delivery/carriers/results/verdict.md)), the same
on all three volumes at 1× and 4×, so it holds "on these three volumes":

| role | strict (the verdict) | compared only | `roles.py`'s times alone, ungated |
| --- | --- | --- | --- |
| exact ask, `p3-m20` vs residual or whole frame | **separate better** (bytes 3.2–4.3× less; times not read) | separate better in all 12 | separate better, every time decided (paired sep ÷ layered 0.03–0.08) |
| exact ask, `p3k1-m20` vs residual or whole frame | **layered better** (bytes 0.92–0.96×) | layered better in 10, a trade in 2 | separate better (paired 0.09–0.31) |
| cheap view, base vs Q 56 (dav1d or WebCodecs) | **separate better** (bytes 0.66–0.89×) | separate better (the base not read in any cell) | layered better |
| high view, base + middle vs its nearest rung (and WebCodecs) | **separate better** (bytes 0.45–0.67× at equal PSNR) | separate better in 19 of 24, a trade in 5 | a trade: on dav1d 23 metrics decided for layered, 10 for separate (every one a first picture), WebCodecs separate |
| server storage | **layered** 0.937–0.947 against 1.001–1.043 of HTJ2K | | |

### Predictions C1–C8, judged as written (`predictions.py`; [`results/predictions.md`](../../lab/av1/delivery/carriers/results/predictions.md))

| # | measured, `a1` · `b1` · `c1`, 1× / 4× | |
| --- | --- | --- |
| C1 | ask 34.7 · 22.9 · 29.6× / 31.1 · 23.7 · 26.1× HTJ2K; position 0 11.9 · 6.3 · 10.3× / 10.6 · 6.3 · 9.0×; position 7 58.4 · 39.1 · 48.3× / 52.8 · 40.2 · 44.5× | **held**; position 7 ÷ 0 is 4.7–6.4, so the theory stands |
| C2 | 3.49 · 4.46 · 3.47× a shipped frame | **held** |
| C3 | residual + add 1.74 · 1.91 · 1.58× / 1.53 · 1.97 · 1.58×; whole (`htj2k-aa`) 1.04 · 1.00 · 1.03× / 1.06 · 1.01 · 1.02× | **refuted** for the residual (band 0.85–1.15); why is not measured here |
| C4 | `p3k1-m20` ask 11.4 · 6.1 · 10.4× / 9.8 · 6.4 · 8.9×; base + middle 1.96 · 1.49 · 1.93× `p3-m20`'s; stored 1.02 · 1.02 · 1.03× | **refuted** on base + middle for `a1` and `c1` (band 1.15–1.8); the rest held |
| C5 | 0.45–0.67 at every (volume, m) | **held** |
| C6 | dav1d 1.08 · 1.23 · 1.17 (`a1`, m 10 · 20 · 30), 0.95 · 1.36 · 1.08 (`b1`, m 10 read against Q 16), 1.05 · 1.24 · 1.05 (`c1`) at 1×, 0.96–1.33 at 4×; WebCodecs ÷ `mid-m20` 0.44 · 0.71 · 0.57 / 0.22 · 0.38 · 0.31 | **held** |
| C7 | 0.75 · 0.89 · 0.66× the base's bytes; +2.31 · +0.54 · +2.69 dB; decode 9.8 · 12.2 · 8.7× / 9.8 · 11.9 · 7.7× | **held** |
| C8 | layered 0.940 · 0.947 · 0.937; by residual 1.004 · 1.001 · 1.002; by whole frame 1.008 · 1.043 · 1.012 | **held** |

C1–C7's time ratios are medians over 10 rounds of each round's ratio, n = 10 every cell; the order-effect gate is the
decision rule's and is not applied to the predictions, which §3 states as bands, not decisions.

**Complexity (2f), checked against the code that ran** (`ask.js`): as the table states, with one narrowing — the
layered exact unit ran on dav1d-WASM only (operating point 0); no WebCodecs arm decoded a layered unit.

**Not run.** The exact-volume fill (2e); a dweller's stepping asks (only the cold ask was timed); Firefox; a link (the
role times past the decode are a model); any fixture but the three named.

## Profile carriers protocol, amended

*Row CARRIERS, amended 2026-11-04 at the owner's request of that day. Written for a reader who has not followed this
row; the terms are defined below even where the protocol above defines them. Separate sessions, given only this
section, measure it; the pilot here only sized it. Arithmetic of ours is* derived*; what no source holds is*
unverified*.*

1. **Asked.** Does a layered AV1 stream stay a candidate as the carrier of quality profiles, against separate
   payloads, once both sides choose their group length and are compared at equal quality?
2. **Why amended.** The first run (above) read no time metric — its order-effect gate voided every one — and compared
   one layered keyframe interval (8) against separate streams at one group length (16).
3. **What changes.** Both group lengths are swept; every comparison runs in a small block with its own control and
   A/A; the order effect is a permutation test, not a fixed bar; a pair is decided by the median's order-statistic
   interval; 4 shards of 4.5 h each run it, and a collector pools them.
4. **It rests on** three DBT volumes, one per system (`dbts_a1`, `dbts_b1`, `dbts_c1`), one-thread dav1d-WASM and
   OpenJPH in headless Chromium at 1×, on 4-core cloud hosts. Nothing else is claimed.
5. **Not in it:** a link (decode only), 4×, WebCodecs, phones, ultrasound cine and ABUS (no fixture), and which
   quality is visually lossless (the owner's call).

### Terms, for this section

* **Profile** — what a role receives: the **cheap view** (e.g. a patient's), the **high-quality view** (most clinical
  roles), the **exact frame on request** (one frame, bit-exact, asked while viewing).
* **Layered carrier (SVC)** — one AV1 stream whose every temporal unit (the coded data of one frame) holds three
  spatial layers: the **base**, a quarter-size lossy picture; the **middle**, a full-size lossy picture predicted from
  the base; the **top**, the exact picture predicted from the middle. A client takes a prefix of each unit: base for
  the cheap view, base + middle for the high view, all three for the exact frame. On 12 bits the stream codes the top
  10 bits and the two low bits are a separate intra stream, as the shipped payload splits them.
* **Separate carrier** — one lossy AV1 stream per view, plus, for the exact frame, the **residual** (exact − lossy,
  per sample, plus one offset, coded losslessly in HTJ2K, added to the lossy frame on screen) or the **whole HTJ2K
  frame**.
* **G** — the separate streams' group length: a keyframe every G frames, each frame of a group predicted from the one
  before; G = 1 codes each frame alone. **k** — the same for the layered stream (its keyframe interval). To show frame
  i, a client that holds no decoder state decodes from i's keyframe to i: (i mod G) + 1 units (or (i mod k) + 1).
* **Q** — the separate streams' quantizer, libaom's 0–63 scale (low is finer). **m** — the layered middle's quantizer
  on the same scale; the base is at 40, the top at 0.
* **Systems A, B, C** — the three DBT scanners of the EA1141 dataset; A and C store 12 bits, B 10. `dbts_a1` is A's
  (56 frames × 1142×1785), `dbts_b1` B's (50 × 2560×3328), `dbts_c1` C's (69 × 976×2513).
* **Block** — one fresh headless Chromium running a few arms in one round on one volume. **Arm** — one configuration
  run through every access pattern. **Control** (`ctrl`) — every HTJ2K frame of the volume decoded in order;
  **A/A** (`ctrl-aa`) — the same, a second time in the same block. **Round** — every block once.
* **HTJ2K-frame unit** — a time divided by the median per-frame HTJ2K decode of its own block's control in the same
  round; every time below is in it, so every number is a ratio inside one browser on one host.

### A · What is swept, and at what quality

**The configurations.** Layered at k = 1, 4, 8, 16 (`lay-k1` … `lay-k16`); separate at G = 1, 4, 8, 16, 32
(`sep-g1` … `sep-g32`; 32 fits: the volumes hold 50–69 frames). The whole HTJ2K frame (`whole`) is the separate exact
carrier that has no G. Each separate configuration is two lossy streams, the cheap and the high, at the same G, and
the residual of its high stream.

**Equal quality, and the metric.** Each role is matched on **in-window PSNR**: PSNR over the samples whose display
code under the series' first header window is strictly inside 0–255 (the tissue a reader is shown, not the
background or the clipped skin line), against the source at the stored depth, from the summed squared error, peak
2^b − 1, as `content.quality` computes it for both carriers. Why this one: it is the only quality the harness
measures one way on both carriers; the review found the all-sample PSNR moves the high-view ratios by 0.00–0.14
(finding 18) because it counts background; and no threshold of visual losslessness is set here (the owner's call),
so PSNR is used to *match* the carriers, not to accept either. All-sample PSNR and max |Δ| are printed beside it.
Each carrier is put back at the stored depth by its own form's inverse: the layered top codes v ≫ 2, so its middle is
read back as x · 4 + 1.5; the separate 10-bit top codes (v + 2) ≫ 2 (`bytes.py`, `forms`), so x · 4.

**The targets** (per volume): the high view's is the in-window PSNR of the first run's layered middle (`p3-m20`,
k = 8), the cheap view's that of its base. `sweep.py search` then steps the integer quantizer one at a time from a
start (m 20; Q 16 for the high, Q 56 for the cheap) until two neighbours bracket the target, keeps the nearer as the
**timed** stream, and records both neighbours' bytes: **bytes at the target** are read between the two, log bytes
linear in PSNR, over one quantizer step (the review's finding 3: the first run's chord spanned 1.7–5.4 dB). A target
outside the scale's reach (Q 63, m 1) takes the end and its gap is printed. The pin it writes,
[`results/amended-content.json`](../../lab/av1/delivery/carriers/results/amended-content.json), is what every shard
codes; `sweep.py code` stops unless every unit size equals it.

**The encoder, apart.** The separate streams come from `aomenc --good --cpu-used=6`, the layered from
`svc_encoder_rtc` at speed 7 (review finding 7). So that the carrier's own cost can be told from its encoder's, the
search also codes, bytes only, a **single-layer** full-size stream from `svc_encoder_rtc` at speed 7 and each k
(`-lm 0 -sl 1`), bracketed to the high target the same way. It is not timed and not in the rule.

**What the search found** (the pin, *measured* on the pilot's host; in-window PSNR, `dbts_a1` · `dbts_b1` · `dbts_c1`).
Targets: high 44.70 · 41.30 · 43.73 dB, cheap 37.13 · 35.16 · 36.04 dB. The layered middle stays at m 20 at every k
(m 19 or m 21 brackets it). The separate high stream is Q 18–19 at every G, the cheap one Q 57–62. Bytes at the
target, separate ÷ layered base + middle at G = k (*derived* from the pin): k 1 0.59 · 0.75 · 0.61; k 4 0.67 · 0.80 ·
0.70; k 8 0.69 · 0.81 · 0.73; k 16 0.71 · 0.82 · 0.75. The single-layer `svc_encoder_rtc` stream ÷ the layered base
+ middle: k 1 0.91 · 0.92 · 0.86, k 4–16 **1.06–1.32**: above k = 1 the layered view's extra bytes come from its
encoder, not from the base it carries. Bytes only, not timed.

### B · The access patterns, each a clock

Every AV1 decode is the same one-thread dav1d-WASM build with operating points (`two-layer/build_wasm.sh`), a fresh
decoder where the pattern says *fresh*; OpenJPH-WASM one thread for HTJ2K and the residual; no WebCodecs (review
finding 11). Every clock stops at the same endpoint: the frame's samples, cropped, in one array (finding 14). Each
round asks **8 frames i drawn uniformly from 0 … F − 2** (`amended.js`, `draws`, seeded by round and volume, so every
block of a round asks the same frames and a run covers every depth of the volume, finding 9).

| pattern | layered at k | separate at G |
| --- | --- | --- |
| **cine playback** (high, cheap) | every middle (or base) unit in order on one fresh decoder at that operating point; the metric: the sum | every unit of the high (or cheap) stream in order, one fresh decoder; the sum |
| **scroll to the next slice** | the same rows: the median frame's decode on the decoder that holds the one before | the same |
| **jump to a random slice** (high) | a fresh decoder at the middle's operating point, units from i's keyframe to i; the mean over the 8 | a fresh decoder, the high stream from i's keyframe to i; the mean |
| **exact, after a jump** | a fresh full decoder, units from i's keyframe to i, and i's low bits on 12 bits, merged | the jump above, then i's residual decoded and added (decode and add timed apart) — or the whole HTJ2K frame i, read from the control's rows |
| **dweller, frame i** (high view on screen) | as after a jump: the top of i is predicted from the top before it, which no middle-only client holds (*derived*, §2a above) | the residual of i and the add only, the lossy i being on screen — or HTJ2K frame i |
| **dweller, then i + 1** | on the decoders that reached i: unit i + 1 and its low bits | on the lossy decoder that reached i: unit i + 1, then its residual and the add — or HTJ2K frame i + 1 |

**Checked, every op:** every exact frame against the fetch's checksum, every lossy frame against native dav1d's hash
(`sweep.py code` writes them); a miss voids that arm's round in the collector and is counted. `sweep.py code` also
decodes natively, from the keyframe, the last frame of each layered stream's first group and the first of its second,
and stops unless both are exact.

### C · Blocks, order, rounds

**Nested.** A block is one (volume, sweep point p) in one fresh Chromium, p = 1, 4, 8, 16: its arms are `lay-kp`,
`sep-gp`, `ctrl` and `ctrl-aa` — four, and five at p = 16, where `sep-g32` joins. So each block compares a layered and
a separate configuration at the same group length, with its own control and its own A/A. Arms run in a Williams
order (`lab/order.mjs`; period 4, and 10 for the five-arm block), so over the run each arm follows each other arm
equally often; the 12 blocks of a round run in a Williams order too. Comparisons across blocks (`sep-g1` against
`sep-g16`, `lay-k1` against `sep-g16`) are made through each block's control, rounds paired: still a ratio inside one
host and one round.

**Washout.** The review traced part of the first run's spread to the first arm of a round running slow (finding 19).
Each block now starts with an untimed pass of every path its arms run (the merge, the residual decode, the add) on
frame 0; and before each arm a forced collection (`--js-flags=--expose-gc`) and two untimed units on a throwaway
decoder of its kind.

**1× only.** In the first run, each dav1d-WASM or OpenJPH ratio at 4× was 0.86–1.05× the same ratio at 1× (C1's
mean ask, C3's residual, C4's ask; *derived* from its table above), and 4× costs four times the wall; the budget goes
to rounds. Nothing is claimed at 4×.

### D · The rule (`amended.py`; derived from the definitions and one cited interval, no bar of ours)

1. **Value.** Each (volume, configuration, metric, round) is the arm's time ÷ its block's control's median frame in
   that round (HTJ2K-frame units). An arm-round with any failed check, error or `VOID` has no value.
2. **A/A gate, per block.** The block's times are read only if the 95 % interval of the median of
   log(`ctrl-aa` ÷ `ctrl`) over its rounds contains 0. The count of blocks that fail is the run's empirical
   false-decision rate, printed; at 95 % about 1 in 20 is expected by chance.
3. **Order gate, per (block, arm).** The statistic: over the arm's predecessors with two or more rounds, the largest
   |median − overall median| of log(arm's total time ÷ the control's total) (for `ctrl`, ÷ `ctrl-aa`'s, and back).
   Its p is the share of 2 000 shuffles of the predecessor labels over the same values that reach it; the arm is not
   read in that block if p < 0.05 ÷ (arms in the block) (Bonferroni over the block's arms, so a block with no
   carryover flags an arm about 5 % of the time). Values normalized by the same round's control remove the
   round-to-round drift that the first run's statistic measured (review, *Order and statistic*).
4. **A pair** (two configurations, one metric, one volume): the per-round log ratio, rounds paired, its median and
   the distribution-free 95 % interval of the median from order statistics: the r-th and (n − r + 1)-th of the n
   sorted values, r the largest with P(r ≤ W ≤ n − r) ≥ 0.95 for W binomial (n, ½) [C3]. **Decided** for the lower
   time when the interval excludes 0; **not resolved** otherwise; **not read** when either side's block fails 2, or
   either arm or the block's control is flagged by 3. At n under 6 no interval exists and nothing is decided.
5. **A frontier, per (volume, role, access pattern).** Each configuration has the role's bytes (deterministic, §A;
   for the exact frame, what an ask adds to what the high view holds, the mean over i = 0 … F − 2: the tops of i's
   group to i and i's low bits for layered; i's residual, or HTJ2K frame i, for separate) and the pattern's one time
   metric. X **dominates** Y if X's bytes are no more, no pair decides the time against X or is not read, and X has
   fewer bytes or the time decided for it. Each configuration is then **dominated**; **not read**, if some rival with
   no more bytes has its time against it not read, so its place is unknown; or **on the frontier**. The fewest bytes
   of a role are on its frontier by this definition, whatever their time; the collector prints every median beside
   it, so the trade is visible.
6. **The answer.** On a volume, the layered stream **stays a candidate** if at least one k is on the frontier of at
   least one (role, pattern) of the high view or the exact frame; it **is not read** if none is on a frontier and some
   k is not read; otherwise it **is dominated**. The collector prints each k's state in every judged (role, pattern)
   at once, so a k kept by one role and dominated in another reads as such (review finding 10). It holds "on these three
   volumes" when it holds on each; otherwise the table says which. Storage is printed beside it (layered stores less,
   as measured above) and is not, by itself, a reason to keep a carrier the roles do not choose: the owner's question
   is about carriers of the profiles the roles receive.
7. **Primary and reported.** The rule reads only the metrics of §B, one per (role, pattern), in HTJ2K-frame units.
   The single-layer encoder's bytes, all-sample PSNR, the residual's decode and add apart, and every median are
   reported beside it.

### E · The review's findings, each answered

[`profile-carriers-review.md`](profile-carriers-review.md) (`9aec9477`), 22 findings. *Accepted* names the change and
where it is; *rejected* gives the reason.

| # | finding, in short | | change, or reason |
| --- | --- | --- | --- |
| 1 | the order statistic, with one value a predecessor, measures round spread | accepted | four arms a block (five at p = 16), 96 rounds so each predecessor has 24 values (about 19 in the five-arm block); a permutation test of predecessor labels on control-normalized values, gated at p < 0.05 ÷ arms in the block (§D) |
| 2 | "not read" became "absent", so bytes alone decided a role | accepted | a comparison whose block fails its A/A, or whose arm or control is flagged, is **not read**, and a not-read time never lets bytes decide dominance (`amended.dominates`; tested and mutated) |
| 3 | high-view bytes rest on a chord across 1.7–5.4 dB | accepted | each stream's quantizer is stepped to bracket the target; bytes are read over one quantizer step (§A); the measured neighbours are in the pin |
| 4 | the A/A min–max range widens with n; `htj2k` is a noisy reference | accepted | the A/A is an order-statistic interval of its median, a gate that must contain 0; the control is the whole volume's HTJ2K decode, not 8 frames (§C, §D) |
| 5 | eight correlated metrics a pair, any one makes "a trade" | accepted | one time metric per (role, access pattern), each read alone with the bytes on its own frontier; no metric is combined with another (§D) |
| 6 | role times are an unvalidated link model | accepted | no link model in the rule: decode only, and nothing is claimed for a link (*Not in it*) |
| 7 | the high view confounds carrier with encoder and group | accepted | the group by the sweep, both sides at 1 · 4 · 8 · 16; the encoder by the single-layer `svc_encoder_rtc` stream's bytes at each k (§A), reported beside the rule |
| 8 | times paired at the nearest rung, not equal quality | accepted | as 3: every timed stream is the one nearest the target, its gap printed |
| 9 | one asked group, no dweller, no view jump | accepted | 8 frames drawn over the whole volume each round; a jump for both carriers; a dweller (i, then i + 1) (§B). Steps past i + 1 are not added: each costs what i + 1 does, one unit on a held decoder (*derived*) |
| 10 | `p3k1-m20` judged for the ask without its high-view cost | accepted | a configuration is one stream serving every role; the verdict lists each k across every judged (role, pattern) at once |
| 11 | WebCodecs against one-thread dav1d-WASM | accepted | no WebCodecs arm |
| 12 | the code that decides every verdict has no test | accepted | `amended_test.py` (31 claims) and `mutate_amended.py` (12 breaks, each caught), covering the interval, the decision, the order test, dominance, the frontier and its "not read", the ask's bytes, the A/A and order gates, and the drop of a failed check |
| 13 | three volumes; mutations on one | accepted | the claim is "these three volumes" in every verdict line; the browser mutations run on all three in shard 1, on `dbts_a1` in the others (§F) |
| 14 | arms stop their clocks at different points; `res` not split | accepted | one endpoint for every exact op (cropped samples in one array); the residual's decode and add are timed apart (§B) |
| 15 | rounds differ from §4 as committed | accepted, here | the first run's measured section is that session's; this protocol notes the deviation (pre-registered 10 at `4b12442`, 7 at `e67b87d`, 10 run) and changes nothing there |
| 16 | mutations and rounds on different `ask.js` | accepted | every shard runs its mutations in the same session, on the commit it times |
| 17 | the two carriers' lossy frames reconstructed differently on 12 bits | rejected | each is its own form's centred inverse: the layered top codes v ≫ 2 (`shape.py`, `Plane.top`), so x · 4 + 1.5; the separate 10-bit form codes (v + 2) ≫ 2 (`bytes.py`, `forms`), so x · 4. One reconstruction for both would bias one of them |
| 18 | which PSNR | accepted | in-window PSNR is the matching metric; all-sample beside it (§A) |
| 19 | the first arm of a round runs slow | accepted | an untimed pass of every path at each block's start, and a washout before each arm (§C) |
| 20 | mutate-and-restore can read the mutant from the bytecode cache | accepted | `mutate_amended.py` runs each child with a fresh `PYTHONPYCACHEPREFIX` |
| 21 | `verdict.not_read` sums `ms` unguarded | rejected | no change: the amended collector does not use `verdict.py`; the first run's code is left as it ran |
| 22 | the cheap view compares bytes at unequal quality; separate may send the base | accepted | the cheap view is matched at equal in-window PSNR and reported, but not judged: the separate carrier may send the layered base itself, so it cannot lose that role by construction (*derived*, §2c above) |

### F · Rounds, pilot, shards

**The pilot** (this session, 2026-11-05, the protocol's harness on a 4-core Intel Xeon @ 2.10 GHz, 15 GB; four
rounds, rows in [`results/amended-pilot.jsonl`](../../lab/av1/delivery/carriers/results/amended-pilot.jsonl), not
read for any verdict). Every check passed in all 48 blocks; no `VOID`. A round of the 12 blocks took 7.1–8.1 min.
The robust spread (1.4826 × MAD, log units, per-round ratios, `pilot_spread.py`) of the A/A was 0.022 · 0.032 ·
0.022 (the first run's ratio over its 8-frame `htj2k`: 0.10–0.17); of the pairs the rule reads, at most 0.049 for the
cine and scroll metrics, 0.13 for the dweller's next, 0.16 for the jump, 0.20 for the exact after a jump and 0.26 for
the dweller's first frame (the draws of i change from round to round, and the chain's length with them). Four
values give a crude spread; the collector prints the run's own.

**Rounds, from it.** The resolution sought is 5 %: the smallest gap the first run measured between two compared
dav1d arms of one role (C6, 0.95 · 1.05 on `dbts_b1` and `dbts_c1`; *derived*, not a bar on the answer). For a median
of n paired log ratios of spread σ, the rule's interval excludes 0 for a true ratio e^δ in about 80 % of runs when
n ≥ (2.80 × 1.2533 × σ / δ)² (normal approximation; 1.2533 = √(π/2), the median's cost against the mean;
*derived*). At δ = ln 1.05 that is n ≈ 24 at σ 0.049, 86 at 0.13, 139 at 0.16, 196 at 0.20, 361 at 0.26. The
budget holds **96 rounds** (4 × 24). So, said before the run: at n = 96 the cine and scroll metrics and the dweller's
next resolve 5 % (1.8 % and 4.7 %); the jump 6.0 %, the exact after a jump 7.2 %, the dweller's first frame 9.7 %
(each *derived* from the pilot's σ). The pilot's exact-frame ratios between carriers were 2–46×, far past those.

**Order at that n.** With four arms and 96 rounds each arm has 24 rounds after each predecessor (the five-arm block
about 19); 24 rounds a shard is a whole number of Williams periods for the four-arm blocks and of the 12 blocks'
order, and within one visit for the five-arm block.

**Saturation.** One decode in flight, one thread a decoder: one core of four, on the page's thread; the host does not
saturate in any arm, and the shards run nothing else. Nothing is claimed past 1×, for concurrent asks, a link, a
phone or another host, and no absolute ms: every number is a ratio inside one block, and only ratios are pooled
across shards.

**Fixtures, and the only ones.** `dbts_a1`, `dbts_b1`, `dbts_c1` (`lab/av1/fetch_data.sh`, SHA-256-checked). The
repository holds few cine-like breast series: the ultrasound cine in it is lossy-sourced and ABUS is absent, so
nothing is claimed for ultrasound, FFDM, or any volume but these three.

**Per shard, on a 4-core cloud host** (minutes on the pilot's host):

| step | `run.sh` | time |
| --- | --- | --: |
| tools, the WASM build, the volumes | `tools` | 8 |
| the shipped payload 5.2, the layered k = 8 stream 2.1 (checked against `svc-shapes.tsv`), `sweep.py code` 23.1 | `amended-content` | 31 |
| `amended_test.py`, `mutate_amended.py`; six browser mutations on block k 8 of `dbts_a1` (shard 1: all three volumes) | `amended-mutate` | 3 (shard 1: 11) |
| 24 rounds at 7.1–8.1 min | `amended-rounds` | 170–194 |
| **total** | | **212–236** (shard 1: 220–244), under 270 |

```bash
git fetch origin && git checkout claude/av1-profile-carriers
SHARD=k ROUNDS_PER_SHARD=24 BUDGET_S=16200 lab/av1/delivery/carriers/run.sh tools amended-content amended-mutate amended-rounds
```

`BUDGET_S` is 4.5 h from `run.sh`'s start: a shard on a slower host stops after a whole round once less than one
round's time is left, and reports its n; the collector pools what came. `sweep.py code` stops the shard if any unit
differs from the pin; a mutation that does not turn its own check to failure (or turns another's) stops it too, and
the shard reports that instead of rounds.

### G · The harness

New files in [`lab/av1/delivery/carriers`](../../lab/av1/delivery/carriers/); the first run's files are unchanged but
for `ask.js`, whose helpers are now exported.

| file | does |
| --- | --- |
| `sweep.py` | `search`: the role targets, the bracketing quantizers for every k and G, the single-layer bytes; writes the pin. `code`: codes what the pin names, stops on any unit size that differs, checks the layered chains natively, writes one index a volume with every lossy frame's native hash and the residuals |
| `amended.js`, `amended.html` | one block: the untimed pass, the washouts, the arms in a Williams order, every pattern of §B with its checks |
| `amended.mjs` | the driver: each (round, volume, block) a fresh Chromium with `--expose-gc`; a block past 15 min is `VOID`; `--mutate sample · truth · offset · skip · low · dwell` |
| `amended.py` | the collector: §D end to end |
| `amended_test.py`, `mutate_amended.py` | 31 claims of `amended.py`'s arithmetic, and 12 breaks of it, each caught |
| `pilot_spread.py` | the pilot's robust spread per metric and pair, which sizes the rounds (§F) |

### Sources

* [C3] NIST/SEMATECH Dataplot Reference Manual, MEDIAN CONFIDENCE LIMITS,
  <https://itl.nist.gov/div898/software/dataplot/refman1/auxillar/mediancl.htm>, read 2026-11-04 (SHA-256 of the
  page `bc7f45b1ac28…`): "Suppose W is a binomial random variable with n trials and a probability of success p =
  0.5. For any integer, k, between 0 and [n/2], let γ_k = P(k ≤ W ≤ n − k). A 95% confidence interval for the median
  is: (X_k, X_{n−k+1}) with X denoting the sorted observations." The page's k is this section's r; the rule takes the
  largest r with γ_r ≥ 0.95 and not the page's interpolated interval, so its coverage is at least 95 %.
* The first run's measured rows, its review (`9aec9477`), and this branch's pin and pilot, as named above.

## Shards

| shard | rounds | writes | heading |
| --- | --- | --- | --- |
| 1 | 0–23, every block | `lab/av1/delivery/carriers/results/amended-shard-1.jsonl`, `.mutations.jsonl`, `.index.dbts_{a1,b1,c1}.json`, `.md` | `### Amended shard 1, measured` |
| 2 | 24–47, every block | `lab/av1/delivery/carriers/results/amended-shard-2.jsonl`, `.mutations.jsonl`, `.md` | `### Amended shard 2, measured` |
| 3 | 48–71, every block | `lab/av1/delivery/carriers/results/amended-shard-3.jsonl`, `.mutations.jsonl`, `.md` | `### Amended shard 3, measured` |
| 4 | 72–95, every block | `lab/av1/delivery/carriers/results/amended-shard-4.jsonl`, `.mutations.jsonl`, `.md` | `### Amended shard 4, measured` |

Split by rounds, never by arm: every shard runs every block whole. Each shard appends its heading at the end of this
file (after `git pull --rebase`) and writes nothing else: its host (`lscpu` model, cores, memory, Chromium), each
step's wall, its n and `VOID` count, its mutations' outcome table, and anything that differed from this section;
`.md` holds the same plus `amended.py`'s output on its own rows, printed as a check, **not read** for any verdict
(24 rounds is not the n this section sized).

**The collector**, once all four headings exist (or when the last one says it stopped): pool, apply the rule.

```bash
python3 lab/av1/delivery/carriers/amended.py lab/av1/delivery/carriers/results/amended-shard-1.index. \
  lab/av1/delivery/carriers/results/amended-shard-{1,2,3,4}.jsonl > lab/av1/delivery/carriers/results/amended-collected.md
```

It reports, under `## Profile carriers, amended, collected`: n per block; every block's A/A interval and the count
that fail; every arm flagged by order with its p; per volume and (role, pattern) the bytes, the median in
HTJ2K-frame units with n, and each configuration's state; the answer of §D.6 per volume and whether it holds "on
these three volumes"; storage beside it; and every deviation a shard reported. The cheap view and the single-layer
bytes are reported, not judged.

### Amended shard 1, measured

*2026-11-05, shard 1 of 4, run by a session given only the amended protocol; §F's command as written, on `fb6e522a`.
Numbers only; the collector pools the shards and applies §D.*

1. **Run:** `SHARD=1 ROUNDS_PER_SHARD=24 BUDGET_S=16200 run.sh tools amended-content amended-mutate amended-rounds`,
   from 01:17:27 to 04:54:40 UTC (3 h 37 min, under `BUDGET_S`). All 24 rounds assigned (0–23) ran, every block whole.
2. **Shows:** the content equals the pin. `amended_test.py` passes 31/31, and `mutate_amended.py`'s 12 breaks are each
   caught. Each of the six browser mutations fails its own check on all three volumes and leaves the others whole. In
   the rounds, 17 424 rows: every exact frame (43 968) and every lossy frame (80 784) passed its check. No `VOID`, no
   error. All 12 blocks pass the A/A gate.
3. **Rests on:** `dbts_a1`, `dbts_b1` and `dbts_c1` only, on the host below, at 1×.
4. **Left:** nothing in shard 1. The collector pools all four shards.
5. **Not here:** a verdict. Twenty-four rounds is not the n that §F sized.

Terms are those of §Terms, for this section. A **check** compares a decoded frame with its truth. An exact frame's
truth is the fetch's SHA-256 of its samples; a lossy frame's is native dav1d's hash, written by `sweep.py code`. A
**mutation** breaks one input on purpose, for one round of block k 8, to show that a check sees it.

#### Host and saturation

4 cores of an Intel Xeon Processor @ 2.10 GHz, one thread a core (`lscpu`), 15 GB. Headless Chrome for Testing
153.0.8010.12, playwright 1.63.0, node 22. It is the pilot's host model.

A 60 s sample of `/proc/stat` was taken in round 0, its only addition to the run. At 10 s steps the whole host was
26–33 % busy, about one core of four, with load average 1.1–1.3. The host does not saturate in any arm. Nothing is
claimed past one decode in flight at 1×.

#### Steps, wall

| step | wall | what it printed |
| --- | --: | --- |
| `tools` | about 1.5 min | built in this session's earlier `tools` (below), reused |
| `amended-content` | 20.0 min | make_frames 1 s (reused, below); `shapes.py` 106 s, k = 8 stream equal to `svc-shapes.tsv` (the `diff` printed nothing); `sweep.py code` 1 092 s, no unit differing from the pin, the native chain checks passed (it did not stop) |
| `amended-mutate` | 10.4 min | below |
| `amended-rounds` | 185.7 min | 24 rounds of 12 blocks, 7.2–8.2 min a round; no budget stop |

#### Mutations (round 0, block k 8, every volume)

`amended_test.py`: 31/31. `mutate_amended.py`: each of 12 breaks caught. Browser, passed/total per (arm, op, check).
`lay-k8` is the layered arm and `sep-g8` the separate one; `ctrl` and `ctrl-aa` each check every frame.

| mutation | expected (*derived* from `amended.js`, `ask.js`) | `dbts_a1` | `dbts_b1` (10 bits) | `dbts_c1` |
| --- | --- | --- | --- | --- |
| `sample` | every check fails | 0 passed, in every row | 0 passed, in every row | 0 passed, in every row |
| `truth` | every check fails | 0 passed, in every row | 0 passed, in every row | 0 passed, in every row |
| `offset` | `sep-g8` residual and next fail; all else whole | residual 0/8, next 0/8; all else all passed | the same | the same |
| `skip` | asks starting one unit late fail, on both carriers | `lay-k8` and `sep-g8` arms end `Error: dav1d: -28`, so no value; `ctrl` 56/56, `ctrl-aa` 56/56 | the same; 50/50 | the same; 69/69 |
| `low` | `lay-k8` exact and next fail on 12 bits only | `lay-k8` exact 0/8, next 0/8; all else all passed | everything passed (no low bits) | as `dbts_a1` |
| `dwell` | next fails, on both carriers | `lay-k8` next 0/8, `sep-g8` next 0/8; all else all passed | the same | the same |

"All else all passed" means every other row passed: the cines 56/56 (50, 69), the jumps 8/8 and the controls 56/56
(50, 69). Under `skip` an error ends the whole arm, so its cines leave no row: the break is seen, but whether the
cines stayed whole is not. The pilot's `skip` on `dbts_a1` ended the same way
([`amended-pilot.mutations.jsonl`](../../lab/av1/delivery/carriers/results/amended-pilot.mutations.jsonl)). The
error code is printed as it came; what −28 means in dav1d is *unverified*. No mutation missed its own check or broke
another's, so the shard went on to rounds. Rows:
[`amended-shard-1.mutations.jsonl`](../../lab/av1/delivery/carriers/results/amended-shard-1.mutations.jsonl).

#### What differed from §F (environment, not protocol)

* `meson` was absent. It was installed with pip (1.12.1), as in the first run.
* `gen_htj2k_fixtures.sh` printed `ModuleNotFoundError: numpy` under `run.sh`'s `|| true`. `ojph_compress` was built
  all the same: the `test -x` that follows passed.
* Before §F's table existed, this session ran `tools` on `a731ca81` and began `amended-content` there. It stopped
  after `shapes.py`, and §F's command was then run from its start on `fb6e522a`. So `tools` and make_frames found
  their outputs present: both are deterministic, and the stream `diff` and `sweep.py code`'s pin check ran in full.
* The run's working tree stayed at `fb6e522a`, plus this section. Rows are committed from a second worktree, so no
  pull changed the harness under the rounds (finding 16).

#### Rounds (0–23)

These are [`amended-shard-1.jsonl`](../../lab/av1/delivery/carriers/results/amended-shard-1.jsonl): 17 424 rows over
288 blocks (24 rounds × 3 volumes × 4 points), 54 rows a four-arm block and 80 at p = 16.

* Each exact frame's check, against its fetch checksum: 43 968 of 43 968 passed.
* Each lossy frame's check, against native dav1d's hash: 80 784 of 80 784 passed.
* No row is `VOID` or carries an error.
* The indexes the checks read are
  [`amended-shard-1.index.dbts_{a1,b1,c1}.json`](../../lab/av1/delivery/carriers/results/), as `sweep.py code` wrote
  them.

`amended.py` on this shard's rows alone is in
[`amended-shard-1.md`](../../lab/av1/delivery/carriers/results/amended-shard-1.md). It is printed as a check and
**not read**: n = 24 is not §F's n. Facts of this shard from it:

* **A/A** — the median of log(`ctrl-aa` ÷ `ctrl`) and its 95 % interval, n = 24 in every block. The interval contains 0
  in all 12 blocks, so 0 of 12 fail. Medians run from −0.0136 to +0.0121; the widest interval is `dbts_a1` k 4,
  (−0.0111, 0.0503).
* **Order, flagged** at p < 0.05 ÷ 4 — only in `dbts_b1` block k 8: `lay-k8` (p printed 0.0125) and `sep-g8`
  (0.0085). No other (block, arm) is flagged.

### Amended shard 3, measured

*2026-11-05, shard 3 of 4, run by a session given only the amended protocol; §F's command as written, on `fb6e522a`.
Numbers only; the collector pools the shards and applies §D.*

1. **Run:** `SHARD=3 ROUNDS_PER_SHARD=24 BUDGET_S=16200 run.sh tools amended-content amended-mutate amended-rounds`,
   01:17:43–05:16:12 UTC: rounds 48–71, every block whole, then nothing else.
2. **Shows:** the content equals the pin; every check fails under its own mutation and no other; 24 rounds of 12
   blocks, none `VOID`, every exact and lossy frame passing its check.
3. **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` only, on the host below, at 1×.
4. **Left:** pooling with shards 1, 2 and 4, and §D's rule, by the collector. n = 24 here is not the n §F sized.
5. **Not judged here:** nothing in this section, or in its `.md`, is a verdict.

Terms as in this protocol: a **block** is one fresh Chromium running one (volume, sweep point) in one round; an
**arm** is one configuration in it; **`VOID`** a block past 15 min; a **mutation** a deliberate break of one check,
which must turn that check, and only it, to failure.

**Host.** `lscpu`: Intel(R) Xeon(R) Processor @ 2.10GHz, 4 CPUs, 1 thread per core, 1 socket; 15 GiB memory;
Chromium 153.0.8010.12 (Playwright 1.63.0's, headless). **Saturation:** one decode in flight on one thread; load
average 1.24 at one sample in round 49, so one core of four busy. The host did not saturate in any arm, and
nothing is claimed past 1× or for any other host.

**Walls.**

| step | wall |
| --- | --: |
| `tools` + `amended-content` + `amended-mutate` | 28.7 min (01:17:43–01:46:23) |
| of which `sweep.py code` | 22.6 min (1356 s) |
| of which the shipped payload / the k = 8 stream | 1 s (reused, below) / 122 s |
| `amended-rounds`, 24 rounds | 209.8 min; a round 8.0–9.5 min, median 8.7 |
| **total** | **238.5 min**, under the 270 of `BUDGET_S`; no round stopped by the budget |

**n and `VOID`.** 24 rounds (48–71), 288 blocks, 17 424 rows; `VOID` 0, errors 0. Checks: 43 968 exact frames,
each against the SHA-256 the index holds, 43 968 passed; 80 784 lossy frames against native dav1d's hash, 80 784
passed. Apart from the harness, the index's 175 truth hashes (56 + 50 + 69) were checked here against SHA-256 of
each source `.raw` and against its `.sha256` file: 175 of 175 equal. The three indexes `sweep.py code` wrote are
byte-identical to `results/amended-shard-1.index.dbts_{a1,b1,c1}.json`.

**Mutations.** `amended_test.py` 31/31; `mutate_amended.py` 12 breaks, each caught (30/31 or fewer each). The six
browser mutations, block k 8 of `dbts_a1`, round 0 (`.mutations.jsonl`): the failing (arm, op, check) set of each
is the same as the pilot's, row for row.

| mutation | rows failing | which (arm · op · check) |
| --- | --: | --- |
| `sample` | 54 of 54 | every op of `lay-k8` and `sep-g8`, and `ctrl`, `ctrl-aa` cine-exact |
| `truth` | 54 of 54 | the same as `sample` |
| `offset` | 16 of 54 | `sep-g8` residual · exact (8), next · exact (8) |
| `skip` | 2 of 4 | `lay-k8`, `sep-g8`: decode error `dav1d: -28`, the arm stops there; `ctrl`, `ctrl-aa` pass |
| `low` | 16 of 54 | `lay-k8` exact · exact (8), next · exact (8) |
| `dwell` | 16 of 54 | `lay-k8` next · exact (8), `sep-g8` next · exact (8) |

**The check on its own rows** ([`results/amended-shard-3.md`](../../lab/av1/delivery/carriers/results/amended-shard-3.md),
not read): A/A passes in 12 of 12 blocks, its median log ratio −0.0097 … +0.0051; one arm flagged by order,
`ctrl` in `dbts_b1` · k 16 (p 0.0085).

**Differed from this section.**

* Before §F was pushed, this session ran `tools` and part of `amended-content` on `589f1c11`, then stopped them and
  ran §F's command from the start on `fb6e522a`. `make_frames.py` (unchanged between the two) found its payload
  already coded and took 1 s; the k = 8 stream was recoded and diffed against `svc-shapes.tsv`, and `sweep.py code`
  recoded and checked every unit.
* meson 1.9.1 (the README's version) was installed with pip; the host had none. Playwright is 1.63.0, not the
  README's 1.56.1.
* `gen_htj2k_fixtures.sh` printed a numpy `ModuleNotFoundError` under `tools`; `run.sh` runs it `|| true` only to
  build `ojph_compress`, whose presence the next line checks.
* Commit `ff801278` (the mutations) has committer `Claude <noreply@anthropic.com>`, set by a `pull --rebase`; it is
  pushed and the branch is not force-pushed. Every later commit's author and committer is `dary-dc`.

### Amended shard 2, measured

*2026-11-05, shard 2 of 4, run by a session given only the amended protocol; §F's command as written, on `fb6e522a`.
Numbers only; the collector pools the shards and applies §D.*

1. **Run:** `SHARD=2 ROUNDS_PER_SHARD=24 BUDGET_S=16200 run.sh tools amended-content amended-mutate amended-rounds`,
   01:17:30–04:36:15 UTC: rounds 24–47, every block whole, then nothing else.
2. **Shows:** the content equals the pin; `amended_test.py` 31/31; `mutate_amended.py`'s 12 breaks each caught; each
   browser mutation fails its own check and leaves the others whole; 24 rounds × 12 blocks, no `VOID`, every check
   passed (43 968 exact frames, 80 784 lossy frames).
3. **Rests on:** `dbts_a1`, `dbts_b1` and `dbts_c1` only, on the host below, at 1×.
4. **Left:** the pooling of the four shards and §D, by the collector.
5. **Not here:** a verdict. The `amended.py` output in the shard's `.md` is a check on 24 rounds, not read.

Terms are those of §Terms, for this section. A **check** compares a decoded frame with its truth: an exact frame's
truth is the SHA-256 of its source samples, a lossy frame's native dav1d's hash, both written by `sweep.py code`. A
**mutation** breaks one input on purpose, for one round of block k 8 of `dbts_a1`, to show that a check sees it.
**`VOID`** is a block past 15 min, or one whose browser failed; **n** is the rounds a block holds.

#### Host and saturation

4 cores of an Intel Xeon Processor @ 2.10 GHz, one thread a core (`lscpu`), 15.7 GiB (`free`). Headless Chrome for
Testing 153.0.8010.12, playwright 1.63.0, node 22.23.4. It is the pilot's host model.

`vmstat 30` ran beside the shard, its only addition. Over the rounds (336 samples) the whole host was 28 % busy at
the median (95th percentile 30 %, max 31 %), about one core of four, run queue 1.2 on average. The host does not
saturate in any arm; `sweep.py code`, before the rounds, reached 70–99 %. Nothing is claimed past one decode in
flight at 1×.

#### Steps, wall

| step | wall | what it printed |
| --- | --: | --- |
| `tools` | about 1 min | built by this session's earlier `tools` (below), reused |
| `amended-content` | 26.7 min | make_frames 252 s; `shapes.py` 90 s, the k = 8 stream equal to `svc-shapes.tsv` (the `diff` printed nothing); `sweep.py code` 1 256 s, no unit differing from the pin, the native chain checks passed (it did not stop) |
| `amended-mutate` | 2.1 min | below |
| `amended-rounds` | 168.7 min | 24 rounds of 6.6–7.5 min; no budget stop |

The three indexes `sweep.py code` wrote are byte-identical to
[`amended-shard-1.index.*.json`](../../lab/av1/delivery/carriers/results/). Every exact truth in them (56 + 50 + 69)
equals the SHA-256 of its frame's `lab/av1/data/<volume>/NNN.raw` and that frame's `.sha256`, recomputed after the run.

#### n and VOID

| volume | k 1 | k 4 | k 8 | k 16 |
| --- | --: | --: | --: | --: |
| `dbts_a1` | 24 | 24 | 24 | 24 |
| `dbts_b1` | 24 | 24 | 24 | 24 |
| `dbts_c1` | 24 | 24 | 24 | 24 |

`VOID` 0, `error` 0, a failed check 0, over 17 424 rows:
[`amended-shard-2.jsonl`](../../lab/av1/delivery/carriers/results/amended-shard-2.jsonl). Every block's A/A
interval contains 0 and no arm is flagged by order, on this shard's rows alone
([`amended-shard-2.md`](../../lab/av1/delivery/carriers/results/amended-shard-2.md); not read).

#### Mutations (round 0, block k 8, `dbts_a1`)

`amended_test.py`: 31/31. `mutate_amended.py`: each of 12 breaks caught. Browser, passed/total per (arm, op, check);
the cines hold 56 frames, the jumps, exacts, residuals and nexts 8, each control 56.

| mutation | expected (*derived* from `amended.js`, `ask.js`) | `dbts_a1` |
| --- | --- | --- |
| `sample` | every check fails | 0 passed, in every row |
| `truth` | every check fails | 0 passed, in every row |
| `offset` | `sep-g8` residual and next fail; all else whole | residual 0/8, next 0/8; all else all passed |
| `skip` | asks starting one unit late fail, on both carriers | `lay-k8` and `sep-g8` arms end `Error: dav1d: -28`, so no value; `ctrl` 56/56, `ctrl-aa` 56/56 |
| `low` | `lay-k8` exact and next fail (12 bits) | `lay-k8` exact 0/8, next 0/8; all else all passed |
| `dwell` | next fails, on both carriers | `lay-k8` next 0/8, `sep-g8` next 0/8; all else all passed |

Under `skip` an error ends the whole arm, so its cines leave no row: the break is seen, whether the cines stayed whole
is not. The outcome equals the pilot's on `dbts_a1`, (arm, op, check) for (arm, op, check)
([`amended-pilot.mutations.jsonl`](../../lab/av1/delivery/carriers/results/amended-pilot.mutations.jsonl)). What −28 means in dav1d is *unverified*. No mutation missed its own check or broke another's, so the shard went
on to rounds. Rows:
[`amended-shard-2.mutations.jsonl`](../../lab/av1/delivery/carriers/results/amended-shard-2.mutations.jsonl).

#### What differed from §F (environment, not protocol)

* `meson` was absent; installed with pip (1.9.1, README's version). `numpy` was absent from the default `python3`
  (3.11); installed (2.4.6, `lab/av1/README.md`'s version) after `tools`' `gen_htj2k_fixtures.sh` printed
  `ModuleNotFoundError` under `|| true`; `ojph_compress` was built all the same (the `test -x` passed).
* Before §F's table existed, this session ran `tools` on `a731ca81` (twice: the first stopped on `meson`). §F's
  command was then run from its start on `fb6e522a`, so `tools` found its outputs present.
* The run's working tree stayed at `fb6e522a`. Rows were committed every 4 min from a second worktree, so no pull
  changed the harness under the rounds (finding 16).
