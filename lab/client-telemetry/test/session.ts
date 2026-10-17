/**
 * Tests for the recorder around the TypeScript client, against its Node stub — run with:
 *   bash lab/client-telemetry/build.sh && node lab/client-telemetry/test/session.mjs
 */

import { install, uninstall } from "../install.ts";
import { getTap } from "../tap.ts";
import { wrapSession } from "../wrap-session.ts";
import { TransportSession } from "../../../client/transport/ts/session.ts";
import { codestreamByte, StubTransport } from "../../../client/transport/ts/test/stub.ts";

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

const intact = (r: { frameIndex: number; bytes: Uint8Array }) => r.bytes.every((b, i) => b === codestreamByte(r.frameIndex, i));
const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Under the telemetry patch a `readMin` session still reads with its view and `{min}`: every
 *  frame arrives bit-exact, and the Tap closes a row for each. */
async function telemetryKeepsTheReadersArguments() {
  const tap = install({ client: "transport-ts" });
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

for (const t of [telemetryKeepsTheReadersArguments, telemetryOpensRowsForAnOpeningFill]) {
  await t();
}
console.log(failed === 0 ? "all tests passed" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
