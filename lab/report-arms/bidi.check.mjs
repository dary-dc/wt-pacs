// node lab/report-arms/bidi.check.mjs — each Firefox ending's lever, through bidi.mjs, fires what report-plan.md §7.6
// checked by hand: hide (a second tab activated) → hidden; close with a second tab open → pagehide; navigate to
// another origin → pagehide persisted; back → pageshow persisted; crash → the page's content process gone; SIGKILL →
// exit; and whether the engine observes long tasks (cell C). A lever check, not a result: headless Firefox, a probe page.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSink } from "./sink.mjs";
import * as bidi from "./bidi.mjs";

let failed = 0;
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : (failed++, console.error(`FAIL ${what}`)));
const dir = mkdtempSync(join(tmpdir(), "levers-"));
const sink = await startSink({ dir, port: 0, statics: new URL(".", import.meta.url).pathname });
const at = (host, id) => `http://${host}:${sink.port}/probe.html?id=${id}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const events = (id) => (existsSync(join(dir, "load.jsonl")) ? readFileSync(join(dir, "load.jsonl"), "utf8") : "")
  .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).r).filter((r) => r.id === id);
const saw = (id, event, f = () => true) => events(id).some((e) => e.event === event && f(e));

const b = await bidi.launch();
try {
  let p = await bidi.openPage(b, at("127.0.0.1", "hide"));
  await bidi.hide(b, p); await pause(1000);
  check(saw("hide", "visibilitychange", (e) => e.state === "hidden"), "hide: a second tab activated, the page turns hidden");
  console.log(`info longtask observed: ${await bidi.evaluate(b, p, "PerformanceObserver.supportedEntryTypes.includes('longtask')")}`);

  p = await bidi.openPage(b, at("127.0.0.1", "close"));
  await bidi.close(b, p); await pause(1000);
  check(saw("close", "pagehide"), "close with another tab open: pagehide");

  // The sink's no-store keeps a page out of Firefox's bfcache, so the lever is checked on a cacheable copy.
  const html = readFileSync(new URL("./probe.html", import.meta.url));
  const got = [];
  const plain = http.createServer((q, s) => {
    if (q.method !== "POST") return s.writeHead(200, { "content-type": "text/html" }).end(html);
    let body = "";
    q.on("data", (d) => (body += d)).on("end", () => (got.push(JSON.parse(body)), s.writeHead(204).end()));
  }).listen(0);
  const there = (host, id) => `http://${host}:${plain.address().port}/?id=${id}`;
  p = await bidi.openPage(b, there("127.0.0.1", "bf"));
  await bidi.navigate(b, p, there("localhost", "other")); await pause(1500);
  check(got.some((e) => e.id === "bf" && e.event === "pagehide" && e.persisted), "navigate to another origin: pagehide, persisted");
  await bidi.back(b, p); await pause(1500);
  check(got.some((e) => e.id === "bf" && e.event === "pageshow" && e.persisted), "back: pageshow persisted, restored from bfcache");
  plain.close();

  p = await bidi.openPage(b, at("127.0.0.1", "crash"));
  const killed = bidi.crash(b, p);
  await pause(1000);
  const alive = await Promise.race([bidi.evaluate(b, p, "1").then(() => true, () => false), pause(3000).then(() => false)]);
  check(killed.length > 0 && !alive, `crash: ${killed.length} content processes killed, the page no longer evaluates`);

  const exited = new Promise((ok) => b.proc.once("exit", (_, signal) => ok(signal)));
  bidi.killBrowser(b);
  check((await exited) === "SIGKILL", "SIGKILL of the spawned browser: it exits");
} finally {
  b.close();
  await sink.close();
}
if (failed) process.exit(1);
console.log("report-arms: every Firefox lever fires what §7.6 checked");
