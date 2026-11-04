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

*2026-11-04, partial: the run is in progress; this section is replaced as each unit finishes.*

* **Host.** 4 cores of an Intel Xeon Processor @ 2.10 GHz (one thread a core), 15 GB, headless Chrome for Testing
  153.0.8010.12 (playwright 1.63.0). Not the 2.80 GHz host §5 was built on: every time below is for this host only.
* **Done.** `run.sh tools` (libaom 3.15.1, the patched `svc_encoder_rtc`, the lab's dav1d-WASM, OpenJPH, the three
  volumes SHA-256-checked, the profiles directory at `b9e3e9e`). The host lacked `meson`; it was installed with pip
  (1.12.1) before `tools`, no file of the repository changed.
* **Content** (`run.sh content`, 23 min on this host): the `p3-m10/20/30` streams equal `svc-shapes.tsv`'s totals
  byte for byte on all three volumes (`run.sh`'s diff empty); `content.py` coded `p3k1-m20` (`-k 1` accepted) and
  the separate streams (`streams.py` did not stop: each equals the profiles bytes run's row); every layered ask decoded
  natively from its keyframe is exact, 8/8 a volume for `p3-m20` and for `p3k1-m20` (48/48).
* **Mutations** (`run.sh mutate`, `dbts_a1`, one round at 1×). `roles_test.py` 16/16, each of `mutate.py`'s six breaks
  caught. Native: `skip` leaves `p3-m20` 1/8 (the keyframe's) and `p3k1-m20` 8/8; `low` 0/8 on both. In the browser:
  `sample` 0/8 every exact arm and 0/56 every view; `truth` the same (its first cell hung and was written `VOID` after
  15 min; run again, as above); `offset` `res` 0/8, its lossy frames 8/8, every other arm whole; `skip` `svc` 1/8,
  `svc1` 8/8, every other arm whole; `low` `svc`, `svc1`, `k2` 0/8, every other arm whole. Each check sees its break.
* **Bytes, storage and quality** (deterministic, from `content.py`'s index; `predictions.py` reads C2, C4's bytes, C5,
  C7's bytes and PSNR, C8). C2 held: an ask downloads 3.49 · 4.46 · 3.47× a shipped frame (`dbts_a1` · `b1` · `c1`);
  the top's share t of top + low bits is 0.691 · 1 · 0.699. C4's bytes: `p3k1-m20`'s base + middle is 1.96 · 1.49 ·
  1.93× `p3-m20`'s, **refuted** on `dbts_a1` and `dbts_c1` (band 1.15–1.8); its stored stream 1.02 · 1.02 · 1.03×,
  held. C5 held at every (volume, m): the separate stream at the middle's PSNR is 0.60 · 0.64 · 0.52 (`a1`, m 10 · 20 ·
  30), 0.67 · 0.66 · 0.57 (`b1`), 0.61 · 0.62 · 0.45 (`c1`) of base + middle. C7's bytes and PSNR held: Q 56 is 0.75 ·
  0.89 · 0.66× the quarter base, +2.31 · +0.54 · +2.69 dB. C8 held: layered 0.940 · 0.947 · 0.937 of HTJ2K, by
  residual 1.004 · 1.001 · 1.002, by whole frame 1.008 · 1.043 · 1.012.
* **Pairing by nearest PSNR** (§4's rule). Middle m 10 · 20 · 30 against Q 8 · 16 · 32: `dbts_a1` 48.46 · 46.33 · 45.31
  dB against 49.94 · 46.76 · 45.02; `dbts_c1` 49.59 · 46.98 · 45.77 against 51.42 · 47.54 · 45.61 — paired as written.
  `dbts_b1` 49.23 · 45.84 · 44.20 against 52.05 · 46.69 · 43.96: m 10 is nearer Q 16 (gap 2.54 dB) than Q 8 (2.82 dB),
  so on `dbts_b1` m 10's times are read against Q 16.
* **Rounds 0–2** (15.8–16.2 min each, under §4's 18 min: no arm dropped; 1 062 rows, none failing a check, no
  `VOID`). Read at n = 3 by `predictions.py`, medians over rounds, `dbts_a1` · `b1` · `c1`, 1× / 4×: C1 held, a layered
  ask 35.5 · 24.5 · 29.7× / 30.3 · 24.0 · 26.0× an HTJ2K frame, position 7 ÷ position 0 4.5–6.4 (the theory stands);
  **C3 refuted**, the residual + add 1.58 · 2.00 · 1.52× / 1.49 · 2.04 · 1.50×, the whole frame (`htj2k-aa`) 0.99–1.10×;
  C4's ask held, 11.5 · 6.2 · 10.5× / 9.6 · 6.5 · 8.8×; C6 held, 0.98–1.31×, WebCodecs 0.23–0.68×; C7's decode held,
  6.3–13.4×. Partial: the reading at 10 rounds replaces this line. Rows: `lab/av1/delivery/carriers/results/`.
* **Rounds 3–6** run (15.8–16.1 min each, no check failed, no `VOID`); rows committed, read with rounds 7–9.
* **Running.** rounds 7–9 (the first `rounds` job was stopped after round 6, whole, to outlast its shell limit, and restarted with `FIRST=7`).
