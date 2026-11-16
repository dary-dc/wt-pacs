// node lab/report-arms/session/session.test.mjs — SESSION as report-plan.md §3.3 designs it: the page hands every
// record to the downloader in the call; the downloader writes each on its own bidirectional stream of the series'
// session, record then FIN, and holds it until the server's one byte; a record not acknowledged goes again on the
// session that replaces a dead or recycled one; the decoder hands a failed check to the downloader, never the page;
// at once, batched per second, is SESSION's own timing; the floor writes the same bytes on one bare stream.
import session, { schedule } from "./session.js";
import { Reports, write } from "./report.js";
import { forward } from "./decoder-report.js";
import { floor } from "./floor.js";
import { Load } from "../record.js";

let failures = 0;
const check = (ok, what) => ok || (failures++, console.error(`FAIL ${what}`));
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
const decoder = new TextDecoder();

/** A WebTransport stand-in: each stream records what was written and whether it was closed; `ack` answers it. */
function transport({ ack = true } = {}) {
  let ready, closed;
  const t = { streams: [], ready: new Promise((r) => (ready = r)), closed: new Promise((r) => (closed = r)) };
  t.open = () => ready();
  t.end = () => closed();
  t.createBidirectionalStream = async () => {
    const s = { chunks: [], closedByClient: false, answer: null };
    const answered = new Promise((r) => (s.answer = r));
    t.streams.push(s);
    return {
      writable: { getWriter: () => ({ write: async (b) => void s.chunks.push(decoder.decode(b)),
                                       close: async () => void (s.closedByClient = true) }) },
      readable: { getReader: () => ({ read: () => answered }) },
    };
  };
  t.answer = (i, ok = ack) => t.streams[i].answer(ok ? { value: new Uint8Array([1]), done: false } : { value: undefined, done: true });
  return t;
}

{
  const posted = [];
  const arm = session({ load: "L" }, { channel: { postMessage: (m) => posted.push(m) } });
  arm.load("A");
  check(posted.length === 1 && posted[0].kind === "load" && posted[0].body === "A", "page: a load record handed on in the call");
  arm.safety("S");
  check(posted.length === 2 && posted[1].kind === "safety" && posted[1].body === "S", "page: its own safety report handed on at once");
  arm.safety("W", true);
  check(posted.length === 2, "page: a decoder's report is not handed on again: the decoder gave it to the downloader");
}
{
  const r = new Reports();
  const t = transport();
  r.adopt(t);
  r.send("before");
  await settle();
  check(t.streams.length === 0, "downloader: nothing written before the session is ready");
  t.open();
  await settle();
  check(t.streams.length === 1 && t.streams[0].chunks.join("") === "before" && t.streams[0].closedByClient,
        "downloader: a held record written on its own stream once ready, then FIN");
  r.send("one");
  await settle();
  check(t.streams.length === 2 && t.streams[1].chunks.join("") === "one", "downloader: a record on a ready session goes at once");
  t.answer(0);
  await settle();
  check(!r.held.has("before") && r.held.has("one"), "downloader: held until the server's byte, released by it");
}
{
  const r = new Reports();
  const a = transport();
  r.adopt(a);
  a.open();
  await settle();
  r.send("lost");
  await settle();
  a.answer(0, false);
  a.end();
  await settle();
  check(r.held.has("lost") && a.streams.length === 1, "downloader: a stream ended without the byte keeps the record, not resent on a dead session");
  r.send("later");
  await settle();
  check(a.streams.length === 1 && r.held.get("later") === null, "downloader: a record sent while no session is open waits, held");
  const b = transport();
  r.adopt(b);
  b.open();
  await settle();
  check(b.streams.length === 2 && b.streams.map((x) => x.chunks.join("")).join() === "lost,later",
        "downloader: every unacknowledged record goes again on the next session, in order");
  b.answer(0);
  b.answer(1);
  await settle();
  check(r.held.size === 0, "downloader: acknowledged on the next session, released");
}
{
  const r = new Reports();
  const a = transport();
  r.adopt(a);
  a.open();
  await settle();
  r.send("x");
  await settle();
  r.send("x");
  await settle();
  check(a.streams.length === 1, "downloader: a record in flight is not written twice");
  const b = transport();
  r.adopt(b);
  b.open();
  await settle();
  check(b.streams.length === 0, "downloader: a record in flight on the old session is not doubled by the new one");
  a.answer(0, false);
  await settle();
  check(b.streams.length === 1 && b.streams[0].chunks.join("") === "x",
        "downloader: a record that failed on a recycled session goes again on the current one");
}
{
  const t = transport();
  t.open();
  const done = write(t, "abc");
  await settle();
  t.answer(0);
  check((await done) === true, "write: true on the server's byte");
  const u = transport();
  const failed = write(u, "abc");
  await settle();
  u.answer(0, false);
  check((await failed) === false, "write: false when the stream ends with no byte");
}
{
  const out = [];
  const send = forward((m) => out.push(m));
  const ok = await send("/report/safety", "S", true);
  check(ok === true && out.length === 1 && out[0].kind === "report" && out[0].body === "S",
        "decoder: a failed check handed to its parent, the downloader, as a report");
}
{
  const t = transport();
  t.open();
  const body = JSON.stringify({ kind: "load", reportId: "0123456789abcdef0123456789abcdef", load: "L-1", seq: 0 });
  const f = floor({ wt: t, load: "L-1", body });
  await settle();
  const sent = t.streams[0].chunks.join("");
  check(f.load !== "L-1" && !sent.includes("L-1") && sent.includes(f.load), "floor: a fresh load id, so the read tool files it apart");
  check(!sent.includes("0123456789abcdef0123456789abcdef") && sent.length === body.length + f.load.length - 3,
        "floor: a fresh reportId, and the arm's bytes but for the ids' lengths");
  t.answer(0);
  check((await f.done) === true, "floor: done on the server's byte");
}
{
  const timers = [];
  const sent = [];
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const win = new EventTarget();
  const load = new Load({ load: "L", session: "S", build: "b", codec: "htj2k", source: null, frameCount: 2 });
  const t = schedule({ timing: "1", carrier: { load: (b) => sent.push(JSON.parse(b)) }, load, doc, win },
                     { every: (fn, ms) => timers.push([fn, ms]) });
  check(sent.length === 0, "at once: nothing before the fill's end");
  t.fillEnded();
  check(sent.length === 1 && sent[0].seq === 0 && timers.length === 1 && timers[0][1] === 1000,
        "at once: the whole record at the fill's end, then a tick a second");
  timers[0][0]();
  check(sent.length === 1, "at once: no delta in a second when nothing changed");
  load.press({ at: 1, text: "frame" });
  timers[0][0]();
  check(sent.length === 2 && sent[1].seq === 1 && sent[1].presses.length === 1, "at once: a delta in the next second when something changed");
  load.press({ at: 2, text: "Lossless" });
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  check(sent.length === 3 && sent[2].presses.length === 1 && sent[2].presses[0].text === "Lossless",
        "at once: the hide send carries only the last second's delta");
  win.dispatchEvent(new Event("pagehide"));
  check(sent.length === 3, "at once: the second event of one hide finds no change and sends nothing");
  const y = [];
  const other = schedule({ timing: "Y", carrier: { load: (b) => y.push(b) }, load: new Load({ load: "M" }),
                           doc: new EventTarget(), win: new EventTarget() }, { every: () => timers.push("Y") });
  other.fillEnded();
  check(y.length === 1 && timers.at(-1) !== "Y", "the hybrid and at hidden are timing.js's, with no tick");
}

if (failures) { console.error(`${failures} failed`); process.exit(1); }
console.log("session.test: ok");
