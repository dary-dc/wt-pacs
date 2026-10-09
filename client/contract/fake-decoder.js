/**
 * A decoder stand-in for the dispatch rig: it decodes nothing, it stalls. Each decode takes `delayMs`,
 * or, under `hold: "decode"`, waits for the page's release, so the downloader's queue backs up on
 * purpose; `hold: "ready"` keeps `ready` back the same way, so a fill can be on the wire while no
 * decoder exists; a frame whose bytes begin `fail` fails once its wait is over. It tags every frame
 * with the order it started (`decodeSeq`) and the most it ever held at once (`maxInFlight`), which
 * is what the ordering and the two-outstanding-per-decoder bound are read from. docs/ARCHITECTURE.md §The downloader; client/contract/dispatch-rig.ts drives it.
 */
let toConsumer = null;
let delayMs = 120;
let hold = null;
let up = false;
let inFlight = 0;
let maxInFlight = 0;
let decodeSeq = 0;

const abs = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ch = new URL(import.meta.url).searchParams.get("ch");
const alive = ch && new BroadcastChannel(`${ch}-alive`);
if (alive) alive.onmessage = (e) => e.data.ping && alive.postMessage({ pong: e.data.ping, who: "decoder" });

/** The page's hold: each wait says "holding" on `${ch}-decoder`, and one "release" there ends every wait for good. */
const control = ch && new BroadcastChannel(`${ch}-decoder`);
let release = () => {};
const released = new Promise((r) => (release = r));
if (control) control.onmessage = (e) => e.data === "release" && release();
const held = () => {
  control?.postMessage("holding");
  return released;
};

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    if (m.decoder && typeof m.decoder.delayMs === "number") delayMs = m.decoder.delayMs;
    hold = m.decoder?.hold ?? null;
    // The decoders share one ticket, so exactly one of them fails, once the page releases it.
    const failOne = m.decoder?.failOneInit;
    if (failOne && Atomics.add(failOne.ticket, 0, 1) === 0) {
      await held();
      return void postMessage({ kind: "init-failed", reason: "the stand-in failed its init on purpose" });
    }
    if (hold === "ready") await held();
    up = true;
    postMessage({ kind: "ready" });
    control?.postMessage("ready");
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
  await (hold === "decode" ? held() : sleep(delayMs));
  if (new TextDecoder().decode(bytes).startsWith("fail")) {
    inFlight -= 1;
    return void postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: "the stand-in failed it on purpose" });
  }
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
  });
  postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: bytes.length });
  inFlight -= 1;
};
