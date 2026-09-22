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
let dialling = null;
/** The request's identity: `+1` on cancel, carried by every record, decode and reply. */
let generation = 0;
let asksInFlight = 0;
// S6: the dial and the decoders start together; dispatch waits on this, the dial does not.
let decodersUp = false;

const decoders = [];
/** index → { state, gen, priority, stamps, bytes }. State: wire | queued | decoding. */
const records = new Map();
const queue = { ask: [], fill: [] };
/** Fill frames the consumer wants and the wire has not delivered. */
const wanted = new Set();

function post(msg, transfer) {
  postMessage(msg, transfer ?? []);
}

function fail(index, reason) {
  records.delete(index);
  wanted.delete(index);
  post({ kind: "failed", index, gen: generation, reason });
}

/** Asks come before fill frames; a frame already in hand moves up rather than being re-asked. */
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
  if (!decodersUp) return;
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

function want(indices, askMs) {
  for (const i of indices) {
    if (records.has(i)) continue;
    record(i, "fill", askMs);
    wanted.add(i);
  }
}

function record(index, priority, askMs) {
  const stamps = { ask: askMs, firstByte: 0, lastByte: 0, dispatched: 0, decodeStart: 0, decodeEnd: 0 };
  records.set(index, { state: "wire", gen: generation, priority, stamps });
}

/** A frame's bytes are here: straight to the consumer, or into the queue for a decoder. */
function arrived(index, frame) {
  wanted.delete(index);
  const rec = records.get(index);
  if (!rec) return;
  rec.stamps.lastByte = abs();
  if (!cfg.decode) {
    records.delete(index);
    post({ kind: "frame", index, gen: rec.gen, pixels: frame.bytes, stamps: rec.stamps, decoded: false }, [frame.bytes.buffer]);
    return;
  }
  rec.bytes = frame.bytes;
  rec.state = "queued";
  queue[rec.priority].push(index);
  pump();
}

/** The server ends a running fill for an ask (L16), so the remainder is re-issued once the ask settles. */
async function ask(index, promise) {
  const gen = generation;
  asksInFlight += 1;
  try {
    const frame = await promise;
    if (gen === generation) arrived(index, frame);
  } catch (e) {
    if (gen === generation) fail(index, String(e?.message ?? e));
  } finally {
    // A cancelled ask's count was already dropped with the rest of its generation's work.
    if (gen === generation) {
      asksInFlight -= 1;
      issueFill();
    }
  }
}

/** The wire carries one contiguous run of what is wanted at a time. docs/proposal-downloader.md §The downloader */
function nextRun() {
  if (wanted.size === 0) return null;
  const from = Math.min(...wanted);
  let to = from;
  while (wanted.has(to + 1)) to += 1;
  return { from, to };
}

function fillHandlers(from, to) {
  const gen = generation;
  return {
    onFrame: (frame) => {
      if (gen !== generation) return;
      arrived(frame.frameIndex, frame);
      if (frame.frameIndex === to) issueFill();
    },
    // A refused range is one frame_error at `from`, so the run fails whole.
    onError: (_index, reason) => {
      if (gen !== generation) return;
      for (let i = from; i <= to; i++) if (wanted.has(i)) fail(i, reason);
      issueFill();
    },
  };
}

function issueFill() {
  if (asksInFlight > 0 || !session || session.stats().closed) return;
  const run = nextRun();
  if (!run) return;
  const { onFrame, onError } = fillHandlers(run.from, run.to);
  session.fillFrames(run.from, run.to, onFrame, onError);
}

function onDone(d, m) {
  d.outstanding -= 1;
  if (m.gen === generation) records.delete(m.index);
  pump();
}

async function start(m) {
  // A config field the consumer left out must not clobber the default with `undefined`.
  for (const [k, v] of Object.entries(m.config ?? {})) if (v !== undefined) cfg[k] = v;
  const ready = [];
  // The decoder is a seam like the transport: a test points it at a controllable stand-in.
  const decoderUrl = cfg.decoderWorker ?? new URL("./decoder.js", import.meta.url);
  for (let i = 0; i < cfg.decoders; i++) {
    const worker = new Worker(decoderUrl, { type: "module" });
    const d = { worker, outstanding: 0 };
    ready.push(new Promise((r) => { d.ready = r; }));
    const ch = new MessageChannel();
    worker.postMessage({ kind: "init", toConsumer: ch.port1, decoder: cfg.decoder, warmup: cfg.warmup }, [ch.port1]);
    worker.onmessage = (e) => {
      if (e.data.kind === "done") onDone(d, e.data);
      else if (e.data.kind === "ready") d.ready();
      else if (e.data.kind === "init-failed") d.ready(post({ kind: "failed", index: -1, reason: e.data.reason }));
      else if (e.data.kind === "failed") {
        d.outstanding -= 1;
        if (e.data.gen === generation) fail(e.data.index, e.data.reason);
        pump();
      }
    };
    post({ kind: "pixel-port", port: ch.port2 }, [ch.port2]);
    decoders.push(d);
  }
  // The decoders come up without the session URL, which arrives in `dial`; `decodersUp` gates
  // dispatch alone — docs/proposal-downloader.md §The downloader.
  if (cfg.fill) want(cfg.fill, abs());
  if (cfg.decode) await Promise.all(ready);
  decodersUp = true;
  pump();
}

/** One dial at a time: a fill riding with the dial and a command behind it share the handshake. */
async function connect() {
  dialling ??= (async () => {
    TransportSession ??= (await import(cfg.transport ?? DEFAULT_TRANSPORT)).TransportSession;
    // The range is known here, so it rides the session URL and is served behind the accept
    // rather than a round trip later. docs/proposal-session-open.md
    const run = cfg.openAsk ? nextRun() : null;
    const opening = run && { ...run, ...fillHandlers(run.from, run.to) };
    session = await TransportSession.connect(dial.url, dial.certHash, opening ? { fill: opening } : {});
    session.closedPromise?.catch(() => {});
    return opening;
  })();
  let opening = null;
  try {
    opening = await dialling;
  } finally {
    dialling = null;
  }
  if (!opening) issueFill();
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
    if (m.kind === "dial") {
      dial = { url: m.url, certHash: m.certHash };
      await connect();
      return void post({ kind: "started" });
    }
    if (m.kind === "ask") {
      const s = await live();
      const rec = records.get(m.index);
      if (rec?.priority === "ask") return;
      // In hand already: up the queue. Still owed by the fill: to the wire, where the server serves it next.
      if (rec && rec.state !== "wire") return void promote(m.index);
      if (rec) rec.priority = "ask";
      else record(m.index, "ask", abs());
      return void ask(m.index, s.requestExactFrame(m.index));
    }
    if (m.kind === "fill") {
      await live();
      want(m.indices, abs());
      return void issueFill();
    }
    if (m.kind === "cancel") {
      generation += 1;
      queue.ask.length = 0;
      queue.fill.length = 0;
      records.clear();
      wanted.clear();
      asksInFlight = 0;
      await session?.endStream();
      return void post({ kind: "cancelled", gen: generation });
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
