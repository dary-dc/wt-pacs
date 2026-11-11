// The demo's check: an optimal-quality series and its exact series from scripts/demo-series.sh, served by README §Demo's own
// commands, opened as a reader would, and every claim of the demo failed by name. README.md §Demo
//
//   node client/viewer/demo-check.mjs DIR LOSSY_ID [--route av1-webcodecs|av1-dav1d] [--refuse-webcodecs] [--view page|worker] [--link "OPTIONS"] [--json]
//     DIR as demo-series.sh wrote it: ID.sbnd and ID.metadata.json for LOSSY_ID and its exactSeries
//     --refuse-webcodecs: the lab's refuseWebCodecs lever, so every frame must reach dav1d with that refusal named
//     --link: both series' sessions through one lab/scripts/link_impair.py with OPTIONS, a phone on lossy wireless
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const [dir, id] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const REFUSE = process.argv.includes("--refuse-webcodecs");
const ROUTE = REFUSE ? "av1-dav1d" : arg("--route", "av1-webcodecs");
const LEVERS = REFUSE ? `&opts=${encodeURIComponent(JSON.stringify({ refuseWebCodecs: true }))}` : "";
const VIEW = arg("--view", "page");
const LINK = arg("--link");
const T = mkdtempSync(path.join(tmpdir(), "demo-check-"));
const children = [];
const stop = () => { for (const c of children.splice(0)) c.kill("SIGKILL"); };
process.on("exit", () => { stop(); rmSync(T, { recursive: true, force: true }); });
const failures = [];
const check = (ok, claim) => ok || (failures.push(claim), false);
/** A claim the rest of a pass waits on: the check ends there. */
const must = (ok, claim) => { if (!ok) throw new Error(claim); };

const file = (name) => {
  const p = path.join(dir, name);
  if (!existsSync(p)) throw new Error(`${p} missing: run scripts/demo-series.sh ${dir}`);
  return p;
};
const lossyMeta = JSON.parse(readFileSync(file(`${id}.metadata.json`)));
const exactId = lossyMeta.exactSeries;
const exactMetaPath = file(`${exactId}.metadata.json`);

const started = (child, re) => new Promise((resolve, reject) => {
  let out = "";
  const read = (d) => { out += d; if (re.test(out)) resolve(); };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});
const run = (cmd, args) => {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return child;
};

/** README §Demo's three servers; `exactMeta`, the exact series' metadata file the static host serves. */
async function serve(exactMeta) {
  const cert = ["--cert-pem", "server/dev-cert/cert.pem", "--key-pem", "server/dev-cert/key.pem"];
  // Renewed before the servers load it: the static host would renew it after, and the page would pin a hash they lack.
  await new Promise((resolve, reject) => run("server/scripts/gen_dev_cert.sh", ["--if-needed"])
    .once("exit", (c) => (c === 0 ? resolve() : reject(new Error(`gen_dev_cert.sh --if-needed exited ${c}`)))));
  const server = path.join(process.env.CARGO_TARGET_DIR || "target", "release/series-server");
  const lossy = run(server, ["--port", "4433", "--series", file(`${id}.sbnd`), ...cert]);
  const exact = run(server, ["--port", "4434", "--series", file(`${exactId}.sbnd`), ...cert]);
  const transport = readFileSync(path.join(ROOT, "client/dev-transport.json"), "utf8");
  // Under --link the page dials the relay, 1000 above each server's port.
  const [toLossy, toExact] = LINK ? [":5433", ":5434"] : [":4433", ":4434"];
  if (LINK) writeFileSync(`${T}/transport.json`, transport.replace(":4433", toLossy));
  writeFileSync(`${T}/exact-transport.json`, transport.replace(":4433", toExact));
  const link = LINK && run("python3", ["lab/scripts/link_impair.py", "--udp", "5433:4433", "--udp", "5434:4434", ...LINK.split(/\s+/)]);
  const host = run("python3", ["server/dev-server.py", "--port", "8765", "--metadata", path.join(dir, `${id}.metadata.json`),
    ...(LINK ? ["--transport", `${T}/transport.json`] : []), "--exact-metadata", exactMeta, "--exact-transport", `${T}/exact-transport.json`]);
  await Promise.all([started(lossy, /transport=/), started(exact, /transport=/), started(host, /port=8765/), link && started(link, /READY/)]);
}

/** The relay's own count of what crossed it, read as it stops. */
async function tally() {
  const relay = children.find((c) => c.spawnargs.includes("lab/scripts/link_impair.py"));
  let out = "";
  relay.stdout.on("data", (d) => (out += d));
  await new Promise((done) => (relay.once("exit", done), relay.kill("SIGTERM")));
  return out.trim().split("\n");
}

/** Each write to the label, the overlay and the status line, timed on the page's clock; the overlay is written on every paint. */
function watch() {
  globalThis.__log = [];
  addEventListener("DOMContentLoaded", () => {
    for (const id of ["quality", "overlay", "status"]) {
      const el = document.getElementById(id);
      new MutationObserver(() => {
        const frame = Number(document.getElementById("status").textContent.match(/^frame (\d+)/)?.[1]);
        globalThis.__log.push({ t: performance.now(), id, text: el.hidden ? "" : el.textContent, frame });
      }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    }
  });
}

/** One reader's pass: open, scroll in order, Home, End (a jump), `l` and `l` again. */
async function pass(browser, query) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(watch);
  await page.goto(`http://127.0.0.1:8765/?overlay=1&view=${VIEW}${LEVERS}${query}`);
  const log = () => page.evaluate(() => globalThis.__log);
  const now = () => page.evaluate(() => performance.now());
  const until = async (pred, ms = 60000) => {
    for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(20)) if (await pred(await log())) return true;
    return false;
  };
  const shown = (i, after) => until((l) => l.some((e) => e.id === "overlay" && e.text && e.frame === i + 1 && e.t > after), 30000);
  const n = lossyMeta.frameCount;
  const filling = !query.includes("fill=0");
  const status = async () => (await log()).findLast((e) => e.id === "status")?.text;
  if (filling) must(await until((l) => /fill \d+ ms/.test(l.findLast((e) => e.id === "status")?.text), 120000), `${query}: the fill completes in 120 s: ${await status()}`);
  must(await shown(0, 0), `${query}: frame 1 painted`);
  const steps = [];
  for (let i = 1; i < (filling ? n : Math.min(n, 13)); i++) {
    const t = await now();
    await page.keyboard.press("ArrowRight");
    must(await shown(i, t), `${query}: frame ${i + 1} painted after its step`);
    steps.push(Math.round((await log()).findLast((e) => e.id === "overlay").t - t));
  }
  const home = await now();
  await page.keyboard.press("Home");
  must(await shown(0, home), `${query}: Home painted frame 1`);
  const before = await now();
  await page.keyboard.press("End");
  must(await shown(n - 1, before), `${query}: the jump to frame ${n} painted`);
  const jumpMs = Math.round((await log()).findLast((e) => e.id === "overlay").t - before);
  const pressed = await now();
  await page.keyboard.press("l");
  await until((l) => /^✓ Lossless/.test(l.findLast((e) => e.id === "quality")?.text), 30000);
  const losslessMs = Math.round((await log()).findLast((e) => e.id === "quality").t - pressed);
  const labelled = (l) => l.filter((e) => e.id === "quality");
  const writes = labelled(await log()).length;
  await page.keyboard.press("l");
  // Settled: back at optimal quality, or, after a failed check, the retry answered.
  await until((l) => labelled(l).length > writes && !/fetching/.test(labelled(l).at(-1).text), 60000);
  const l = await log();
  await page.close();
  const overlays = l.filter((e) => e.id === "overlay" && e.text);
  const lossless = l.findIndex((e) => e.id === "quality" && e.text === LABELS[2]);
  const received = [];
  for (const e of l.filter((e) => e.id === "status")) {
    const k = Number(e.text.match(/received (\d+)/)?.[1] ?? 0);
    while (received.length < k) received.push(Math.round(e.t));
  }
  return {
    query, errors, steps, jumpMs, losslessMs,
    labels: l.filter((e) => e.id === "quality" && e.text).map((e) => e.text).filter((t, k, a) => t !== a[k - 1]),
    firstPictureMs: Math.round(overlays[0]?.t), receivedMs: received,
    frames: Object.values(Object.fromEntries(overlays.filter((e) => !e.text.startsWith("htj2k")).map((e) => [e.frame, e.text]))),
    paintedWithLossless: lossless < 0 ? null : l.slice(lossless + 1).find((e) => e.id === "overlay")?.text,
    status: l.findLast((e) => e.id === "status")?.text,
  };
}

const LABELS = ["Optimal quality", "Optimal quality · fetching lossless…", "✓ Lossless", "Optimal quality"];
const FAILED = "Lossless check failed · optimal quality shown";
const routeOf = (overlay) => overlay.match(/^(\S+)( after WebCodecs refused: (.*?))? · ([\d.]+) KB · decode ([\d.]+) ms/);

function judge(r) {
  // The label and the overlay are written by one paint, the label first: the overlay after it names what was painted.
  check(r.paintedWithLossless?.startsWith("htj2k"), `${r.query}: Lossless written with ${r.paintedWithLossless ?? "no paint"}, not the exact frame's`);
  check(r.status?.includes(` · view ${VIEW} · `), `${r.query}: the frames held in ${r.status?.match(/view (\w+)/)?.[1]}, not ${VIEW}`);
  check(r.errors.length === 0, `${r.query}: console errors ${JSON.stringify(r.errors)}`);
  for (const f of r.frames) {
    const m = routeOf(f);
    check(m?.[1] === ROUTE, `${r.query}: a frame decoded by ${m?.[1]}, not ${ROUTE}: ${f}`);
    check(m?.[1] !== "av1-dav1d" || m[3], `${r.query}: dav1d without WebCodecs' refusal named: ${f}`);
    check(!REFUSE || /refuseWebCodecs/.test(m?.[3]), `${r.query}: the lab's refusal not named: ${f}`);
  }
}

const browser = await createRequire(import.meta.url)("playwright").chromium.launch();
const report = { id, exactId, passes: [] };
try {
  await serve(exactMetaPath);
  for (const query of ["", "&fill=0"]) {
    const r = await pass(browser, query);
    judge(r);
    check(JSON.stringify(r.labels) === JSON.stringify(LABELS), `${query}: the label ran ${JSON.stringify(r.labels)}, not ${JSON.stringify(LABELS)}`);
    if (query) {
      const g = lossyMeta.lossy.g;
      const groups = new Set([...Array(13).keys()].map((i) => Math.floor(i / g))).add(Math.floor((lossyMeta.frameCount - 1) / g));
      const want = [...groups].reduce((s, k) => s + Math.min(g, lossyMeta.frameCount - k * g), 0);
      check(r.status.includes(`received ${want},`), `${query}: on demand, 13 steps and a jump asked the whole groups, ${want} frames: ${r.status}`);
    }
    report.passes.push(r);
  }
  if (LINK) report.link = await tally();
  stop();
  // The exact frame's digest made wrong: the label must say the check failed, and never Lossless.
  const bad = JSON.parse(readFileSync(exactMetaPath));
  const last = bad.digests.frames.length - 1;
  bad.digests.frames[last] = bad.digests.frames[last].replace(/^./, (c) => (c === "0" ? "1" : "0"));
  writeFileSync(`${T}/bad.json`, JSON.stringify(bad));
  await serve(`${T}/bad.json`);
  const r = await pass(browser, "&fill=0");
  // The pass's second `l` lands on the failed label, so it asks again (the retry) and fails again.
  const RETRIED = [LABELS[0], LABELS[1], FAILED, LABELS[1], FAILED];
  check(JSON.stringify(r.labels) === JSON.stringify(RETRIED), `a wrong digest, \`l\` and its retry: the label ran ${JSON.stringify(r.labels)}, not ${JSON.stringify(RETRIED)}`);
  report.tampered = r.labels;
} catch (e) {
  failures.push(e.message);
} finally {
  await browser.close();
  stop();
}
if (process.argv.includes("--json")) console.log(JSON.stringify(report));
else {
  for (const r of report.passes) {
    const kb = r.frames.reduce((s, f) => s + Number(routeOf(f)?.[4] ?? 0), 0);
    console.log(`${id}${r.query || " (fill)"}: first picture ${r.firstPictureMs} ms, ${r.receivedMs.length} frames by ${r.receivedMs.at(-1)} ms, ` +
      `${kb.toFixed(0)} KB over ${r.frames.length} frames painted, jump ${r.jumpMs} ms, lossless ${r.losslessMs} ms`);
  }
}
for (const line of report.link ?? []) console.log(`link: ${line}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `demo check: ${failures.length} failed` : `demo check: ${id} passed`);
process.exit(failures.length ? 1 : 0);
