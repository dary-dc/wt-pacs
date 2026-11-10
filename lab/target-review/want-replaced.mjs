// node lab/target-review/want-replaced.mjs — a want replaced (cancel + fill) while frames are decoding.
import { handFed, load, frame, posted, settle } from "./harness.mjs";

const dispatched = new Map();
const decoders = [];
globalThis.Worker = class {
  constructor() {
    this.decoding = [];
    decoders.push(this);
  }
  postMessage(m) {
    if (m.kind === "init") queueMicrotask(() => this.onmessage({ data: { kind: "ready" } }));
    if (m.kind === "decode") {
      this.decoding.push(m);
      dispatched.set(m.index, [...(dispatched.get(m.index) ?? []), m.gen]);
    }
  }
  finish() {
    const m = this.decoding.shift();
    this.onmessage({ data: { kind: "done", index: m.index, gen: m.gen } });
    return m;
  }
  terminate() {}
};
const fed = handFed();
await load("replaced", { decode: true, decoders: 2, perDecoder: 2, decoderWorker: "x", survival: { decodeMs: 60_000, stallMs: 60_000 } });
const ten = [...Array(10).keys()];
const feed = async () => { const [f, t] = fed.fills.at(-1); for (let i = f; i <= t; i++) fed.onFrame(frame(i)); await settle(); };

await onmessage({ data: { kind: "fill", indices: ten } });
await feed();
console.log("gen 0 decoding:", decoders.map((d) => d.decoding.map((m) => m.index)));
await onmessage({ data: { kind: "cancel" } });
await onmessage({ data: { kind: "fill", indices: ten } });
console.log("after cancel + fill 0..9, wire calls:", JSON.stringify(fed.fills));
await feed();
while (decoders.some((d) => d.decoding.length)) for (const d of decoders) if (d.decoding.length) d.finish(), await settle();
console.log("decode dispatches per index (gens):", JSON.stringify(Object.fromEntries(dispatched)));
console.log("indices dispatched twice:", [...dispatched].filter(([, g]) => g.length > 1).map(([i]) => i).join(","));

fed.fills.length = 0;
await onmessage({ data: { kind: "ack", index: 0, gen: 0 } });
await onmessage({ data: { kind: "fill", indices: [0] } });
console.log("ack(0, gen 0) then fill [0]: wire calls", JSON.stringify(fed.fills), "(empty = record for 0 still held)");
await onmessage({ data: { kind: "ack", index: 0, gen: 1 } });
await onmessage({ data: { kind: "fill", indices: [0] } });
console.log("ack(0, gen 1) then fill [0]: wire calls", JSON.stringify(fed.fills));
console.log("cancelled reply:", JSON.stringify(posted.find((m) => m.kind === "cancelled")));
process.exit(0);
