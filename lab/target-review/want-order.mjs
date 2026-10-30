// node lab/target-review/want-order.mjs — what the wire sees for a controller-ordered want, and for a sparse one.
import { handFed, load, frame, posted, settle } from "./harness.mjs";

const N = 76;
const fed = handFed();
await load("order", { decode: false, decoders: 0 });

const outward = [40];
for (let d = 1; outward.length < N; d++) for (const i of [40 + d, 40 - d]) if (i >= 0 && i < N) outward.push(i);
console.log("(a) want order sent:", outward.slice(0, 9).join(","), "...");
await onmessage({ data: { kind: "fill", indices: outward } });
console.log("(a) wire calls:", JSON.stringify(fed.fills), "asks:", JSON.stringify(fed.asks));
const run = fed.fills[0];
for (let i = run[0]; i <= run[1]; i++) fed.onFrame(frame(i));
await settle();
const order = posted.filter((m) => m.kind === "frame").map((m) => m.index);
console.log("(a) arrival order:", order.slice(0, 6).join(","), "... frame 40 arrives at position", order.indexOf(40) + 1, "of", order.length);

fed.fills.length = 0;
const odd = [...Array(N).keys()].filter((i) => i % 2 === 1);
await onmessage({ data: { kind: "fill", indices: odd } });
for (let n = 0; n < fed.fills.length; n++) {
  const [from, to] = fed.fills[n];
  for (let i = from; i <= to; i++) fed.onFrame(frame(i));
  await settle();
}
const runs = fed.fills.length;
console.log(`(b) ${odd.length} misses (odd of ${N}) -> ${runs} fillFrames calls; first 3: ${JSON.stringify(fed.fills.slice(0, 3))}`);
console.log("(b) model: each run issued only when the previous run's last frame lands, so each run after the first waits 1 RTT idle (request out, first byte back); server time and transfer ignored.");
for (const rtt of [46, 92]) console.log(`(b) RTT ${rtt} ms: idle ${(runs - 1) * rtt} ms over ${runs} runs vs 0 ms for one run of the whole series`);
process.exit(0);
