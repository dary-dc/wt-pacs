// A model, not a measurement: the real downloader against a simulated server and link, on the sawtooth trace. docs/adr/frame-path.md §3, *Experiment 2*
//   node lab/viewer/want-model.mjs [--queue-kb 0,125,250]
import { sawtooth, STEP_MS, waits } from "./trace.js";

globalThis.onmessage ??= null;
globalThis.addEventListener ??= () => {};
const posted = [];
globalThis.postMessage = (m) => posted.push(m);
const settle = async () => { for (let k = 0; k < 4; k++) await new Promise((r) => setImmediate(r)); };
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

/** ms: the model's clock. */
const TICK_MS = 1;

/**
 * One visit. The server recites a fill frame by frame and ends it at a frame boundary for any message in hand; it
 * keeps at most BDP + `queueKb` unacknowledged, into one FIFO at `kbit`; `rttMs` split evenly each way.
 */
async function visit({ frames, frameKb, kbit, rttMs, queueKb, waitAhead, fill = true }) {
  const rate = kbit / 8;
  const oneWay = rttMs / 2;
  const window = rate * rttMs + queueKb * 1000;
  const size = frameKb * 1000;
  let now = 0;
  const later = [];
  const at = (t, fn) => later.push({ t, fn });
  const server = { inbox: [], asks: [], fill: null, writing: null, written: 0, acked: 0 };
  const link = [];
  let onFill = null;
  const pending = new Map();
  const sent = { asks: 0, runs: 0 };
  globalThis.fakeTransport = {
    connect: async () => ({
      requestExactFrame: (i, onHead) => new Promise((resolve) => {
        sent.asks += 1;
        pending.set(i, { resolve, onHead });
        at(now + oneWay, () => server.inbox.push({ ask: i }));
      }),
      fillFrames: (from, to, onFrame) => { sent.runs += 1; onFill = onFrame; at(now + oneWay, () => server.inbox.push({ from, to })); },
      stats: () => ({ closed: null, lastByteAt: now }),
      endStream: async () => {},
      releaseWireBuffer() {},
      close() {},
    }),
  };
  posted.length = 0;
  const name = `model-${Math.random()}`;
  await import(`../../client/transport/downloader.js?${name}`);
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // ${name}`;
  await onmessage({ data: { kind: "start", config: { transport, survival: false, decode: false, decoders: 0, waitAhead } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });

  const held = new Map();
  let wanted = [];
  let current = 0;
  const order = () => {
    if (!fill) return [current];
    if (waitAhead) return Array.from({ length: frames }, (_, d) => (current + d) % frames);
    const o = [current];
    for (let d = 1; o.length < frames; d++) for (const i of [current + d, current - d]) if (i >= 0 && i < frames) o.push(i);
    return o;
  };
  const want = async () => {
    const misses = order().filter((i) => !held.has(i));
    const owed = wanted.filter((i) => !held.has(i));
    if (misses.length === owed.length && misses.every((i, k) => i === owed[k])) return;
    wanted = misses;
    await onmessage({ data: { kind: "want", indices: misses } });
  };
  await want();

  const write = () => {
    for (;;) {
      if (!server.writing) {
        for (const m of server.inbox.splice(0)) {
          if ("ask" in m) server.asks.push(m.ask);
          else server.fill = { next: m.from, to: m.to };
          if ("ask" in m) server.fill = null;
        }
        let i = server.asks.shift();
        const asked = i !== undefined;
        if (!asked && server.fill && server.fill.next <= server.fill.to) i = server.fill.next++;
        if (i === undefined) return;
        server.writing = { i, asked, left: size, first: true };
      }
      const room = window - (server.written - server.acked);
      if (room <= 0) return;
      const w = Math.min(room, server.writing.left);
      link.push({ ...server.writing, bytes: w, last: w === server.writing.left });
      server.written += w;
      server.writing.left -= w;
      server.writing.first = false;
      if (server.writing.left > 0) return;
      server.writing = null;
    }
  };
  const deliver = ({ i, asked, first, last }) => {
    if (asked && first) pending.get(i)?.onHead?.();
    if (!last) return;
    if (asked) pending.get(i)?.resolve({ frameIndex: i, bytes: new Uint8Array(1) });
    else onFill?.({ frameIndex: i, bytes: new Uint8Array(1) });
  };

  const steps = [];
  const trace = sawtooth(frames);
  let t0 = null;
  let budget = 0;
  for (; now < 600_000; now += TICK_MS) {
    const due = later.filter((e) => e.t <= now).sort((a, b) => a.t - b.t);
    if (due.length) later.splice(0, later.length, ...later.filter((e) => e.t > now));
    for (const e of due) e.fn();
    write();
    budget += rate * TICK_MS;
    while (link.length && budget >= link[0].bytes) {
      const chunk = link.shift();
      budget -= chunk.bytes;
      at(now + oneWay, () => deliver(chunk));
      at(now + 2 * oneWay, () => (server.acked += chunk.bytes));
    }
    if (!link.length) budget = 0;
    if (due.length) await settle();
    for (const m of posted.splice(0)) if (m.kind === "frame" && !held.has(m.index)) held.set(m.index, now);
    if (t0 === null && held.has(0)) t0 = now;
    if (t0 !== null && steps.length < trace.length && now >= t0 + (steps.length + 1) * STEP_MS) {
      const i = trace[steps.length];
      steps.push({ i, at: now });
      current = i;
      await want();
    }
    if (steps.length === trace.length && (fill ? held.size === frames : steps.every((s) => held.has(s.i)))) break;
  }
  return {
    ...waits(steps, held),
    fillMs: fill ? Math.max(...held.values()) : null,
    ...sent,
  };
}

const cells = [
  { set: "ct_lidc", frames: 100, frameKb: 164 },
  { set: "dbt10_ea1141", frames: 24, frameKb: 567 },
];
const arms = [["off", undefined], ["k=1", 1], ["k=2", 2], ["k=4", 4], ["k=8", 8]];
for (const queueKb of arg("--queue-kb", "0,250").split(",").map(Number)) {
  for (const c of cells) for (const kbit of [5000, 20000]) for (const rttMs of [46, 92]) {
    const parts = [];
    for (const [arm, waitAhead] of arms) {
      const r = await visit({ ...c, kbit, rttMs, queueKb, waitAhead });
      parts.push(`${arm} up ${r.forwardMs.toFixed(0)} down ${r.backwardMs.toFixed(0)} missing ${r.missingMs.toFixed(1)} live ${(r.live * 100).toFixed(0)}% fill ${r.fillMs} asks ${r.asks} runs ${r.runs}`);
    }
    console.log(`queue ${queueKb} kB ${c.set} ${kbit / 1000} Mbit ${rttMs} ms: ${parts.join(" · ")}`);
  }
}
process.exit(0);
