/**
 * Tests for the fetch carrier, against a fake `fetch` — run with:
 *   bash lab/transport-arms/build.sh && node lab/transport-arms/dist/fetch-session.test.mjs
 */

import { TransportSession, type FrameResult } from "./fetch-session.ts";

const LAST = 49;

function envelope(index: number): Uint8Array {
  const out = new Uint8Array(8 + 16).fill(index & 255);
  const view = new DataView(out.buffer);
  view.setUint32(0, 4 + 16, false);
  view.setUint32(4, index, false);
  return out;
}

/** `/frames/K` answers its frame at once; `/frames/K-N` answers K and holds the rest until `release()`. */
function fakeFetch() {
  const asked: string[] = [];
  let release = () => {};
  globalThis.fetch = (async (url: string, init: { signal: AbortSignal }) => {
    const path = new URL(url).pathname;
    asked.push(path);
    const [from, to] = path.slice("/frames/".length).split("-").map(Number);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        init.signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        c.enqueue(envelope(from));
        if (to === undefined) return c.close();
        release = () => {
          for (let i = from + 1; i <= to; i++) c.enqueue(envelope(i));
          c.close();
        };
      },
    });
    return new Response(body);
  }) as typeof fetch;
  return { asked, release: () => release() };
}

const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<"late">((r) => setTimeout(() => r("late"), ms))]);

let failed = 0;
function assert(cond: boolean, msg: string) {
  console[cond ? "log" : "error"](cond ? "ok:" : "FAIL:", msg);
  if (!cond) failed += 1;
}

/** Under `fill`, an ask during the opening fill reaches the carrier, and lands, before the fill's last frame. */
async function anAskDuringTheOpeningFillJumpsIt() {
  const { asked, release } = fakeFetch();
  const landed: number[] = [];
  const fill = { from: 0, to: LAST, onFrame: (f: FrameResult) => landed.push(f.frameIndex), onError: () => {} };
  const session = await within(TransportSession.connect("http://get/?shape=fill", "", { fill }), 500);
  assert(session !== "late", "connect returns while the opening fill's GET is still open");
  if (session === "late") return release();
  const frame = await within(session.requestFrame(30), 500);
  assert(asked.includes("/frames/30"), `the ask's GET went out, saw ${JSON.stringify(asked)}`);
  assert(frame !== "late" && frame.frameIndex === 30, "the asked frame lands");
  assert(!landed.includes(LAST), `the fill's last frame had not landed, saw ${JSON.stringify(landed)}`);
  session.close();
}

await anAskDuringTheOpeningFillJumpsIt();
if (failed) console.error(`${failed} failed`);
process.exit(failed ? 1 : 0);
