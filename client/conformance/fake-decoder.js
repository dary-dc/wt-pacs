/**
 * A decoder stand-in for D2c: it decodes nothing, it stalls. Each decode holds for `delayMs`
 * so the downloader's queue backs up on purpose — contention forced, not waited for, and
 * `readyDelayMs` holds `ready` back so a fill can be on the wire while no decoder exists. It tags
 * every frame with the order it started (`decodeSeq`) and the most it ever held at once
 * (`maxInFlight`), which is what the ordering and the two-outstanding-per-decoder bound are read
 * from. docs/ARCHITECTURE.md §The downloader; client/conformance/dispatch-rig.ts drives it.
 */
let toConsumer = null;
let delayMs = 120;
let readyDelayMs = 0;
let up = false;
let inFlight = 0;
let maxInFlight = 0;
let decodeSeq = 0;
let warmed = false;

const abs = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ch = new URL(import.meta.url).searchParams.get("ch");
const alive = ch && new BroadcastChannel(`${ch}-alive`);
if (alive) alive.onmessage = (e) => e.data.ping && alive.postMessage({ pong: e.data.ping, who: "decoder" });

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    if (m.decoder && typeof m.decoder.delayMs === "number") delayMs = m.decoder.delayMs;
    if (m.decoder && typeof m.decoder.readyDelayMs === "number") readyDelayMs = m.decoder.readyDelayMs;
    // The real decoder warms before it answers `ready`; the stand-in waits as long and says so.
    if (m.warmup) warmed = !!(await fetch(m.warmup).catch(() => null))?.ok;
    if (readyDelayMs) await sleep(readyDelayMs);
    up = true;
    postMessage({ kind: "ready" });
    return;
  }
  if (m.kind !== "decode") return;
  // The real decoder has no instance until its wasm is up, and loses a frame handed to it before.
  if (!up) return void postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: "dispatched before the decoder was ready" });
  const seq = ++decodeSeq;
  inFlight += 1;
  if (inFlight > maxInFlight) maxInFlight = inFlight;
  const stamps = { ...m.stamps, decodeStart: abs() };
  const bytes = new Uint8Array(m.bytes);
  await sleep(delayMs);
  const sab = new SharedArrayBuffer(bytes.length);
  new Uint8Array(sab).set(bytes);
  stamps.decodeEnd = abs();
  toConsumer.postMessage({
    kind: "frame",
    index: m.index,
    gen: m.gen,
    pixels: sab,
    width: 1,
    height: bytes.length,
    bits: 8,
    components: 1,
    signed: false,
    min: 0,
    max: 0,
    byteCount: bytes.length,
    stamps,
    decodeSeq: seq,
    maxInFlight,
    warmed,
  });
  postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: bytes.length });
  inFlight -= 1;
};
