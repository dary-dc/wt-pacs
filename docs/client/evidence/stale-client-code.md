# Can a browser run older client code than the server serves?

STALE-CODE, 2026-11-23, on `claude/stale-code` from `claude/unified` `4a2b4277f`. Found in PHONE-ROUND-3D
(2026-11-22): Chrome on Android ran `lab/devices/beacon.js` from its HTTP cache, older than the tree the dev server
served (`f5252051`).

**Yes, on both servers, until a module's heuristic lifetime runs out.** The page and the metadata are sent
`Cache-Control: no-cache`. Modules, workers and WASM are sent no `Cache-Control` at all, only `Last-Modified` and a
validator (`deploy/nginx/wt-pacs.conf.template`'s `map`, `server/dev-server.py`'s `REVALIDATED`). So the browser
picks their freshness itself, and while a module is fresh it runs the cached copy without asking. The new page
then runs beside old modules, and beside any new ones the browser happened not to hold: a mix of two builds.

## The sources

* RFC 9111 §4.2.2 (<https://www.rfc-editor.org/rfc/rfc9111.txt>, June 2022): "If the response has a Last-Modified
  header field (Section 8.8.2 of [HTTP]), caches are encouraged to use a heuristic expiration value that is no more
  than some fraction of the interval since that time. A typical setting of this fraction might be 10%."
* Chromium, `net/http/http_response_headers.cc` at `1e61e2cd62e322942124abcaf255b1f3a3b0283d`,
  `GetFreshnessLifetimes`: `lifetimes.freshness = (date_value - last_modified_value.value()) / 10;`, for a 200, 203
  or 206 with no explicit lifetime and no `must-revalidate`.
* RFC 9111 §5.2.2.4: "The no-cache response directive, in its unqualified form (without an argument), indicates that
  the response MUST NOT be used to satisfy any other request without forwarding it for validation and receiving a
  successful response".

## How long, in the product (derived)

`deploy/web-files.sh` copies with `cp -R`, so every file of the web image is stamped with the image's build time.
A module fetched *d* days after the build stays fresh for *d*/10 days. A browser that fetched the client 10 days
after one deploy runs that client for up to a day after the next deploy, with the next deploy's page. A browser with
an emptied cache, or one that last fetched more than a tenth of the build's age ago, is not affected.

## Measured (headless Chromium, Playwright 1.63, this container; a scratch page, not the viewer)

A page imports one module, stamped 30 days old, through `server/dev-server.py`. After the first load the module's
text changes on disk and the tab opens the page again (`about:blank`, then the page: a navigation, not a reload).

| server | first load ran | second load ran | on disk |
| --- | --- | --- | --- |
| as today | old | **old** | new |
| `--revalidate` | old | new | new |

What revalidating everything costs, on a second scratch page that `preload`s a module worker and its one import as
scripts, as the viewer does (`lab/page-open/README.md` §The cuts, cut 3), files a day old, requests counted from
`--log-requests`, two runs each, identical:

| server | requests for the two scripts, cold open | warm open |
| --- | ---: | ---: |
| as today | 2 | 0 |
| `--revalidate` | 4 | 4 |

The worker's own fetch does not reuse a `no-cache` preload: it revalidates, so each link of the downloader's chain
(page → worker → decoder worker → glue → WASM) waits a round trip again, which is what cut 3 removed. A warm open,
which today asks for no module, asks again for every one. *Theory:* about one round trip per link of that chain on a
cold open, and one or more on a warm open. Not measured on the viewer: the cell that would decide it is
`lab/page-open/run.mjs`, cold and warm at `RTTS=40,80`, with the two header policies interleaved.

## What was changed, and what is the owner's

* **The harness:** `server/dev-server.py --revalidate` sends `no-cache` on every response, errors included. A device
  round, whose tree changes between commits and whose link is a LAN, should pass it. `round.py` lives on
  `claude/phone-run` (DEVICEKIT-TOOLS's branch), so passing it there, and recording which code each load ran, is
  that row's (its item 2 checks the page's running code against the served tree). The default is unchanged, so
  `deploy/check_equivalence.sh` still holds the two servers to the same headers.
* **The product: the owner's call**, because both ways out cost something:
  1. `no-cache` on every response in the nginx template (one line). Correct after every deploy. Costs the round
     trips above on every open.
  2. Versioned URLs: the page names its code under a build key (`/client/<key>/…`), served `immutable`. Correct
     after every deploy, and free once warm. A structural change: the 11 absolute `/client/` specifiers in 3
     product modules and the page's 15 `/client/` references move under the key, in both servers, and in the equivalence check.
  3. Neither: a deploy waits a tenth of the build's age, or users clear their cache.
