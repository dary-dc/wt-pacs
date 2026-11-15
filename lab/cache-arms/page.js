// The page: it makes the ring, starts the store worker, the view worker and the feeders, wires their ports, and runs
// one cell's steps; it holds no frame. `globalThis.row` is the row once settled, `globalThis.progress()` reads the store.
const q = new URLSearchParams(location.search);
const num = (k, d) => Number(q.get(k) ?? d);
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? null;
const quantile = (v, p) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))] ?? null;

const c = {
  mode: q.get("mode") ?? "fill", arm: q.get("arm") ?? "none", mutant: q.get("mutant") ?? "", pilot: q.get("pilot") ?? "", series: q.get("series") ?? "s",
  w: num("w", 512), h: num("h", 512), n: num("n", 64), held: num("held", 4), rateMBps: num("rate", 125), credits: num("credits", 0),
  cineEvery: num("cineEvery", 1), misses: q.get("misses") ?? "", missCount: num("missCount", 16), longTasks: q.get("longTasks") === "1",
  floor: num("floor", 0), ringMiB: num("ringMiB", 256), decoders: num("decoders", 3), all: q.get("all") === "1", rest: q.get("rest") === "1",
  ballast: q.get("ballast") === "1", hold: q.get("hold") === "1", timeoutS: num("timeoutS", 240),
};
c.frameBytes = c.w * c.h * 2;

function caller(worker) {
  let id = 0;
  const waiting = new Map();
  worker.onmessage = ({ data }) => (waiting.get(data.id)?.(data.reply), waiting.delete(data.id));
  const call = (kind, m = {}) => new Promise((resolve) => (waiting.set(++id, resolve), worker.postMessage({ kind, id, ...m })));
  call.ready = new Promise((resolve) => waiting.set(0, resolve));
  return call;
}

const slots = Math.floor((c.ringMiB * 2 ** 20) / c.frameBytes);
const samples = new SharedArrayBuffer(slots * c.frameBytes);
const table = new SharedArrayBuffer((slots + 2) * 4);
const fields = new SharedArrayBuffer(4 * c.frameBytes);
const storeWorker = new Worker("store-worker.js", { type: "module" });
const store = caller(storeWorker);
const view = new Worker("view.js", { type: "module" });
const feeders = [...Array(c.decoders)].map(() => new Worker("feeder.js", { type: "module" }));
const fromView = new MessageChannel();
const viewToStore = new MessageChannel();
const toStore = feeders.map(() => new MessageChannel());
const toView = feeders.map(() => new MessageChannel());
const shared = { samples, table, fields, config: c };
storeWorker.postMessage({ kind: "init", ...shared, feeders: toStore.map((ch) => ch.port2), view: viewToStore.port2 }, [...toStore.map((ch) => ch.port2), viewToStore.port2]);
feeders.forEach((f, k) => f.postMessage({ kind: "init", ...shared, toStore: toStore[k].port1, toView: toView[k].port1 }, [toStore[k].port1, toView[k].port1]));
const canvas = document.getElementById("view").transferControlToOffscreen();
view.postMessage({ kind: "init", ...shared, canvas, store: viewToStore.port1, page: fromView.port1, feeders: toView.map((ch) => ch.port2) },
  [canvas, viewToStore.port1, fromView.port1, ...toView.map((ch) => ch.port2)]);

const fromViewNext = (kind) => new Promise((resolve) => {
  const f = ({ data }) => data.kind === kind && (fromView.port2.removeEventListener("message", f), resolve(data));
  fromView.port2.addEventListener("message", f);
  fromView.port2.start();
});
const until = async (cond, ms) => { for (const t0 = performance.now(); !(await cond()) && performance.now() - t0 < ms; ) await sleep(20); };
/** A feeder stalled on a ring that never frees cannot answer: its stats are then null. */
const feederStats = () => Promise.all(feeders.map((f) => Promise.race([sleep(2000).then(() => null),
  new Promise((resolve) => ((f.onmessage = ({ data }) => resolve(data)), f.postMessage({ kind: "stats" })))])));
globalThis.progress = () => store("progress");

/** A 50 ms long task every 100 ms on this thread (cell B), until stopped. */
function longTasks() {
  let on = true;
  (async () => { while (on) { const t = performance.now(); while (performance.now() - t < 50); await sleep(50); } })();
  return () => (on = false);
}

/** `count` misses one after another, each a frame `pick()` names: intent → read → re-check → painted. */
async function misses(count, pick) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const i = pick(k);
    if (i === null) break;
    const painted = fromViewNext("painted");
    view.postMessage({ kind: "show", i, sentAt: now() });
    out.push(await painted);
  }
  return out.map((m) => ({ i: m.i, ms: m.paintedAt - m.sentAt, hit: m.hit, damaged: m.damaged ?? false, waitMs: m.waitMs }));
}
const spread = (k, span) => (k * 2654435761) % Math.max(1, span);

/** The writes the store worker timed, as a cell reads them. */
function writes(r, from = c.held) {
  const w = r.writes.filter((x) => x.i >= from);
  const firstArrival = Math.min(...w.map((x) => x.arrivedAt));
  const busy = w.map((x) => x.end - x.start);
  const last = Math.max(...w.filter((x) => x.written).map((x) => x.end));
  return { handled: w.length, written: w.filter((x) => x.written).length, refused: w.filter((x) => !x.written).length, busyMsP50: median(busy),
    busyMsP99: quantile(busy, 0.99), writeMBps: (w.filter((x) => x.written).length * c.frameBytes) / 1e3 / Math.max(1, last - firstArrival),
    stopped: r.stopped, evicted: r.evicted, writer: r.writer, storeWrites: r.storeWrites };
}

async function fill() {
  const opened = (await store("open")).opened;
  const floor = c.floor ? await store("floor", { count: c.floor }) : null;
  const ballast = c.ballast ? new Worker("ballast.js", { type: "module" }) : null;
  const ballastDone = ballast && new Promise((resolve) => (ballast.onmessage = ({ data }) => resolve(data)));
  feeders[0].postMessage({ kind: "send", indices: [...Array(c.held).keys()] });
  await until(async () => (await store("progress")).handled >= c.held, 60000);
  const running = fromViewNext("running");
  view.postMessage({ kind: "run" });
  await running;
  const stopTasks = c.longTasks ? longTasks() : () => {};
  const pace = c.credits ? { credits: c.credits } : { bytesPerMs: c.rateMBps * 1e3 };
  feeders.forEach((f, k) => f.postMessage({ kind: "go", from: c.held, to: c.n, first: c.held + k, stride: c.decoders, ...pace }));
  const handled = async () => (await store("progress")).handled >= c.n;
  let busyMisses = [];
  if (c.misses === "busy") {
    await until(async () => (await store("progress")).written >= c.held + c.missCount, c.timeoutS * 1000);
    const written = (await store("progress")).written;
    busyMisses = await misses(c.missCount, (k) => c.held + spread(k, written - c.held));
  }
  await until(handled, c.timeoutS * 1000);
  const stats = await feederStats();
  const lastPost = Math.max(0, ...stats.map((s) => s?.lastAt ?? 0));
  await sleep(Math.max(0, Math.min(lastPost + 5000 - now(), 5000)));
  const at5s = await store("progress");
  stopTasks();
  const viewSummary = fromViewNext("summary");
  view.postMessage({ kind: "stop" });
  const shown = await viewSummary;
  const fillEnd = shown.fillPosts === c.n - c.held ? shown.lastPost : now();
  const idleMisses = c.misses === "idle" ? await misses(c.missCount, (k) => c.held + spread(k, c.n - c.held)) : [];
  const r = await store("result");
  const row = { opened, floor, shown, misses: c.misses === "busy" ? busyMisses : idleMisses, store: writes(r),
    deliveredMBps: (shown.fillPosts * c.frameBytes) / 1e3 / Math.max(1, fillEnd - shown.firstPost), stallMs: stats.map((s) => s?.stallMs ?? null),
    unwrittenAt5s: c.n - at5s.handled, list: await store("list"), verify: opened.cache ? await store("verify") : null,
    ballast: ballastDone ? await ballastDone : null };
  if (!c.hold) await store("close");
  return row;
}

/** A reopen: every present frame (or every frame, `all`) read and re-checked; then, with `rest`, the rest fetched. */
async function reopen() {
  const { opened, startedMs } = await store("open");
  const asked = c.all ? [...Array(c.n).keys()] : opened.present;
  const read = await store("reopen", { present: asked });
  let rest = null;
  if (c.rest) {
    const have = new Set(read.hits);
    const missing = [...Array(c.n).keys()].filter((i) => !have.has(i));
    missing.forEach((i, k) => feeders[k % c.decoders].postMessage({ kind: "send", indices: [i] }));
    await until(async () => (await store("progress")).handled >= missing.length, c.timeoutS * 1000);
    rest = { asked: missing.length, ...writes(await store("result"), 0) };
  }
  const row = { opened: { ...opened, present: opened.present.length }, startedMs, read: { hits: read.hits.length, damaged: read.damaged, misses: read.misses.length,
    fromStartMs: read.fromStartMs }, rest, list: await store("list"), verify: opened.cache ? await store("verify", { indices: c.rest && opened.writer ? [...Array(c.n).keys()] : read.hits }) : null };
  await store("close");
  return row;
}

async function run() {
  await store.ready;
  if (q.get("damage") !== null) {
    const { opened } = await store("open");
    const i = opened.present[num("damage", 0)];
    return { present: opened.present.length, damaged: i === undefined ? null : (await store("damage", { i })).damaged, close: await store("close") };
  }
  return c.mode === "reopen" ? reopen() : fill();
}

globalThis.row = null;
globalThis.result = run().then((r) => ({ config: c, slots, ...r }), (e) => ({ config: c, error: `${e.name ?? ""}: ${e.message ?? e}` }));
globalThis.result.then((r) => (globalThis.row = r));
