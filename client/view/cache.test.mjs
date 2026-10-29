// node client/view/cache.test.mjs — the view worker's cache under the writer `store`, with a stand-in store worker.
import assert from "node:assert/strict";
import { openCache } from "./cache.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A store worker that answers by `answer(kind, message)`; `sent`, what it was posted. */
function storeWorker(answer) {
  const sent = [];
  globalThis.Worker = class {
    postMessage(m, transfer) {
      sent.push({ ...m, transfer });
      queueMicrotask(() => this.onmessage({ data: { id: m.id, ...answer(m.kind, m) } }));
    }
    terminate() {
      sent.push({ kind: "terminated" });
    }
  };
  return sent;
}

/** A cache with every event it emits recorded. */
async function opened() {
  const events = [];
  const cache = await openCache({ writer: "store", key: "https://host/", digests: ["a", "b"], emit: (type, e) => events.push([type, e]) });
  return { cache, failures: () => events.filter(([t]) => t === "failed").map(([, e]) => `${e.scope}: ${e.reason}`) };
}

const frame = { info: { pixels: new SharedArrayBuffer(4), width: 1, height: 1, bits: 16, components: 1, signed: false, min: 0, max: 1, exact: true } };

/** A second tab, whose store worker cannot take the series' lock, is told so as the cache's, and runs without one. */
test("a second tab without the lock is said, not swallowed", async () => {
  const sent = storeWorker(() => ({ error: "NoModificationAllowedError" }));
  const { cache, failures } = await opened();
  assert.equal(cache, null);
  assert.deepEqual(failures(), ["cache: not opened: another tab holds this series' cache"]);
  assert.equal(sent.at(-1).kind, "terminated");
});

/** Writes the store refuses, two in flight at once, stop the cache, said once; no later write is posted. */
test("the cache stops once, and says so once", async () => {
  const sent = storeWorker((kind) => (kind === "open" ? { present: [1] } : { written: false }));
  const { cache, failures } = await opened();
  assert.deepEqual([...cache.present], [1]);
  assert.deepEqual(await Promise.all([cache.write(0, frame), cache.write(2, frame)]), [false, false]);
  assert.equal(await cache.write(3, frame), false);
  assert.deepEqual(failures(), ["cache: stopped at frame 0: no frame after it is written"]);
  assert.equal(sent.filter((m) => m.kind === "write").length, 2);
});

/** The store worker is handed a copy of the samples, transferred, never the SharedArrayBuffer itself. */
test("a write hands the store worker a copy", async () => {
  const sent = storeWorker((kind) => (kind === "open" ? { present: [] } : { written: true }));
  const { cache } = await opened();
  assert.equal(await cache.write(0, frame), true);
  const w = sent.find((m) => m.kind === "write");
  assert.ok(w.info.pixels instanceof ArrayBuffer && w.transfer[0] === w.info.pixels);
});

/** A read-back that fails its check is a miss, and a good one comes back exact, from the cache. */
test("a read is the frame checked, or null", async () => {
  storeWorker((kind, m) => (kind === "open" ? { present: [0, 1] } : m.index === 0 ? { miss: "its digest did not match" } : { info: { ...frame.info, path: "store" } }));
  const { cache } = await opened();
  assert.equal(await cache.read(0), null);
  const info = await cache.read(1);
  assert.deepEqual([info.exact, info.path], [true, "cache"]);
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
console.log(`cache: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
