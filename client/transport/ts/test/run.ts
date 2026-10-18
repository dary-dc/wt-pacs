/**
 * Tests for the TypeScript client's asks and reads, against the Node stub — run with:
 *   bash client/transport/ts/build.sh && node client/transport/ts/test/run.mjs
 */

import { TransportSession } from "../session.ts";
import { codestreamByte, StubTransport, type StubLink } from "./stub.ts";

(globalThis as { WebTransport?: unknown }).WebTransport = StubTransport;
const HASH = "00".repeat(32);

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

async function drive(link: StubLink, asks: number, options?: Parameters<typeof TransportSession.connect>[2]) {
  StubTransport.link = link;
  const session = await TransportSession.connect("https://stub/", HASH, options);
  const stub = StubTransport.last!;
  const results = await Promise.all(
    Array.from({ length: asks }, (_, i) => session.requestExactFrame(i)),
  );
  return { session, stub, results };
}

function inOrder(v: number[]): boolean {
  return v.every((x, i) => i === 0 || v[i - 1] < x);
}

/** Every ask goes out at once, and every frame comes back in ask order. */
async function everyAskGoesOutAtOnce() {
  const { stub, results } = await drive({ rttMs: 20, tfMs: 2, bytes: 16 }, 6);
  assert(stub.maxInFlight === 6, `6 asks in flight, saw ${stub.maxInFlight}`);
  assert(results.length === 6 && inOrder(results.map((r) => r.frameIndex)), "all frames, in order");
}

const intact = (r: { frameIndex: number; bytes: Uint8Array }) => r.bytes.every((b, i) => b === codestreamByte(r.frameIndex, i));

/** A frame dribbled in 1 KB pieces takes one read a piece by default, and two — head, body — read whole. */
async function readWholeTakesTwoReadsAFrame() {
  const link = { rttMs: 0, tfMs: 0, bytes: 64_000, chunk: 1000 };
  const plain = await drive(link, 3);
  const whole = await drive(link, 3, { readMin: 1 << 30 });
  const reads = (d: typeof plain) => d.session.stats().mediaReads;
  assert(reads(plain) >= 3 * 64, `default reader: a read a piece, saw ${reads(plain)} for 3 frames`);
  assert(reads(whole) === 6, `readMin whole: 2 reads a frame, saw ${reads(whole)} for 3 frames`);
  assert(whole.results.every(intact), "readMin whole: every frame bit-exact");
}

/** At 16 KB a read, a 64 000-byte body resolves in 4 reads of at least 16 384, the last the rest. */
async function readMinBoundsEachRead() {
  const { session, results } = await drive({ rttMs: 0, tfMs: 0, bytes: 64_000, chunk: 1000 }, 3, { readMin: 16_384 });
  const reads = session.stats().mediaReads;
  assert(reads === 15, `readMin 16 KB: a head and 4 body reads a frame, saw ${reads} for 3 frames`);
  assert(results.every(intact), "readMin 16 KB: every frame bit-exact");
}

/** A media stream with no BYOB reader is read the default way under `readMin`, every frame intact. */
async function readMinWithoutByobFallsBack() {
  const { session, results } = await drive({ rttMs: 0, tfMs: 0, bytes: 64_000, chunk: 1000, plain: true }, 3, { readMin: 65_536 });
  assert(results.length === 3 && results.every(intact), "readMin, no BYOB reader: every frame delivered bit-exact");
  assert(session.stats().mediaReads >= 3 * 64, `readMin, no BYOB reader: a read a piece, saw ${session.stats().mediaReads}`);
}

/** A stream cut inside a frame is named truncated with the bytes it carried, whichever reader. */
async function aCutFrameIsNamedWithItsBytes() {
  for (const readMin of [undefined, 1 << 30, 4096]) {
    StubTransport.link = { rttMs: 0, tfMs: 0, bytes: 10_000, chunk: 1000, cutAfter: 5008 };
    const session = await TransportSession.connect("https://stub/", HASH, { readMin });
    const why = await session.requestExactFrame(0).then(() => "delivered", (e) => String(e.message));
    assert(why.includes("truncated: 5000 of 10000 bytes"), `readMin ${readMin}: a cut frame is named, saw "${why}"`);
  }
}

/** Under `readMin` too, an asked frame's `onHead` runs once, with its envelope head read and its body not yet;
 *  the default reader's is client/contract/clauses.ts `onHeadRunsBeforeTheBody`. */
async function onHeadRunsBeforeTheBodyUnderReadMin() {
  StubTransport.link = { rttMs: 0, tfMs: 0, bytes: 64_000, chunk: 1000 };
  const session = await TransportSession.connect("https://stub/", HASH, { readMin: 4096 });
  const heads: number[] = [];
  const r = await session.requestExactFrame(0, () => heads.push(session.stats().mediaReads));
  const reads = session.stats().mediaReads;
  assert(heads.length === 1 && heads[0] < reads / 4 && intact(r), `readMin 4096: one head at read ${heads}, of ${reads}`);
}

/** A control write that fails takes its waiter with it: the same frame asked again is a fresh
 *  ask, not "already requested", and neither it nor a fill leaves a rejection unobserved. */
async function aFailedAskWriteDisarmsItsWaiter() {
  const unobserved: string[] = [];
  const onUnobserved = (e: unknown) => void unobserved.push(String(e));
  process.on("unhandledRejection", onUnobserved);
  StubTransport.link = { rttMs: 0, tfMs: 0, bytes: 16, failWrites: true };
  const session = await TransportSession.connect("https://stub/", HASH);
  const why = (p: Promise<unknown>) => p.then(() => "delivered", (e) => String(e.message));
  const first = await why(session.requestExactFrame(4));
  const again = await why(session.requestExactFrame(4));
  session.fillFrames(0, 1, () => {});
  await new Promise((r) => setTimeout(r, 50));
  process.off("unhandledRejection", onUnobserved);
  assert(/reset/.test(first), `failed ask write: the ask rejects with the write's error, saw "${first}"`);
  assert(/reset/.test(again), `failed ask write: asking again is a fresh ask, saw "${again}"`);
  assert(session.stats().inFlight === 0, `failed ask write: no waiter is left armed (${session.stats().inFlight})`);
  assert(unobserved.length === 0, `failed ask write: no rejection goes unobserved (${unobserved.join("; ") || "none"})`);
}

for (const t of [everyAskGoesOutAtOnce, readWholeTakesTwoReadsAFrame, readMinBoundsEachRead, readMinWithoutByobFallsBack, aCutFrameIsNamedWithItsBytes, onHeadRunsBeforeTheBodyUnderReadMin, aFailedAskWriteDisarmsItsWaiter]) {
  await t();
}
console.log(failed === 0 ? "all tests passed" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
