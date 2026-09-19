# Does the work before the click happen before the click?

**S20, O1.** Speculation Rules prerender the viewer from the worklist; the question is what a
prerendered page is allowed to do. `target.html` records three things — whether it loaded with
`document.prerendering` true, whether a worker started, and whether a WebTransport session
dialled — and, for each, whether it was still prerendering at the time.

```bash
NODE_PATH=$(npm root -g) node lab/prerender/run.mjs
```

## It cannot be answered in this container

**2026-09-19.** Headless Chromium 141 **supports the API and never uses it**:
`HTMLScriptElement.supports("speculationrules")` is `true` and `document.prerendering` exists,
but the target page is never fetched before the click — not with Playwright's defaults, not with
`--enable-features=Prerender2,SpeculationRulesPrerenderingTarget`, and not with a preloading
holdback disabled. Without a display there is no visible tab, which is one of Chromium's own
preconditions for starting a prerender.

So the probe here loads the target directly, which is exactly the measurement it is *not*: it
reports `prerendered at load: no`, and everything after that is the ordinary path.

**What lifts it:** a headful Chrome, on the workstation or under `Xvfb`. The probe needs no
change — it prints `prerendered at load: yes` the moment the browser obliges, and the two lines
that matter are `worker started … while prerendering` and `session dialled … while prerendering`.
`../../docs/rig-limits.md` §8.
