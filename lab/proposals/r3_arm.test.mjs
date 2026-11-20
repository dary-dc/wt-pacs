// node lab/proposals/r3_arm.test.mjs ROOT — R3's arm (docs/lines/proposals.md §R3, amendment 1), as r3_arm.sh built it in ROOT.
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2]);
let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

/** The wake is the exact session's alone: the viewer posts it to `exactSource` once, never to the optimal-quality client. */
const viewer = readFileSync(`${root}/client/viewer/viewer.js`, "utf8");
const wakes = viewer.match(/[\w.?]+\.wake\(\)/g) ?? [];
check(wakes.length === 1 && wakes[0] === "controller.exactSource?.wake()", `the viewer wakes ${JSON.stringify(wakes)}, not the exact session alone`);

/** A wake while an `l` is in flight ends the stream once and keeps the ask: its frame still reaches the page, uncancelled. */
globalThis.onmessage ??= null;
const posted = [];
globalThis.postMessage = (m) => posted.push(m);
globalThis.addEventListener ??= () => {};
Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 4 }, configurable: true });
let ended = 0, answer;
globalThis.fakeTransport = {
  connect: async () => ({
    requestExactFrame: () => new Promise((r) => (answer = r)),
    stats: () => ({ closed: null, lastByteAt: performance.now() }),
    fillFrames() {},
    endStream: async () => void ended++,
    close() {},
  }),
};
await import(`${root}/client/transport/downloader.js`);
const transport = "data:text/javascript,export const TransportSession = globalThis.fakeTransport;";
await onmessage({ data: { kind: "start", config: { decode: false, decoders: 0, transport, survival: false } } });
await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
await onmessage({ data: { kind: "ask", index: 7 } });
for (let n = 0; n < 50 && !answer; n++) await new Promise((r) => setTimeout(r, 10));
await onmessage({ data: { kind: "wake" } });
answer({ frameIndex: 7, bytes: new Uint8Array(4), timing: {} });
for (let n = 0; n < 50 && !posted.some((m) => m.kind === "frame"); n++) await new Promise((r) => setTimeout(r, 10));
check(ended === 1, `the wake ended the stream ${ended} times, not once`);
check(posted.some((m) => m.kind === "frame" && m.index === 7), `the ask in flight was not delivered after the wake: ${JSON.stringify(posted.map((m) => m.kind))}`);
check(!posted.some((m) => m.kind === "cancelled" || m.kind === "failed"), "the wake cancelled or failed the ask");
console.log(failed ? `${failed} failed` : "ok");
process.exit(failed ? 1 : 0);
