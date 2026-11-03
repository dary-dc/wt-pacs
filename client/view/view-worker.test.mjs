// node client/view/view-worker.test.mjs — the view worker's intents, its paint module failing for want of a GPU.
import assert from "node:assert/strict";

globalThis.self = globalThis;
globalThis.onmessage = null;
const posted = [];
globalThis.postMessage = (m) => posted.push(m);
await import("./view-worker.js");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const send = (m) => onmessage({ data: m });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
async function call(kind) {
  const asked = ++id;
  send({ kind, id: asked });
  await settle(10);
  return posted.find((m) => m.kind === "reply" && m.id === asked).value;
}

send({ kind: "start", canvas: {}, meta: { frameCount: 4 }, fillMode: true, size: { width: 1, height: 1, dpr: 1 } });
const now = () => performance.timeOrigin + performance.now();
/** Each cine step to a frame no downloader can send is said as that frame's failure: the steps taken so far. */
const steps = () => posted.filter((m) => m.type === "failed" && m.scope === "frame").length;

/** A pause sent while the clock's module still loads stops the cine it was sent after: no frame is shown once paused. */
test("a pause right after play holds", async () => {
  send({ kind: "play", fps: 1000, t0: now(), source: "timeout" });
  send({ kind: "pause" });
  const paused = steps();
  await settle(100);
  assert.equal(steps(), paused);
  assert.equal((await call("cine")).length, 0);
});

/** A second play replaces the first, even while the clock's module loads: one cine runs, and the pause stops it. */
test("a second play leaves one cine running", async () => {
  send({ kind: "play", fps: 1000, t0: now(), source: "timeout" });
  send({ kind: "play", fps: 1000, t0: now(), source: "timeout" });
  await settle(50);
  send({ kind: "pause" });
  await settle(10);
  const paused = steps();
  await settle(50);
  assert.equal(steps(), paused);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`view worker: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
