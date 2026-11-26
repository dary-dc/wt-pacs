# The reports: how the load and safety reports leave the page

Written 2026-11-22 by row REPORTS-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that wrote, built,
ran and reviewed none of the reports' rows, from pushed results only; nothing run. Inputs at: `claude/report-plan`
`948e79b47` (`docs/client/evidence/report-plan.md`: §2–§5 the options and their sources, §7 the protocol, §Results,
§Verdict review, §Results 2, §Verdict review 2), `claude/report-arms` `4ef4e12a` (the rig and its rows, PR 395),
`claude/telemetry-client` `b097f5b9` (PR 370, `docs/adr/telemetry-in-production.md`), [`frame-integrity.md`](frame-integrity.md)
§3.4, `claude/phone-run:docs/phone-rows/next-round-results.md`. § numbers are `report-plan.md`'s unless another file
is named. *Read against the reruns 2026-11-26* (PAGES-AFTER-RUNS-REPORTS, a session that ran none of the runs):
`claude/page-runs` `5fc1c372d` (`docs/reviews/page-runs.md` §2, §2 Amendment, §2 Results as PAGE-RUNS-VERDICT-FIX
corrects them, §Verdict review and its re-review) and the rows at `claude/report-arms` `a3b58b612`
(`lab/report-arms/rows/r3-*.jsonl`); §2's *Read against the reruns* carries them, each old line kept and marked.

## 1 · The question

Two records leave the page. The **load report** says how a sampled load went: its fill, routes and bytes. It is
telemetry, and it is off until the owner turns it on (rate 0). The **safety report** says a frame failed its exactness
check. It is always on and never sampled (`docs/client/design.md` §Decided, 2026-11-14). Three things must be chosen:

* the **carrier**: `sendBeacon` (BEACON), `fetch` with `keepalive` (KEEPALIVE), or a stream on the WebTransport
  session (SESSION);
* the **timing**: once at hide (H), or at the fill's end plus a delta at hide (Y, the hybrid);
* the **receiver**: an nginx log line (NGINX), or a validating process behind nginx (RECEIVER).

The pre-registered rule (§7.5) passed no carrier. Rule 5 therefore hands the result to the owner as measured. Rate,
sink and retention are policy, not measurements.

## 2 · The recommendation, and the owner's yes or no

**Keep telemetry off. Take NGINX as the receiver and the hybrid timing (Y). Send the safety report at once over
HTTP, never on the session alone. Name no carrier until the two reruns that can separate BEACON-Y from KEEPALIVE-Y
have run (phase 2, amendment 28 rule 2). Do not merge PR 370 as it is.** The carrier and the timing are
**provisional**: no counted cell decides them (§Verdict review 2, rule 1). *Corrected 2026-11-26*
(PAGES-AFTER-RUNS-REPORTS): the two reruns ran (REPORT-RERUNS, 2026-11-24 and 25) and both are `VOID` by their A/A
(`page-runs.md` §Verdict review B1), so neither separates the carriers, and §6's rule ("BEACON-Y wins if neither
holds") names **BEACON-Y, provisional**. The one rerun left to ask is D5a busy's (item 3).

This serves the value statement in two ways. The safety report is how the check's failures reach whoever runs
the server: the exact frame's, and the view's where it is still checked (the owner's word of 2026-11-23 ~02:00: a view decoded in hardware is
shown unchecked). And at 100 reports a second NGINX costs 1.3–1.5 % of a core, which keeps the server's cost per reading
session low.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | The receiver is **NGINX**: one access line per report, no address logged, one file per kind and UTC day | **yes** | nothing now (telemetry is off). At turn-on, a `location` per kind in the web image, as built in `lab/report-arms/nginx/` | RECEIVER: validation when each report is written, at about 4× NGINX's CPU, a second process, and a 5 % bar it misses (5.28–6.33 %) |
| 2 | The load report is sent **Y** (at the fill's end, plus a delta at hide), not H | **yes, provisional** | the carrier build sends at the fill's end. Y leads H by 40 points of fill records (90/90 against 54/90). This is read without C's bar, so it is not the verdict | H, PR 370's timing. H loses the fill record whenever the renderer dies before a hide (0/18 in D5a and in D5b) |
| 3 | Name the load report's carrier only after the reruns of §Verdict review 2 *Owed* | **yes** (*corrected 2026-11-26*: run and `VOID`, so **BEACON-Y by §6's rule, provisional**; the owner's yes or no is now **rerun D5a busy alone, 18 rounds, with an A/A for a race cell written before its rows** (`off` and `off′` within Fisher's p ≥ 0.05, `page-runs.md` §Verdict review row 2): **yes**, recommended; without it BEACON-Y stands. C is not rerun: two runs, no arm inside its bar, not measurable at this size on this host) | two rerun rows in phase 2, each written before its rows: (a) C, judged by its median within the A/A's band, with a KEEPALIVE arm that uses `off`'s decoder; (b) Lbusy, and D5a on a busy page, with an absolute A/A and a sub-ms sink clock | the owner names BEACON-Y or KEEPALIVE-Y now. No counted cell separates them, and the two uncounted readings point opposite ways (§5) |
| 4 | The safety report goes **at once, over HTTP**, and is never carried by the session alone | **yes** (*read against the reruns 2026-11-26*: on a busy page SESSION lost 2–3 of 18 safety reports too, unpredicted, and BEACON-* 9 of 18 against KEEPALIVE-* 0, read beside a `VOID` cell; §2, *Read against the reruns*) | the 2026-11-14 decision's "at once" gets its carrier family. Its carrier (rule 3) waits on rerun (b) | SESSION stays a candidate, although it delivered 0 of 54 safety reports when no session opened (D8) |
| 5 | SESSION enters the product wire (`docs/WIRE.md`: a client stream type in the frame server) | **no** | — | SESSION stays a lab arm (`lab/server-telemetry/`, feature `telemetry`). It fails D8 by design (§3.3), and C read it 26–38 ms slower a fill than `off`. A SESSION arm with an HTTP fallback is not worth a run: the fallback is an HTTP carrier, which rule 4 already covers |
| 6 | Design the coded-bytes digest and the server's re-check of a reported frame now, and build them once the safety report's carrier is named | **yes, provisional** (as [`frame-integrity.md`](frame-integrity.md) row 5) | one hash a frame at ingest. The client hashes only after a mismatch, and the server re-checks one hash. Until then the receiver records each safety report and raises it (§5) | a safety report the server can record but cannot place (the bytes or the decoder) |
| 7 | Rate: 0 by default. A deployment that turns it on sets p, with 0.01 suggested (the ADR's §Open) | **yes** | nothing now. `TELEMETRY_RATE` stays unset | the ADR's default stays open |
| 8 | Sink: the same-origin nginx log (the ADR's (a)). Retention: 30 days, enforced by deleting the per-day files | **yes** | the ADR's §Open rows "the receiver", "the product sink" and both retention rows are answered | the ADR's defaults, unanswered |
| 9 | The web image moves to **nginx 1.31** (≥ 1.31.5, for `client_body_early_read`) when reports are turned on, not before | **yes** | nothing now. The image stays on `nginx:1.29-alpine` (`deploy/Containerfile:91`) while telemetry is off | the hop form on 1.29 (a second, local request a report; §3.5). It is neither built nor measured |
| 10 | RECEIVER's fallback log (an unvalidated body while RECEIVER is down) and its 1 GiB daily cap on load reports | **no: neither is needed with NGINX** | — | with NGINX, nginx itself writes every line, and load reports are bounded by `limit_req` (10/s, burst 20, per client) and the 16 KiB body. A daily cap exists only in RECEIVER. If the owner answers no to 1, keep the cap, and choose between the fallback log and lost records (§3.5) |
| 11 | PR 370 (M6): merge the telemetry module as built | **no; keep it open** | — | its record, fields, size bound and off switch are the shared base every arm used (§3). Its carrier is BEACON-H, the timing that row 2 replaces. The carrier build after row 3 takes PR 370's module with timing Y. Closing PR 370 then is the owner's call |

**Read against the reruns** (2026-11-26, PAGES-AFTER-RUNS-REPORTS, from `page-runs.md` §2 Results and §Verdict
review, whose counts hold, recomputed from the rows by PAGE-RUNS-VERDICT and its re-review; **measured** on headless
Chromium 158.0.8127.36 and Firefox 160.0.1, one 4-core cloud container, the grey-16 frame × 32, loopback; host CPU at
most 63 %, no round over 90 %):

* **(b), the race, is `VOID`** by `page-runs.md` §2's A/A rule ("D's A/A `off` = `off′`": `off` 6, `off′` 8 of 18 in D5a busy). Read
  beside, not adopted: on a busy page BEACON-H and BEACON-Y delivered the safety report 9 of 18 each, KEEPALIVE-H and
  KEEPALIVE-Y 18 of 18, SESSION-1, -Y, -H 16, 16, 15; the four page-thread arms lost 17 of 18 reports when the kill was
  sent under 12.5 ms after the fault, 1 of 16 over 37.5 ms; KEEPALIVE-* none at any delay. The model predicted 10–17
  of 18 for BEACON-*; 9 is a miss below: the page-thread carriers lose about half, not a quarter, cause not
  established (*theory*: the hand-off also waits on the decoder's failed-frame message).
* **Lbusy passes its A/A now** (BEACON-H's floor, even ÷ odd rounds, 1.040 on a µs clock): per-load p99, median of
  18, `off` and BEACON-* 50.9–51.4 ms, KEEPALIVE-* 2.72–2.81 ms, SESSION-* 1.92–2.13 ms. A page-thread carrier hands a
  report off after the long task; a worker carrier does not. This is (b)'s latency cell, not its loss cell, and it
  does not lift D5a busy's `VOID`.
* **(a), C, is `VOID`** by its A/A (`off′` ÷ `off` 1.053, 21 of 28 rounds slower, sign test p 0.013). Read beside:
  KEEPALIVE-Y 1.102, KEEPALIVE-Y° (its carrier with `off`'s decoder) 1.038, above its band 0.97–1.03; KEEPALIVE-Y over
  KEEPALIVE-Y° +7.3 ms, 19 of 28 rounds, p 0.09. So "its C cost comes from its wrapped decoder" leans that way and is
  **not shown**.
* **Firefox** (counted, Firefox 160.0.1): D1 safety report 18/18 every arm (2 `off` loads never filled, `VOID: no
  fill`), fill record 18/18 for each Y arm and SESSION-1, BEACON-H 17, KEEPALIVE-H 14, SESSION-H 2 of 18; idle D5a
  safety 18/18 every arm, fill record 18/18 Y arms and SESSION-1, 0/18 H arms: Chromium's pattern, a hit on every
  cell. L is `VOID` by its A/A (2.25). D6 is unrun: every WebTransport session to the relay timed out under `--tun`.
* **For item 2 (Y over H):** Firefox's D1 and D5a repeat Chromium's: an H arm loses the fill record when the renderer
  dies before a hide, Y does not. D5a busy's lost fill records (Y arms 6–9 of 18) are kills before the fill ends
  (~135 ms, the fault at frame 10), not a carrier property. Item 2 stays **yes, provisional**, still read without C's bar.
* **This page's reading, not the verdict's:** §6's rule names a winner when both of (a) and (b) hold or neither does;
  it names none when only (b) holds. With C left unmeasurable here, a valid D5a busy rerun that shows the race would
  therefore hand the carrier to the owner as measured (rule 5, §1), with KEEPALIVE-Y° +3.9 ms a fill (p 0.09) read
  beside; one that does not leaves BEACON-Y.

How it serves the value statement: a failed check is known only if its safety report arrives; on a busy page only the
worker carriers delivered it every time, and the rerun is what would let the page act on that.

## 3 · The options

All numbers **measured** on Chromium 153 headless, one 4-vCPU container, unless labelled otherwise. The rows are
`claude/report-arms` `4ef4e12a` `lab/report-arms/rows/`, and REPORT-VERDICT-2 recomputed every number
(`claude/work-ledger:docs/queue/REPORT-VERDICT-2/output.txt`).

| arm | safety report delivered | fill record, D3–D6 | C: fill time ÷ `off`, median | C: rounds within ±2 % (bar ≥ 15/18) | busy p99 (Lbusy, **VOID**; rerun 2026-11-24, its A/A passing: §2) | kept bytes a load |
| --- | --- | --- | --- | --- | --- | --- |
| BEACON-H | every ending | 54/90 | 1.052 | 0/18 | page thread, ~51 ms | ~2.2 KB |
| BEACON-Y | every ending | 90/90 | 0.976 (not told from `off`: sign test p 1.0, **derived**) | 1/18 | 50.84 ms | 2 647 B |
| KEEPALIVE-H | every ending | 54/90 | 1.137 (+16.7 ms, p 0.001, **derived**) | 0/18 | worker, 2.46 ms (3.25 its largest round) | ~2.2 KB |
| KEEPALIVE-Y | every ending | 90/90 | 1.072 (+9.2 ms, p 0.03, **derived**) | 3/18 | 2.46 ms | 2 649 B |
| SESSION-1, -Y, -H | **0/18 in D8** (no session opened) | -1 and -Y in every load; -H fails the load bar (D1 0/18, D7 1/18) | 1.217–1.303 (+26 to +38 ms) | 0–1/18 | worker | ~2.65 KB |
| `off′` (the A/A copy of `off`) | every ending | — | 1.013 (per-round median, as the column; 0.989 is the ratio of the medians) | **3/18** | — | — |

| receiver | at 100 reports a second (R, 6 rounds, 1.7 KB bodies) | bar 5 % of a core | what it adds |
| --- | --- | --- | --- |
| NGINX (1.31.8, early read) | 1.31–1.45 % of a core; all 72 000 written, nothing refused | passes | no new process. Fields are checked when read (the field mutant was caught) |
| RECEIVER behind nginx | 5.28–6.33 %; every report written | misses by 0.3–1.3 points | validation and refusal when written, the daily cap, the raise on stderr, `sync_data` for each safety report |
| the frame server (SESSION's) | not built | — | judged only together with SESSION |

Each arm's gap over its floor (L idle p50) is 0.0–0.7 ms. That is below the receiver clock's whole millisecond, so it
is a tie, not a ranking (§Verdict review 2, rule 5).

## 4 · Where it holds

**Fixtures and limits.** One 4-vCPU cloud container without a GPU, headless Chromium 153.0.8010.12, the rig's grey-16
frame ×32, nginx 1.31.8. *The reruns (2026-11-24 and 25, §2):* the same fixture and fault, headless Chromium
158.0.8127.36 and Firefox 160.0.1, host CPU at most 63 %. The host never saturated (CPU at most 38 %, REPORT-VERDICT-2 from `r2-cpu.log`). Every limit
is in the list below.

**Where the link, not the decode, binds** (2026-11-25, PAGES-PASS). Neither binds a report: a record is 2.2–2.65 KB
here and at most 6.6 KB on the demo series (**measured**, §3 and PR 370's test), and no decode is in its path. The link
enters as whether it is there: the session fails with it, so a load whose session never opens delivers no SESSION
safety report (D8, **measured**), which is why item 4 sends the safety report over HTTP. The fill cost C was read on
loopback, not on a link that binds a fill. No transport row is lowered by this, nor by the decode-bound phone
(`README.md` §Premises item 1).

**Each limitation, and what found it** (completed 2026-11-25, PAGES-PASS):

* **The fixture is the rig's grey-16 frame ×32, not a demo volume** (`dbts_c1`'s fill is not on this host). Found by
  REPORT-RUN's amendment (`report-plan.md` §7.8), kept by REPORT-RUN-2 (§7.9).
* **The faults are the fault bench's forced mismatch, not a real decoder fault.** Found by REPORT-PROTOCOL (§4, §7.2),
  restated in §7.9's fixtures line.
* **The links are loopback, or under `--tun` a userspace relay at 10 ms each way and 50 Mbit, not a radio**; REPORT-RUN
  ran no relay. Found by §7.8 (REPORT-RUN) and §7.9 (REPORT-RUN-2).
* **One nginx, 1.31.8.** Found by the re-review's n4 (§7.9's nginx row).
* **R's bodies are 1.7 KB**, against PR 370's 4.9–6.6 KB on the demo series (PR 370's test, **measured** there). Found
  by REPORT-RUN-2 (§7.9's R row).
* **Each arm's gap over its floor (0.0–0.7 ms) is below the receiver clock's whole millisecond**: a tie, not a
  ranking. Found by REPORT-VERDICT-2 (§Verdict review 2, rule 5).

* **C's bar cannot be met on this host.** `off′` met it against `off` in only 3 of 18 rounds, and `off`'s fill varies by
  7.3 % from round to round. Found by REPORT-VERDICT-2. Confirmed 2026-11-24: the rerun's A/A is 1.053, `VOID` again.
  Found by REPORT-RERUNS; read as not measurable at this size on this host by PAGE-RUNS-VERDICT (row 2).
* **Lbusy is VOID.** Its A/A gap was 0.11 ms on a clock that counts whole milliseconds. Found by REPORT-RUN-2, from PR 395's m5.
  *Corrected 2026-11-26:* rerun on a µs clock, its A/A passes (1.040). Found by REPORT-RERUNS.
* **D5a never reached the race.** In all 162 loads the page handed its report on before the kill, 49–65 ms after the
  fault. Found by REPORT-RUN-2's `safetyHanded`. The first run's D5 was mistimed (REPORT-VERDICT-REVIEW).
  *Corrected 2026-11-26:* D5a busy reached it (the kill sent from the sink's fault signal, not through the page;
  `page-runs.md` §2 Amendment), but its cell is `VOID` by `page-runs.md` §2's A/A rule. Found by REPORT-RERUNS.
* **`page-runs.md` §2's A/A rule cannot be met reliably by a race cell**: two Binomial(18, ≈ 0.4) arms are rarely equal (`off` 6,
  `off′` 8). Found by PAGE-RUNS-VERDICT (B1), from the rows.
* **The race's model under-predicts the loss**: BEACON-* 9 of 18 against 10–17 predicted (P ≈ 0.02 under its
  Binomial). Found by REPORT-RERUNS.
* **SESSION lost 2–3 of 18 safety reports on a busy page**, unpredicted and not traced. Found by REPORT-RERUNS.
* **The driver learns of each fault 5–8 ms after it** (p50; max 21 ms), so 1–5 delays an arm were sent late. Found by
  REPORT-RERUNS (§2 Amendment and §2 Results).
* **The KEEPALIVE and SESSION arms load a different decoder worker than `off`.** So their C cost is the arm as built,
  not the carrier alone. Found by REPORT-VERDICT-2.
* **SESSION's floor, KEEPALIVE's worker floor and the server's receiver row are not built.** Found by REPORT-CELLS.
* **D6 tested a 30 s blackout, never a link that does not come back.** Found by REPORT-VERDICT-2.
* **Only Chromium is counted** (*corrected 2026-11-26:* Firefox 160.0.1's D1 and idle D5a are counted, Chromium's
  pattern on each cell; its L is `VOID` by its A/A, 2.25; its D6 is unrun, every WebTransport session to the relay
  timing out under `--tun`; the rest unrun. Found by REPORT-RERUNS, after the rig's driver fix); Firefox 160.0.1 caught every mutant but ran no counted cell, its `bidi.mjs` hangs about
  once in 70–100 loads and leaks a ~108 MB profile a load. Found by REPORT-RUN-2.
* **Firefox observes no long tasks**, so C's long-task bar judges nothing there. Found by REPORT-CELLS.
* **WebKitGTK did not run** ("not on this host"), and nothing is claimed for Safari. Found by REPORT-RUN (§7.8) and
  REPORT-RUN-2 (§7.9).
* **No report cell has run on a phone**, and whether a record survives a phone's screen lock, app switch or
  force-stop is not known. Found by REPORT-PROTOCOL (§7.7) and this page's reading of `next-round-results.md` §Cells.
* **The phone harness's batch was lost at unload** with lab code, not the product; the keepalive quota it met is for
  BEACON-LOSS to verify (amendment 28). Found by the round of 2026-11-22 (`next-round-results.md`).
* **A clip's record size is not known**: no US clip was run, and a clip of a few hundred frames may pass 16 KiB or the
  64 KiB budget (**theory**). Found by this page (§4, *US and DBT stacks*); US-DBT-CARRY §4.3 agrees.

**Engines.** Only Chromium is counted (the list above; *corrected 2026-11-26:* Firefox's D1 and idle D5a since). **Theory** (§2, BCD): all three engines ship `sendBeacon`, keepalive `fetch` and WebTransport, under the
same 64 KiB keepalive budget.

**Phones.** None ran (the list above). The round of 2026-11-22 lost the harness's own ~45–110 KB end-of-load batch at
unload in every cell-3 load, a fresh Chrome included (**measured**, one phone, lab code; the list above). The
product's records are 2.2–2.65 KB here and at most 6.6 KB on the demo series, under that budget by an order of
magnitude (**theory**). Whether a record survives a phone's screen lock, app switch or force-stop (the list above)
is what the phone cells measure.

**US and DBT stacks** (amendment 27 item 6). The carrier, timing and receiver results do not depend on the modality.
They depend on record size and on how the load ends, and every arm stayed under 16 KiB here. A record's size grows with
its frame count, because it carries one row per frame. A breast ultrasound clip of a few hundred frames may therefore
pass 16 KiB or the 64 KiB budget. **Not yet known**: no US clip was run (`usb_cine` exists, lossy-sourced). PR 370's answer is to send the record again
without its per-frame rows (`truncated`).

## 5 · The mechanism

**Why Y beats H.** A report sent only at hide is lost whenever the page dies without a hide: the renderer is killed
while the page is visible, or the tab crashes. Beacon §1 guarantees only `visibilitychange`. Y sends the fill's record
as soon as it exists, so only the hide delta is at risk.

**Why the session is the wrong carrier for the safety report.** The session is the one thing that fails when the link
fails. A load whose session never opens has nowhere to send its report (D8). HTTP keeps a channel open in exactly that
case.

**Why BEACON-Y and KEEPALIVE-Y stay apart.** *Read against the reruns 2026-11-26:* Lbusy is now counted (51 ms
against 2.7–2.8 ms), and the race and C are read beside their `VOID` cells (§2). The rest of this paragraph is the page as
written. The two decisive keys disagree, and neither is a counted result. BEACON
sends from the page's thread, so a long task delays it: 51 ms in Lbusy, read as measured. KEEPALIVE sends the safety
report from the worker, so it does not wait (2.5 ms). Against that, KEEPALIVE's arm was slower in C (+9 ms a fill),
probably from its wrapped decoder rather than its send. Rerun (a) settles C and rerun (b) settles Lbusy.

**Why NGINX.** nginx already serves the page. Early read writes the body as a single access line, with no hop and no
second process. RECEIVER's checks when writing are worth something, but NGINX's read tool flags the same field errors
later, and RECEIVER costs about four times as much at every rate.

## 6 · What would change the recommendation

* **Rerun (a) or (b)** names the carrier. KEEPALIVE-Y wins if (b) shows a race that page-thread carriers lose on a busy
  page and (a) shows its C cost belongs to the wrapped decoder. BEACON-Y wins if neither holds, since it has fewer
  moving parts and is PR 370's API.
  *Run 2026-11-24 and 25, verdicted 2026-11-26:* both `VOID` by their A/A, so BEACON-Y by this rule, provisional.
  What would change it now: D5a busy rerun with a race A/A (item 3). It showing the race leaves the rule silent, (a)
  being unmeasurable here (§2, *Read against the reruns*), and the carrier the owner's as measured; it not showing
  the race keeps BEACON-Y.
* **R at 4.9–6.6 KB bodies.** If NGINX's cost rose past 5 %, row 1 would reopen. Theory says it will not: a line write
  of a few KB.
* **The phone cells** (§7.7): Y's fill record was sent while the page was visible, which theory says protects it, and
  H's at a screen lock. If a phone lost Y's fill record, row 2 would reopen.
* **A US clip's record size**, measured on a real clip, would decide whether `truncated` becomes the common path.

## 7 · What it would reopen

Nothing among the decided approaches. Telemetry stays off (rate 0). The safety report stays always on, never sampled
and sent at once. Row 4 only names its carrier family. Row 5 keeps the product wire unchanged.

## 8 · Rows and links

* Client queue: REPORT-OPTIONS, the four advocates, REPORT-PROTOCOL, the builds (REPORT-BUILD-HARNESS, -BEACON,
  -KEEPALIVE, -SESSION, -RECEIVERS), REPORT-BUILD-REVIEW, REPORT-BUILD-FIX, -FIX-REVIEW, REPORT-RUN,
  REPORT-VERDICT-REVIEW.
* Program: REPORT-CELLS, -REVIEW, -FIX, -FIX-REVIEW, REPORT-RUN-2, REPORT-VERDICT-2 (status files in `docs/queue/`).
* PRs: 395 (the rig, `claude/report-arms`, draft) and 370 (the telemetry module, `claude/telemetry-client`, draft).
* Files: `claude/report-plan:docs/client/evidence/report-plan.md`,
  `claude/report-arms:docs/reviews/report-arms.md`, `claude/telemetry-client:docs/adr/telemetry-in-production.md`,
  [`frame-integrity.md`](frame-integrity.md) §3.4.
