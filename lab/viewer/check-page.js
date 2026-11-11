/** The page check's in-page half: the protocol where the controller is, the cine, the readbacks, and what reached the page. client/viewer/check.mjs */

/** `check(phase, args)` runs a phase of client/view/check.js beside the controller; `seen`, the page's own messages, in the worker variant. */
export async function run({ q, n, check, errors, report, rendererName, toggleCine, current, seen, close }) {
  // Before the protocol asks anything of the downloader.
  const cache = seen ? await check("cache") : undefined;
  const out = { n, cache, ...(await check("protocol", { n, onDemand: q.get("fill") === "0" })), errors: [...errors], renderer: rendererName,
    status: document.getElementById("status").textContent,
    preloaded: performance.getEntriesByType("resource").filter((e) => e.initiatorType === "link").map((e) => new URL(e.name).pathname) };

  if (q.get("cine")) {
    const shown = new Set();
    toggleCine();
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      shown.add(current());
      await new Promise((r) => setTimeout(r, 5));
    }
    toggleCine();
    out.cine = shown.size;
  }

  Object.assign(out, await check("readbacks", { n }));
  if (seen) out.page = seen;
  close();
  report(out);
}
