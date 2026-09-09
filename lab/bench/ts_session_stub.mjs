// Drive the product TypeScript client in plain Node against a stub WebTransport — no browser,
// no server. Two scenarios from docs/improvements/2026-09-08.md (D2, D3):
//   1. the control writer rejects every write: a single ask must not leave its waiter armed;
//   2. a bulk ask with a duplicate index must not orphan a waiter or ask the server twice.
// usage: node lab/bench/ts_session_stub.mjs client/transport-ts/dist/session.js
// Node ≥ 22 (web streams and performance are globals). Prints what the client did; judge by eye.

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const bundle = pathToFileURL(resolve(process.argv[2] ?? "client/transport-ts/dist/session.js")).href;
process.on("unhandledRejection", (r) => console.log("UNHANDLED REJECTION:", r?.message ?? r));

function stubTransport({ writeRejects, onWrite }) {
  return class StubWebTransport {
    constructor() {
      this.ready = Promise.resolve();
      this.incomingUnidirectionalStreams = new ReadableStream({ start() {} });
    }
    createBidirectionalStream() {
      return Promise.resolve({
        readable: new ReadableStream({ start() {} }),
        writable: new WritableStream({
          write(chunk) {
            onWrite?.(chunk);
            return writeRejects ? Promise.reject(new Error("control write failed")) : Promise.resolve();
          },
        }),
      });
    }
    close() {}
  };
}

const { TransportSession } = await import(bundle);
const t0 = performance.now();
const ms = () => `${Math.round(performance.now() - t0)} ms`;

console.log("--- scenario 1: control writer rejects every write");
globalThis.WebTransport = stubTransport({ writeRejects: true });
let s = await TransportSession.connect("https://stub/", "00");
try { await s.requestExactFrame(7); } catch (e) { console.log("ask 1 rejected:", e.message, `(${ms()})`); }
console.log("stats after the failed single ask:", JSON.stringify(s.stats()), "← inFlight should be 0");
try { await s.requestExactFrame(7); } catch (e) { console.log("ask 2, same frame, rejected:", e.message); }
const askMs = s.startExactFrames([9]);
try { await s.waitExactFrame(9, askMs); } catch (e) { console.log("bulk waiter rejected:", e.message, `(${ms()})`); }
console.log("stats after the failed bulk ask:", JSON.stringify(s.stats()), "← the bulk path fails its waiter at once (C7)");
await new Promise((r) => setTimeout(r, 20)); // let any orphaned rejection surface

console.log("--- scenario 2: duplicate index in a bulk ask");
const wire = [];
globalThis.WebTransport = stubTransport({ writeRejects: false, onWrite: (c) => wire.push(new TextDecoder().decode(c.subarray(4))) });
s = await TransportSession.connect("https://stub/", "00");
const ask2 = s.startExactFrames([3, 3]);
await new Promise((r) => setTimeout(r, 20));
console.log("asked on the wire:", JSON.stringify(wire), "← the server would send frame 3 twice");
try { await s.waitExactFrame(3, ask2); } catch (e) { console.log("first wait:", e.message); }
try { await s.waitExactFrame(3, ask2); } catch (e) { console.log("second wait:", e.message); }
console.log("stats:", JSON.stringify(s.stats()), "← inFlight 1 is the orphaned first waiter (until its 15 s timeout)");
process.exit(0);
