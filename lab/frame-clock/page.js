/** One run: frames held in the view worker, one arm's cine, the page quiet or busy from navigation. lab/frame-clock/README.md */
import { now } from "../../client/view/clock.js";
import { ViewWorker } from "../../client/view/view.js";
import { start } from "./arms.js";
import { busyPage } from "./busy.js";

/** ms: frame 0 is due this long after the arm starts, so a worker's clock module has loaded. */
const LEAD_MS = 500;

export const SERIES = {
  s512: { n: 76, width: 512, height: 512, css: [512, 512] },
  mammo: { n: 12, width: 2560, height: 3328, css: [640, 832] },
};

const q = new URLSearchParams(location.search);
const tasks = q.get("busy") === "1" ? busyPage() : [];

async function run() {
  const s = SERIES[q.get("series")];
  const fps = Number(q.get("fps"));
  const ms = Number(q.get("seconds") ?? 10) * 1000;
  const canvas = document.getElementById("view");
  [canvas.style.width, canvas.style.height] = s.css.map((v) => `${v}px`);
  let renderer = null;
  const failures = [];
  const view = new ViewWorker(canvas, {
    meta: { frameCount: s.n, window: { center: [32768], width: [65536] } },
    fillMode: true,
    size: { width: s.css[0], height: s.css[1], dpr: 1 },
    settle: "fence",
    emit: (type, e) => {
      if (type === "renderer") renderer = e.renderer ?? e.error;
      if (type === "failed") failures.push(e.reason);
    },
  });
  const phase = new Worker(new URL("./phase.js", import.meta.url));
  const heard = () => new Promise((r) => (phase.onmessage = ({ data }) => r(data)));
  await view.check("hold", { n: s.n, width: s.width, height: s.height });
  // Due times mid-interval, so neither a random phase nor a display a hair off 60 Hz moves a vsync across one.
  const aligned = heard();
  phase.postMessage({ at: now() + LEAD_MS });
  const t0 = await aligned;
  const stop = start(q.get("arm"), view, fps, t0);
  await new Promise((r) => setTimeout(r, t0 + ms - now()));
  stop();
  const vsyncs = heard();
  phase.postMessage({});
  return { renderer, t0, ms, period: 1000 / fps, draws: await view.cine(), vsyncs: await vsyncs, tasks, failures };
}

globalThis.__run = run().catch((e) => ({ error: String(e?.message ?? e) }));
