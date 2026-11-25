// node lab/report-arms/bidi.test.mjs — a BiDi remote value read as plain JSON: numbers, strings, booleans, null and
// undefined as null, arrays and objects element by element, as run.mjs reads rig's fields; a closed socket rejects
// every pending and later call (the driver hang of REPORT-RUN-2), and one no caller awaits any more is no unhandled
// rejection; a closed browser leaves no profile behind; no
// Firefox runs without FIREFOX_PATH.
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plain, Bidi, closeBrowser, firefoxPath } from "./bidi.mjs";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));
const v = { type: "object", value: [["a", { type: "array", value: [{ type: "number", value: 1 }, { type: "string", value: "x" }] }],
  ["n", { type: "null" }], ["u", { type: "undefined" }], ["ok", { type: "boolean", value: true }],
  ["o", { type: "object", value: [["k", { type: "number", value: 2.5 }]] }]] };
check(JSON.stringify(plain(v)) === JSON.stringify({ a: [1, "x"], n: null, u: null, ok: true, o: { k: 2.5 } }),
  `plain: nested values (${JSON.stringify(plain(v))})`);
check(plain({ type: "number", value: "NaN" }) !== plain({ type: "number", value: "NaN" }), "plain: NaN as a number");

/** A fake BiDi socket: records what is sent, answers nothing, closes on demand. */
const fakeSocket = () => ({ sent: [], send(m) { this.sent.push(m); }, close() { this.onclose?.(); } });
{
  const ws = fakeSocket();
  const bidi = new Bidi(ws);
  const pending = bidi.send("script.evaluate").then(() => "answered", (e) => e.message);
  ws.close();
  check(await pending === "BiDi socket closed", "Bidi: a call pending when the socket closes is rejected");
  check(await bidi.send("browsingContext.create").then(() => "answered", (e) => e.message) === "BiDi socket closed",
    "Bidi: a call after the close is rejected at once");
}
{
  let unhandled = 0;
  const count = () => unhandled++;
  process.on("unhandledRejection", count);
  const ws = fakeSocket();
  new Bidi(ws).send("script.evaluate");
  ws.close();
  await new Promise((ok) => setTimeout(ok, 20));
  process.off("unhandledRejection", count);
  check(unhandled === 0, "Bidi: a dropped call rejected at the close is no unhandled rejection");
}
{
  const ws = fakeSocket();
  const bidi = new Bidi(ws);
  const answer = bidi.send("session.new");
  ws.onmessage({ data: JSON.stringify({ id: 1, type: "success", result: { ok: 1 } }) });
  check((await answer).ok === 1, "Bidi: an answered call resolves with its result");
}
{
  const profile = mkdtempSync(join(tmpdir(), "report-arms-ff-test-"));
  writeFileSync(join(profile, "prefs.js"), "x".repeat(1024));
  const proc = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null,
    kill(sig) { setTimeout(() => { this.signalCode = sig; this.emit("exit", null, sig); }, 5); } });
  await closeBrowser(fakeSocket(), proc, profile);
  check(!existsSync(profile), "closeBrowser: the profile is removed once the browser has exited");
}
{
  let refused = false;
  try { firefoxPath({}); } catch { refused = true; }
  check(refused && firefoxPath({ FIREFOX_PATH: "/x/firefox" }) === "/x/firefox", "firefoxPath: required, no default");
}
if (failed) process.exit(1);
console.log("report-arms: BiDi values read as JSON; a closed socket rejects; no profile left; FIREFOX_PATH required");
