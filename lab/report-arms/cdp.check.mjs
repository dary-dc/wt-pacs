// node lab/report-arms/cdp.check.mjs — each Chromium ending's lever, through cdp.mjs, fires what report-plan.md §7.6
// checked by hand: hide (minimized) → hidden; close with a second tab open → pagehide; navigate to another origin →
// pagehide persisted; back → pageshow persisted (bfcache); freeze → freeze; crash → the target crashed; SIGKILL → exit.
// A lever check, not a result: headless Chromium in the container, a probe page, the sink on loopback.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSink } from "./sink.mjs";
import * as cdp from "./cdp.mjs";

let failed = 0;
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : (failed++, console.error(`FAIL ${what}`)));
const dir = mkdtempSync(join(tmpdir(), "levers-"));
const sink = await startSink({ dir, port: 0, statics: new URL(".", import.meta.url).pathname });
const at = (host, id) => `http://${host}:${sink.port}/probe.html?id=${id}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const events = (id) => (existsSync(join(dir, "load.jsonl")) ? readFileSync(join(dir, "load.jsonl"), "utf8") : "")
  .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).r).filter((r) => r.id === id);
const saw = (id, event, f = () => true) => events(id).some((e) => e.event === event && f(e));

const b = await cdp.launch();
try {
  let p = await cdp.openPage(b, at("127.0.0.1", "hide"));
  await cdp.hide(b, p); await pause(1000);
  check(saw("hide", "visibilitychange", (e) => e.state === "hidden"), "hide: minimized, the page turns hidden");
  await cdp.close(b, p);

  const keep = await cdp.openPage(b, "about:blank");
  p = await cdp.openPage(b, at("127.0.0.1", "close"));
  await cdp.close(b, p); await pause(1000);
  check(saw("close", "pagehide"), "close with another tab open: pagehide");

  p = await cdp.openPage(b, at("127.0.0.1", "bf"));
  await cdp.navigate(b, p, at("localhost", "other")); await pause(1500);
  check(saw("bf", "pagehide", (e) => e.persisted), "navigate to another origin: pagehide, persisted");
  await cdp.back(b, p); await pause(1500);
  check(saw("bf", "pageshow", (e) => e.persisted), "back: pageshow persisted, restored from bfcache");
  await cdp.freeze(b, p); await pause(1000);
  check(saw("bf", "freeze"), "setWebLifecycleState frozen: freeze");
  await cdp.close(b, p);

  p = await cdp.openPage(b, at("127.0.0.1", "crash"));
  const crashed = b.cdp.waitFor("Inspector.targetCrashed", () => true, 5000).then(() => true, () => false);
  await b.cdp.send("Inspector.enable", {}, p.sessionId);
  cdp.crash(b, p);
  check(await crashed, "Page.crash: the renderer crashed");
  void keep;

  const exited = new Promise((ok) => b.proc.once("exit", (_, signal) => ok(signal)));
  cdp.killBrowser(b);
  check((await exited) === "SIGKILL", "SIGKILL of the spawned browser: it exits");
} finally {
  b.close();
  await sink.close();
}
if (failed) process.exit(1);
console.log("report-arms: every Chromium lever fires what §7.6 checked");
