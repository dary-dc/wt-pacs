# What the demo's page and servers read, and what runs with none set

DEFAULTS-FIND, 2026-11-11, on the demo tip `claude/demo-fixes-0` `618e13c8`. Findings only: nothing is changed here,
and every move waits for the owner's yes. Read from the code (file and line named); nothing was measured or run.
Where a finding is the same code as CLEAN-FIND's ([`clean.md`](clean.md)), it says so and does not repeat it.

**Kinds**, as used below: *product option* (a reader or an operator may set it, and the product must keep it working);
*developer aid* (shows or changes something for whoever runs the demo, never needed by a reader); *test lever* (set
by a check or a lab harness, never by hand).

**Two gates already exist.** The page refuses its lab parameters on a host that does not serve `lab/`
(`client/viewer/head.js:5`: `opts`, `wt`, `hash`, `metadata`, `post`, `origin`, `writer`, `busy`, `cine`); the web
image's nginx serves no `lab/` (`deploy/nginx/wt-pacs.conf.template:46–56`), `server/dev-server.py:14` does. The
server's lab flags are compiled only under the `lab-levers` feature (`server/src/transport/lab_levers.rs`), refused by
a default build (test `the_default_build_refuses_every_lab_lever`). Most findings below are items that sit outside
the gate they belong behind.

## What runs with none set (the reader's demo)

`http://127.0.0.1:8765/` with no parameter: the page view (`view=page`), the series filled ahead, no overlay, no
check, no OPFS cache; the transport file `/wt/dev-transport.json` names the client (`ts` when it names none) and the
server. `series-server` with only `--series`: port 4433, every address (`[::]`, else `0.0.0.0`), the dev certificate
under `server/dev-cert/` relative to the working directory, one shared stream, `cubic-restart`, the opening ask
honoured, quinn's windows and timeouts, no WebSocket. `dev-server.py` with nothing: port 8765 on 127.0.0.1 only, the
smoke fixture `us_cine_smoke`'s metadata, the dev certificate made or renewed, no exact series.

## Ranked findings, essentials first

1. **`?check=` and `?deadline=` are test levers outside the lab gate, and the web image ships them.**
   `viewer.js:55–61, 94, 111, 302–321` read them on any host; `deploy/web-files.sh:8–14` copies
   `viewer/check-page.js` and `view/check.js` into the web image so that `?check=1` works there. On the product host
   `?check=1` runs the protocol, closes the session (`check-page.js:25`) and stops the page after 120 s. No caller
   runs `?check=` against the web image (grep of `deploy/`, `scripts/`, `.github/`, `lab/`, 2026-11-11):
   `check_equivalence.sh` asks for its files, not the page. **Move behind the lab gate** (add `check` to
   `head.js`'s list; `check.mjs` already runs on the dev host, which serves `lab/`), and drop the two files from
   `web-files.sh`. Saves the reader: "the product page reads three parameters, `view`, `fill` and `overlay`; every
   other is refused on the product host". Proves: `run_check.sh` both views, `demo-check.mjs` on the 20 series,
   `check_equivalence.sh --local` (`check-page.js` and `view/check.js` then 404). Same code as `clean.md` §1, seen from
   the host. Risk before 11-13: low; it touches the check's own path.

2. **`?cine=` is one name for two levers.** In `head.js:5` and `lab/viewer/levers.js:22` it is the lab's cine of N
   seconds after the fill; in `check-page.js:11` it is the check's 1.5 s cine toggle (`check.mjs:84` sets `cine=1`).
   Under `check.mjs --cine` both fire: levers builds a cine of 1 s (and starts `lab/frame-clock/phase.js`'s worker)
   that the check branch never runs. On the product host `?check=1&cine=1` is refused, so item 1's move needs this
   one too. **Rename one** (the lab's, e.g. a name of its seconds; the glossary decides). Saves: one meaning per name.
   Proves: `levers.test.mjs`, `check.mjs --cine`. Risk: low.

3. **`?trace=`, `?settle=` and `?after=` are lab levers the gate does not see.** `levers.js:10, 19, 29, 31` read
   them, but `head.js:5` imports `levers.js` only when one of its nine names is present, and `settle` and `after`
   take effect only beside `post` (`levers.js:29`; `levers.test.mjs:83`, "no rig, no settle"). Alone, each is ignored
   without a word on either host, against the gate's own rule (refuse what this host does not honour). The lab's rig
   always sends `post` with them (`lab/av1/delivery/total-time/run.mjs:385`), so no measurement was affected; a hand
   run would be. **Add the three to `head.js`'s list, and refuse `settle`/`after` without `post`.** Saves: the rule holds without exception. Proves:
   `levers.test.mjs` plus a head test that `?settle=read` alone is refused on a host without `lab/` (mutant: drop the
   name from the list). Risk: low.

4. **`?opts=` (lab) overrides every connect option, the exactness check's digests included.** `viewer.js:162–172`
   spreads `...options` after `digests` and the groups; `opts.decoder` replaces the decoder (`:154`). About 25
   downloader settings are reachable this way (`client/transport/downloader.js`: `decoders`, `perDecoder`,
   `survival`, `askDepth`, `refill`, `recycleAtBytes`, `cache`, …), not listed anywhere a reader looks. On the lab host
   only. **Stays a test lever**; the smallest fix is to spread `options` before `digests` and `decoder` so the lab
   cannot turn exactness off from a URL, or to name the keys it may set. Saves: "the exactness check cannot be turned
   off from the page's URL" becomes true. Proves: a check that `?opts={"digests":null}` still checks. Risk: medium for
   the lab (a rig that sets `opts.decoder`, as the contract rigs may, must still work); none for the demo.

5. **`series-server` compiles three "Lab only" choices into the default build.** `--send-window-follows-cwnd`
   (`server/src/transport/server.rs:58`), `--reply-repeated-initial` (`tuning.rs:82`) and `--stream-mode
   per-frame-asks-first` (`stream_mode.rs:14`) are documented "Lab only" yet parse in the deployed binary;
   `--congestion bbr-bound` failed its pre-registered rule and "stays opt-in"
   (`docs/transport/transport-conclusions.md` §Congestion controller). **Move the three behind `lab-levers`**, as
   `--force-pool-reads` already is; leave `bbr-bound` to the owner (opt-in, measured). Saves: `series-server --help`
   lists only what a deployment may set. Proves: `the_default_build_refuses_every_lab_lever` extended to the three,
   the lab's scripts under `--features lab-levers`. Risk: medium; every lab script that passes them needs the feature.

6. **`?view=` is a product option whose second value is not yet at the page's bar.** `viewer.js:21`: `page`
   (default) or `worker` (the client's target, `docs/lines/client.md` 2026-10-28); refused otherwise, on both hosts.
   `demo-check.mjs` checks only the page view (VIEW-WORKER-CHECK's row). **Stays**, default `page`, until that row
   decides; README §Demo sets neither. Saves the reader one sentence: "`view` chooses where frames are held; the demo
   uses the default".

7. **`?overlay=1` is the developer switch the owner decided** (2026-11-09: "a developer overlay behind a toggle";
   `viewer.js:135`). README §Demo sets it on every page it opens. **Stays**; it is the one developer switch, and the
   natural home if more developer aids appear on the demo path (none needs to move under it today).

8. **`?fill=0` is a product option shown as a developer aid.** `viewer.js:50`: on demand, each frame asked as it is
   stepped to; README §Demo step 6 sets it. It is an asking pattern of the product (`docs/adr/frame-path.md`
   §Target), not a lever. **Stays.** Its only spelling is the negative `0`; anything else fills.

9. **`dev-server.py --series` names a fixture folder, not a series it serves.** `dev-server.py:87, 44`: with no
   `--metadata`, `/series/metadata` is `fixtures/<name>/metadata.json` (default `us_cine_smoke`, the gate's smoke
   series); the frames come from `series-server`. README §Demo always sets `--metadata`, so the default never shows
   in the demo; a presenter who forgets it sees the smoke cine's metadata against a DBT server. **Stays a developer
   aid**; a name question for NAMES-FIND (`names.md`). Risk: none until renamed.

10. **The rest are product or developer options in their right place.** `series-server`: `--port`, `--series`,
    `--bind`, `--cert-pem`/`--key-pem` (defaults are the dev certificate's paths, relative to the working
    directory; README always passes them), `--stream-mode shared|per-frame`, `--congestion`, `--send-window-bytes`,
    `--max-idle-timeout-ms`, `--keep-alive-interval-ms`, `--initial-window-bytes`, `--initial-rtt-ms`,
    `--opening-ask` (on), `--websocket` (off; the decided approach keeps TCP off the fill unless proven):
    operator options, each with its measurement in `transport-conclusions.md`. `dev-server.py`: `--port`,
    `--metadata`, `--transport` (phone), `--exact-metadata` with `--exact-transport` (refused apart,
    `dev-server.py:101–103`): developer options; `--log-requests`: `check.mjs`'s test lever, harmless. The lab
    names gated by `head.js` (`opts`, `wt`, `hash`, `metadata`, `post`, `origin`, `writer`, `busy`) and `?mutate=`
    (read only under the lab's `finished`, `viewer.js:331`): test levers, gated. **All stay.**

## Who sets what in README §Demo

| where | sets | with none set |
| --- | --- | --- |
| the page | `overlay=1` on every visit; `fill=0` in step 6 | page view, filled, label and status line only |
| `series-server` | `--port 4433`/`4434`, `--series`, `--cert-pem`, `--key-pem` | the defaults of §What runs |
| `dev-server.py` | `--port 8765`, `--metadata`, `--exact-metadata`, `--exact-transport`; `--transport` on the phone | smoke metadata, loopback, certificate renewed |

## Owner decisions these raise

* Items 1–3: one rule, "a test lever needs `lab/`", with `check`, `deadline`, `trace`, `settle` and `after` under it.
* Item 5: whether the three "Lab only" server choices leave the default build before or after 11-13.
* Item 6: which view the demo shows (VIEW-WORKER-CHECK's result decides only correctness).
