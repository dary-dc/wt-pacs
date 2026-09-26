# Does the work before the click happen before the click?

**S20, O1.** Speculation Rules prerender the viewer from the worklist; the question is what a
prerendered page is allowed to do. `target.html` records three things — whether it loaded with
`document.prerendering` true, whether a worker started, and whether a WebTransport session
dialled — and, for each, whether it was still prerendering at the time.

```bash
NODE_PATH=$(npm root -g) node lab/prerender/run.mjs
```

## Answered 2026-09-19 — with no driver, headless included

Three runs, two headless and one under `Xvfb`, agree:

```
prerendered at load      yes
activation seen          3 945–3 985 ms
dial called              44–85 ms, while prerendering: yes
session dialled          19–23 ms after activation, while prerendering: no
worker started           18–21 ms after activation, while prerendering: no
```

**The page runs; the session and the worker wait for activation.** Same-origin fetches,
`import()` and the script itself run while prerendering — the dial is *called* at 44–85 ms — but
the WebTransport connection and the worker's first message arrive only after activation. So a
prerender from the worklist can hide the page half of a cold open, the 3.6 round trips before the
dial that `../page-open/README.md` counts, and none of the dial's 3.0, and nothing that boots in a
worker.

**Why the first answer was wrong.** The probe first drove Chromium through Playwright and reported
that headless Chromium never prerenders. The browser's own reason, read from the DevTools `Preload`
domain (`DRIVER=playwright` prints it), is `PrerenderingDisabledByDevTools`; headful under `Xvfb`
says the same. A DevTools session disables prerendering — a display was never the condition. The
default run therefore launches Chromium with no driver: the referrer navigates itself after 4 s and
the target posts its record back to `run.mjs`.

```bash
NODE_PATH=$(npm root -g) node lab/prerender/run.mjs   # no driver, headless
HEADFUL=1 DISPLAY=:99 node lab/prerender/run.mjs      # the same on a display (Xvfb :99 &)
DRIVER=playwright node lab/prerender/run.mjs          # prints why the browser refused
```
