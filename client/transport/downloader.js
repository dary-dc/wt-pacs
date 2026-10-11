/**
 * The downloader: one worker owns the session, every frame's record and the queue.
 * Data takes the shortest path — pixels go decoder → consumer over a port handed out here —
 * and control has one owner. docs/ARCHITECTURE.md
 */
/** The transport is a seam: a third implementation plugs in here. docs/CLIENTS.md §The seam */
const DEFAULT_TRANSPORT = "/client/transport/ts/dist/session.js";
let TransportSession = null;

const abs = () => performance.timeOrigin + performance.now();

let session = null;
/** A third decoder helps on four cores, not on two: docs/ARCHITECTURE.md §Resources */
let cfg = { decoders: Math.min(3, navigator.hardwareConcurrency || 3), decode: true, perDecoder: 2, survival: true };
/** ms, and how many re-dials. `cfg.survival` as an object overrides them; `false` turns it all off. */
const deadlines = { stallMs: 3000, redialMs: 1000, tries: 5, dialMs: 5000 };
let dial = null;
let dialling = null;
/** The request's identity: `+1` on cancel, carried by every record, decode and reply. */
let generation = 0;
let asksInFlight = 0;
// The dial and the decoders start together; dispatch waits on this, the dial does not.
let decodersUp = false;
let decoderLoss = "none is configured";
let spawned = 0;
/** The session's identity: `+1` when one is declared dead, so its callbacks become no-ops. */
let epoch = 0;
let resuming = null;
/** Re-dials since a frame last arrived: a session that dies before delivering spends them too. */
let redials = 0;
let stall = null;
/** When the owed work last went on the wire, and the silence after it that condemns the session. */
let issuedAt = 0;
let quietMs = 0;
/** Envelope bytes the live session has delivered, and the dial of its replacement once one is under way. */
let sessionBytes = 0;
let recycling = null;
/** Set by `close`: a dial that opens after it is closed, not adopted. */
let closed = false;

const decoders = [];
/** Lab flag `followQueue`: decoders retired idle, kept to be taken back, and the one coming up. */
const parked = [];
let growing = null;
/** index → { state, priority, stamps, bytes }. State: wire | queued | decoding. */
const records = new Map();
const queue = { ask: [], fill: [] };
/** Fill frames the consumer wants and the wire has not delivered; never one an ask carries, which the ask settles. */
const wanted = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(index, reason) {
  records.delete(index);
  wanted.delete(index);
  postMessage({ kind: "failed", index, gen: generation, reason });
}

/** Asks come before fill frames; a frame already in hand moves up rather than being re-asked. */
function promote(index) {
  // No pump: a frame waits in a queue only while no decoder can take it, and moving it frees none.
  const at = queue.fill.indexOf(index);
  if (at < 0) return;
  queue.fill.splice(at, 1);
  queue.ask.push(index);
  records.get(index).priority = "ask";
}

/** Frames per group, a keyframe at every multiple of it. docs/av1/adr-unit.md §3 */
const groupLength = () => cfg.groupLength ?? 1;
const isKey = (index) => index % groupLength() === 0;

/** Every frame of every group `indices` touch: a group is asked whole, from its keyframe. */
function wholeGroups(indices) {
  const g = groupLength();
  if (g === 1) return indices;
  const out = new Set();
  for (const i of indices) {
    for (let j = i - (i % g); j < Math.min(i - (i % g) + g, cfg.frameCount); j++) out.add(j);
  }
  return [...out].sort((a, b) => a - b);
}

/** A decoder still owed the next frame of its group takes no other keyframe. */
const holdsAGroup = (d) => d.next !== null && !isKey(d.next) && records.has(d.next);

/** A keyframe to the least busy free decoder; any other frame only to the one that took the frame before it. */
function decoderFor(index) {
  if (!isKey(index)) return decoders.find((d) => d.next === index && d.outstanding < cfg.perDecoder);
  let best = null;
  for (const d of decoders) {
    if (d.outstanding >= cfg.perDecoder || holdsAGroup(d)) continue;
    if (!best || d.outstanding < best.outstanding) best = d;
  }
  return best;
}

/** A frame whose predecessor will never reach a decoder cannot decode: it fails by name. */
const orphaned = (index) => !isKey(index) && !records.has(index - 1) && !decoders.some((d) => d.next === index);

/** Never leave a decoder idle: up to `perDecoder` outstanding each. docs/decode/README.md §Dispatch */
function pump() {
  if (!decodersUp) return;
  if (decoders.length === 0) return failQueued();
  for (const q of [queue.ask, queue.fill]) {
    for (let at = 0; at < q.length && decoders.some((d) => d.outstanding < cfg.perDecoder); ) {
      const index = q[at];
      const rec = records.get(index);
      if (!rec || rec.state !== "queued") {
        q.splice(at, 1);
        continue;
      }
      if (orphaned(index)) {
        q.splice(at, 1);
        fail(index, `frame ${index - 1} of its group did not decode`);
        continue;
      }
      const d = decoderFor(index);
      if (!d) {
        at += 1;
        continue;
      }
      q.splice(at, 1);
      dispatch(d, index, rec);
    }
  }
  grow();
}

/** Lab flags `followQueue` and `startOnNeed` (which never retires): one decoder at the start. docs/ARCHITECTURE.md §How many */
const growsOnNeed = () => cfg.followQueue || cfg.startOnNeed;

/** Frames still queued after a dispatch add a decoder, up to `cfg.decoders`. */
function grow() {
  if (!growsOnNeed() || growing || queue.ask.length + queue.fill.length === 0 || decoders.length >= cfg.decoders) return;
  const back = parked.pop();
  if (back) {
    decoders.push(back);
    return pump();
  }
  const d = spawn();
  growing = d;
  d.up.then(() => {
    // A decoder that failed to come up blocks further growth: the next would fail the same way.
    if (d.lost) return;
    growing = null;
    decoders.push(d);
    pump();
    retire(d);
  });
}

/** `followQueue`: a decoder left idle with nothing queued leaves the pool, alive, for `grow` to take back. */
function retire(d) {
  if (!cfg.followQueue || d.outstanding > 0 || decoders.length < 2 || holdsAGroup(d) || !decoders.includes(d)) return;
  decoders.splice(decoders.indexOf(d), 1);
  d.next = null;
  parked.push(d);
}

function dispatch(d, index, rec) {
  rec.state = "decoding";
  rec.stamps.dispatched = abs();
  rec.stamps.decoder = d.id;
  d.outstanding += 1;
  d.next = index + 1;
  d.worker.postMessage(
    { kind: "decode", index, gen: generation, key: isKey(index), bytes: rec.bytes, stamps: rec.stamps },
    [rec.bytes.buffer],
  );
  rec.bytes = null;
}

function failQueued() {
  for (const index of queue.ask.splice(0).concat(queue.fill.splice(0))) {
    if (records.has(index)) fail(index, `no decoder: ${decoderLoss}`);
  }
}

/** A decoder that never came up leaves the pool; with none left, the start has failed. */
function lose(d, reason) {
  // Not terminated: it ends with this worker, as every decoder does. docs/ARCHITECTURE.md §Closing a client
  d.lost = true;
  d.ready();
  if (!decoders.includes(d)) return;
  decoders.splice(decoders.indexOf(d), 1);
  if (decoders.length > 0) return;
  decoderLoss = reason;
  postMessage({ kind: "failed", index: -1, reason });
  pump();
}

function want(indices, askMs) {
  for (const i of wholeGroups(indices)) {
    if (records.has(i)) continue;
    record(i, "fill", askMs);
    wanted.add(i);
  }
}

function record(index, priority, askMs) {
  const stamps = { ask: askMs, lastByte: 0, dispatched: 0, decodeStart: 0, decodeEnd: 0 };
  records.set(index, { state: "wire", priority, stamps });
}

/** A frame's bytes are here: straight to the consumer, or into the queue for a decoder. */
function arrived(index, frame) {
  redials = 0;
  wanted.delete(index);
  watch();
  sessionBytes += frame.bytes.length + 8;
  if (cfg.recycleAtBytes && sessionBytes >= 0.75 * cfg.recycleAtBytes) recycling ??= recycle().finally(() => { recycling = null; });
  const rec = records.get(index);
  if (!rec) return;
  rec.stamps.lastByte = abs();
  rec.stamps.mediaReads = session?.stats().mediaReads;
  if (!cfg.decode) {
    records.delete(index);
    postMessage({ kind: "frame", index, gen: generation, pixels: frame.bytes, wireBytes: frame.bytes.length, stamps: rec.stamps, decoded: false }, [frame.bytes.buffer]);
    return;
  }
  rec.bytes = frame.bytes;
  rec.state = "queued";
  queue[rec.priority].push(index);
  pump();
}

/** The server ends a running fill for an ask, so the remainder is re-issued once the ask settles. docs/WIRE.md §An ask during a fill */
async function ask(index, promise) {
  const gen = generation;
  const ep = epoch;
  asksInFlight += 1;
  issuedAt = performance.now();
  watch();
  try {
    const frame = await promise;
    if (gen === generation && ep === epoch) arrived(index, frame);
  } catch (e) {
    if (gen === generation && ep === epoch && !lost(e?.name === "FrameTimeoutError")) {
      fail(index, String(e?.message ?? e));
      pump();
    }
  } finally {
    // A cancelled ask's count was already dropped with the rest of its generation's work.
    if (gen === generation && ep === epoch) {
      asksInFlight -= 1;
      issueFill();
    }
  }
}

function askFor(s, index) {
  const rec = records.get(index);
  if (rec?.priority === "ask") return;
  // In hand already: up the queue. Still owed by the fill: to the wire, where the server serves it next.
  if (rec && rec.state !== "wire") return void promote(index);
  wanted.delete(index);
  if (rec) rec.priority = "ask";
  else record(index, "ask", abs());
  ask(index, s.requestExactFrame(index));
}

/** The wire carries one contiguous run of what is wanted at a time. docs/ARCHITECTURE.md §The downloader */
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
  issuedAt = performance.now();
  watch();
}


/** No byte for `quietMs` while frames are owed is a dead path; each re-dial it causes doubles the
 *  wait. A frame slower than the wait still moves bytes. docs/ARCHITECTURE.md §Detection */
function watch() {
  clearTimeout(stall);
  stall = null;
  if (!cfg.survival || !session || (wanted.size === 0 && owedAsks().length === 0)) return;
  const quiet = performance.now() - Math.max(session.stats().lastByteAt ?? 0, issuedAt);
  if (quiet < quietMs) return void (stall = setTimeout(watch, quietMs - quiet));
  quietMs *= 2;
  lost(true);
}

/** True once the session is being resumed. Silence — the stall's, or a transport's frame timeout — is the
 *  only proof a caller may bring of its own; every other one must see the session already closed. */
function lost(proved) {
  if (!cfg.survival || !dial || !session) return false;
  if (!proved && !session.stats().closed) return false;
  resuming ??= resume().finally(() => { resuming = null; });
  return true;
}

const owedAsks = () =>
  [...records].filter(([, r]) => r.state === "wire" && r.priority === "ask").map(([i]) => i);

/** A session swapped for its replacement before a byte budget runs out, the replacement dialled
 *  while the old one still delivers. docs/ARCHITECTURE.md §Recycling before the stall */
async function recycle() {
  const ep = epoch;
  const next = await openSession(null).catch(() => null);
  if (!next || ep !== epoch || resuming || !session) return void next?.close();
  epoch += 1;
  asksInFlight = 0;
  session.close();
  adopt(next);
  for (const i of owedAsks()) ask(i, session.requestExactFrame(i));
  issueFill();
  postMessage({ kind: "recycled" });
}

/** A new session, then exactly what the records still owe: nothing that arrived is asked twice. */
async function resume() {
  epoch += 1;
  asksInFlight = 0;
  clearTimeout(stall);
  session.close();
  session = null;
  dialling = null;
  while (redials < deadlines.tries) {
    if (closed || (wanted.size === 0 && owedAsks().length === 0)) return;
    redials += 1;
    try {
      await connect();
      for (const i of owedAsks()) ask(i, session.requestExactFrame(i));
      return void postMessage({ kind: "resumed" });
    } catch {
      await sleep(deadlines.redialMs);
    }
  }
  redials = 0;
  const reason = "the session was lost and could not be re-dialled";
  for (const i of [...wanted]) fail(i, reason);
  for (const [i, rec] of [...records]) if (rec.state === "wire") fail(i, reason);
}

function onDone(d, m) {
  d.outstanding -= 1;
  if (m.gen === generation) records.delete(m.index);
  pump();
  retire(d);
}

/** A decoder worker, up once `d.up` settles; `start` puts it in the pool at once, `grow` once it is up. */
function spawn() {
  // The decoder is a seam like the transport: a test points it at a controllable stand-in.
  const worker = new Worker(cfg.decoderWorker ?? new URL("../decode/decoder.js", import.meta.url), { type: "module" });
  const d = { worker, outstanding: 0, next: null, id: spawned++ };
  d.up = new Promise((r) => { d.ready = r; });
  const ch = new MessageChannel();
  worker.postMessage({ kind: "init", toConsumer: ch.port1, decoder: cfg.decoder, groupLength: cfg.groupLength, digests: cfg.digests }, [ch.port1]);
  worker.onmessage = (e) => {
    if (e.data.buffer) session?.releaseWireBuffer(e.data.buffer);
    if (e.data.kind === "done") onDone(d, e.data);
    else if (e.data.kind === "ready") d.ready();
    else if (e.data.kind === "init-failed") lose(d, e.data.reason);
    else if (e.data.kind === "failed") {
      d.outstanding -= 1;
      if (e.data.gen === generation) fail(e.data.index, e.data.reason);
      pump();
      retire(d);
    }
  };
  postMessage({ kind: "pixel-port", port: ch.port2 }, [ch.port2]);
  return d;
}

async function start(m) {
  // A config field the consumer left out must not clobber the default with `undefined`.
  for (const [k, v] of Object.entries(m.config ?? {})) if (v !== undefined) cfg[k] = v;
  const count = !cfg.decode ? 0 : growsOnNeed() ? Math.min(1, cfg.decoders) : cfg.decoders;
  for (let i = 0; i < count; i++) decoders.push(spawn());
  const ready = decoders.map((d) => d.up);
  if (cfg.survival && cfg.survival !== true) Object.assign(deadlines, cfg.survival);
  quietMs = deadlines.stallMs;
  // The decoders come up without the session URL, which arrives in `dial`; `decodersUp` gates
  // dispatch alone — docs/ARCHITECTURE.md §The downloader.
  if (cfg.fill) want(cfg.fill, abs());
  if (cfg.decode) await Promise.all(ready);
  decodersUp = true;
  pump();
}

async function openSession(opening) {
  TransportSession ??= (await import(cfg.transport ?? DEFAULT_TRANSPORT)).TransportSession;
  // The ring is sized by what can be between the wire and a decoder. docs/decode/README.md §The wire buffer ring
  const options = { wireBuffers: cfg.wireBuffers ?? cfg.decoders * cfg.perDecoder + 2 };
  if (cfg.survival) options.dialMs = deadlines.dialMs;
  if (cfg.readMin) options.readMin = cfg.readMin;
  if (opening) options.fill = opening;
  const next = await TransportSession.connect(dial.url, dial.certHash, options);
  if (closed) {
    next.close();
    throw new Error("closed by the consumer");
  }
  return next;
}

function adopt(next) {
  session = next;
  sessionBytes = 0;
  issuedAt = performance.now();
}

/** One dial at a time: a fill riding with the dial and a command behind it share the handshake. */
async function connect() {
  dialling ??= (async () => {
    const gen = generation;
    // The range is known here, so it rides the session URL and is served behind the accept
    // rather than a round trip later. docs/ARCHITECTURE.md
    const run = cfg.openingAsk !== false ? nextRun() : null;
    const opening = run && { ...run, ...fillHandlers(run.from, run.to) };
    adopt(await openSession(opening));
    // A cancel during the dial cannot take back the run its URL carries.
    if (opening && gen !== generation) session.endStream().catch(() => {});
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

/** A first dial that never settles is tried again, as a re-dial is; one that fails says so at once. */
async function firstDial() {
  for (let n = 1; ; n++) {
    try {
      return await connect();
    } catch (e) {
      if (!cfg.survival || n >= deadlines.tries || e?.name !== "DialTimeoutError") throw e;
      await sleep(deadlines.redialMs);
    }
  }
}

/** A command after a closure re-dials: docs/ARCHITECTURE.md §The downloader. */
async function live() {
  await resuming;
  if (session && !session.stats().closed) return session;
  await connect();
  return session;
}

// The page's own triggers — visibility, pageshow, freeze/resume — are forwarded by consumer.js.
for (const ev of ["online", "offline"]) addEventListener(ev, watch);
navigator.connection?.addEventListener?.("change", watch);

onmessage = async (e) => {
  const m = e.data;
  const gen = generation;
  try {
    if (m.kind === "start") return void (await start(m));
    if (m.kind === "dial") {
      dial = { url: m.url, certHash: m.certHash };
      await firstDial();
      return void postMessage({ kind: "started" });
    }
    if (m.kind === "ask") {
      const s = await live();
      if (gen !== generation) return;
      for (const i of wholeGroups([m.index])) askFor(s, i);
      return;
    }
    if (m.kind === "fill") {
      await live();
      if (gen !== generation) return;
      want(m.indices, abs());
      return void issueFill();
    }
    if (m.kind === "check") return void watch();
    if (m.kind === "cancel") {
      generation += 1;
      clearTimeout(stall);
      queue.ask.length = 0;
      queue.fill.length = 0;
      records.clear();
      wanted.clear();
      for (const d of decoders) d.next = null;
      asksInFlight = 0;
      try {
        await session?.endStream();
      } catch {
        /* a dead session has no stream to end */
      }
      return void postMessage({ kind: "cancelled", gen: generation });
    }
    if (m.kind === "close") {
      closed = true;
      clearTimeout(stall);
      session?.close();
      // The decoders end with this worker; ending them here first can strand it. docs/ARCHITECTURE.md §Closing a client
      return void postMessage({ kind: "closed", reason: "closed by the consumer" });
    }
  } catch (err) {
    const reason = String(err?.message ?? err);
    // Index -1 is the start failing; an ask or a fill names its own frames, in its own generation.
    if (m.kind !== "ask" && m.kind !== "fill") return void postMessage({ kind: "failed", index: -1, reason });
    if (gen === generation) for (const index of m.indices ?? [m.index]) fail(index, reason);
  }
};
