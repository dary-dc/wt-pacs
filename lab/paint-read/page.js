/** One visit: the probe worker's variant for `seconds`, the page quiet or busy from navigation. lab/paint-read/README.md */
import { now } from "../../client/view/clock.js";
import { busyPage } from "../frame-clock/busy.js";

/** ms: the loop starts this long after navigation, so the worker's module has loaded and a long task has run. */
const LEAD_MS = 1000;

const q = new URLSearchParams(location.search);
const spans = [];
const tasks = q.get("busy") === "1" ? busyPage(spans) : [];

async function run() {
  const offscreen = document.getElementById("view").transferControlToOffscreen();
  const probe = new Worker(new URL("./probe.js", import.meta.url), { type: "module" });
  const done = new Promise((r) => (probe.onmessage = ({ data }) => r(data)));
  const t0 = now() + LEAD_MS;
  const ms = Number(q.get("seconds") ?? 10) * 1000;
  probe.postMessage({ canvas: offscreen, variant: q.get("variant"), t0, ms }, [offscreen]);
  const r = await done;
  probe.terminate();
  return { ...r, t0, ms, userAgent: navigator.userAgent, tasks, spans: spans.filter(([, end]) => end > t0) };
}

globalThis.__run = run().catch((e) => ({ error: String(e?.message ?? e) }));
