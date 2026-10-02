/**
 * Tests for the TypeScript client's ask window, against the Node stub — run with:
 *   bash client/transport-ts/build.sh && node client/transport-ts/test/run.mjs
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

async function drive(link: StubLink, asks: number, window?: Parameters<typeof TransportSession.connect>[2]) {
  StubTransport.link = link;
  const session = await TransportSession.connect("https://stub/", HASH, window);
  const stub = StubTransport.last!;
  const results = await Promise.all(
    Array.from({ length: asks }, (_, i) => session.requestExactFrame(i)),
  );
  return { session, stub, results };
}

function inOrder(v: number[]): boolean {
  return v.every((x, i) => i === 0 || v[i - 1] < x);
}

/** Without a window every ask goes out at once, as before. */
async function noWindowIsUnchanged() {
  const { stub, results } = await drive({ rttMs: 20, tfMs: 2, bytes: 16 }, 6);
  assert(stub.maxInFlight === 6, `no window: 6 asks in flight, saw ${stub.maxInFlight}`);
  assert(results.length === 6 && inOrder(results.map((r) => r.frameIndex)), "no window: all frames, in order");
}

/** A fixed depth caps the asks in flight and keeps ask order. */
async function fixedDepthCapsInFlight() {
  const { stub, results, session } = await drive({ rttMs: 20, tfMs: 2, bytes: 16 }, 12, { window: { depth: 3 } });
  assert(stub.maxInFlight === 3, `depth 3: at most 3 in flight, saw ${stub.maxInFlight}`);
  assert(inOrder(stub.askOrder) && stub.askOrder.length === 12, "depth 3: asks sent in order");
  assert(results.length === 12, "depth 3: every queued ask is answered");
  assert(session.stats().windowDepth === 3, "depth 3: reported");
}

/** `auto` climbs from its initial depth to the smallest that saturates the link, ±1. */
async function autoDepthFindsTheLink() {
  const link = { rttMs: 40, tfMs: 6, bytes: 16, stats: true };
  const want = Math.ceil(0.95 * (1 + link.rttMs / link.tfMs));
  const { stub, session } = await drive(link, 200, { window: { depth: "auto", initial: 2 } });
  const d = session.stats().windowDepth ?? 0;
  assert(Math.abs(d - want) <= 1, `auto: depth ${d} within 1 of ${want}`);
  assert(stub.maxInFlight <= 16, `auto: never past the clamp, saw ${stub.maxInFlight}`);
  assert(stub.maxInFlight >= want - 1, `auto: opened up to the link, saw ${stub.maxInFlight} for want ${want}`);
  assert(inOrder(stub.askOrder), "auto: asks sent in order");
}

/**
 * Without the transport's RTT and without a pause the only idle ask is the session's first,
 * whose trip carries the warm-up, so `auto` holds its initial depth rather than trust it.
 */
async function autoWithoutStatsHoldsWithoutAPause() {
  const { session, stub } = await drive({ rttMs: 40, tfMs: 6, bytes: 16 }, 200, { window: { depth: "auto", initial: 2 } });
  assert(session.stats().windowDepth === 2, "auto without getStats, no pause: depth stays 2");
  assert(stub.maxInFlight === 2, `auto without getStats, no pause: 2 in flight, saw ${stub.maxInFlight}`);
}

/** Without the transport's RTT, a reader that pauses gives `auto` idle asks to read the RTT from. */
async function autoWithoutStatsReadsIdleAsks() {
  const link = { rttMs: 40, tfMs: 6, bytes: 16 };
  const want = Math.ceil(0.95 * (1 + link.rttMs / link.tfMs));
  StubTransport.link = link;
  const session = await TransportSession.connect("https://stub/", HASH, { window: { depth: "auto", initial: 2 } });
  let frame = 0;
  for (let burst = 0; burst < 12; burst++) {
    await Promise.all(Array.from({ length: 16 }, () => session.requestExactFrame(frame++)));
    await new Promise((r) => setTimeout(r, 30));
  }
  const d = session.stats().windowDepth ?? 0;
  assert(Math.abs(d - want) <= 1, `auto without getStats, bursts with pauses: depth ${d} within 1 of ${want}`);
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

for (const t of [noWindowIsUnchanged, fixedDepthCapsInFlight, autoDepthFindsTheLink, autoWithoutStatsHoldsWithoutAPause, autoWithoutStatsReadsIdleAsks,
  readWholeTakesTwoReadsAFrame, readMinBoundsEachRead, readMinWithoutByobFallsBack, aCutFrameIsNamedWithItsBytes]) {
  await t();
}
console.log(failed === 0 ? "all tests passed" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
