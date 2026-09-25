/**
 * Node entry: the clauses in clauses.ts against every client implementation, over the fake
 * WebTransport or WebSocket installed on the global scope, then the race between the two.
 *
 *   bash client/transport-ts/build.sh && node client/conformance/run.mjs
 */
import { FakeTransport, installFakeTransport } from "./fake-transport.ts";
import { FakeWebSocket, installFakeWebSocket } from "./fake-websocket.ts";
import {
  type Implementation,
  raceImpl,
  typescriptImpl,
  wasmBuilt,
  wasmImpl,
  websocketImpl,
} from "./adapters.ts";
import { type Rig, runClauses } from "./clauses.ts";
import { type RingFake, runRing } from "./ring.ts";
import { runRace } from "./race.ts";

const CERT = "ab".repeat(32);
// A cancelled fill leaves waiters nothing will ever settle; their eventual timeout is not a
// result, and must not take the process down before the checks are counted.
const strays: string[] = [];
process.on("unhandledRejection", (e) => strays.push(String((e as Error)?.message ?? e)));
let failed = 0;
let ran = 0;
const inapplicable: string[] = [];

function check(cond: boolean, what: string) {
  ran += 1;
  if (!cond) {
    console.error(`  FAIL: ${what}`);
    failed += 1;
  }
}

type Fake = RingFake & {
  dials(): number;
  last(): FakeTransport | FakeWebSocket;
};

const overWebTransport: Fake = {
  install: installFakeTransport,
  dials: () => FakeTransport.dials,
  last: () => FakeTransport.last,
};

const overWebSocket: Fake = {
  install: installFakeWebSocket,
  dials: () => FakeWebSocket.dials,
  last: () => FakeWebSocket.last,
};

function nodeRig(impl: Implementation, fake: Fake): Rig {
  let dialsAtOpen = 0;
  return {
    name: impl.name,
    closure: "fail",
    open() {
      fake.install();
      dialsAtOpen = fake.dials();
      return impl.connect("https://conformance.invalid/", CERT);
    },
    fake: () => ({
      pushFrame: async (i, c) => fake.last().pushFrame(i, c),
      pushOnOneStream: async (frames) => fake.last().pushOnOneStream(frames),
      pushTruncatedFrame: async (i, c, sent) => fake.last().pushTruncatedFrame(i, c, sent),
      trickleFrame: async (i, c, n, ms) => fake.last().trickleFrame(i, c, n, ms),
      serverClose: async (code, reason, endStreams) => fake.last().serverClose(code, reason, endStreams),
      controlMessages: async () => fake.last().controlMessages(),
      didClose: async () => fake.last().didClose,
    }),
    dialsSinceOpen: async () => fake.dials() - dialsAtOpen,
    oneStream: impl.overWebSocket
      ? (what) => void inapplicable.push(`${what} — one ordered stream carries every frame`)
      : undefined,
  };
}

// Both WebTransport arms or none: the WASM clock is the bug this suite exists for. docs/cloud-queue.md §Blocked.
if (!wasmBuilt()) {
  console.error(
    "transport-wasm is not built — no client/transport-wasm/pkg/.\n" +
      "  Build it once: bash client/transport-wasm/build.sh (needs wasm-pack).\n" +
      "  README.md §Prerequisites.",
  );
  process.exit(2);
}
const impls: Implementation[] = [await typescriptImpl(), await wasmImpl(), await websocketImpl()];

for (const impl of impls) {
  console.log(`\n${impl.name}`);
  const fake = impl.overWebSocket ? overWebSocket : overWebTransport;
  await runClauses(nodeRig(impl, fake), check);
  await runRing(impl, fake, check);
}
console.log("\ntransport-race");
await runRace(await raceImpl(), check);

if (inapplicable.length) {
  console.log(`\n  not applicable, and not counted as passing:`);
  for (const what of inapplicable) console.log(`    ${what}`);
}
if (strays.length) console.log(`\n  ${strays.length} abandoned waiter(s) rejected after their fill was cancelled`);
console.log(
  `\nconformance: ${ran - failed}/${ran} checks passed across ${impls.length} implementations and the race; ` +
    `${inapplicable.length} not applicable`,
);
// A cancelled fill leaves its waiters armed until FRAME_TIMEOUT_MS; exit rather than wait them out.
process.exit(failed ? 1 : 0);
