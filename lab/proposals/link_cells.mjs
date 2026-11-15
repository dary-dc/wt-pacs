// One run of a link protocol in docs/lines/proposals.md §Optimize (P1, P3, P4, P5): a pair served as README §Demo serves it, both
// sessions through lab/scripts/link_impair.py, one fresh headless Chromium; the fill's last frame, then `l` after a quiet.
//
//   node lab/proposals/link_cells.mjs TIP DIR LOSSY_ID --link "OPTIONS" [--lossy-args "..."] [--exact-args "..."]
//        [--quiet-ms 10000] [--frame first|middle|last] [--host ROOT] [--cpu-throttle RATE]
//        [--exact-only] [--lead-ms L] [--jump-after-ms J] [--windows]
//     TIP: a checkout of the demo tip with its client, series-server and dev certificate built
//     ROOT: where dev-server.py serves the page from, TIP by default (P5's arm: lab/proposals/p5_arm.sh)
//     RATE: Emulation.setCPUThrottlingRate on the page target; Chromium applies it to the main thread only
//     --exact-only: only the exact session through the relay, which --idle-promote needs; --lead-ms: ask by the
//     button, its pointerdown L ms before its click (P3), instead of the `l` key; --jump-after-ms: `End` J ms after the
//     first picture, during the fill, the relay's flows tallied over the jump alone, and no `l` (R2); --windows: the
//     relay's flows tallied over the quiet, then over the `l` (R4)
//   prints one JSON row; times are ms on the page's clock, from navigation
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const [tip, dir, id] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const words = (s) => (s ? s.split(/\s+/).filter(Boolean) : []);
const QUIET = Number(arg("--quiet-ms", 10000));
const FRAME = arg("--frame", "first");
const JUMP = arg("--jump-after-ms");
const CONTROL = 5556;
const WINDOWS = JUMP !== undefined || process.argv.includes("--windows");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const T = mkdtempSync(path.join(tmpdir(), "link-cells-"));
const children = [];
const stop = () => { for (const c of children.splice(0)) c.kill("SIGKILL"); };
process.on("exit", () => { stop(); rmSync(T, { recursive: true, force: true }); });

const lossyMeta = JSON.parse(readFileSync(path.join(dir, `${id}.metadata.json`)));
const exactId = lossyMeta.exactSeries;
const run = (cmd, args) => {
  const child = spawn(cmd, args, { cwd: tip, stdio: ["ignore", "pipe", "pipe"] });
  child.out = "";
  child.stdout.on("data", (d) => (child.out += d));
  child.stderr.on("data", (d) => (child.out += d));
  children.push(child);
  return child;
};
const started = (child, re) => new Promise((resolve, reject) => {
  const t = setInterval(() => re.test(child.out) && (clearInterval(t), resolve()), 20);
  child.once("exit", (c) => (clearInterval(t), reject(new Error(`exited ${c}: ${child.out}`))));
});

const cert = ["--cert-pem", "server/dev-cert/cert.pem", "--key-pem", "server/dev-cert/key.pem"];
const server = path.join(tip, "target/release/series-server");
const lossy = run(server, ["--port", "4433", "--series", path.join(dir, `${id}.sbnd`), ...cert, ...words(arg("--lossy-args"))]);
const exact = run(server, ["--port", "4434", "--series", path.join(dir, `${exactId}.sbnd`), ...cert, ...words(arg("--exact-args"))]);
const transport = readFileSync(path.join(tip, "client/dev-transport.json"), "utf8");
const exactOnly = process.argv.includes("--exact-only");
writeFileSync(`${T}/transport.json`, exactOnly ? transport : transport.replace(":4433", ":5433"));
writeFileSync(`${T}/exact-transport.json`, transport.replace(":4433", ":5434"));
const relay = run("python3", [path.join(HERE, "../scripts/link_impair.py"), ...(WINDOWS ? ["--control-port", String(CONTROL)] : []), ...(exactOnly ? [] : ["--udp", "5433:4433"]), "--udp", "5434:4434", ...words(arg("--link"))]);
const host = run("python3", [path.join(arg("--host", tip), "server/dev-server.py"), "--port", "8765", "--metadata", path.join(dir, `${id}.metadata.json`),
  "--transport", `${T}/transport.json`, "--exact-metadata", path.join(dir, `${exactId}.metadata.json`),
  "--exact-transport", `${T}/exact-transport.json`]);
await Promise.all([started(lossy, /transport=/), started(exact, /transport=/), started(host, /port=8765/), started(relay, /READY/)]);

function watch() {
  globalThis.__log = [];
  addEventListener("DOMContentLoaded", () => {
    for (const id of ["quality", "overlay", "status"]) {
      const el = document.getElementById(id);
      new MutationObserver(() => globalThis.__log.push({ t: performance.now(), id, text: el.hidden ? "" : el.textContent,
        frame: Number(document.getElementById("status").textContent.match(/^frame (\d+)/)?.[1]) }))
        .observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    }
  });
}

async function control(cmd) {
  const s = dgram.createSocket("udp4");
  await new Promise((done) => s.send(cmd, CONTROL, "127.0.0.1", done));
  s.close();
}

const row = { id, jumpAfterMs: JUMP === undefined ? null : Number(JUMP), exactId, host: arg("--host", tip), cpuThrottle: Number(arg("--cpu-throttle", 1)), link: arg("--link"), exactOnly, leadMs: arg("--lead-ms") === undefined ? null : Number(arg("--lead-ms")), lossyArgs: arg("--lossy-args", ""), exactArgs: arg("--exact-args", ""), frame: FRAME };
const browser = await createRequire(import.meta.url)("playwright").chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.addInitScript(watch);
  if (row.cpuThrottle !== 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: row.cpuThrottle });
  await page.goto("http://127.0.0.1:8765/?overlay=1&view=page");
  const log = () => page.evaluate(() => globalThis.__log);
  const until = async (pred, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(20)) if (pred(await log())) return true;
    return false;
  };
  const picture = (l) => l.find((e) => e.id === "quality" && e.text);
  await until(picture, 600000);
  row.firstPictureMs = Math.round(picture(await log())?.t) || null;
  if (JUMP !== undefined && row.firstPictureMs) {
    const n = lossyMeta.frameCount;
    await page.waitForTimeout(Number(JUMP));
    await control("window");
    const before = await page.evaluate(() => performance.now());
    await page.keyboard.press("End");
    const painted = (l) => l.find((e) => e.id === "overlay" && e.text && e.frame === n && e.t > before);
    row.jumped = await until(painted, 120000);
    row.jumpAt = Math.round(before);
    row.jumpMs = row.jumped ? Math.round(painted(await log()).t - before) : null;
    await control("window");
  }
  const status = (l) => l.findLast((e) => e.id === "status")?.text ?? "";
  row.filled = await until((l) => /fill \d+ ms/.test(status(l)), 600000);
  const n = lossyMeta.frameCount;
  const all = (await log()).find((e) => e.id === "status" && new RegExp(`received ${n}\\b`).test(e.text));
  row.fillMs = all ? Math.round(all.t) : null;
  row.status = status(await log());
  if (row.filled && JUMP === undefined) {
    const key = { first: null, middle: null, last: "End" }[FRAME];
    if (FRAME === "middle") for (let i = 0; i < Math.floor(n / 2); i++) await page.keyboard.press("ArrowRight");
    if (key) await page.keyboard.press(key);
    if (WINDOWS) await control("window");
    await page.waitForTimeout(QUIET);
    if (row.leadMs !== null) {
      await page.dispatchEvent("#lossless", "pointerdown");
      await page.waitForTimeout(row.leadMs);
    }
    if (WINDOWS) await control("window");
    const pressed = await page.evaluate(() => performance.now());
    if (row.leadMs !== null) await page.dispatchEvent("#lossless", "click");
    else await page.keyboard.press("l");
    const quality = (l) => l.findLast((e) => e.id === "quality")?.text ?? "";
    row.lossless = await until((l) => /^(✓ )?Lossless$/.test(quality(l)), 120000);
    const done = (await log()).findLast((e) => e.id === "quality");
    row.losslessMs = row.lossless ? Math.round(done.t - pressed) : null;
    if (WINDOWS) await control("window");
    row.label = quality(await log());
    row.shown = status(await log()).match(/^frame (\d+)/)?.[1];
    row.statusAfter = status(await log());
  }
} catch (e) {
  row.error = e.message;
} finally {
  await browser.close();
}
await new Promise((done) => (relay.once("exit", done), relay.kill("SIGTERM")));
row.relay = relay.out.trim().split("\n").filter((s) => !/^READY/.test(s));
stop();
console.log(JSON.stringify(row));
process.exit(0);
