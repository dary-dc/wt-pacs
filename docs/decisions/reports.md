# The reports: how the load and safety reports leave the page

Written 2026-11-22 by row REPORTS-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that wrote, built,
ran and reviewed none of the reports' rows, from pushed results only; nothing run. Inputs at: `claude/report-plan`
`948e79b47` (`docs/client/evidence/report-plan.md`: §2–§5 the options and their sources, §7 the protocol, §Results,
§Verdict review, §Results 2, §Verdict review 2), `claude/report-arms` `4ef4e12a` (the rig and its rows, PR 395),
`claude/telemetry-client` `b097f5b9` (PR 370, `docs/adr/telemetry-in-production.md`), [`frame-integrity.md`](frame-integrity.md)
§3.4, `claude/phone-run:docs/phone-rows/next-round-results.md`. § numbers are `report-plan.md`'s unless another file
is named.

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
**provisional**: no counted cell decides them (§Verdict review 2, rule 1).

This serves the value statement in two ways. The safety report is how "every frame … checked" reaches whoever runs
the server. And at 100 reports a second NGINX costs 1.3–1.5 % of a core, which keeps the server's cost per reading
session low.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | The receiver is **NGINX**: one access line per report, no address logged, one file per kind and UTC day | **yes** | nothing now (telemetry is off). At turn-on, a `location` per kind in the web image, as built in `lab/report-arms/nginx/` | RECEIVER: validation when each report is written, at about 4× NGINX's CPU, a second process, and a 5 % bar it misses (5.28–6.33 %) |
| 2 | The load report is sent **Y** (at the fill's end, plus a delta at hide), not H | **yes, provisional** | the carrier build sends at the fill's end. Y leads H by 40 points of fill records (90/90 against 54/90). This is read without C's bar, so it is not the verdict | H, PR 370's timing. H loses the fill record whenever the renderer dies before a hide (0/18 in D5a and in D5b) |
| 3 | Name the load report's carrier only after the reruns of §Verdict review 2 *Owed* | **yes** | two rerun rows in phase 2, each written before its rows: (a) C, judged by its median within the A/A's band, with a KEEPALIVE arm that uses `off`'s decoder; (b) Lbusy, and D5a on a busy page, with an absolute A/A and a sub-ms sink clock | the owner names BEACON-Y or KEEPALIVE-Y now. No counted cell separates them, and the two uncounted readings point opposite ways (§5) |
| 4 | The safety report goes **at once, over HTTP**, and is never carried by the session alone | **yes** | the 2026-11-14 decision's "at once" gets its carrier family. Its carrier (rule 3) waits on rerun (b) | SESSION stays a candidate, although it delivered 0 of 54 safety reports when no session opened (D8) |
| 5 | SESSION enters the product wire (`docs/WIRE.md`: a client stream type in the frame server) | **no** | — | SESSION stays a lab arm (`lab/server-telemetry/`, feature `telemetry`). It fails D8 by design (§3.3), and C read it 26–38 ms slower a fill than `off`. A SESSION arm with an HTTP fallback is not worth a run: the fallback is an HTTP carrier, which rule 4 already covers |
| 6 | Design the coded-bytes digest and the server's re-check of a reported frame now, and build them once the safety report's carrier is named | **yes, provisional** (as [`frame-integrity.md`](frame-integrity.md) row 5) | one hash a frame at ingest. The client hashes only after a mismatch, and the server re-checks one hash. Until then the receiver records each safety report and raises it (§5) | a safety report the server can record but cannot place (the bytes or the decoder) |
| 7 | Rate: 0 by default. A deployment that turns it on sets p, with 0.01 suggested (the ADR's §Open) | **yes** | nothing now. `TELEMETRY_RATE` stays unset | the ADR's default stays open |
| 8 | Sink: the same-origin nginx log (the ADR's (a)). Retention: 30 days, enforced by deleting the per-day files | **yes** | the ADR's §Open rows "the receiver", "the product sink" and both retention rows are answered | the ADR's defaults, unanswered |
| 9 | The web image moves to **nginx 1.31** (≥ 1.31.5, for `client_body_early_read`) when reports are turned on, not before | **yes** | nothing now. The image stays on `nginx:1.29-alpine` (`deploy/Containerfile:91`) while telemetry is off | the hop form on 1.29 (a second, local request a report; §3.5). It is neither built nor measured |
| 10 | RECEIVER's fallback log (an unvalidated body while RECEIVER is down) and its 1 GiB daily cap on load reports | **no: neither is needed with NGINX** | — | with NGINX, nginx itself writes every line, and load reports are bounded by `limit_req` (10/s, burst 20, per client) and the 16 KiB body. A daily cap exists only in RECEIVER. If the owner answers no to 1, keep the cap, and choose between the fallback log and lost records (§3.5) |
| 11 | PR 370 (M6): merge the telemetry module as built | **no; keep it open** | — | its record, fields, size bound and off switch are the shared base every arm used (§3). Its carrier is BEACON-H, the timing that row 2 replaces. The carrier build after row 3 takes PR 370's module with timing Y. Closing PR 370 then is the owner's call |

## 3 · The options

All numbers **measured** on Chromium 153 headless, one 4-vCPU container, unless labelled otherwise. The rows are
`claude/report-arms` `4ef4e12a` `lab/report-arms/rows/`, and REPORT-VERDICT-2 recomputed every number
(`claude/work-ledger:docs/queue/REPORT-VERDICT-2/output.txt`).

| arm | safety report delivered | fill record, D3–D6 | C: fill time ÷ `off`, median | C: rounds within ±2 % (bar ≥ 15/18) | busy p99 (Lbusy, **VOID**) | kept bytes a load |
| --- | --- | --- | --- | --- | --- | --- |
| BEACON-H | every ending | 54/90 | 1.052 | 0/18 | page thread, ~51 ms | ~2.2 KB |
| BEACON-Y | every ending | 90/90 | 0.976 (not told from `off`: sign test p 1.0, **derived**) | 1/18 | 50.84 ms | 2 647 B |
| KEEPALIVE-H | every ending | 54/90 | 1.137 (+16.7 ms, p 0.001, **derived**) | 0/18 | worker, 2–9 ms | ~2.2 KB |
| KEEPALIVE-Y | every ending | 90/90 | 1.072 (+9.2 ms, p 0.03, **derived**) | 3/18 | 2.46 ms | 2 649 B |
| SESSION-1, -Y, -H | **0/18 in D8** (no session opened) | -1 and -Y in every load; -H fails the load bar (D1 0/18, D7 1/18) | 1.217–1.303 (+26 to +38 ms) | 0–1/18 | worker | ~2.65 KB |
| `off′` (the A/A copy of `off`) | every ending | — | 0.989 | **3/18** | — | — |

| receiver | at 100 reports a second (R, 6 rounds, 1.7 KB bodies) | bar 5 % of a core | what it adds |
| --- | --- | --- | --- |
| NGINX (1.31.8, early read) | 1.31–1.45 % of a core; all 72 000 written, nothing refused | passes | no new process. Fields are checked when read (the field mutant was caught) |
| RECEIVER behind nginx | 5.28–6.33 %; every report written | misses by 0.3–1.3 points | validation and refusal when written, the daily cap, the raise on stderr, `sync_data` for each safety report |
| the frame server (SESSION's) | not built | — | judged only together with SESSION |

Each arm's gap over its floor (L idle p50) is 0.0–0.7 ms. That is below the receiver clock's whole millisecond, so it
is a tie, not a ranking (§Verdict review 2, rule 5).

## 4 · Where it holds

**Fixtures and limits.** One 4-vCPU cloud container without a GPU. Headless Chromium 153.0.8010.12. The fixture is the
rig's grey-16 frame ×32, not a demo volume (`dbts_c1`'s fill is not on this host). The faults are the fault bench's
forced mismatch, not a real decoder fault. The links are loopback, or under `--tun` a userspace relay at 10 ms each way
and 50 Mbit, not a radio. nginx is 1.31.8. R's bodies are 1.7 KB, against PR 370's 4.9–6.6 KB on the demo series
(PR 370's test, **measured** there). The host never saturated (CPU at most 38 %).

**Each limitation, and what found it:**

* **C's bar cannot be met on this host.** `off′` met it against `off` in only 3 of 18 rounds, and `off`'s fill varies by
  7.3 % from round to round. Found by REPORT-VERDICT-2.
* **Lbusy is VOID.** Its A/A gap was 0.11 ms on a clock that counts whole milliseconds. Found by REPORT-RUN-2, from PR 395's m5.
* **D5a never reached the race.** In all 162 loads the page handed its report on before the kill, 49–65 ms after the
  fault. Found by REPORT-RUN-2's `safetyHanded`. The first run's D5 was mistimed (REPORT-VERDICT-REVIEW).
* **The KEEPALIVE and SESSION arms load a different decoder worker than `off`.** So their C cost is the arm as built,
  not the carrier alone. Found by REPORT-VERDICT-2.
* **SESSION's floor, KEEPALIVE's worker floor and the server's receiver row are not built.** Found by REPORT-CELLS.
* **D6 tested a 30 s blackout, never a link that does not come back.** Found by REPORT-VERDICT-2.

**Engines.** Only Chromium is counted. On Firefox 160.0.1 every mutant was caught, but no counted cell ran.
`bidi.mjs` hangs about once in 70–100 loads and leaks a ~108 MB profile per load (REPORT-RUN-2). Firefox also observes
no long tasks, so C's long-task bar cannot be judged there (REPORT-CELLS). WebKitGTK did not run, and nothing is claimed
for Safari. **Theory** (§2, BCD): all three engines ship `sendBeacon`, keepalive `fetch` and WebTransport, under the
same 64 KiB keepalive budget.

**Phones.** No report cell has run on a phone (§7.7). The 2026-11-22 round did not include them (`next-round-results.md`
§Cells). That round did show something nearby, **measured** on one phone with lab code, not the product: the
harness's own end-of-load batch was lost at unload in every cell-3 load, a fresh Chrome included. The batch was ~45–110
KB, against a keepalive quota the BEACON-LOSS row is to verify (amendment 28). The product's records are 2.2–2.65 KB
here and at most 6.6 KB on the demo series, under that budget by an order of magnitude (**theory**). Whether one
survives a phone's screen lock, app switch or force-stop is not known. That is what the phone cells measure.

**US and DBT stacks** (amendment 27 item 6). The carrier, timing and receiver results do not depend on the modality.
They depend on record size and on how the load ends, and every arm stayed under 16 KiB here. A record's size grows with
its frame count, because it carries one row per frame. A breast ultrasound clip of a few hundred frames may therefore
pass 16 KiB or the 64 KiB budget. **Not yet known**: no US fixture exists. PR 370's answer is to send the record again
without its per-frame rows (`truncated`).

## 5 · The mechanism

**Why Y beats H.** A report sent only at hide is lost whenever the page dies without a hide: the renderer is killed
while the page is visible, or the tab crashes. Beacon §1 guarantees only `visibilitychange`. Y sends the fill's record
as soon as it exists, so only the hide delta is at risk.

**Why the session is the wrong carrier for the safety report.** The session is the one thing that fails when the link
fails. A load whose session never opens has nowhere to send its report (D8). HTTP keeps a channel open in exactly that
case.

**Why BEACON-Y and KEEPALIVE-Y stay apart.** The two decisive keys disagree, and neither is a counted result. BEACON
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
