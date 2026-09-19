/**
 * What client/record costs when it is installed, against the same client without it.
 *
 * The seam is a patched global `WebTransport`, which is exactly what client/conformance's fake
 * occupies, so this runs in Node with no browser and no server. Three arms, not two: `off` twice.
 * The second `off` is a null control — whatever difference it shows against the first is this
 * rig's resolution, and a telemetry cost smaller than that is not a measurement.
 *
 *   bash client/transport-ts/build.sh && node lab/telemetry-cost/cost.mjs
 */
import { FakeTransport, installFakeTransport } from "../../client/conformance/fake-transport.ts";
import { typescriptImpl, wasmBuilt, wasmImpl } from "../../client/conformance/adapters.ts";
import { install, uninstall } from "../../client/record/install.ts";

const CERT = "ab".repeat(32);
const ROUNDS = Number(process.env.ROUNDS ?? 7);
const WARMUP = Number(process.env.WARMUP ?? 2); // the JIT is still moving after one round
const CHUNKS = Number(process.env.CHUNKS ?? 1); // a real link delivers a frame in many reads
const IMPL = process.env.IMPL ?? "transport-ts";
const impl = IMPL === "transport-wasm" ? await wasmImpl() : await typescriptImpl();
const ARMS = ["off", "on", "off2"] as const;
type Arm = (typeof ARMS)[number];

const median = (a: number[]) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const range = (a: number[]): [number, number] => [Math.min(...a), Math.max(...a)];

/** One run: `count` frames of `size` bytes through a whole session. Returns µs per frame. */
async function oneRun(arm: Arm, count: number, size: number, chunks: number): Promise<number> {
  installFakeTransport();
  if (arm === "on") install({ arm: IMPL as "transport-ts", patch: true });

  const session = await impl.connect("https://telemetry-cost.invalid/", CERT);
  const payload = new Uint8Array(size).fill(7);

  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    const pending = session.requestExactFrame(i);
    FakeTransport.last.pushFrameInChunks(i, payload, chunks);
    const frame = await pending;
    if (frame.bytes.length !== size) throw new Error(`frame ${i}: ${frame.bytes.length} != ${size}`);
  }
  const us = ((performance.now() - t0) * 1000) / count;

  session.close();
  if (arm === "on") uninstall();
  return us;
}

async function cell(label: string, count: number, size: number, chunks = CHUNKS) {
  const got: Record<Arm, number[]> = { off: [], on: [], off2: [] };
  for (let round = 0; round < ROUNDS; round++) {
    const shift = round % ARMS.length;
    for (const arm of [...ARMS.slice(shift), ...ARMS.slice(0, shift)]) {
      const us = await oneRun(arm, count, size, chunks);
      if (round >= WARMUP) got[arm].push(us);
    }
  }
  const n = ROUNDS - WARMUP;
  const overhead = median(got.on) - median(got.off);
  const noise = median(got.off2) - median(got.off);
  const worse = got.on.filter((v, i) => v > got.off[i]).length;
  const nullWorse = got.off2.filter((v, i) => v > got.off[i]).length;
  const [ol, oh] = range(got.on);
  const [fl, fh] = range(got.off);
  console.log(
    `  ${label.padEnd(16)} ${median(got.off).toFixed(1).padStart(7)} [${fl.toFixed(1)}-${fh.toFixed(1)}]` +
      `   ${median(got.on).toFixed(1).padStart(7)} [${ol.toFixed(1)}-${oh.toFixed(1)}]` +
      `   ${(overhead >= 0 ? "+" : "") + overhead.toFixed(1)} µs`.padStart(12) +
      `   ${worse}/${n}` +
      `   ${(noise >= 0 ? "+" : "") + noise.toFixed(1)} µs ${nullWorse}/${n}`,
  );
  return { overhead, noise, worse, nullWorse, n, perFrameOff: median(got.off) };
}

if (IMPL === "transport-wasm" && !wasmBuilt()) {
  console.error("transport-wasm has no pkg/ — run client/transport-wasm/build.sh");
  process.exit(2);
}
console.log(`${impl.name}: ${ROUNDS - WARMUP} timed rounds after ${WARMUP} warmup, three arms interleaved and rotated each round`);
console.log("  cell               off µs/frame          on µs/frame           overhead  on worse  null control");

const SWEEP = process.env.SWEEP ?? "both";
const cells = [];

if (SWEEP !== "bytes") {
  console.log("\nframes, at 64 KB:");
  for (const count of [200, 800, 3200]) cells.push(await cell(`${count} frames`, count, 64 * 1024));
}
if (SWEEP === "both" || SWEEP === "bytes") {
  console.log("\nbytes, at 800 frames, one chunk each:");
  for (const kb of [16, 32, 64, 128, 256, 512]) cells.push(await cell(`${kb} KB`, 800, kb * 1024, 1));
}
if (SWEEP === "both" || SWEEP === "chunks") {
  console.log("\nchunks per frame, at 800 frames of 64 KB:");
  for (const c of [1, 2, 4, 8, 16, 32]) cells.push(await cell(`${c} chunk(s)`, 800, 64 * 1024, c));
}

const floor = Math.max(...cells.map((c) => Math.abs(c.noise)));
console.log(`\n  resolution floor from the null control: ${floor.toFixed(1)} µs per frame.`);
console.log("  * container-measured, not a timing rig: the shape is the claim, not the microseconds.");
