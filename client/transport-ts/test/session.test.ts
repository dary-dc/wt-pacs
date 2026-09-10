/**
 * Claims: startStreamFrames queues the ask before any waiter timer;
 * media that arrives before waitExactFrame is still delivered;
 * createBidirectionalStream is not gated on ready.
 * Mutate: arm every waiter before sendFod — "ask before any timer" fails.
 * Mutate: drop unexpected media — early-media delivery fails.
 * Mutate: await transport.ready before createBidirectionalStream — ready-gate fails.
 */

import { TransportSession } from "../session.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

function mediaFrame(index: number, payload: Uint8Array): Uint8Array {
  const envelope = new Uint8Array(4 + payload.length);
  new DataView(envelope.buffer).setUint32(0, index, false);
  envelope.set(payload, 4);
  const framed = new Uint8Array(4 + envelope.length);
  new DataView(framed.buffer).setUint32(0, envelope.length, false);
  framed.set(envelope, 4);
  return framed;
}

function encodeFod(msg: object): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(msg));
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}

type Fake = {
  transport: WebTransport;
  written: Uint8Array[];
  timeoutsAtWrite: number | null;
  bidiBeforeReady: boolean;
  resolveReady: () => void;
  pushUni: (bytes: Uint8Array) => void;
  pushControl: (bytes: Uint8Array) => void;
};

function makeFake(): Fake {
  let uniCtl: ReadableStreamDefaultController<ReadableStream<Uint8Array>>;
  const incomingUnidirectionalStreams = new ReadableStream<ReadableStream<Uint8Array>>({
    start(c) {
      uniCtl = c;
    },
  });
  let controlCtl: ReadableStreamDefaultController<Uint8Array>;
  const controlReadable = new ReadableStream<Uint8Array>({
    start(c) {
      controlCtl = c;
    },
  });
  const written: Uint8Array[] = [];
  let timeoutsAtWrite: number | null = null;
  let readyResolved = false;
  let resolveReady = () => {};
  const ready = new Promise<void>((r) => {
    resolveReady = () => {
      readyResolved = true;
      r();
    };
  });
  let bidiBeforeReady = false;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(chunk);
      timeoutsAtWrite = timeoutCount;
    },
  });
  const transport = {
    ready,
    incomingUnidirectionalStreams,
    createBidirectionalStream() {
      if (!readyResolved) bidiBeforeReady = true;
      return Promise.resolve({ writable, readable: controlReadable });
    },
    close() {
      try {
        uniCtl.close();
      } catch {
        /* closed */
      }
      try {
        controlCtl.close();
      } catch {
        /* closed */
      }
    },
  };
  return {
    transport: transport as unknown as WebTransport,
    written,
    get timeoutsAtWrite() {
      return timeoutsAtWrite;
    },
    get bidiBeforeReady() {
      return bidiBeforeReady;
    },
    resolveReady,
    pushUni(bytes) {
      uniCtl.enqueue(
        new ReadableStream({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      );
    },
    pushControl(bytes) {
      controlCtl.enqueue(bytes);
    },
  };
}

let timeoutCount = 0;
const realSetTimeout = globalThis.setTimeout;
function installTimeoutTap() {
  timeoutCount = 0;
  globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
    timeoutCount += 1;
    return realSetTimeout(fn, ms, ...a);
  }) as typeof setTimeout;
}
function restoreTimeoutTap() {
  globalThis.setTimeout = realSetTimeout;
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => realSetTimeout(r, 0));
}

async function testReadyNotGated() {
  const fake = makeFake();
  const p = TransportSession.connect("https://example.test", "ab", fake.transport);
  const session = await Promise.race([
    p,
    new Promise<never>((_, reject) =>
      realSetTimeout(() => reject(new Error("connect waited for ready")), 50),
    ),
  ]);
  assert(fake.bidiBeforeReady, "createBidirectionalStream before ready resolves");
  session.close();
}

async function testAskBeforeTimers() {
  installTimeoutTap();
  try {
    const fake = makeFake();
    const session = await TransportSession.connect("https://example.test", "ab", fake.transport);
    await settle();
    session.startStreamFrames(2000);
    await settle();
    assert(fake.written.length === 1, "startStreamFrames writes one FoD");
    assert(fake.timeoutsAtWrite === 0, `ask queued before any timer (got ${fake.timeoutsAtWrite})`);
    assert(timeoutCount === 0, `startStreamFrames arms no timers (got ${timeoutCount})`);
    session.close();
  } finally {
    restoreTimeoutTap();
  }
}

async function testEarlyMedia() {
  const fake = makeFake();
  const session = await TransportSession.connect("https://example.test", "ab", fake.transport);
  await settle();
  const askMs = session.startStreamFrames(2);
  const payload = new Uint8Array([9, 8, 7]);
  fake.pushUni(mediaFrame(0, payload));
  await settle();
  const r = await session.waitExactFrame(0, askMs);
  assert(r.frameIndex === 0, "early media keeps the index");
  assert(r.bytes.length === 3 && r.bytes[0] === 9, "early media delivers the codestream");
  assert(session.stats().droppedEarlyMedia === 0, "early media is not dropped");
  session.close();
}

async function testRefusalBeforeWait() {
  const fake = makeFake();
  const session = await TransportSession.connect("https://example.test", "ab", fake.transport);
  await settle();
  const askMs = session.startExactFrames([3]);
  fake.pushControl(encodeFod({ op: "frame_error", frame_index: 3, reason: "out of range" }));
  await settle();
  let msg = "";
  try {
    await session.waitExactFrame(3, askMs);
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  assert(/unavailable/.test(msg), `refusal before wait is immediate (got ${msg})`);
  session.close();
}

function armAllThenWrite(n: number): number {
  const t0 = performance.now();
  const waiters = new Map<number, ReturnType<typeof setTimeout>>();
  for (let i = 0; i <= n; i++) {
    const timer = realSetTimeout(() => {}, 15_000);
    waiters.set(i, timer);
  }
  const ms = performance.now() - t0;
  for (const timer of waiters.values()) clearTimeout(timer);
  return ms;
}

async function measureInterleaved() {
  const n = 8000;
  const oldMs: number[] = [];
  const newMs: number[] = [];
  for (let rep = 0; rep < 6; rep++) {
    const order = rep % 2 === 0 ? (["old", "new"] as const) : (["new", "old"] as const);
    for (const arm of order) {
      if (arm === "old") {
        oldMs.push(armAllThenWrite(n));
      } else {
        const fake = makeFake();
        const session = await TransportSession.connect("https://example.test", "ab", fake.transport);
        await settle();
        const t0 = performance.now();
        session.startStreamFrames(n);
        const ms = performance.now() - t0;
        newMs.push(ms);
        session.close();
      }
    }
  }
  oldMs.sort((a, b) => a - b);
  newMs.sort((a, b) => a - b);
  const med = (a: number[]) => a[Math.floor(a.length / 2)];
  console.log(
    `measure n=${n} interleaved old_arm_ms=[${oldMs.map((x) => x.toFixed(2))}] ` +
      `new_start_ms=[${newMs.map((x) => x.toFixed(2))}] ` +
      `old_p50=${med(oldMs).toFixed(2)} new_p50=${med(newMs).toFixed(2)}`,
  );
  assert(med(newMs) < med(oldMs), "new startStreamFrames is faster than arm-all-then-write");
}

await testReadyNotGated();
await testAskBeforeTimers();
await testEarlyMedia();
await testRefusalBeforeWait();
await measureInterleaved();

if (failed) {
  throw new Error(`${failed} FAIL`);
}
console.log("session tests ok");
