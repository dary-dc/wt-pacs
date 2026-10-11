// node client/transport/downloader.test.mjs — decoders a start makes, a timed-out ask; no browser.
globalThis.onmessage ??= null;
globalThis.addEventListener ??= () => {};
const posted = [];
globalThis.postMessage = (m) => posted.push(m);
let made = 0;
globalThis.Worker = class {
  constructor() {
    made++;
  }
  postMessage() {}
};

/** A fresh downloader on a host reporting `cores`, started with no `decoders`: the workers it makes. */
async function decodersOn(cores) {
  Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: cores }, configurable: true });
  made = 0;
  await import(`./downloader.js?cores=${cores}`);
  onmessage({ data: { kind: "start", config: {} } });
  return made;
}

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};

// Two cores get two decoders: a third is no faster there and starves the page's main thread.
const two = await decodersOn(2);
check(two === 2, `2 cores: ${two} decoders, not 2`);
// Eight cores get three: the count is capped, not the core count.
const eight = await decodersOn(8);
check(eight === 3, `8 cores: ${eight} decoders, not 3`);
// A host that does not report its cores gets three.
const unknown = await decodersOn(undefined);
check(unknown === 3, `unreported cores: ${unknown} decoders, not 3`);

/** A transport's frame timeout is silence, as the stall's is: past a doubled wait, the ask is resumed, not failed. */
async function aTimedOutAskIsResumed() {
  let dials = 0;
  globalThis.fakeTransport = {
    connect: async () => {
      const dial = ++dials;
      return {
        requestExactFrame: (i) => dial === 1
          ? Promise.reject(Object.assign(new Error(`timeout waiting for frame ${i}: no byte for 15000 ms`), { name: "FrameTimeoutError" }))
          : Promise.resolve({ frameIndex: i, bytes: new Uint8Array(4), timing: {} }),
        stats: () => ({ closed: null, lastByteAt: performance.now() }),
        fillFrames() {},
        endStream: async () => {},
        close() {},
      };
    },
  };
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport;`;
  posted.length = 0;
  await import("./downloader.js?timeout");
  await onmessage({ data: { kind: "start", config: { decode: false, decoders: 0, transport, survival: { stallMs: 60_000, redialMs: 1 } } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
  await onmessage({ data: { kind: "ask", index: 0 } });
  for (let n = 0; n < 50 && !posted.some((m) => m.kind === "frame"); n++) await new Promise((r) => setTimeout(r, 10));
  check(!posted.some((m) => m.kind === "failed"), `a timed-out ask is not failed (${posted.find((m) => m.kind === "failed")?.reason})`);
  check(dials === 2 && posted.some((m) => m.kind === "frame" && m.index === 0), `it is asked again on a new session (${dials} dials)`);
}
await aTimedOutAskIsResumed();

/** A transport whose fill and asks the test feeds by hand. */
function handFed() {
  const fed = { fill: null, asks: new Map() };
  globalThis.fakeTransport = {
    connect: async () => ({
      requestExactFrame: (i) => new Promise((resolve) => fed.asks.set(i, resolve)),
      stats: () => ({ closed: null, lastByteAt: performance.now() }),
      fillFrames: (from, to, onFrame) => (fed.fill = onFrame),
      endStream: async () => {},
      close() {},
    }),
  };
  return fed;
}

/** Decoder workers that come up at once and finish a frame only when the test says so. */
function handDecoders() {
  const made = [];
  globalThis.Worker = class {
    constructor() {
      this.decoding = [];
      made.push(this);
    }
    postMessage(m) {
      if (m.kind === "init") queueMicrotask(() => this.onmessage({ data: { kind: "ready" } }));
      if (m.kind === "decode") this.decoding.push(m);
    }
    finish() {
      const m = this.decoding.shift();
      this.onmessage({ data: { kind: "done", index: m.index, gen: m.gen } });
    }
  };
  return made;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const frame = (i) => ({ frameIndex: i, bytes: new Uint8Array(4), timing: {} });

/**
 * `followQueue` starts one decoder, adds one only while frames stay queued after a dispatch, never past
 * `decoders`, takes a retired decoder back before making another, and keeps both dispatch clauses: asks
 * first, at most `perDecoder` a decoder.
 */
async function followTheQueue() {
  const fed = handFed();
  const made = handDecoders();
  // A source of its own: a module is cached by its URL, and the one above holds the other fake.
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // follow`;
  await import("./downloader.js?follow");
  await onmessage({ data: { kind: "start", config: { followQueue: true, decoders: 3, perDecoder: 2, transport, decoderWorker: "x", survival: false } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
  check(made.length === 1, `it starts ${made.length} decoders, not 1`);
  await onmessage({ data: { kind: "fill", indices: [...Array(16).keys()] } });
  const busy = () => made.map((w) => w.decoding.length);
  const most = () => Math.max(...busy());

  fed.fill(frame(0));
  fed.fill(frame(1));
  await settle();
  check(made.length === 1, `two frames on one decoder add none (${made.length} decoders)`);
  fed.fill(frame(2));
  await settle();
  check(made.length === 2 && busy()[1] === 1, `a frame left queued adds one, which takes it (${busy()})`);
  for (let i = 3; i < 10; i++) fed.fill(frame(i));
  await settle();
  check(made.length === 3, `never past decoders: ${made.length}`);
  check(most() <= 2, `at most perDecoder a decoder: ${busy()}`);

  const ask = onmessage({ data: { kind: "ask", index: 11 } });
  await settle();
  fed.asks.get(11)(frame(11));
  await ask;
  await settle();
  made[0].finish();
  check(made[0].decoding.at(-1)?.index === 11, `a freed decoder takes the ask before queued fill frames (${made[0].decoding.map((m) => m.index)})`);

  while (made.some((w) => w.decoding.length)) {
    for (const w of made) if (w.decoding.length) w.finish();
    await settle();
  }
  fed.fill(frame(10));
  fed.fill(frame(12));
  await settle();
  const working = made.filter((w) => w.decoding.length).length;
  check(working === 1, `idle decoders retire: two frames find ${working} decoders working, not 1`);
  fed.fill(frame(13));
  await settle();
  check(made.length === 3 && busy().filter((n) => n).length === 2, `a retired decoder is taken back, none made (${made.length} made, ${busy()})`);
}
await followTheQueue();

/** `startOnNeed` starts one decoder, adds one only while frames stay queued after a dispatch, never past `decoders`, and never retires one. */
async function startOnNeed() {
  const fed = handFed();
  const made = handDecoders();
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // need`;
  await import("./downloader.js?need");
  await onmessage({ data: { kind: "start", config: { startOnNeed: true, decoders: 3, perDecoder: 2, transport, decoderWorker: "x", survival: false } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
  check(made.length === 1, `it starts ${made.length} decoders, not 1`);
  await onmessage({ data: { kind: "fill", indices: [...Array(16).keys()] } });
  const busy = () => made.map((w) => w.decoding.length);
  fed.fill(frame(0));
  fed.fill(frame(1));
  await settle();
  check(made.length === 1, `two frames on one decoder add none (${made.length} decoders)`);
  for (let i = 2; i < 10; i++) fed.fill(frame(i));
  await settle();
  check(made.length === 3 && Math.max(...busy()) <= 2, `a queue adds decoders up to decoders, perDecoder each (${busy()})`);
  while (made.some((w) => w.decoding.length)) {
    for (const w of made) if (w.decoding.length) w.finish();
    await settle();
  }
  for (const i of [10, 11, 12]) fed.fill(frame(i));
  await settle();
  check(made.length === 3 && busy().every((n) => n === 1), `idle decoders stay in the pool: three frames on three (${busy()})`);
}
await startOnNeed();

console.log(failed ? `${failed} failed` : "downloader decoder count, timed-out ask, follow the queue, start on need: ok");
process.exit(failed ? 1 : 0);
