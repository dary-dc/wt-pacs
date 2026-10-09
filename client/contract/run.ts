/**
 * Node entry: the clauses in clauses.ts against every client implementation, over the fake
 * WebTransport or WebSocket installed on the global scope, then the race between the two.
 *
 *   bash client/transport/ts/build.sh && node client/contract/run.mjs [transport-ts|transport-wasm|transport-ws|transport-race]
 *
 * With no name, each implementation runs in its own process, side by side: the fakes are global to a
 * process, and one clause waits out 16 s of a trickled frame on each.
 */
import { spawn } from "node:child_process";
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

type Fake = Omit<RingFake, "last"> & {
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
      return impl.connect("https://contract.invalid/", CERT);
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

const CLIENTS = ["transport-ts", "transport-wasm", "transport-ws", "transport-race"];
const only = process.argv[2];
if (!only) {
  const runs = await Promise.all(CLIENTS.map((name) => new Promise<{ out: string; code: number }>((resolve) => {
    const child = spawn(process.execPath, [process.argv[1], name]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => resolve({ out, code: code ?? 1 }));
  })));
  const total = { ran: 0, failed: 0, inapplicable: [] as string[], strays: 0 };
  for (const { out, code } of runs) {
    const tally = out.match(/^RESULT (.*)$/m);
    process.stdout.write(out.replace(/^RESULT .*\n?/m, ""));
    if (!tally) {
      console.error(`  FAIL: an implementation's process ended (code ${code}) without a result`);
      total.failed += 1;
      continue;
    }
    const r = JSON.parse(tally[1]);
    total.ran += r.ran;
    total.failed += r.failed;
    total.inapplicable.push(...r.inapplicable);
    total.strays += r.strays;
  }
  report(total.ran, total.failed, total.inapplicable, total.strays, CLIENTS.length - 1);
  process.exit(total.failed ? 1 : 0);
}
if (!CLIENTS.includes(only)) {
  console.error(`unknown implementation ${only}: one of ${CLIENTS.join(", ")}`);
  process.exit(2);
}

function report(ran: number, failed: number, inapplicable: string[], strays: number, impls: number) {
  if (inapplicable.length) {
    console.log(`\n  not applicable, and not counted as passing:`);
    for (const what of inapplicable) console.log(`    ${what}`);
  }
  if (strays) console.log(`\n  ${strays} abandoned waiter(s) rejected after their fill was cancelled`);
  console.log(
    `\ncontract: ${ran - failed}/${ran} checks passed across ${impls} implementations and the race; ` +
      `${inapplicable.length} not applicable`,
  );
}

// Both WebTransport clients or none: the WASM clock is the bug this suite exists for. docs/CLIENTS.md §The seam.
if (!wasmBuilt()) {
  console.error(
    "transport-wasm is not built — no client/transport/wasm/pkg/.\n" +
      "  Build it once: bash client/transport/wasm/build.sh (needs wasm-pack).\n" +
      "  README.md §Prerequisites.",
  );
  process.exit(2);
}
console.log(`\n${only}`);
if (only === "transport-race") {
  await runRace(await raceImpl(), check);
} else {
  const impl = await { "transport-ts": typescriptImpl, "transport-wasm": wasmImpl, "transport-ws": websocketImpl }[only]!();
  const fake = impl.overWebSocket ? overWebSocket : overWebTransport;
  await runClauses(nodeRig(impl, fake), check);
  await runRing(impl, fake, check);
}
console.log(`RESULT ${JSON.stringify({ ran, failed, inapplicable, strays: strays.length })}`);
// A cancelled fill leaves its waiters armed until FRAME_TIMEOUT_MS; exit rather than wait them out.
process.exit(failed ? 1 : 0);
