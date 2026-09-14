/**
 * Tests for the TypeScript client's ask window, against the Node stub — run with:
 *   bash client/transport-ts/build.sh && node client/transport-ts/test/run.mjs
 */

import { TransportSession } from "../session.ts";
import { StubTransport, type StubLink } from "./stub.ts";

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
  assert(stub.maxInFlight <= want + 1, `auto: never more than ${want + 1} in flight, saw ${stub.maxInFlight}`);
  assert(inOrder(stub.askOrder), "auto: asks sent in order");
}

/** Without the transport's RTT, `auto` holds its initial depth rather than guess. */
async function autoWithoutStatsHolds() {
  const { session, stub } = await drive({ rttMs: 40, tfMs: 6, bytes: 16 }, 48, { window: { depth: "auto", initial: 2 } });
  assert(session.stats().windowDepth === 2, "auto without getStats: depth stays 2");
  assert(stub.maxInFlight === 2, `auto without getStats: 2 in flight, saw ${stub.maxInFlight}`);
}

for (const t of [noWindowIsUnchanged, fixedDepthCapsInFlight, autoDepthFindsTheLink, autoWithoutStatsHolds]) {
  await t();
}
console.log(failed === 0 ? "all tests passed" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
