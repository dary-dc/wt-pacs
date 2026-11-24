// candidates.md §2: the real FrameStore and wantFrom of a checkout, and a stand-in downloader that keeps downloader.js's
// two rules (a want is widened to whole groups; a record is forgotten at the ack). Usage: node window-model.mjs <checkout>/client
const root = process.argv[2];
const { FrameStore } = await import(`${root}/view/store.js`);
const { wantFrom } = await import(`${root}/view/controller.js`);
function run({ n, W, G, path }) {
  let delivered = 0, perStep = [];
  const store = new FrameStore({ arrived() {}, budget: W });
  const records = new Set();
  const whole = (idx) => { const o = new Set(); for (const i of idx) for (let j = i - (i % G); j < Math.min(i - (i % G) + G, n); j++) o.add(j); return [...o].sort((a, b) => a - b); };
  let pending = [];
  store.downloader = { want(misses) { pending = whole(misses).filter((i) => !records.has(i)); for (const i of pending) records.add(i); } };
  const drain = () => { const p = pending; pending = []; for (const i of p) { delivered++; store.put(i, { info: { exact: null } }, () => records.delete(i)); } };
  for (const c of path) {
    const before = delivered;
    store.near = c;
    store.want(wantFrom(c, n, true, false, Math.min(n, W)));
    drain();
    perStep.push(delivered - before);
  }
  return { delivered, perStep };
}
const n = 50, fwd = Array.from({ length: n }, (_, i) => i), back = [...fwd].reverse();
for (const [W, G] of [[15, 8], [16, 8], [15, 1], [50, 8], [23, 8], [24, 8]]) {
  const f = run({ n, W, G, path: fwd }), b = run({ n, W, G, path: [49, ...back] });
  console.log(`W=${W} G=${G}  forward 0..49: ${f.delivered} frames delivered for ${n} steps (${(f.delivered / n).toFixed(2)} a step)  steps 8..23: [${f.perStep.slice(8, 24)}]   backward: ${b.delivered}`);
}
