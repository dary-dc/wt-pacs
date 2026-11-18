/** The round's hook in the viewer, `?round=<host>&at=<k>`: one load recorded, then the host's next. lab/devices/README.md §The round */
import { Cine, now } from "../../client/view/clock.js";
import { beaconHooks } from "./beacon.js";
import { bench, exactFill } from "./bench.js";
import { TICK_MS, fillFailure, largestGap, losslessFailure, verdict } from "./round.mjs";

const epochMs = () => performance.timeOrigin + performance.now();

export function roundHooks(q) {
  const k = Number(q.get("at"));
  const fillS = Number(q.get("fillS") ?? 120);
  const decoders = q.has("decoders") ? Number(q.get("decoders")) : null;
  const { recorder, finished } = beaconHooks(q, { step: k, cell: q.get("cell"), arm: q.get("arm"), counted: q.get("counted") !== "0", decoders, cores: navigator.hardwareConcurrency });
  holdScreen(recorder);
  const ticks = [performance.now()];
  const ticker = setInterval(() => ticks.push(performance.now()), TICK_MS);
  let left = false;
  const leave = (failure) => {
    if (left) return;
    left = true;
    clearInterval(ticker);
    ticks.push(performance.now());
    recorder.record("verdict", verdict(failure, largestGap(ticks)));
    recorder.flush({ leaving: true });
    location.assign(new URL(`/next?after=${k}`, q.get("round")));
  };
  const late = setTimeout(() => leave(`no ${q.has("bench") ? "bench end" : "fill"} in ${fillS} s`), fillS * 1000);
  return {
    // Cell 1 before the viewer dials, which it then never does: the load is the bench's alone.
    ...(q.has("bench") && { started: async () => {
      let failure;
      try {
        const [meta, transport] = await Promise.all([globalThis.viewerMetadata, globalThis.viewerTransport]);
        const r = await bench({ meta, transport, count: Number(q.get("bench")), decoders });
        recorder.record("bench", r);
        failure = r.failure;
      } catch (e) {
        failure = `bench: ${e?.message ?? e}`;
      }
      leave(failure);
      await new Promise(() => {});
    } }),
    async finished(ledger, page) {
      clearTimeout(late);
      const afterS = Number(q.get("afterS") ?? 300);
      setTimeout(() => leave(`no end ${afterS} s after the fill`), afterS * 1000);
      let failure;
      try {
        await finished(ledger);
        await fault(q.get("fault"));
        const quality = document.getElementById("quality");
        const lossless = document.getElementById("lossless");
        failure = fillFailure(ledger, (await globalThis.viewerMetadata).frameCount);
        if (!failure && q.get("exactFill") === "1") {
          const r = await exactFill(await globalThis.viewerMetadata, await globalThis.viewerTransport, decoders);
          recorder.record("exactFill", r);
          failure = r.failure;
        }
        if (!failure && q.get("press") === "lossless") failure = await losslessFailure(quality, lossless);
        if (!failure && q.get("seq") === "view") failure = await viewSequence(q, recorder, { ...page, n: ledger.frames.length }, quality, lossless);
      } catch (e) {
        failure = `after the fill: ${e?.message ?? e}`;
      }
      if (q.has("stall")) stall(Number(q.get("stall")));
      leave(failure);
    },
  };
}

/**
 * Cell 3's load after its fill, next-round.md §4: frame changes, cine, then exact frames, each with the page's thread
 * idle and then busy. Every frame stepped to is one never painted, so its ledger's `painted` is this step's paint.
 */
async function viewSequence(q, r, page, quality, lossless) {
  const steps = Number(q.get("steps") ?? 20);
  const cineMs = Number(q.get("cineS") ?? 10) * 1000;
  if (page.n < 2 * steps + 1) return `${page.n} frames: cell 3's ${steps} steps idle and busy need ${2 * steps + 1}`;
  const busyWhile = async (busy, f) => {
    const lever = busy && (await busyThread(r));
    try {
      return await f();
    } finally {
      if (lever) lever.stop();
    }
  };
  const asked = [];
  for (const busy of [false, true]) {
    const why = await busyWhile(busy, async () => {
      for (let s = 0; s < steps; s += 1) {
        const failed = await step(page, asked, busy);
        if (failed) return failed;
      }
      return null;
    });
    if (why) return why;
  }
  const painted = new Map((await page.ledger()).frames.map((f) => [f.i, f.painted]));
  r.record("frameChange", { steps: asked.map((a) => ({ ...a, ms: painted.get(a.i) - a.due })) });
  for (const busy of [false, true]) {
    const { draws, period } = await busyWhile(busy, () => cineRun(page, cineMs));
    r.record("cine", { busy, due: Math.floor(cineMs / period), painted: draws.length, draws });
  }
  for (const busy of [false, true]) {
    const why = await step(page, [], false);
    if (why) return why;
    const exact = await busyWhile(busy, () => exactFrame(quality, lossless));
    r.record("exactFrame", { busy, i: page.shown()?.i, ...exact });
    if (exact.failure) return exact.failure;
  }
  return null;
}

/** ms: next-round.md §4 cell 3's lever, a long task of 100 ms every 250 ms on this, the viewer document's, thread. */
const BUSY_MS = 100;
const BUSY_EVERY_MS = 250;

/** The lever on, resolved once its first task has run, so what follows meets a busy thread. */
async function busyThread(r) {
  let tasks = 0;
  let first;
  const started = new Promise((resolve) => (first = resolve));
  const timer = setInterval(() => {
    const t0 = performance.now();
    while (performance.now() - t0 < BUSY_MS);
    tasks += 1;
    first();
  }, BUSY_EVERY_MS);
  r.record("busy", { on: true, ms: BUSY_MS, everyMs: BUSY_EVERY_MS });
  await started;
  return { stop: () => (clearInterval(timer), r.record("busy", { on: false, tasks })) };
}

/** `ms` of cine on the thread that holds the frames, on the timeout clock: each paint against the frames due. */
async function cineRun({ worker, controller, fps }, ms) {
  const t0 = now() + 2 * BUSY_EVERY_MS;
  const page = !worker && new Cine({ fps, t0, source: "timeout", show: async (i) => (await controller.show(i), controller.lastPaint?.drawn) });
  if (worker) worker.play(fps, t0, "timeout");
  await new Promise((r) => setTimeout(r, t0 + ms - now()));
  if (worker) worker.pause();
  else page.stop();
  return { period: 1000 / fps, draws: worker ? await worker.cine() : page.log };
}

/**
 * One frame change as a reader's key press, due at a random phase of the busy lever's period; a page task cannot
 * dispatch it while a long task runs, so its latency counts from when it was due (`due`), its dispatch beside it.
 */
async function step(page, asked, busy) {
  const wait = Math.random() * BUSY_EVERY_MS;
  const due = epochMs() + wait;
  await new Promise((r) => setTimeout(r, wait));
  const from = page.view.current;
  const i = from + 1 < page.n ? from + 1 : from - 1;
  asked.push({ i, busy, due, at: epochMs() });
  dispatchEvent(new KeyboardEvent("keydown", { key: i > from ? "ArrowRight" : "ArrowLeft", bubbles: true }));
  return (await until(() => page.shown()?.i === i, 10000)) ? null : `frame ${i} not painted 10 s after its step`;
}

/** The exact-frame latency: the Lossless control pressed, to its label showing; then back to the view. */
async function exactFrame(quality, lossless) {
  if (!(await until(() => !lossless.hidden && quality.className === "optimal", 10000))) return { failure: "no lossless button, or the label not optimal" };
  const shown = new Promise((resolve) => {
    const o = new MutationObserver(() => ["lossless", "failed"].includes(quality.className) && (o.disconnect(), resolve(epochMs())));
    o.observe(quality, { attributes: true, attributeFilter: ["class"] });
  });
  const at = epochMs();
  lossless.click();
  const end = await Promise.race([shown, new Promise((r) => setTimeout(() => r(null), 30000))]);
  if (end === null || quality.className !== "lossless") return { at, failure: `exact frame: ${quality.className} (${quality.textContent})` };
  lossless.click();
  return (await until(() => quality.className === "optimal", 10000)) ? { at, ms: end - at } : { at, ms: end - at, failure: "not back to optimal quality" };
}

const until = (done, ms) => new Promise((resolve) => {
  const t0 = performance.now();
  const poll = setInterval(() => {
    const ok = done();
    if (ok || performance.now() - t0 > ms) (clearInterval(poll), resolve(Boolean(ok)));
  }, 5);
});

/** The screen wake lock, asked at load, on each return to visible and after each release; every outcome recorded. */
function holdScreen(r) {
  const ask = async (why) => {
    try {
      const lock = await navigator.wakeLock.request("screen");
      r.record("wakeLock", { event: "acquired", why });
      lock.addEventListener("release", () => (r.record("wakeLock", { event: "released" }), document.visibilityState === "visible" && ask("released")));
    } catch (e) {
      r.record("wakeLock", { event: "refused", why, error: `${e.name}: ${e.message}` });
    }
  };
  ask("load");
  document.addEventListener("visibilitychange", () => {
    r.record("visibility", { state: document.visibilityState });
    if (document.visibilityState === "visible") ask("visible");
  });
}

/** The lab's faults after the fill, round_headless.sh's: `throw` rejects, `hang` never settles. */
async function fault(kind) {
  if (kind === "throw") throw new Error("injected fault");
  if (kind === "hang") await new Promise(() => {});
}

/** The lab's stall: the page's thread held for `ms`, so the runner's timers stop as a screen turned off would stop them. */
function stall(ms) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms);
}
