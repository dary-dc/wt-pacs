// The store worker: one arm behind the seam, the rules above it (store.js), frames by slot number from the feeders,
// reads from the view served before the next write. cache-plan.md §7.0, §8.2
import { hasher } from "../../client/decode/xxh3.js";
import { fieldBytes, fill, FIELDS, sha256 } from "./fields.js";
import { ring as makeRing } from "./ring.js";
import { store as makeStore, webLocks } from "./store.js";

const now = () => performance.timeOrigin + performance.now();
let c = null;
let ring = null;
let st = null;
let arm = null;
let xxh3 = null;
let digests = [];
let shas = [];
const reads = [];
const writes = [];
const done = [];
const served = [];
let busy = false;

const check = (bytes, i) => xxh3.init().update(bytes).digest("hex") === digests[i % FIELDS];

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (reads.length || writes.length) {
      if (reads.length && (ring.anyFree() || !writes.length)) await serveRead(reads.shift());
      else await doWrite(writes.shift());
    }
  } finally {
    busy = false;
  }
}

/** Reads let in while a write waits between its pieces (§7.1, reads first), as long as a slot is free. */
async function serveReads() {
  while (reads.length && ring.anyFree()) await serveRead(reads.shift());
}

/** A free slot for the view, waited for apart: a full ring frees only as the view and the writer let go. A ring
 *  that never frees (the slot-held mutant) gives none after `SLOT_WAIT_MS`: slot −1. */
const SLOT_WAIT_MS = 10000;
async function freeSlot() {
  for (const t0 = performance.now(); ; await new Promise((r) => setTimeout(r, 1))) {
    const slot = ring.claim(1);
    if (slot !== -1 || performance.now() - t0 > SLOT_WAIT_MS) return { slot, waitMs: performance.now() - t0 };
  }
}

async function serveRead({ i, port, askedAt }) {
  const { slot, waitMs } = await freeSlot();
  if (slot === -1) return ring.readServed(), port.postMessage({ kind: "read", i, slot: null, hit: false, why: "no free slot", waitMs });
  const t0 = performance.now();
  const got = await st.read(i, ring.bytes(slot, c.frameBytes));
  ring.readServed();
  if (!got.hit) ring.release(slot);
  served.push({ i, askedAt, waitMs, readMs: performance.now() - t0, ...got });
  port.postMessage({ kind: "read", i, slot: got.hit ? slot : null, waitMs, ...got });
}

async function doWrite({ i, slot, arrivedAt, feeder }) {
  const start = now();
  const w = await st.write(i, slot);
  done.push({ i, arrivedAt, start, end: now(), ...w });
  if (c.credits) feeder.postMessage({ kind: "credit" });
}

/** Every frame named read back through the store and checked by SHA-256, which no arm uses. */
async function verify(indices) {
  const { slot } = await freeSlot();
  if (slot === -1) return { ok: 0, notOk: indices.length, wrong: [], why: "no free slot" };
  const bytes = ring.bytes(slot, c.frameBytes);
  const wrong = [];
  let ok = 0;
  for (const i of indices) {
    const got = await st.read(i, bytes);
    if (got.hit && (await sha256(bytes)) === shas[i % FIELDS]) ok++;
    else wrong.push(i);
  }
  ring.release(slot);
  return { ok, notOk: wrong.length, wrong: wrong.slice(0, 8) };
}

/** Each present frame read and re-checked in turn, timed from this worker's start (the cell O's R). */
async function reopen(present) {
  const { slot } = await freeSlot();
  if (slot === -1) return { hits: [], damaged: [], misses: present, why: "no free slot", fromStartMs: performance.now() };
  const bytes = ring.bytes(slot, c.frameBytes);
  const out = { hits: [], damaged: [], misses: [] };
  for (const i of present) {
    const got = await st.read(i, bytes);
    (got.hit ? out.hits : got.damaged ? out.damaged : out.misses).push(i);
  }
  ring.release(slot);
  return { ...out, fromStartMs: performance.now() };
}

async function floor(count) {
  if (!arm.floor) return null;
  const a = ring.claim(1);
  const b = ring.claim(1);
  ring.bytes(a, c.frameBytes).set(fieldBytes(c.fieldsBuffer, 0, c.frameBytes));
  const f = await arm.floor(ring.bytes(a, c.frameBytes), ring.bytes(b, c.frameBytes), count);
  ring.release(a);
  ring.release(b);
  const median = (v) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
  return { writeMs: median(f.writeMs), readMs: median(f.readMs), count };
}

const commands = {
  open: async () => {
    const opened = await st.open(c.series, { digests: [...Array(c.n).keys()].map((i) => digests[i % FIELDS]), frameBytes: c.frameBytes, shape: [c.w, c.h] });
    return { opened, startedMs: performance.now() };
  },
  floor: ({ count }) => floor(count),
  damage: async ({ i }) => (await arm.damage(i), { damaged: i }),
  list: () => arm.list(),
  reopen: ({ present }) => reopen(present),
  verify: ({ indices }) => verify(indices ?? done.filter((d) => d.written).map((d) => d.i)),
  progress: () => ({ handled: done.length, written: done.filter((d) => d.written).length, queued: writes.length }),
  result: () => ({ writes: done, reads: served, storeWrites: st.writes, stopped: st.stopped, evicted: st.evicted, writer: st.writer }),
  close: () => st.close(),
};

onmessage = async ({ data: m }) => {
  if (m.kind !== "init") {
    const reply = await Promise.resolve(commands[m.kind](m)).catch((e) => ({ error: `${e.name ?? ""}: ${e.message ?? e}` }));
    return postMessage({ id: m.id, reply });
  }
  c = { ...m.config, fieldsBuffer: m.fields };
  ring = makeRing(m.samples, m.table, c.frameBytes);
  xxh3 = await hasher();
  fill(m.fields, c.w, c.h);
  digests = [...Array(FIELDS).keys()].map((k) => xxh3.init().update(fieldBytes(m.fields, k, c.frameBytes)).digest("hex"));
  shas = await Promise.all([...Array(FIELDS).keys()].map((k) => sha256(fieldBytes(m.fields, k, c.frameBytes))));
  arm = (await import(`./arms/${c.arm}.js`)).default(new URLSearchParams(c.pilot));
  const estimate = navigator.storage?.estimate ? () => navigator.storage.estimate() : null;
  st = makeStore({ arm, ring, check, locks: webLocks(), mutant: c.mutant, estimate, serveReads });
  for (const feeder of m.feeders) {
    feeder.onmessage = ({ data: f }) => (writes.push({ ...f, arrivedAt: now(), feeder }), pump());
  }
  m.view.onmessage = ({ data: v }) => (reads.push({ ...v, port: m.view, askedAt: now() }), pump());
  postMessage({ id: 0, reply: { ready: true } });
};
