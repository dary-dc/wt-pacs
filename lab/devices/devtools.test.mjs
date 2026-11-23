// node lab/devices/devtools.test.mjs — devtools.mjs against headless Chromium's DevTools port and a static server; no phone.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const SCRIPT = fileURLToPath(new URL("devtools.mjs", import.meta.url));
const { chromium } = createRequire(import.meta.url)("playwright");
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });

const dir = mkdtempSync(join(tmpdir(), "devtools-test-"));
const served = join(dir, "served");
const other = join(dir, "other");
const OLD = new Date("2020-01-01");
function writeTree(root, version) {
  writeFileSync(join(root, "page.html"), '<!DOCTYPE html><script type="module" src="/a.js"></script>', { flag: "w" });
  writeFileSync(join(root, "a.js"), `document.title = "v${version}";\n`);
  // An old Last-Modified: the cache keeps a.js fresh by heuristic (RFC 9111 §4.2.2), so only a clear makes it ask again.
  utimesSync(join(root, "a.js"), OLD, OLD);
}
for (const d of [served, other]) rmSync(d, { recursive: true, force: true }), await import("node:fs").then((fs) => fs.mkdirSync(d));
writeTree(served, 1);
writeTree(other, 9);

const httpPort = await freePort();
const http = spawn("python3", ["-m", "http.server", "--bind", "127.0.0.1", String(httpPort), "--directory", served], { stdio: "ignore" });
const devPort = await freePort();
const browser = await chromium.launchPersistentContext(join(dir, "profile"), { args: [`--remote-debugging-port=${devPort}`] });
const roundUrl = (at) => `http://127.0.0.1:${httpPort}/page.html?round=http%3A%2F%2F127.0.0.1%3A8780&at=${at}`;

/** devtools.mjs against TREE until it prints "waiting", then `then()`; its exit code and its printed records. */
async function run(tree, then) {
  const proc = spawn("node", [SCRIPT, tree, "--port", String(devPort), "--wait-s", "30"], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  let waited = false;
  proc.stdout.on("data", async (b) => {
    out += b;
    if (!waited && out.includes('"waiting"')) {
      waited = true;
      await then();
    }
  });
  const code = await new Promise((ok) => proc.on("exit", ok));
  return { code, out, records: out.trim().split("\n").map((l) => JSON.parse(l)) };
}

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`not ok - ${name}\n  ${e.message}`);
  }
}
try {
  await check("the round's own tabs are closed, another site's tab is kept and never printed, and a page running the served tree passes", async () => {
    const elsewhere = await browser.newPage();
    await elsewhere.goto("data:text/html,<title>someone else's tab</title>");
    const stale = await browser.newPage();
    await stale.goto(roundUrl(0));
    let open;
    const r = await run(served, async () => {
      open = (await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json()).filter((x) => x.type === "page").map((x) => x.url);
      await (await browser.newPage()).goto(roundUrl(0));
    });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.records.find((x) => x.event === "round tabs closed").count, 1);
    assert.ok(!open.includes(roundUrl(0)) && open.some((u) => u.startsWith("data:")), open.join(" "));
    assert.ok(!/data:|someone/.test(r.out), r.out);
    assert.deepEqual(r.records.at(-1), { kind: "devtools", event: "code checked", page: "/page.html", at: 0, scripts: 1, differ: [] });
  });

  await check("a page whose script differs from the tree's is named and fails", async () => {
    const r = await run(other, async () => (await browser.newPage()).goto(roundUrl(1)));
    assert.equal(r.code, 1, r.out);
    assert.deepEqual(r.records.at(-1).differ, ["/a.js"]);
  });

  await check("the cache is cleared first: a script changed on the server since it was cached runs as served", async () => {
    await (await browser.newPage()).goto(roundUrl(2));
    writeTree(served, 2);
    const r = await run(served, async () => (await browser.newPage()).goto(roundUrl(2)));
    assert.equal(r.code, 0, r.out);
    assert.ok(r.records.some((x) => x.event === "cache cleared"));
  });
} finally {
  await browser.close();
  http.kill();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
