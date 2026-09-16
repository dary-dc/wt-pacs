/**
 * The downloader: one worker owns the session, every frame's record and the queue.
 * Data takes the shortest path — pixels go decoder → consumer over a port handed out here —
 * and control has one owner. docs/proposal-downloader.md
 */
/** The transport is a seam: a third implementation plugs in here. docs/client-shape-plan.md §0 */
const DEFAULT_TRANSPORT = "/client/transport-ts/dist/session.js";
let TransportSession = null;

const abs = () => performance.timeOrigin + performance.now();

let session = null;
let cfg = { decoders: 3, decode: true, perDecoder: 2 };
let dial = null;
let generation = 0;

const decoders = [];
/** index → { state, gen, askMs, priority }. State: wire | queued | decoding | delivered | failed. */
const records = new Map();
const queue = { ask: [], fill: [] };

function post(msg, transfer) {
  postMessage(msg, transfer ?? []);
}

function fail(index, reason) {
  records.delete(index);
  post({ kind: "failed", index, reason });
}

/** Asks come before fill frames; a frame already in flight moves up rather than being re-asked. */
function promote(index) {
  const rec = records.get(index);
  if (!rec || rec.priority === "ask") return;
  rec.priority = "ask";
  const at = queue.fill.indexOf(index);
  if (at >= 0) {
    queue.fill.splice(at, 1);
    queue.ask.push(index);
    pump();
  }
}

function nextDecoder() {
  let best = null;
  for (const d of decoders) {
    if (d.outstanding >= cfg.perDecoder) continue;
    if (!best || d.outstanding < best.outstanding) best = d;
  }
  return best;
}

/** Never leave a decoder idle: up to `perDecoder` outstanding each. docs/decode/README.md §Dispatch */
function pump() {
  for (;;) {
    const d = nextDecoder();
    if (!d) return;
    const index = queue.ask.shift() ?? queue.fill.shift();
    if (index === undefined) return;
    const rec = records.get(index);
    if (!rec || rec.gen !== generation || rec.state !== "queued" || !rec.bytes) continue;
    rec.state = "decoding";
    rec.stamps.dispatched = abs();
    d.outstanding += 1;
    d.worker.postMessage(
      { kind: "decode", index, gen: generation, bytes: rec.bytes, stamps: rec.stamps },
      [rec.bytes.buffer],
    );
    rec.bytes = null;
  }
}

async function take(index, priority, promise, askMs) {
  const stamps = { ask: askMs, firstByte: 0, lastByte: 0, dispatched: 0, decodeStart: 0, decodeEnd: 0 };
  records.set(index, { state: "wire", gen: generation, priority, stamps });
  const gen = generation;
  let frame;
  try {
    frame = await promise;
  } catch (e) {
    if (gen === generation) fail(index, String(e?.message ?? e));
    return;
  }
  if (gen !== generation) return;
  stamps.lastByte = abs();
  const rec = records.get(index);
  if (!rec) return;
  rec.bytes = frame.bytes;
  if (!cfg.decode) {
    records.delete(index);
    post({ kind: "frame", index, pixels: frame.bytes, stamps, decoded: false }, [frame.bytes.buffer]);
    return;
  }
  rec.state = "queued";
  queue[priority].push(index);
  pump();
}

function onDone(d, m) {
  d.outstanding -= 1;
  records.delete(m.index);
  pump();
}

async function start(m) {
  // A config field the consumer left out must not clobber the default with `undefined`.
  for (const [k, v] of Object.entries(m.config ?? {})) if (v !== undefined) cfg[k] = v;
  const ready = [];
  for (let i = 0; i < cfg.decoders; i++) {
    const worker = new Worker(new URL("./decoder.js", import.meta.url), { type: "module" });
    const d = { worker, outstanding: 0 };
    ready.push(new Promise((r) => { d.ready = r; }));
    const ch = new MessageChannel();
    worker.postMessage({ kind: "init", toConsumer: ch.port1, decoder: cfg.decoder }, [ch.port1]);
    worker.onmessage = (e) => {
      if (e.data.kind === "done") onDone(d, e.data);
      else if (e.data.kind === "ready") d.ready();
      else if (e.data.kind === "init-failed") d.ready(post({ kind: "failed", index: -1, reason: e.data.reason }));
      else if (e.data.kind === "failed") { d.outstanding -= 1; fail(e.data.index, e.data.reason); pump(); }
    };
    post({ kind: "pixel-port", port: ch.port2 }, [ch.port2]);
    decoders.push(d);
  }
  // No frame may be dispatched before every decoder holds its instance.
  if (cfg.decode) await Promise.all(ready);
  dial = { url: m.url, certHash: m.certHash };
  await connect();
  post({ kind: "started" });
}

async function connect() {
  TransportSession ??= (await import(cfg.transport ?? DEFAULT_TRANSPORT)).TransportSession;
  session = await TransportSession.connect(dial.url, dial.certHash);
  session.closedPromise?.catch(() => {});
}

/** A command after a closure re-dials, as the proposal requires. */
async function live() {
  if (session && !session.stats().closed) return session;
  await connect();
  return session;
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.kind === "start") return void (await start(m));
    if (m.kind === "ask") {
      const s = await live();
      const askMs = abs();
      const rec = records.get(m.index);
      // An ask for a frame already on the wire moves it up the queue rather than asking twice.
      if (rec) return void promote(m.index);
      return void take(m.index, "ask", s.requestExactFrame(m.index), askMs);
    }
    if (m.kind === "fill") {
      const s = await live();
      const askMs = abs();
      s.startExactFrames(m.indices);
      for (const i of m.indices) take(i, "fill", s.waitExactFrame(i, askMs), askMs);
      return;
    }
    if (m.kind === "cancel") {
      generation += 1;
      queue.ask.length = 0;
      queue.fill.length = 0;
      for (const [index] of records) post({ kind: "failed", index, reason: "AbortError: the fill was cancelled" });
      records.clear();
      await session?.endStream();
      return void post({ kind: "cancelled" });
    }
    if (m.kind === "stats") return void post({ kind: "stats", id: m.id, stats: session ? session.stats() : { inFlight: 0 } });
    if (m.kind === "close") {
      session?.close();
      for (const d of decoders) d.worker.terminate();
      return void post({ kind: "closed", reason: "closed by the consumer" });
    }
  } catch (err) {
    post({ kind: "failed", index: m.index ?? -1, reason: String(err?.message ?? err) });
  }
};
