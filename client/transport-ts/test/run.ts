/**
 * Tests for the TypeScript client's asks and reads, against the Node stub — run with:
 *   bash client/transport-ts/build.sh && node client/transport-ts/test/run.mjs
 */

import { install, uninstall } from "../../record/install.ts";
import { getTap } from "../../record/tap.ts";
import { wrapSession } from "../../record/wrap-session.ts";
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

const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Under the telemetry patch a `readMin` session still reads with its view and `{min}`: every
 *  frame arrives bit-exact, and the Tap closes a row for each. */
async function telemetryKeepsTheReadersArguments() {
  const tap = install({ arm: "transport-ts" });
  try {
    StubTransport.link = { rttMs: 0, tfMs: 0, bytes: 64_000, chunk: 1000 };
    const session = wrapSession(await TransportSession.connect("https://stub/", HASH, { readMin: 16_384 }));
    const results = await Promise.all([0, 1, 2].map((i) => within(session.requestExactFrame(i), 2000)));
    assert(results.every((r) => r !== null && intact(r)), "telemetry + readMin: every frame delivered bit-exact");
    const report = tap.finish();
    const closed = report.client_frames.filter((r) => r.closed_at === "delivered").length;
    assert(closed === 3 && report.summary.integrity.valid === true,
      `telemetry + readMin: the Tap closes a row per frame (${closed} of 3, ${report.summary.integrity.invalid_reasons?.join("; ") || "valid"})`);
  } finally {
    uninstall();
  }
}

/** An opening fill rides the session URL, yet the Tap opens a row per frame and drops none. */
async function telemetryOpensRowsForAnOpeningFill() {
  StubTransport.link = { rttMs: 0, tfMs: 0, bytes: 1000 };
  // Imported here: it patches WebTransport when it loads, and must find the stub there.
  const { TransportSession: Telemetry } = await import("../session-telemetry.ts");
  const got: number[] = [];
  await Telemetry.connect("https://stub/", HASH, { fill: { from: 0, to: 2, onFrame: (f) => got.push(f.frameIndex), onError: () => {} } });
  const t0 = Date.now();
  while (got.length < 3 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
  const report = getTap()!.finish();
  assert(got.length === 3, `opening fill under telemetry: every frame delivered (${got.length}/3)`);
  assert(report.client_frames.length === 3 && report.summary.integrity.rows_dropped === 0,
    `opening fill under telemetry: a row per frame and none dropped (${report.client_frames.length} rows, ${report.summary.integrity.rows_dropped} dropped)`);
  uninstall();
}

for (const t of [everyAskGoesOutAtOnce, readWholeTakesTwoReadsAFrame, readMinBoundsEachRead, readMinWithoutByobFallsBack, aCutFrameIsNamedWithItsBytes, telemetryKeepsTheReadersArguments, telemetryOpensRowsForAnOpeningFill]) {
  await t();
}
console.log(failed === 0 ? "all tests passed" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
