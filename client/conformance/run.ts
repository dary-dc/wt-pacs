/**
 * The three clauses the transport surface requires and does not state, run against every
 * implementation. docs/proposal-conformance-suite.md says why they are these three.
 *
 *   bash client/transport-ts/build.sh && node client/conformance/run.mjs
 */
import { FakeTransport, installFakeTransport } from "./fake-transport.ts";
import {
  type ConformantSession,
  type Implementation,
  typescriptImpl,
  wasmBuilt,
  wasmImpl,
} from "./adapters.ts";

const CERT = "ab".repeat(32);
// A cancelled fill leaves waiters nothing will ever settle; their eventual timeout is not a
// result, and must not take the process down before the checks are counted.
const strays: string[] = [];
process.on("unhandledRejection", (e) => strays.push(String((e as Error)?.message ?? e)));
const enc = new TextEncoder();
let failed = 0;
let ran = 0;

function check(cond: boolean, what: string) {
  ran += 1;
  if (!cond) {
    console.error(`  FAIL: ${what}`);
    failed += 1;
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));

async function open(impl: Implementation): Promise<ConformantSession> {
  installFakeTransport();
  return impl.connect("https://conformance.invalid/", CERT);
}

/** Timestamps must be real values, not the zeros a missing clock hands back in a worker. */
async function workerSafe(impl: Implementation) {
  const s = await open(impl);
  const pending = s.requestExactFrame(3);
  await settle();
  FakeTransport.last.pushFrame(3, enc.encode("frame-three"));
  const f = await pending;

  check(f.frameIndex === 3, `${impl.name}: frame index round-trips`);
  check(f.timing.askMs > 0, `${impl.name}: askMs is a real clock reading, not 0`);
  check(f.timing.lastChunkMs > 0, `${impl.name}: lastChunkMs is a real clock reading, not 0`);
  check(f.timing.lastChunkMs >= f.timing.askMs, `${impl.name}: the frame arrives at or after the ask`);
  s.close();
}

/** A fill can be stopped without ending the session: the ask goes out and the session survives. */
async function cancellable(impl: Implementation) {
  const s = await open(impl);
  const t = FakeTransport.last;
  s.startStreamFrames(4, { from: 0, to: 4 });
  await settle();
  await s.endStream();
  await settle();

  const ops = t.controlMessages().map((m) => m.op);
  check(ops.includes("stream_frames"), `${impl.name}: the fill was asked for`);
  check(ops.includes("end_stream"), `${impl.name}: end_stream was sent`);
  check(!t.didClose, `${impl.name}: cancelling a fill does not close the session`);

  const after = s.requestExactFrame(9);
  await settle();
  t.pushFrame(9, enc.encode("after-cancel"));
  const f = await after;
  check(
    new TextDecoder().decode(f.bytes) === "after-cancel",
    `${impl.name}: the session still serves a frame after a cancel`,
  );
  s.close();
}

/** A frame's buffer crosses a worker boundary as a move, and takes no sibling with it. */
async function transferable(impl: Implementation) {
  const s = await open(impl);
  const t = FakeTransport.last;
  const a = s.requestExactFrame(1);
  const b = s.requestExactFrame(2);
  await settle();
  t.pushOnOneStream([
    [1, enc.encode("frame-one")],
    [2, enc.encode("frame-two")],
  ]);
  const [f1, f2] = await Promise.all([a, b]);

  const buf = f1.bytes.buffer as ArrayBuffer;
  check(buf.byteLength > 0, `${impl.name}: the frame arrives with a live buffer`);
  structuredClone(buf, { transfer: [buf] });
  check(buf.byteLength === 0, `${impl.name}: transferring the buffer detaches it — a move, not a copy`);
  check(
    f2.bytes.length > 0 && new TextDecoder().decode(f2.bytes) === "frame-two",
    `${impl.name}: transferring one frame does not detach another delivered beside it`,
  );
  s.close();
}

/** A closed session is noticed at once; a live one still owes the frame its full timeout. */
async function noticesClose(impl: Implementation) {
  const closedFirst = await open(impl);
  FakeTransport.last.serverClose(7, "server went away");
  await settle();
  const t0 = performance.now();
  let rejected = false;
  try {
    await closedFirst.requestExactFrame(1);
  } catch {
    rejected = true;
  }
  const ms = performance.now() - t0;
  check(rejected, `${impl.name}: a request against a closed session fails`);
  check(ms < 1000, `${impl.name}: it fails at once (${ms.toFixed(0)} ms), not at FRAME_TIMEOUT_MS`);

  const closedDuring = await open(impl);
  const t = FakeTransport.last;
  const inFlight = closedDuring.requestExactFrame(2);
  await settle();
  const t1 = performance.now();
  t.serverClose(7, "server went away");
  let woke = false;
  try {
    await inFlight;
  } catch {
    woke = true;
  }
  check(woke, `${impl.name}: a request in flight when the session closes is woken`);
  check(
    performance.now() - t1 < 1000,
    `${impl.name}: it is woken at once, not left to time out`,
  );

  // `closed` alone, with the media stream left open: the session object is the signal.
  const quietClose = await open(impl);
  FakeTransport.last.serverClose(7, "server went away", false);
  await settle();
  const t2 = performance.now();
  let noticed = false;
  try {
    await quietClose.requestExactFrame(4);
  } catch {
    noticed = true;
  }
  check(
    noticed && performance.now() - t2 < 1000,
    `${impl.name}: a close is noticed from the session, not only from the stream ending`,
  );

  // The timeout's own case: still alive, frame never arrives. It must NOT fail fast.
  const live = await open(impl);
  const pending = live.requestExactFrame(3);
  let early: unknown = null;
  pending.catch((e) => (early = e));
  await new Promise((r) => setTimeout(r, 300));
  check(early === null, `${impl.name}: a live session still owes the frame its full timeout`);
  live.close();
}

const impls: Implementation[] = [await typescriptImpl()];
if (wasmBuilt()) {
  impls.push(await wasmImpl());
} else {
  console.log("SKIPPED arm: transport-wasm — no pkg/, run client/transport-wasm/build.sh (needs wasm-pack)");
}

for (const impl of impls) {
  console.log(`\n${impl.name}`);
  await workerSafe(impl);
  await cancellable(impl);
  await transferable(impl);
  await noticesClose(impl);
}

if (strays.length) console.log(`\n  ${strays.length} abandoned waiter(s) rejected after their fill was cancelled`);
console.log(
  `\nconformance: ${ran - failed}/${ran} checks passed across ${impls.length} implementation(s)` +
    (impls.length < 2 ? " — one arm was skipped" : ""),
);
// A cancelled fill leaves its waiters armed until FRAME_TIMEOUT_MS; exit rather than wait them out.
process.exit(failed ? 1 : 0);
