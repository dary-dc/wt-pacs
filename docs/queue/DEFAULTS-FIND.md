state: done
started: 2026-11-11 01:41
heartbeat: 2026-11-11 02:05
outputs: claude/demo-understand 3171ee7b, docs/reviews/understand/defaults.md (findings only, no PR)
## Resume
Done. Read from the demo tip claude/demo-fixes-0 618e13c8; line note as item 13 of docs/lines/optimal-quality.md.
## Result
* Every viewer URL parameter, series-server and dev-server.py option classified (product option, developer aid,
  test lever), with what runs with none set and who sets what in README §Demo (overlay=1, fill=0 only).
* 1: `?check=`/`?deadline=` are test levers outside head.js's lab gate, and deploy/web-files.sh ships check-page.js
  and view/check.js into the web image; no caller uses them there. Move behind the lab gate.
* 2: `?cine=` is one name for the lab's N-second cine and the check's 1.5 s toggle; both fire under check.mjs --cine.
* 3: `?trace=`, `?settle=`, `?after=` are silently ignored unless a gated name (and, for two, `post`) is present.
* 4: `?opts=` (lab host only) spreads over the connect options after `digests` and `decoder`: it can turn the
  exactness check off from a URL.
* 5: `--send-window-follows-cwnd`, `--reply-repeated-initial`, `--stream-mode per-frame-asks-first` are "Lab only"
  but in the default series-server build; `lab-levers` is where they belong.
* view, overlay, fill and every other option stay; dev-server's `--series` naming is passed to NAMES-FIND.
* Read from the code only; nothing measured or run. No fixtures used.
* Owner decisions: one rule "a test lever needs lab/" (items 1–3); whether item 5 moves before or after 11-13;
  which view the demo shows.
