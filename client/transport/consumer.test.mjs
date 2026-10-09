// node client/transport/consumer.test.mjs — what `connect` refuses before it starts a worker.
import { DownloaderClient } from "./consumer.js";

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const refusal = (opts) => DownloaderClient.connect("https://x.invalid/", "ab", opts).then(() => "started", (e) => e.message);

globalThis.crossOriginIsolated = true;
// A group length must be a whole number of at least one frame.
for (const g of [0, 2.5, -1]) check(/groupLength/.test(await refusal({ groupLength: g })), `groupLength ${g} is refused`);
// Above one, the series' frame count is needed to cut its last group.
check(/frameCount/.test(await refusal({ groupLength: 4 })), "groupLength 4 without frameCount is refused");

// Pixels go through a SharedArrayBuffer, so a page that is not cross-origin isolated is refused.
globalThis.crossOriginIsolated = false;
check(/cross-origin isolated/.test(await refusal({})), "a page not cross-origin isolated is refused");
// Undecoded bytes need no shared memory: that start gets as far as making its worker.
globalThis.Worker = class {
  constructor() {
    throw new Error("worker made");
  }
};
check(/worker made/.test(await refusal({ decode: false })), "decode: false is not refused for isolation");

console.log(failed ? `${failed} failed` : "consumer refusals: ok");
process.exit(failed ? 1 : 0);
