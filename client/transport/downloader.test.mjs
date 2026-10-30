// node client/transport/downloader.test.mjs — decoders a start makes, a timed-out ask, lost decodes; no browser.
import v8 from "node:v8";
import vm from "node:vm";
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
      if (m.kind === "init") {
        this.toConsumer = m.toConsumer;
        queueMicrotask(() => this.onmessage({ data: { kind: "ready" } }));
      }
      if (m.kind === "decode") this.decoding.push(m);
    }
    finish() {
      const m = this.decoding.shift();
      this.toConsumer.postMessage({ kind: "frame", index: m.index, gen: m.gen, pixels: new Uint8Array(1), stamps: m.stamps });
      this.onmessage({ data: { kind: "done", index: m.index, gen: m.gen } });
      return m;
    }
    crash() {
      this.onerror({ message: "the stand-in crashed", preventDefault() {} });
    }
    terminate() {
      this.terminated = true;
    }
  };
  return made;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const frame = (i) => ({ frameIndex: i, bytes: new Uint8Array(4), timing: {} });

/**
 * `startOnNeed` starts one decoder, adds one only while frames stay queued after a dispatch, never past `decoders`,
 * never retires one, and keeps both dispatch clauses while it grows: asks first, at most `perDecoder` a decoder.
 */
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
  for (const i of [10, 12, 13]) fed.fill(frame(i));
  await settle();
  check(made.length === 3 && busy().every((n) => n === 1), `idle decoders stay in the pool: three frames on three (${busy()})`);
}
await startOnNeed();

/** A downloader on hand-fed transport and decoders, filling frames 0–3, one decoder taking two frames at a time. */
async function lossWorld(name, survival = false) {
  const fed = handFed();
  const made = handDecoders();
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // ${name}`;
  await import(`./downloader.js?${name}`);
  await onmessage({ data: { kind: "start", config: { decoders: 1, perDecoder: 2, transport, decoderWorker: "x", survival } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
  await onmessage({ data: { kind: "fill", indices: [0, 1, 2, 3] } });
  posted.length = 0;
  return { fed, made, failed: () => posted.filter((m) => m.kind === "failed") };
}

/** A decoder that crashes is terminated and replaced, and the frames it held are asked again and decoded by the new one. */
async function aCrashIsRecovered() {
  const { fed, made, failed } = await lossWorld("crash");
  fed.fill(frame(0));
  fed.fill(frame(1));
  await settle();
  made[0].crash();
  await settle();
  check(made[0].terminated && made.length === 2, `the crashed decoder is terminated and a new one made (${made.length} made)`);
  check(fed.asks.has(0) && fed.asks.has(1), `both frames it held are asked again (${[...fed.asks.keys()]})`);
  fed.asks.get(0)?.(frame(0));
  fed.asks.get(1)?.(frame(1));
  await settle();
  check(made[1]?.decoding.map((m) => m.index).join() === "0,1", `the new decoder takes them (${made[1].decoding.map((m) => m.index)})`);
  check(failed().length === 0, `nothing fails (${failed().map((m) => m.reason)})`);
}
await aCrashIsRecovered();

/** A decoded frame the page has not acknowledged is asked again when the page reports an unreadable delivery; one it acknowledged is not. */
async function anUnreadDeliveryIsRecovered() {
  const { fed, made } = await lossWorld("undelivered");
  fed.fill(frame(0));
  fed.fill(frame(1));
  await settle();
  const first = made[0].finish();
  const second = made[0].finish();
  await onmessage({ data: { kind: "ack", index: first.index, gen: first.gen } });
  await onmessage({ data: { kind: "undelivered", decoder: 0 } });
  await settle();
  check(made[0].terminated && made.length === 2, `the decoder is replaced (${made.length} made)`);
  check(fed.asks.has(second.index) && !fed.asks.has(first.index), `only the unacknowledged frame is asked again (${[...fed.asks.keys()]})`);
}
await anUnreadDeliveryIsRecovered();

/** A decode that never answers is cut off at `decodeMs`: the decoder is replaced and both frames it held are asked again. */
async function aHangIsRecovered() {
  const { fed, made } = await lossWorld("hang", { decodeMs: 30, stallMs: 60_000 });
  fed.fill(frame(0));
  fed.fill(frame(1));
  await settle();
  await new Promise((r) => setTimeout(r, 60));
  check(made[0].terminated && made.length === 2, `the hung decoder is replaced (${made.length} made)`);
  check(fed.asks.has(0) && fed.asks.has(1), `both frames it held are asked again (${[...fed.asks.keys()]})`);
}
await aHangIsRecovered();

/** A frame lost twice fails by name, through `failed`, and is not asked a third time. */
async function lostTwiceFailsLoudly() {
  const { fed, made, failed } = await lossWorld("twice");
  fed.fill(frame(0));
  await settle();
  made[0].crash();
  await settle();
  fed.asks.get(0)(frame(0));
  await settle();
  const asked = fed.asks.size;
  made[1].crash();
  await settle();
  check(failed().some((m) => m.index === 0 && /crashed/.test(m.reason)), `frame 0 fails by name (${failed().map((m) => `${m.index}: ${m.reason}`)})`);
  check(fed.asks.size === asked, `and is not asked again (${fed.asks.size} asks, not ${asked})`);
}
await lostTwiceFailsLoudly();

/**
 * A frame the page has is never failed: handed to the page, its decoder lost before the page's ack is back and the
 * next decoder lost too, it reaches `onFrame` alone, and the frame those decoders were lost on fails by name.
 */
async function aDeliveredFrameIsNotFailed() {
  const fed = handFed();
  const decoders = handDecoders();
  const Decoder = globalThis.Worker;
  const acks = [];
  let page;
  globalThis.Worker = class {
    constructor(url) {
      if (url !== "downloader") return new Decoder();
      page = this;
    }
    postMessage(m) {
      if (m.kind === "ack") acks.push(m);
      else onmessage({ data: m });
    }
    terminate() {}
  };
  globalThis.MessageChannel = class {
    port1 = { postMessage: (m) => this.port2.onmessage({ data: m }) };
    port2 = {};
  };
  globalThis.postMessage = (m) => page.onmessage({ data: m });
  globalThis.crossOriginIsolated = true;
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // delivered`;
  await import("./downloader.js?delivered");
  const { DownloaderClient } = await import("./consumer.js");
  const got = [];
  const failures = [];
  const c = await DownloaderClient.connect("https://x.invalid/", "ab", {
    worker: "downloader", decoders: 1, perDecoder: 2, transport, decoderWorker: "x", survival: false,
    onFrame: (f) => got.push(f.frameIndex), onError: (f) => failures.push(f),
  });
  c.fill([0, 1]);
  await settle();
  fed.fill(frame(0));
  fed.fill(frame(1));
  await settle();
  decoders[0].finish();
  decoders[0].crash();
  await settle();
  fed.asks.get(0)?.(frame(0));
  fed.asks.get(1)?.(frame(1));
  await settle();
  decoders[1].crash();
  await settle();
  for (const m of acks.splice(0)) await onmessage({ data: m });
  const failed = failures.map((f) => `${f.frameIndex}: ${f.reason}`);
  check(got.join() === "0" && failures.length === 1 && failures[0].frameIndex === 1 && /crashed/.test(failures[0].reason),
    `frame 0 is delivered and not failed, frame 1 fails by name (delivered ${got}; failed ${failed})`);
  c.close();
  globalThis.postMessage = (m) => posted.push(m);
}
await aDeliveredFrameIsNotFailed();

/** A frame asked, cancelled before it arrives and asked again reaches the new ask: the session still owes the first, and refuses a second. */
async function anAskAgainAfterACancelIsServed() {
  const owed = new Map();
  globalThis.fakeTransport = {
    connect: async () => ({
      requestExactFrame: async (i) => {
        if (owed.has(i)) throw new Error(`frame ${i} already requested`);
        return new Promise((resolve) => owed.set(i, (f) => (owed.delete(i), resolve(f))));
      },
      stats: () => ({ closed: null, lastByteAt: performance.now() }),
      fillFrames() {},
      endStream: async () => {},
      close() {},
    }),
  };
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // again`;
  await import("./downloader.js?again");
  await onmessage({ data: { kind: "start", config: { decode: false, decoders: 0, transport, survival: false } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
  posted.length = 0;
  await onmessage({ data: { kind: "ask", index: 5 } });
  await onmessage({ data: { kind: "cancel" } });
  await onmessage({ data: { kind: "ask", index: 5 } });
  owed.get(5)?.(frame(5));
  await settle();
  check(!posted.some((m) => m.kind === "failed"), `asked again after a cancel, it is not refused (${posted.find((m) => m.kind === "failed")?.reason})`);
  check(posted.some((m) => m.kind === "frame" && m.index === 5 && m.gen === 1), `the new generation gets frame 5 (${posted.map((m) => `${m.kind} ${m.index ?? ""} ${m.gen}`).join(", ")})`);
}
await anAskAgainAfterACancelIsServed();

/**
 * After an ask during a fill, the remainder is re-issued exactly once: on the asked frame's head under `refill: "head"`,
 * the default, right behind the ask under `refill: "ask"`, when the ask lands under `refill: "landed"`.
 */
async function theRemainderIsReissuedOnce() {
  const want = { landed: ["", "", "3-6"], head: ["", "3-6", "3-6"], ask: ["3-6", "3-6", "3-6"], default: ["", "3-6", "3-6"] };
  for (const [refill, expected] of Object.entries(want)) {
    const fills = [];
    const asks = new Map();
    let onFrame;
    globalThis.fakeTransport = {
      connect: async () => ({
        requestExactFrame: (i, onHead) => new Promise((resolve) => asks.set(i, { resolve, onHead })),
        stats: () => ({ closed: null, lastByteAt: performance.now() }),
        fillFrames: (from, to, f) => {
          fills.push(`${from}-${to}`);
          onFrame = f;
        },
        endStream: async () => {},
        close() {},
      }),
    };
    const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // ${refill}`;
    await import(`./downloader.js?refill-${refill}`);
    const config = { decode: false, decoders: 0, transport, survival: false, refill: refill === "default" ? undefined : refill };
    await onmessage({ data: { kind: "start", config } });
    await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
    await onmessage({ data: { kind: "fill", indices: [...Array(8).keys()] } });
    for (const i of [0, 1, 2]) onFrame(frame(i));
    await onmessage({ data: { kind: "ask", index: 7 } });
    await settle();
    const seen = [fills.slice(1).join()];
    asks.get(7).onHead?.();
    seen.push(fills.slice(1).join());
    asks.get(7).resolve(frame(7));
    await settle();
    seen.push(fills.slice(1).join());
    check(seen.join("|") === expected.join("|"), `refill ${refill}: remainders after the ask, its head, its landing: ${seen.join(" | ")}, not ${expected.join(" | ")}`);
  }
}
await theRemainderIsReissuedOnce();

/**
 * The downloader keeps each decoder's end of its pixel channel reachable for the decoder's life: Firefox deletes
 * the frames in flight through a transferred port once the sender's object is collected.
 */
async function portsOutliveCollection() {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc");
  // Plain objects stand in for the ports: Node keeps its own entangled ports alive whatever the downloader holds.
  globalThis.MessageChannel = class {
    port1 = {};
    port2 = {};
  };
  const ports = [];
  globalThis.Worker = class {
    postMessage(m) {
      if (m.kind !== "init") return;
      ports.push(new WeakRef(m.toConsumer));
      queueMicrotask(() => this.onmessage({ data: { kind: "ready" } }));
    }
  };
  await import("./downloader.js?ports");
  await onmessage({ data: { kind: "start", config: { decoders: 3, decoderWorker: "x", survival: false } } });
  posted.length = 0;
  for (let i = 0; i < 5; i++) {
    await settle();
    gc();
  }
  const alive = ports.filter((p) => p.deref() !== undefined).length;
  check(ports.length === 3 && alive === 3, `${alive} of ${ports.length} decoders' ports survive a collection, not 3 of 3`);
}
await portsOutliveCollection();

/** A transport that serves asks in the order they were sent, as the server does, when the test says so; fills are only recorded. */
function servedInOrder() {
  const w = { fills: [], asks: [], owed: [], onFill: null };
  globalThis.fakeTransport = {
    connect: async () => ({
      requestExactFrame: (i) => new Promise((resolve) => (w.asks.push(i), w.owed.push(() => resolve(frame(i))))),
      stats: () => ({ closed: null, lastByteAt: performance.now() }),
      fillFrames: (from, to, onFrame) => (w.fills.push([from, to]), (w.onFill = onFrame)),
      endStream: async () => {},
      releaseWireBuffer() {},
      close() {},
    }),
  };
  w.serveOne = async () => (w.owed.shift()(), await settle());
  return w;
}

async function wantWorld(name, config) {
  const w = servedInOrder();
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // ${name}`;
  await import(`./downloader.js?${name}`);
  await onmessage({ data: { kind: "start", config: { transport, survival: false, ...config } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
  posted.length = 0;
  return w;
}

/** A want nearest-first from frame 40: its first D_min misses go out as asks in its order, topped up as each lands, and arrive in its order. */
async function aWantArrivesInItsOrder() {
  const w = await wantWorld("want-order", { decode: false, decoders: 0 });
  const want = [40];
  for (let d = 1; want.length < 76; d++) for (const i of [40 + d, 40 - d]) if (i >= 0 && i < 76) want.push(i);
  await onmessage({ data: { kind: "want", indices: want } });
  check(w.asks.join() === want.slice(0, 4).join() && w.fills.length === 0, `the first asks are the want's first 4 (${w.asks}, runs ${JSON.stringify(w.fills)})`);
  let deepest = 0;
  while (w.owed.length) {
    deepest = Math.max(deepest, w.owed.length);
    await w.serveOne();
  }
  const order = posted.filter((m) => m.kind === "frame").map((m) => m.index);
  check(order.join() === want.join(), `frames arrive in the want's order (${order.slice(0, 8)} …)`);
  check(deepest === 4, `at most D_min asks owed at once, and D_min reached (${deepest})`);
  w.asks.length = 0;
  await onmessage({ data: { kind: "want", indices: [10, 11, 12, 13, 14, 15] } });
  check(JSON.stringify(w.fills) === "[[10,15]]" && w.asks.length === 0, `an ascending want is one run (${JSON.stringify(w.fills)}, asks ${w.asks})`);
  w.onFill(frame(10));
  await onmessage({ data: { kind: "want", indices: [30, 31, 32] } });
  check(w.fills.length === 1, `a want ascending fewer than D_min frames, or behind a run, is no new run (${JSON.stringify(w.fills)})`);
}
await aWantArrivesInItsOrder();

/**
 * A want replaced while its run is decoding and in flight: no index is dispatched to a decoder twice or in a new
 * generation, no frame the run delivered is asked again, and nothing is cancelled or failed.
 */
async function aReplacedWantKeepsWhatIsOwed() {
  const dispatched = new Map();
  const decoders = [];
  globalThis.Worker = class {
    constructor() {
      this.decoding = [];
      decoders.push(this);
    }
    postMessage(m) {
      if (m.kind === "init") queueMicrotask(() => this.onmessage({ data: { kind: "ready" } }));
      if (m.kind === "decode") {
        this.decoding.push(m);
        dispatched.set(m.index, [...(dispatched.get(m.index) ?? []), m.gen]);
      }
    }
    terminate() {}
  };
  const w = await wantWorld("want-replaced", { decoders: 2, perDecoder: 2, decoderWorker: "x" });
  const ten = [...Array(10).keys()];
  await onmessage({ data: { kind: "want", indices: ten } });
  for (const i of [0, 1, 2, 3]) w.onFill(frame(i));
  await settle();
  // The view moves to frame 7 and wants 10 next: 0–3 are decoding, 4 and 5 already in flight.
  await onmessage({ data: { kind: "want", indices: [7, 10, 6, 8, 5, 9, 4, 3, 2, 1, 0] } });
  check(w.asks.join() === "7,10", `the head and what the old run did not hold are asked, while that run may still be in flight (${w.asks})`);
  w.onFill(frame(4));
  w.onFill(frame(5));
  await settle();
  await w.serveOne();
  check(w.asks.join() === "7,10,6,8,9", `once the head lands, the run's unsent frames are asked in the want's order (${w.asks})`);
  while (w.owed.length) await w.serveOne();
  await onmessage({ data: { kind: "want", indices: [3, 2, 1, 0] } });
  for (let busy = true; busy; ) {
    busy = false;
    for (const d of decoders) {
      const m = d.decoding.shift();
      if (!m) continue;
      busy = true;
      d.onmessage({ data: { kind: "done", index: m.index, gen: m.gen } });
      await onmessage({ data: { kind: "ack", index: m.index, gen: m.gen } });
    }
    await settle();
  }
  const once = [...ten, 10].every((i) => dispatched.get(i)?.join() === "0");
  check(once, `each index dispatched once, in generation 0 (${JSON.stringify(Object.fromEntries(dispatched))})`);
  check(JSON.stringify(w.fills) === "[[0,9]]" && w.asks.every((i) => i > 5), `the run once, and no frame it delivered asked again (runs ${JSON.stringify(w.fills)}, asks ${w.asks})`);
  check(!posted.some((m) => m.kind === "cancelled" || m.kind === "failed"), `nothing cancelled or failed (${posted.map((m) => m.kind)})`);
}
await aReplacedWantKeepsWhatIsOwed();

console.log(failed ? `${failed} failed` : "downloader decoder count, timed-out ask, start on need, lost decodes, an ask again after a cancel, refill points, ports held, a want's order and its replacement: ok");
process.exit(failed ? 1 : 0);
