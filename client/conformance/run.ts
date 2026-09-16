/**
 * Node entry: the clauses in clauses.ts against both client implementations, over the fake
 * transport installed on the global scope.
 *
 *   bash client/transport-ts/build.sh && node client/conformance/run.mjs
 */
import { FakeTransport, installFakeTransport } from "./fake-transport.ts";
import { type Implementation, typescriptImpl, wasmBuilt, wasmImpl } from "./adapters.ts";
import { type Rig, runClauses } from "./clauses.ts";

const CERT = "ab".repeat(32);
// A cancelled fill leaves waiters nothing will ever settle; their eventual timeout is not a
// result, and must not take the process down before the checks are counted.
const strays: string[] = [];
process.on("unhandledRejection", (e) => strays.push(String((e as Error)?.message ?? e)));
let failed = 0;
let ran = 0;

function check(cond: boolean, what: string) {
  ran += 1;
  if (!cond) {
    console.error(`  FAIL: ${what}`);
    failed += 1;
  }
}

function nodeRig(impl: Implementation): Rig {
  let dialsAtOpen = 0;
  return {
    name: impl.name,
    closure: "fail",
    open() {
      installFakeTransport();
      dialsAtOpen = FakeTransport.dials;
      return impl.connect("https://conformance.invalid/", CERT);
    },
    fake: () => ({
      pushFrame: async (i, c) => FakeTransport.last.pushFrame(i, c),
      pushOnOneStream: async (frames) => FakeTransport.last.pushOnOneStream(frames),
      serverClose: async (code, reason, endStreams) =>
        FakeTransport.last.serverClose(code, reason, endStreams),
      controlMessages: async () => FakeTransport.last.controlMessages(),
      didClose: async () => FakeTransport.last.didClose,
    }),
    dialsSinceOpen: async () => FakeTransport.dials - dialsAtOpen,
  };
}

const impls: Implementation[] = [await typescriptImpl()];
if (wasmBuilt()) {
  impls.push(await wasmImpl());
} else {
  console.log("SKIPPED arm: transport-wasm — no pkg/, run client/transport-wasm/build.sh (needs wasm-pack)");
}

for (const impl of impls) {
  console.log(`\n${impl.name}`);
  await runClauses(nodeRig(impl), check);
}

if (strays.length) console.log(`\n  ${strays.length} abandoned waiter(s) rejected after their fill was cancelled`);
console.log(
  `\nconformance: ${ran - failed}/${ran} checks passed across ${impls.length} implementation(s)` +
    (impls.length < 2 ? " — one arm was skipped" : ""),
);
// A cancelled fill leaves its waiters armed until FRAME_TIMEOUT_MS; exit rather than wait them out.
process.exit(failed ? 1 : 0);
