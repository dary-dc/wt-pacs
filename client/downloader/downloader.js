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
let cfg = { decoders: 3, decode: true, perDecoder: 2, survival: true };
/** ms, and how many re-dials. `cfg.survival` as an object overrides them; `false` turns it all off. */
const deadlines = { stallMs: 3000, probeMs: 2000, redialMs: 1000, tries: 5 };
let dial = null;
let dialling = null;
/** The request's identity: `+1` on cancel, carried by every record, decode and reply. */
let generation = 0;
let asksInFlight = 0;
// S6: the dial and the decoders start together; dispatch waits on this, the dial does not.
let decodersUp = false;
/** The session's identity: `+1` when one is declared dead, so its callbacks become no-ops. */
let epoch = 0;
let resuming = null;
let checking = false;
let lastArrival = 0;
let lastDelivered = -1;
let stall = null;

const decoders = [];
/** index → { state, gen, priority, stamps, bytes }. State: wire | queued | decoding. */
const records = new Map();
const queue = { ask: [], fill: [] };
/** Fill frames the consumer wants and the wire has not delivered. */
const wanted = new Set();

function post(msg, transfer) {
  postMessage(msg, transfer ?? []);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  lastArrival = abs();
  lastDelivered = index;
  armStall();
  const rec = records.get(index);
  if (!rec) return;
  rec.stamps.lastByte = abs();
  if (!cfg.decode) {
    records.delete(index);
    post({ kind: "frame", index, gen: rec.gen, pixels: frame.bytes, wireBytes: frame.bytes.length, stamps: rec.stamps, decoded: false }, [frame.bytes.buffer]);
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
  const ep = epoch;
  asksInFlight += 1;
  try {
    const frame = await promise;
    if (gen === generation && ep === epoch) arrived(index, frame);
  } catch (e) {
    if (gen === generation && ep === epoch && !lost()) fail(index, String(e?.message ?? e));
  } finally {
    // A cancelled ask's count was already dropped with the rest of its generation's work.
    if (gen === generation && ep === epoch) {
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
  const ep = epoch;
  return {
    onFrame: (frame) => {
      if (gen !== generation || ep !== epoch) return;
      arrived(frame.frameIndex, frame);
      if (frame.frameIndex === to) issueFill();
    },
    // A refused range is one frame_error at `from`, so the run fails whole.
    onError: (_index, reason) => {
      if (gen !== generation || ep !== epoch || lost()) return;
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
  armStall();
}


/** A fill gone quiet is a trigger; so is every platform signal. docs/proposal-session-survival.md */
function armStall() {
  clearTimeout(stall);
  stall = cfg.survival && wanted.size > 0 ? setTimeout(suspect, deadlines.stallMs) : null;
}

/** None of the triggers proves the path is dead, so each one starts a check, not a re-dial. */
function suspect() {
  if (!cfg.survival || checking || resuming || !session) return;
  // The probe reuses a frame already in hand, so one the fill wants again is not a candidate.
  if (lastDelivered < 0 || records.has(lastDelivered) || wanted.has(lastDelivered)) return;
  if (abs() - lastArrival < deadlines.stallMs) return;
  checking = true;
  probe().finally(() => { checking = false; });
}

/** The cheapest honest test of a session is to use it: one ask, discarded, with a deadline. */
async function probe() {
  const ep = epoch;
  const at = abs();
  if (session.stats().closed) return void lost();
  // An ask ends the running fill on the server (L16), so the remainder is re-issued after it.
  asksInFlight += 1;
  const answer = session.requestExactFrame(lastDelivered).then(() => true, () => false);
  const alive = await Promise.race([answer, sleep(deadlines.probeMs).then(() => false)]);
  if (ep !== epoch) return;
  asksInFlight -= 1;
  // A frame that landed while the probe was out proves the path whatever became of the probe.
  if (!alive && lastArrival < at) return void lost(true);
  armStall();
  issueFill();
}

/** True once the session is being resumed. The probe's missed deadline is the only proof a
 *  caller may bring of its own; every other one must see the session already closed. */
function lost(proved) {
  if (!cfg.survival || !dial || !session) return false;
  if (!proved && !session.stats().closed) return false;
  resuming ??= resume().finally(() => { resuming = null; });
  return true;
}

const owedAsks = () =>
  [...records].filter(([, r]) => r.state === "wire" && r.priority === "ask").map(([i]) => i);

/** A new session, then exactly what the records still owe: nothing that arrived is asked twice. */
async function resume() {
  epoch += 1;
  asksInFlight = 0;
  clearTimeout(stall);
  session.close();
  session = null;
  dialling = null;
  for (let n = 0; n < deadlines.tries; n++) {
    if (wanted.size === 0 && owedAsks().length === 0) return;
    try {
      await connect();
      for (const i of owedAsks()) ask(i, session.requestExactFrame(i));
      return void post({ kind: "resumed" });
    } catch {
      await sleep(deadlines.redialMs);
    }
  }
  const reason = "the session was lost and could not be re-dialled";
  for (const i of [...wanted]) fail(i, reason);
  for (const [i, rec] of [...records]) if (rec.state === "wire") fail(i, reason);
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
      if (e.data.buffer) session?.releaseWireBuffer(e.data.buffer);
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
  if (cfg.survival && cfg.survival !== true) Object.assign(deadlines, cfg.survival);
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
    // The ring is sized by what can be between the wire and a decoder. docs/decode/README.md §The wire buffer ring
    const options = { wireBuffers: cfg.wireBuffers ?? cfg.decoders * cfg.perDecoder + 2 };
    if (opening) options.fill = opening;
    session = await TransportSession.connect(dial.url, dial.certHash, options);
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
  await resuming;
  if (session && !session.stats().closed) return session;
  await connect();
  return session;
}

// The page's own triggers — visibility, pageshow, freeze/resume — are forwarded by consumer.js.
for (const ev of ["online", "offline"]) addEventListener(ev, suspect);
navigator.connection?.addEventListener?.("change", suspect);

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
    if (m.kind === "check") return void suspect();
    if (m.kind === "cancel") {
      generation += 1;
      clearTimeout(stall);
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
      clearTimeout(stall);
      session?.close();
      // The decoders end with this worker; ending them here first can strand it. docs/proposal-downloader.md §Closing a client
      return void post({ kind: "closed", reason: "closed by the consumer" });
    }
  } catch (err) {
    post({ kind: "failed", index: m.index ?? -1, reason: String(err?.message ?? err) });
  }
};
