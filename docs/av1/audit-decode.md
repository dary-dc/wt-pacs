# Decode and delivery results, audited

*2026-11-10, an independent audit (queue row AV1-AUDIT-DECODE), adversarial toward the results, not their author. Read
from `origin` that day: each study's document, its harness code and its committed rows. Nothing was re-run in a
browser. "Verified" means read in code or recomputed from committed rows; *derived* means arithmetic on committed
rows or on a timing taken here; *unverified* means reasoned and not checked.*

**What prompted it.** A residual-decode ratio of 0.97–1.00 HTJ2K frames turned out to divide by an HTJ2K arm that
carried an extra JavaScript pass over every sample, while three other harnesses read 1.4–1.7. This audit looks for
every other case of that kind, plus the other ways a ratio can be wrong: clocks that span different work, builds and
browsers that differ, software decoding read as hardware, one thread generalised, a throttle that does not model a
phone, gates that pass for the wrong reason, equal Q read as equal quality, and encoder settings that change the cost
of G > 1.

**Studies audited** (branch: document; harness):

| short name | branch | document | harness |
| --- | --- | --- | --- |
| profiles decode (amended) | `claude/av1-quality-profiles` | `claude/av1-quality-profiles:lab/av1/profiles/README.md` §Profiles decode, measured (amended) | `decode_block.js`, `decode_block.mjs`, `decoders.js`, `shared.js` |
| residual apart | `claude/av1-residual-apart` | `lab/av1/delivery/residual/README.md` §Residual apart | `apart.js` |
| profile carriers, its audit and review | `claude/av1-profile-carriers` | `docs/av1/profile-carriers{,-audit,-review}.md` | `claude/av1-profile-carriers:lab/av1/delivery/carriers/ask.js`, `amended.js` |
| SNR preview | `claude/av1-snr-preview` | `claude/av1-snr-preview:docs/av1/snr-preview.md` | `claude/av1-snr-preview:lab/av1/delivery/snr/snr.js`, `rule.py` |
| SVC preview and its rule | `claude/av1-svc-preview` | `lab/av1/delivery/scalable/tool/svc-results*.md`, `svc-rule.md` | `bench.mjs`, `total-time/page.js`, `run.mjs` |
| pixel work (JS passes) | `claude/av1-unified-mainbase` | `docs/decode/README.md` §JS passes protocol | `claude/av1-unified-mainbase:lab/av1/decode/passes/` |
| grey path (merge-free) | `claude/av1-unified-mainbase` | `docs/decode/README.md` §Merge-free protocol | `claude/av1-unified-mainbase:lab/av1/decode/merge-free/` |
| decode notes | `claude/av1-unified-mainbase` | `docs/decode/README.md` §AV1, §Decode time against HTJ2K | `claude/av1-unified-mainbase:lab/av1/decode/breakdown/`, `per-frame/` |

The task named "pixel-work" and "grey-path" studies; they are read here as the JS passes and merge-free studies on
`claude/av1-unified-mainbase`, the two that time JavaScript passes over the samples (*unverified* that this is the
intended pair).

**Fixtures, for every finding below.** Three EA1141 breast tomosynthesis volumes, one per system: `dbts_a1`
(56 × 1142×1785, 12-bit), `dbts_b1` (50 × 2560×3328, 10-bit), `dbts_c1` (69 × 976×2513, 12-bit); usually the middle or
first 16 slices. Controls `us_liver` and `mr_ispy1` in the passes and merge-free studies. No breast ultrasound cine, no
ABUS. Every host is a 4-core cloud Xeon at 2.1–2.8 GHz, headless, no GPU, `prefer-software`.

## The HTJ2K frame is not one unit

Every result in this line is quoted as "× an HTJ2K frame". Four different things carry that name:

| HTJ2K unit | OpenJPH build | what its clock spans | Chromium | studies |
| --- | --- | --- | --- | --- |
| bare product build | the client's own (0.31.0, emscripten 3.1.74, `-msimd128`, range in the pack) | header, decode, one `slice()` copy | 141.0.7390.37 | profiles decode (`decoders.js:95-104`, `decode_block.js:57-63`) |
| product build plus a JS pass | the client's own | decode, then a JS loop `out[k] = v[k] − htj2kShift` into a fresh array | 153.0.8010.12 | residual apart, arm H (`apart.js:117-125`) |
| vendor package plus range pass | `@cornerstonejs/codec-openjph` 2.4.11 (no `getRange`) | `htj2k.decodeFrame`: decode, copy into a `SharedArrayBuffer`, JS `finish()` range pass | 153.0.8010.12 | profile carriers (`ask.js:10`, `amended.js:10`), SNR (`snr.js:154-156`), SVC (`bench.mjs`, `total-time/run.mjs`) |
| vendor package through the worker | the package | the decoder worker: decode, range pass, XXH3 digest, messaging | 141.0.7390.37 | breakdown (`breakdown/page.js:7`), row SPEED, so `docs/decode/README.md` §Decode time against HTJ2K |

The range pass alone is 21–31 % of a frame (`docs/decode/README.md:1106-1107`, unified-mainbase); the product's
own build was ×0.715–0.732 of the package on a cold ask (`:281-282`). Absolute times differ accordingly: H on
`dbts_a1` at 1× is 12.6 ms in profiles shard 2, 25.0 ms in residual apart (`rows/dbt-summary.txt`), 31.5 ms in the
breakdown. **A ratio from one row of this table cannot be set beside a ratio from another**, yet
`docs/lines/codecs.md` (main) puts the exact ask's "1.01–1.03 HTJ2K frames" beside the view's "1.05–2.04", and
`claude/av1-profile-carriers:docs/av1/profile-carriers.md:84-86` sets residual apart's 0.97–1.00 against package-build ratios. The product ships the
first row's build with its range in the pack and a digest on the exact frame; no study times exactly that.

## Findings

Severity: **V** changes a verdict, **W** weakens it, **C** cosmetic. Decisions: **WC** WebCodecs as the default route,
**D** dav1d-WASM only as fallback, **G** the frame-group size, **X** the exact-frame HTJ2K path.

| # | finding | sev. | evidence | decision | cheapest check |
| --: | --- | :-: | --- | :-: | --- |
| 1 | **The 4× throttle caps each thread, not the cores, so multi-threaded WebCodecs gets several quarter-CPUs against one-thread OpenJPH's one.** WebCodecs' fall to under H at 4× is the thread count, not a slow device. | V | `throttleTree(pid, throttle)` with no `cores` at profiles `decode_block.mjs:93`, passes `run.mjs:26`, merge-free `run.mjs:32`, breakdown `run.mjs:38`, `per-frame/speed.mjs:35`, SVC `total-time/run.mjs:192`; the tool's own doc says `cores` is what makes "a slow phone, not slow threads on a fast box" (`lab/scripts/cpu_throttle.mjs:38`). D1 S1 WebCodecs ÷ H: `dbts_a1` Q16 1.226 at 1×, 0.809 at 4×; `dbts_c1` Q16 1.453 → 0.955 (`rows/decode-pooled.txt:100,196,856,952`). H slows ×4.5, WebCodecs ×2.9 (profiles shard 3, *derived*). New threads also run uncapped until the 10 ms sweep. | WC | D1 at 4× with `{ cores: 1 }` and `{ cores: 2 }`, one block, interleaved |
| 2 | **D1's lossy clock carries a JS pass the HTJ2K clock does not, and its result is discarded.** `back(px, shift)` allocates and loops over every sample on the clock, even at shift 0 (all of `dbts_b1`), and `keep` hashes the pre-shift array. WebCodecs' read also copies the 4:2:0 chroma the 4:0:0 stream comes back with, then row-copies the luma in JS. | V (coarse rungs), W (Q 8) | `decode_block.js:80-85`, `shared.js:13-17`, `decoders.js:74-80`; product: `client/decode/av1-webcodecs.js:141-143` reads with no `back`. `back()` timed here in Node 22 on this audit's 4-core host: 3.5 ms (`a1`), 10.6 (`b1`), 2.8 (`c1`), against shard 2's H of 12.6 · 36.1 · 12.6 ms: 0.23–0.29 H (*derived*, a different host). Removing it: `dbts_a1` Q32 1.045 → ~0.77, `dbts_c1` Q32 1.233 → ~1.0, `dbts_b1` Q56 1.346 → ~1.06, but Q 8 stays above 1: `a1` 1.824 → ~1.55, `c1` 2.040 → ~1.81 (*derived*). | WC | one block with a second stamp before `back`, or `back` off the clock; D1 re-read |
| 3 | **D3's residual clock carries the JS add; H has none. The 1.42–1.69 is mostly the add.** The mirror of the original conflict. | V (what D3 means) | `decode_block.js:66-74` times `j2k` + `add()`; H `:57-63` times `j2k` only. Residual bytes ≈ the exact frame's (`a1` 1.18–1.27 MB against 1.25). R − H on shard 2: `a1` Q8 18.3 − 12.6 = 5.7 ms; `b1` Q16 60.1 − 36.4 = 23.7 ms: the same per-sample cost as `back()` (*derived*). | X | a stamp between `j2k` and `add` in R, one block |
| 4 | **Residual apart's 0.97–1.00 divides by an H with a JS pass; corrected, the residual plus add is 1.3–1.6 HTJ2K frames.** Confirmed from the rows: the pass costs what the add costs. | V | `apart.js:117-125` (H's pass), `:137-149` (RA's add). `rows/dbt-summary.txt` 1×: H − R = 6.2 · 24.9 ms, RA − R = 5.40 · 24.6 ms (`a1`, `b1` crf20). RA ÷ R, a proxy for RA ÷ a bare HTJ2K frame since residual bytes are 0.98–1.00 of HTJ2K: 24.9 ÷ 18.8 = 1.32 (`a1`), 72.8 ÷ 46.1 = 1.58 (`b1`) (*derived*). The 8-bit `us_liver` cell, where H has no pass, is the only one that read "more" (1.283). | X | an H0 arm (`dec(u).slice()`) interleaved, 15 rounds on `dbts_a1` |
| 5 | **The three residual harnesses agree once their passes are aligned.** Profile carriers amended times the residual decode and the add apart: decode 22.0 · 68.0 · 22.5 ms against its HTJ2K 20.5 · 66.6 · 21.3, the add 6.05 · 24.5 · 7.24; decode + add ÷ HTJ2K 1.37 · 1.39 · 1.40 (*derived* from its shards). The residual's decode alone is 1.02–1.07 HTJ2K frames; the JS add is 0.3–0.4. | W (the earlier conflict, settled) | `amended.js:104-112`, `:141-146`; `results/amended-shard-{1…4}.jsonl` | X | none needed for the reconciliation; a WASM add would be the lever, but the residual is dropped |
| 6 | **SNR's "`two` decided slower than `sep`, 1.04–1.11×" is the JS add.** With each block's median add (from its own jump rows) taken off `two`'s in-order residuals, the exact-stage ratio is 0.98–1.02 in all 18 cells: a tie. | V (a dropped design) | `snr.js:83-89` times `decodeFrame` + `added`; `ctrl` `:154-156` times `decodeFrame` only; `rule.py:87-92`. Recomputed from `results/shard-{1,2}.jsonl`: as run 1.033–1.095, add removed 0.980–1.016 (*derived*: the in-order rows hold only decode + add, so the add is the jump rows' median). | X | rerun one block with `decode` and `add` stored per in-order frame |
| 7 | **The profiles WebCodecs jump opens a new `VideoDecoder` each time; the product keeps one and flushes.** The start-up lands in every jump. | W | `decoders.js:86-90` (`fresh` closes, constructs, configures); product `client/decode/av1-webcodecs.js` reconfigures only on a codec change. WebCodecs G 1 ÷ H: jump 1.30–2.25 against in order 1.05–2.04 at 1× (`README.md:2497,2503`): about 0.2–0.25 H of start-up (*derived*). A constant added to both S16 and S1 pulls D2 (6.7–9.2) down; every jump multiple (7.6–30×) is inflated. | G, WC | a jump variant that flushes the live decoder and sends the keyframe |
| 8 | **G > 1 is timed only on low-delay streams.** Every decode-timed lossy stream is `--good --cpu-used=6 --lag-in-frames=0 --auto-alt-ref=0`; the alt-ref variant exists in `bytes.py` but is never decode-timed, and its omission is not in §7's list of what is left. Residual apart's previews use libaom's defaults (alt-ref likely on, *unverified*); SVC and SNR's `snr` use `svc_encoder_rtc` at speed 7. | W | profiles `bytes.py:86-96`; residual `encode.py:110-111`; `docs/lines/codecs.md` Open 0 already names the question for bytes, not for decode | G | one jump and one in-order run on `--lag-in-frames=19 --auto-alt-ref=1` streams, same Q |
| 9 | **G is compared at equal Q, not equal quality.** At one Q, G 1, 8 and 16 differ in fidelity; the decode-time multiples by G (D2, the access-pattern table) carry that difference. | W | `bytes.py:92-95` fixes min-q = max-q = Q, aq and deltaq off; no PSNR or σ column beside the decode table (`README.md:2491-2520`) | G | report the bytes run's PSNR by G at each Q beside the decode rows |
| 10 | **dav1d-WASM is C without assembly, one thread; WebCodecs is Chromium's dav1d with assembly and threads.** The 1.2–3.6× between them is mostly build and threads, and dav1d-WASM's cost rises with Q where WebCodecs' falls (`dbts_b1` S1 in order, shard 2: dav1d 94.8 → 163.4 ms from Q16 to Q56, WebCodecs 63.5 → 50.0). | W | `client/decode/wasm/build/inside.sh` (`-Denable_asm=false -msimd128`); that the WebCodecs decoder is `Dav1dVideoDecoder` was read on a page, not in the harness's workers (`README.md:1777`, *unverified* there) | D | native dav1d `--threads=1` with and without asm, per frame type, on the same streams |
| 11 | **No result rests on hardware decoding or a phone, and the summary line carries no such caveat.** `codecs.md` (main) says "AV1 saves bytes, not decode time" unqualified. Phones' hardware decoders refuse spatial layers (`docs/av1/README.md:1741`, SVC branch), and a hardware decoder's exactness is unmeasured everywhere. | W | every study: headless shell, `prefer-software`, no GPU | WC | none cheap: owed to a phone (`codecs.md` Open 4) |
| 12 | **Two Chromium versions under ratios that are compared.** Profiles, passes, merge-free and breakdown ran 141.0.7390.37; residual apart, profile carriers, SNR and SVC ran 153.0.8010.12. Residual apart's README Pins (`:140-142`) still name 141 and the package for its earlier §Decode time, whose 1.31–1.89× puts the preview on the clock and is not a residual-apart number. No profiles row records the browser version; shard 3 says "Chromium major not read: *unverified*" (`README.md:583`) while the pooled section states 141.0.7390.37 (`:2431`). | W | as cited; keyParse's 141 against 156 moved a ratio by 1–3 % (`docs/decode/README.md:1787-1788`) | WC, X | one ratio from each study re-run on one Chromium |
| 13 | **`codecs.md` (main) labels the view's 1.05–2.04 "Q 8, G 1"; it spans three rungs per set.** At Q 8 only `a1` and `c1` have cells (1.824, 2.040, both the top-10-bit stream); `dbts_b1`'s lowest rung is Q 16 (1.714). The 1.05 end is `a1` Q 32, "not decided". "1.9–4.7 through dav1d" is the 12-bit stream, not the same view as WebCodecs' top 10 bits. | W | `rows/decode-pooled.txt:292,388,484,1144`; `README.md:2497,2509` | WC | quote the Q 8 cells alone |
| 14 | **No A/A or mutation can see what a clock spans.** Every A/A (profiles H′ ÷ H, SNR `ctrl-aa`, carriers `ctrl-aa`) runs the same code twice, and every mutation breaks a hash, an offset or a unit. Residual apart's pass survived 960/960 on every check. Shard 5's A/A 0.978 [0.962–0.997] excludes 1 and was kept under the ±5 % rule. | W | profiles `README.md` §Blocks; `snr.js:151-159`; `mutations.py` | all | a known-cost mutation: a dummy pass over every sample added to H, which must move D1 and D3 by its cost |
| 15 | **SVC's 4× verdicts take their A/A resolution from a link-bound arm.** At 50 Mbit/s HTJ2K stays within 0.3 s of its last byte while AV1 is decode-bound; the ±0.3–0.4 % A/A then judges decode-bound times, e.g. the passing 1.069–1.070 against 1.10. | W | `svc-results-r50000.md` §Host, `svc-rule.md` §Verdict | G | a k2-against-k2 A/A at 50 Mbit/s 4× |
| 16 | **Every "× HTJ2K" in profile carriers, SNR and SVC uses the package, whose range pass the product no longer runs**, so "every AV1 carrier 2.8–10× HTJ2K" (`snr-preview.md:697`) and SVC's "3.4–9.2×" understate HTJ2K's lead by up to the pass's 21–31 %. `profile-carriers.md:156` calls the package "the product's". Within-AV1 ratios are untouched. | W | the table above | X, WC | one `ctrl` block on `client/decode/wasm/build`'s OpenJPH |
| 17 | **Profile carriers' C3 on `dbts_b1` is inflated by a transient, and review row 14 misdescribes its HTJ2K arm.** `ask.js:197-200` calls `decodeFrame` (copy and range pass), not "decode only"; the residual's third ask spikes to 324.8 ms at 1× against ~86–110 for the others; asks 4–8 alone give ~1.35×, not 1.91 (*derived*). "Refuted" stands. | C | `ask.js:190-200`, `:234-246` (`warm()` never runs `added()`); `results/carriers-rows.jsonl` | X | C3 re-read from asks 4–8 (rows exist) |
| 18 | **The merge-free S ÷ W2 credits S with R's buffer reuse.** `s/av1-webcodecs.js` keeps a grown per-stream region, which is R's lever; against R, S is 0.82–0.92, so it misses the < 0.90 line in more cells. "Not proposed" stands with a smaller margin. | C | merge-free README ms table: `a1` 97.2 ÷ 107.2 = 0.91 (*derived*) | WC | `report.mjs` with R as S's reference |
| 19 | **SNR's dominance of `svc` ignores fidelity:** a quarter-size q 40 base at 38.0–38.7 dB upscaled against a full-size Q 24 preview at 45.8–46.5 dB; dominance counts bytes and time only. | C (preview out of the top) | `svc-results.md` headline 3; `snr-preview.md:134-136` | — | a PSNR column in the dominance test, or the q 20 base |
| 20 | **Stale lines.** `docs/decode/README.md:2016-2017` still quotes the flush's −7 to −20 % (corrected at `:1710`); `:2883` says "the fixtures are synthetic", no longer true of the AV1 timings. | C | as cited | — | edit in place |

What held: the passes and merge-free studies' W and W2 span the same `decodeStart` → `decodeEnd` (or post → receipt);
warm-up frames are off every clock; their interval ranks and Williams orders are as pre-registered; every exactness
check reported was read and passes for the right reason. SVC's fill times are measured through a real relay, and the
one modelled figure (`svc_tables.model()`) is printed as such.

## The three that matter most for the optimal-quality product

1. **The 4× throttle is not a slow phone (finding 1).** It is the only evidence that WebCodecs comes in under an
   HTJ2K frame (0.81–0.97 on `a1` and `c1` at 4×), and it comes from giving each of WebCodecs' threads a quarter-CPU
   while OpenJPH has one. The default route's speed on a slow device is therefore unmeasured, not favourable. *Check:*
   D1 at 4× with `cores` 1 and 2; then a phone.
2. **The view's "1.05–2.04 HTJ2K frames" carries a discarded JS pass and is mislabelled (findings 2, 13).** Taking
   `back()` off the clock moves the coarse rungs to ~0.77–1.06, but at Q 8, the optimal-quality rung, `a1` and `c1` stay
   at ~1.55–1.81 (*derived*). "AV1 saves bytes, not decode time" survives at Q 8 at 1× and should say so, with its
   rungs, its stream (top 10 bits) and its host. *Check:* one block with a stamp before `back`.
3. **The HTJ2K denominator differs by study (the table, findings 4, 12, 16).** The exact frame's cost — the
   product's own path for every Lossless request — is quoted against four HTJ2K units on two Chromium versions, and
   the one the product ships (its build, range in the pack, digest on) is timed nowhere. *Check:* one interleaved block
   timing the product's `htj2k.decodeFrame` on its own build beside each study's unit, on one Chromium.

The original conflict is settled (findings 3–5): aligned, all three residual harnesses read the residual's decode at
1.02–1.07 HTJ2K frames and the JS add at 0.3–0.4 more. That does not reopen the residual, which the owner dropped.
