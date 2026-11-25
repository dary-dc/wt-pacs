// Stands in for one decoder: each frame copied from its field into a ring slot held for the view and the store, the
// slot number posted to both, at a rate or on credit. A full ring stalls it, timed apart (the delivered rate).
import { fieldBytes } from "./fields.js";
import { ring as makeRing } from "./ring.js";

const now = () => performance.timeOrigin + performance.now();
let c = null;
let ring = null;
let toStore = null;
let toView = null;
const posted = [];
let stallMs = 0;

function post(i, timed = true) {
  let slot = ring.claim(2);
  if (slot === -1) {
    const t0 = performance.now();
    while (slot === -1) ring.waitFreed(ring.freed(), 50), (slot = ring.claim(2));
    stallMs += performance.now() - t0;
  }
  ring.bytes(slot, c.frameBytes).set(fieldBytes(c.fields, i, c.frameBytes));
  const at = now();
  if (timed) posted.push(at);
  toStore.postMessage({ i, slot, postedAt: at });
  toView.postMessage({ i, slot, postedAt: at });
}

/** `from`…`to`, every `stride`-th from `first`: frame j due at (j − from) × frameBytes / bytesPerMs, or on a credit. */
function go({ from, to, first, stride, bytesPerMs, credits }) {
  let next = first;
  if (credits) {
    let free = credits;
    const more = () => { while (free > 0 && next < to) free--, post(next), (next += stride); };
    toStore.addEventListener("message", ({ data }) => data.kind === "credit" && (free++, more()));
    toStore.start();
    return more();
  }
  const t0 = performance.now();
  const dueMs = (j) => ((j - from) * c.frameBytes) / bytesPerMs;
  const tick = () => {
    while (next < to && dueMs(next) <= performance.now() - t0) post(next), (next += stride);
    if (next < to) setTimeout(tick, Math.max(0, t0 + dueMs(next) - performance.now()));
  };
  tick();
}

onmessage = ({ data: m }) => {
  if (m.kind === "init") {
    c = { ...m.config, fields: m.fields };
    ring = makeRing(m.samples, m.table, c.frameBytes);
    ({ toStore, toView } = m);
    return;
  }
  if (m.kind === "go") return go(m);
  if (m.kind === "send") return m.indices.forEach((i) => post(i, false));
  if (m.kind === "stats") postMessage({ posted: posted.length, firstAt: posted[0] ?? null, lastAt: posted.at(-1) ?? null, stallMs });
};
