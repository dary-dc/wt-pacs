/** A reading session after the fill, driven by the viewer's own keys: docs/server/session-cost.md §1, §2, §6 */
import { FIT } from "../../client/view/controller.js";
import { zoomFailure } from "./fit-page.js";

const epochMs = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** §1: a reader no faster than 10 frames a second. */
const STEP_MS = 100;
const DWELL_MS = 3000;
const PAINT_MS = 60_000;

/** §1's trace for `n` frames: steps of ±1 and two jumps, each `{ to, key }` or `{ to, jump: true }`, and its three dwells. */
export function sessionTrace(n) {
  const third = Math.floor(n / 3);
  const out = [];
  for (let stroke = 0; stroke < 3; stroke++) {
    for (let i = 1; i <= third; i++) out.push({ to: i, key: "ArrowRight" });
    for (let i = third - 1; i >= 0; i--) out.push({ to: i, key: "ArrowLeft" });
  }
  for (let i = 1; i < n; i++) out.push({ to: i, key: "ArrowRight" });
  out.push({ dwell: true }, { to: Math.floor(n / 2), jump: true }, { dwell: true }, { to: Math.floor(n / 4), jump: true }, { dwell: true });
  return out;
}

export const stepCount = (trace) => trace.filter((a) => !a.dwell).length;

/** `?session=1`: §1's trace, the arm's action at each dwell (`?dwell=lossless|zoom`), every arrival recorded. Why it failed, or null. */
export async function sessionFailure(q, record, { controller, shown }, meta, window) {
  if (!controller) return "session: the page view only";
  const n = meta.frameCount;
  const full = sessionTrace(n);
  // The mutant of §6: a trace one step short, which the step count must flag.
  const trace = q.get("mutate") === "skip-step" ? full.filter((_, k) => k !== 1) : full;
  const atFill = controller.received;
  const arrivals = [];
  const put = controller.store.put.bind(controller.store);
  controller.store.put = (i, frame, ack) => (arrivals.push({ i, at: epochMs(), bytes: frame.info?.wireBytes ?? null }), put(i, frame, ack));
  const exactAsks = [];
  const watchExact = () => {
    const c = controller.exactClient;
    if (!c || c.watched) return;
    const ask = c.requestFrame.bind(c);
    c.requestFrame = (k) => ask(k).then((f) => (exactAsks.push({ i: k, at: epochMs(), bytes: f.info?.wireBytes ?? f.bytes?.byteLength ?? null, lastByteMs: f.timing && f.timing.lastChunkMs - f.timing.askMs }), f));
    c.watched = true;
  };
  const slider = document.getElementById("slice");
  const steps = [];
  const dwells = [];
  const t0 = epochMs();
  let last = 0;
  for (const a of trace) {
    if (a.dwell) {
      const d = { i: controller.current, at: epochMs() };
      if (q.get("dwell") === "lossless") {
        watchExact();
        dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
      } else if (q.get("dwell") === "zoom") {
        const failure = await zoomFailure(controller, meta, record, { afterMs: 0, filledAt: epochMs() });
        if (failure) return `session dwell at ${d.i}: ${failure}`;
        if (meta.fit) exactAsks.push({ i: d.i, at: epochMs(), zoom: true });
      }
      await sleep(Math.max(0, d.at + DWELL_MS - epochMs()));
      d.label = document.getElementById("quality").className || null;
      if (q.get("dwell") === "zoom") await controller.setDisplay({ pose: FIT });
      dwells.push(d);
      continue;
    }
    await sleep(Math.max(0, last + STEP_MS - epochMs()));
    last = epochMs();
    if (a.jump) {
      slider.value = String(a.to);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    } else dispatchEvent(new KeyboardEvent("keydown", { key: a.key }));
    const until = last + PAINT_MS;
    while (shown()?.i !== a.to && epochMs() < until) await sleep(5);
    if (shown()?.i !== a.to) return `session: frame ${a.to} not painted ${PAINT_MS / 1000} s after its press`;
    steps.push({ i: a.to, at: last, paintedMs: epochMs() - last });
  }
  controller.store.put = put;
  record("session", {
    steps: steps.length, stepsExpected: stepCount(full), window, frames: n, lengthMs: epochMs() - t0,
    asked: controller.received, askedAtFill: atFill, exactAsked: exactAsks.length, arrivals, exactAsks, dwells,
    paintedMs: steps.map((s) => +s.paintedMs.toFixed(1)),
  });
  return null;
}
