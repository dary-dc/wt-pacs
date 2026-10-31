// The viewer's lab levers: what reaches run.mjs's result. lab/viewer/levers.js
import { levers } from "./levers.js";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};

const posted = [];
globalThis.fetch = async (url, { body }) => posted.push({ url, body: body && JSON.parse(body) });
const lab = (query) => levers(new URLSearchParams({ post: "http://rig/", ...query }));
const finished = async (l, extra) => {
  posted.length = 0;
  await l.finished({ issuedAt: 1000, firstShownMs: 5, frames: [], errors: [], stats: { resumedAt: [], exact: {} }, ...extra });
  return posted.find((p) => p.url === "http://rig/result").body;
};
const frame = (i, page, mediaReads) => ({ i, page, lastByte: page - 1, mediaReads, exact: true, sha: `s${i}` });

/** The result carries the controller's fill time and the session's reads at the last frame; a half-held fill's reads start at its last held frame. */
async function aFillCarriesItsTimeAndReads() {
  const frames = [frame(0, 10, 4), frame(2, 20, 9), frame(1, 30, 15), frame(3, 40, 21)];
  const empty = await finished(lab({ opts: "{}" }), { fillMs: 123.4, frames });
  check(empty.fillMs === 123.4 && empty.mediaReads === 21 && empty.fillReads === 21, `an empty store: fill ${empty.fillMs} ms, reads ${empty.mediaReads}, the fill's ${empty.fillReads}`);
  const half = await finished(lab({ view: "worker", opts: JSON.stringify({ holdEveryOther: true, span: 1 }) }), { fillMs: 50, frames });
  check(half.mediaReads === 21 && half.fillReads === 12, `a half-held store: the fill's reads from the last held frame (${half.fillReads}, of ${half.mediaReads})`);
  check(half.frames.length === 4 && half.after.length === 0, `a fill reports its frames, no steps (${half.frames.length}, ${half.after.length})`);
}
await aFillCarriesItsTimeAndReads();

/** On demand, the steps are frames 1 … after, each timed from its step to its frame held, and no fill frame is reported. */
async function onDemandStepsAreTimed() {
  const l = lab({ opts: "{}", fill: "0", after: "3" });
  check(l.steps.join() === "1,2,3", `the steps (${l.steps})`);
  const frames = [frame(0, 10, 2), frame(1, 120, 4), frame(2, 260, 6), frame(3, 300, 8)];
  const r = await finished(l, { fillMs: null, frames, stepped: [{ i: 1, at: 100 }, { i: 2, at: 200 }, { i: 3, at: 290 }] });
  check(r.after.map((a) => `${a.i}:${a.ms}`).join() === "1:20,2:60,3:10", `each step timed from its own step (${JSON.stringify(r.after)})`);
  check(r.frames.length === 0 && r.sha[3] === "s3", `no fill frames, every digest (${r.frames.length}, ${Object.keys(r.sha)})`);
  check(lab({ opts: "{}", after: "3" }).steps.length === 0, "a fill takes no steps, whatever --asks-after says");
}
await onDemandStepsAreTimed();

/** A setting only the view worker honours is refused by name under the page view, as is a writer the cache lacks or a decoder writing a frame it transferred. */
function settingsTheViewCannotHonourAreRefused() {
  const refusal = (query) => {
    try {
      levers(new URLSearchParams(query));
      return null;
    } catch (e) {
      return e.message;
    }
  };
  for (const [query, said] of [
    [{ writer: "store" }, "refused: writer under view page — the view worker's; name view=worker"],
    [{ opts: JSON.stringify({ waitAhead: 4 }) }, "refused: waitAhead under view page — the view worker's; name view=worker"],
    [{ view: "page", opts: JSON.stringify({ holdEveryOther: true }) }, "refused: holdEveryOther under view page — the view worker's; name view=worker"],
    [{ opts: JSON.stringify({ pixels: "transfer" }) }, "refused: pixels under view page — the view worker's; name view=worker"],
    [{ opts: JSON.stringify({ pageDials: true }) }, "refused: pageDials under view page — the view worker's; name view=worker"],
    [{ opts: JSON.stringify({ viewWorkerFirst: true }) }, "refused: viewWorkerFirst under view page — the view worker's; name view=worker"],
    [{ opts: JSON.stringify({ glAfterDial: true }) }, "refused: glAfterDial under view page — the view worker's; name view=worker"],
    [{ opts: JSON.stringify({ shortRuns: true }) }, "refused: shortRuns under view page — the view worker's; name view=worker"],
    [{ view: "worker", writer: "decoders", opts: JSON.stringify({ pageDials: true }) }, "refused: writer decoders with pageDials — the decoders are told to keep frames only once the cache is open"],
    [{ view: "worker", writer: "disk" }, 'refused: writer "disk" — store, decoders or view'],
    [{ view: "worker", writer: "decoders", opts: JSON.stringify({ pixels: "transfer" }) }, "refused: writer decoders with pixels transfer — the decoder would write a frame it has transferred"],
  ]) check(refusal(query) === said, `${JSON.stringify(query)}: ${refusal(query)}`);
  for (const query of [{ opts: JSON.stringify({ span: 2, waitAhead: 0, pixels: "shared" }) }, { view: "worker", writer: "view", opts: JSON.stringify({ waitAhead: 4, holdEveryOther: true, pixels: "transfer" }) }]) {
    check(refusal(query) === null, `${JSON.stringify(query)} taken`);
  }
}
settingsTheViewCannotHonourAreRefused();

console.log(failed ? `${failed} failed` : "levers: a fill's time and reads, steps on demand, the refusals: ok");
process.exit(failed ? 1 : 0);
