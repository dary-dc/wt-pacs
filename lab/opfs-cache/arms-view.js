// M5's view worker: the product's downloader filling a series, each frame held as the arm says, asks and steps timed.
// docs/adr/frame-path.md §Who owns a frame's memory, M5 amended
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";
import { hasher } from "/client/decode/xxh3.js";
import { HELD, slotsOf, tableBytes } from "./arms-slots.js";

const BUDGET = 256 * 2 ** 20;
/** Asked mid-fill once this many frames are in, each the farthest not yet asked. */
const ASK_AT = [10, 30, 50];
/** Stepped back by after the fill, from the frame last asked: neighbours the window around it holds. */
const STEPS = [1, 2, 3];
const abs = () => performance.timeOrigin + performance.now();
const say = (m) => postMessage(m);

onmessage = ({ data }) => (data.verify ? verify().then((r) => say({ verified: r })) : run(data)).catch((e) => say({ status: `error: ${e?.message ?? e}`, result: { error: String(e?.message ?? e) } }));

let dir = null;
let n = 0;
let frameBytes = 0;
let digests = null;
let shaUrl = null;

async function run(q) {
  const meta = await (await fetch(q.metadata)).json();
  n = meta.frameCount;
  frameBytes = meta.width * meta.height * 2;
  digests = meta.digests.frames;
  shaUrl = q.sha;
  const arm = q.arm;
  const holdMs = Number(q.holdMs ?? 0);
  const xxh3 = await hasher();
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("arms", { create: true });
  dir = await root.getDirectoryHandle(encodeURIComponent(q.wt), { create: true });

  const held = new Map();
  let heldBytes = 0;
  let heldPeak = 0;
  let current = 0;
  const ring = arm === "ring" ? (() => {
    const count = Math.floor(BUDGET / frameBytes);
    const samples = new SharedArrayBuffer(count * frameBytes);
    const table = new SharedArrayBuffer(tableBytes(count));
    return { samples, table, ...slotsOf(table), view: (s) => new Uint8Array(samples, s * frameBytes, frameBytes) };
  })() : null;
  const readBuffer = arm === "disk" ? new Uint8Array(frameBytes) : null;
  const seen = { received: 0, exact: 0, inexact: 0, stored: 0, twice: 0, offRing: 0, waits: 0, waitedMs: 0, readMismatch: 0, staleTake: 0 };
  const arrivals = [];
  const errors = [];
  let fillMs = null;

  const hold = (i, h) => {
    held.set(i, h);
    heldBytes += h.bytes.length;
    heldPeak = Math.max(heldPeak, heldBytes);
  };
  const farthest = () => [...held.keys()].filter((i) => i !== current).sort((a, b) => Math.abs(b - current) - Math.abs(a - current))[0];
  function evict(i) {
    const h = held.get(i);
    held.delete(i);
    heldBytes -= h.bytes.length;
    if (h.slot !== undefined) ring.free(h.slot);
  }
  /** Over budget, the farthest frame goes: a frame the decoder could not write is held all the same, and shows in `stored`. */
  const trim = () => { while (heldBytes > BUDGET && held.size > 1) evict(farthest()); };
  if (ring) new BroadcastChannel("arms-dry").onmessage = () => ring.anyFree() || farthest() === undefined || evict(farthest());

  /** A frame from a decoder, of the fill or asked, held as the arm says; the consumer acknowledged it on handing it over. */
  function accept(f) {
    const m = f.info;
    if (arrivals.some((a) => a.i === m.index)) return void seen.twice++;
    if (holdMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
    arrivals.push({ i: m.index, decodeEnd: m.stamps.decodeEnd, processed: abs() });
    seen.received++;
    seen[m.exact ? "exact" : "inexact"]++;
    seen.stored += m.stored ? 1 : 0;
    seen.waits += m.waits ?? 0;
    seen.waitedMs += m.waitedMs ?? 0;
    if (arm === "ring" && m.slot !== undefined) {
      ring.hold(m.slot);
      hold(m.index, { bytes: ring.view(m.slot), slot: m.slot, take: m.take });
    } else if (m.pixels) {
      if (arm === "ring") seen.offRing++;
      hold(m.index, { bytes: new Uint8Array(m.pixels) });
      trim();
    }
    if (seen.received === n) fillMs = abs() - t0;
    status();
  }

  /** A slot for a frame read back: a free one, or the farthest held frame's. */
  function readSlot() {
    for (;;) {
      for (let s = 0; s < ring.count; s++) if (ring.claim(s, HELD)) return { slot: s, take: ring.taken(s), bytes: ring.view(s) };
      if (farthest() === undefined) throw new Error("every slot held by a decoder");
      evict(farthest());
    }
  }
  /** Frame i's samples checked and in hand: from what the view holds, or read from disk into a slot, a new buffer or the one read buffer. */
  async function inHand(i) {
    const h = held.get(i);
    if (h && (h.slot === undefined || ring.takeOf(h.slot) === h.take)) return;
    if (h) (seen.staleTake++, evict(i));
    const into = ring ? readSlot() : { bytes: readBuffer ?? new Uint8Array(frameBytes) };
    const a = await (await dir.getFileHandle(String(i))).createSyncAccessHandle();
    a.read(into.bytes, { at: 0 });
    a.close();
    if (xxh3.init().update(into.bytes).digest("hex") !== digests[i]) seen.readMismatch++;
    if (!readBuffer) hold(i, into);
    if (!ring) trim();
  }

  function status() {
    say({ status: [`arm ${arm}`, `received ${seen.received}, exact ${seen.exact}, not exact ${seen.inexact}`, `on disk ${seen.stored}`,
      fillMs !== null ? `fill ${Math.round(fillMs)} ms` : "filling", ...errors.slice(-1).map((e) => `error: ${e}`)].join(" · ") });
  }

  const decoder = { ...(await built("openjph")), arm, key: q.wt, ...(ring && { ring: { samples: ring.samples, table: ring.table, slotBytes: frameBytes } }) };
  const t0 = abs();
  const client = await DownloaderClient.connect(q.wt, q.hash, {
    transport: "/client/transport/ts/dist/session.js",
    fill: [...Array(n).keys()],
    digests,
    decoder,
    decoderWorker: new URL("./arms-decoder.js", import.meta.url).href,
    ...(q.credits && { credits: Number(q.credits) }),
    onFrame: (f) => (accept(f), asking()),
    onError: ({ frameIndex, reason }) => (errors.push(`frame ${frameIndex}: ${reason}`), status()),
  });

  const asks = [];
  let asked = 0;
  async function asking() {
    if (asked >= ASK_AT.length || seen.received < ASK_AT[asked]) return;
    const i = n - 1 - 10 * asked++;
    if (held.has(i) || arrivals.some((a) => a.i === i)) return;
    current = i;
    const t = abs();
    try {
      accept(await client.requestExactFrame(i));
      const arrived = abs();
      await inHand(i);
      asks.push({ i, ms: abs() - t, inHandMs: abs() - arrived });
    } catch (e) {
      errors.push(`ask ${i}: ${e.message}`);
    }
  }

  while (fillMs === null && !errors.length) await new Promise((r) => setTimeout(r, 20));
  const steps = [];
  const last = current;
  for (const k of STEPS) {
    const i = (last - k + n) % n;
    const t = abs();
    current = i;
    await inHand(i);
    steps.push({ i, ms: abs() - t });
  }
  client.close();
  // A frame decoded at decodeEnd and taken at processed waits in the view's port meanwhile: the most at once.
  const backlogPeak = Math.max(0, ...arrivals.map((a) => arrivals.filter((b) => b.decodeEnd <= a.processed && b.processed > a.processed).length));
  say({ result: { arm, holdMs, credits: q.credits ? Number(q.credits) : null, fillMs, ...seen, slots: ring?.count ?? null, heldPeakMiB: heldPeak / 2 ** 20, backlogPeak, asks, steps, errors } });
}

/** The rig's second check: every frame read back from disk and its SHA-256 compared with the encoder input's. */
async function verify() {
  const sha = await (await fetch(shaUrl)).json();
  const buffer = new Uint8Array(frameBytes);
  const wrong = [];
  let read = 0;
  for (let i = 0; i < n; i++) {
    const a = await (await dir.getFileHandle(String(i)).catch(() => null))?.createSyncAccessHandle();
    if (!a) continue;
    const got = a.read(buffer, { at: 0 });
    a.close();
    read++;
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer.subarray(0, got)));
    if ([...h].map((b) => b.toString(16).padStart(2, "0")).join("") !== sha[i % sha.length]) wrong.push(i);
  }
  return { read, wrong };
}
