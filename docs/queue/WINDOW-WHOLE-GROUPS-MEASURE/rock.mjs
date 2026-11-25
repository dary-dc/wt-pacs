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

const out = [];
for (const [n, g, budget] of [[50,8,15],[50,8,16],[50,8,23],[50,8,24],[50,8,31],[50,8,32],[69,8,40],[69,8,54],[50,16,40],[50,16,48]]) {
  const s = await world(`r${n}-${g}-${budget}`, { n, g, budget });
  await walk(s, [8, 16, 23]);
  const rock = await walk(s, [24, 23, 24, 23, 24, 23]);
  const s2 = await world(`q${n}-${g}-${budget}`, { n, g, budget });
  await walk(s2, [16, 24, 31]);
  const rock2 = await walk(s2, [32, 31, 32, 31, 32, 31]);
  out.push(`${n}/${g}/${budget}: groups ${Math.max(2, Math.floor(budget / g))}, rock 23|24 ${rock.length}, rock 31|32 ${rock2.length}`);
}
console.log(out.join("\n"));
