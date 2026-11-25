// node client/view/window.test.mjs — the view's memory window over the real downloader, a stand-in transport and decoders.
import assert from "node:assert/strict";
import { Controller } from "./controller.js";

globalThis.onmessage ??= null;
globalThis.addEventListener ??= () => {};
Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 4 }, configurable: true });

const settle = async () => { for (let k = 0; k < 20; k++) await new Promise((r) => setTimeout(r, 0)); };

/** A controller over the real downloader on a series of `n` frames in groups of `g`, its window `budget` frames; `wire` counts each frame the transport delivers. */
async function world(tag, { n, g, budget }) {
  const wire = [];
  const send = (index, cb) => (wire.push(index), cb({ frameIndex: index, bytes: new Uint8Array(4), timing: {} }));
  const fillFrames = async (from, to, onFrame) => { for (let i = from; i <= to; i++) { await null; send(i, onFrame); } };
  globalThis.fakeTransport = {
    connect: async (url, certHash, { fill }) => {
      // The opening run rides the session URL and is served behind the accept.
      if (fill) setTimeout(() => fillFrames(fill.from, fill.to, fill.onFrame));
      return {
        requestFrame: async (i) => (wire.push(i), { frameIndex: i, bytes: new Uint8Array(4), timing: {} }),
        fillFrames,
        stats: () => ({ closed: null, lastByteAt: performance.now() }),
        endStream: async () => {},
        releaseWireBuffer() {},
        close() {},
      };
    },
  };
  let c;
  const downloader = (m) => globalThis.onmessage({ data: m });
  globalThis.Worker = class {
    postMessage(m) {
      if (m.kind === "init") queueMicrotask(() => this.onmessage({ data: { kind: "ready" } }));
      if (m.kind !== "decode") return;
      queueMicrotask(() => {
        const info = { pixels: new Uint8Array(1).buffer, width: 1, height: 1, bits: 8, components: 1, signed: false, min: 0, max: 0, exact: null, stamps: {} };
        c.take({ frameIndex: m.index, info, ack: () => downloader({ kind: "ack", index: m.index, gen: m.gen }) });
        this.onmessage({ data: { kind: "done", index: m.index, gen: m.gen } });
      });
    }
    terminate() {}
  };
  globalThis.postMessage = (m) => m.kind === "failed" && console.error("downloader:", m);
  await import(`../transport/downloader.js?${tag}`);
  c = new Controller({ meta: { frameCount: n, width: 1, height: 1, lossy: { g } }, fillMode: true, size: { width: 1, height: 1, dpr: 1 }, emit() {}, paint: async () => ({}), budget });
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // ${tag}`;
  const sent = c.want();
  await downloader({ kind: "start", config: { transport, decoderWorker: "x", survival: false, groupLength: g, frameCount: n, want: sent } });
  await downloader({ kind: "dial", url: "https://x.invalid/", certHash: "ab" });
  c.link({ want: (indices) => downloader({ kind: "want", indices }), requestFrame() {}, cancel() {} }, sent);
  await settle();
  return { c, wire };
}

/** Steps `path` one frame at a time, each step's frame here before the next: the frames the wire delivered meanwhile, in order. */
async function walk({ c, wire }, path) {
  const before = wire.length;
  for (const i of path) {
    c.show(i);
    await settle();
    assert.ok(c.store.has(i), `frame ${i} is here at its step`);
  }
  return wire.slice(before);
}

const once = (delivered) => new Set(delivered).size === delivered.length;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A 50-frame series in groups of 8 under a 15-frame budget, stepped forward once then back once: each pass puts each frame on the wire once at most. docs/client/evidence/what-a-view-asks-for.md, *M, the budget* */
test("a pass over a series in groups puts each frame on the wire once", async () => {
  const n = 50;
  const w = await world("pass", { n, g: 8, budget: 15 });
  const forward = await walk(w, Array.from({ length: n }, (_, i) => i));
  const backward = await walk(w, Array.from({ length: n }, (_, i) => n - 1 - i));
  assert.ok(once(forward), `forward: ${forward.length} frames on the wire for ${n} steps`);
  assert.ok(once(backward), `backward: ${backward.length} frames on the wire for ${n} steps`);
});

/** A reader rocking across a group boundary holds both groups: past the first, nothing crosses the wire again. */
test("a sawtooth across a group boundary fetches no group twice", async () => {
  const w = await world("sawtooth", { n: 50, g: 8, budget: 15 });
  await walk(w, [8, 16, 23]);
  const rocking = await walk(w, [24, 23, 24, 23, 24, 23]);
  assert.ok(once(rocking), `rocking over 23|24: ${rocking}`);
});

/** A reader rocking one frame back and forth over any adjacent pair, reached from either side, fetches no frame twice: at W = 15 and 24 over 50 frames (two and three groups), and at `dbts_c1`'s W = 54 over 69 (six, an even count over two). */
test("rocking over any adjacent pair fetches no frame twice", async () => {
  for (const [n, budget] of [[50, 15], [50, 24], [69, 54]]) {
    const w = await world(`rock-${budget}`, { n, g: 8, budget });
    for (const pairs of [Array.from({ length: n - 1 }, (_, i) => [i, i + 1]), Array.from({ length: n - 1 }, (_, i) => [n - 1 - i, n - 2 - i])]) {
      for (const [from, to] of pairs) {
        await walk(w, [from]);
        const rocking = await walk(w, [to, from, to, from, to, from]);
        assert.ok(once(rocking), `W = ${budget}, rocking over ${from}|${to}: ${rocking}`);
      }
    }
  }
});

for (const [name, fn] of tests) {
  await fn();
  console.log(`ok ${name}`);
}
