// The client cache's owed cells, M1–M4, in headless Chromium: docs/adr/frame-path.md §Proposed, *Pre-registered 2026-10-27*.
//
//   NODE_PATH=$(npm root -g) PYTHON=.venv/bin/python node lab/opfs-cache/run.mjs --cell m1|m2|m2-13g|m2-trace|m3|m4 --out rows.jsonl
//     [--rounds 7] [--mutant name]
import { execFileSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { order } from "../order.mjs";
import { chromiumAt, chromiumPath, firefoxAt, own, staticHost, started, tree, treePss } from "./browser.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const HERE = new URL(".", import.meta.url).pathname;
const BIN = path.resolve(ROOT, process.env.CARGO_TARGET_DIR || "target", "release");
const WORK = path.join(HERE, "work");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CELL = arg("--cell");
const OUT = path.resolve(arg("--out", path.join(WORK, `${CELL}.jsonl`)));
const ROUNDS = Number(arg("--rounds", 7));
const MUTANT = arg("--mutant", "");
const ENGINE = arg("--engine", "chromium");
// MiB the store may hold in Firefox: its per-site limit is a fifth of this pref, in KiB (ActorsParent.cpp 1413–1416).
const FIREFOX_LIMIT_MIB = 1300;
const PYTHON = process.env.PYTHON || "python3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(WORK, { recursive: true });

async function freeUdpPort() {
  const s = createSocket("udp4");
  await new Promise((r) => s.bind(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

/** A series made once per shape and length, with its metadata and each distinct field's SHA-256 under work/. */
function series(w, h, n) {
  const name = `${w}x${h}-${n}`;
  const sbnd = path.join(WORK, `${name}.sbnd`);
  if (!existsSync(sbnd)) {
    execFileSync(PYTHON, ["-I", path.join(ROOT, "lab/viewer-ceiling/make_series.py"), path.join(ROOT, "ingest/.build/openjph"),
      `${BIN}/pack-series`, path.join(WORK, `cs-${w}x${h}`), sbnd, String(w), String(h), String(n)], { stdio: "inherit" });
  }
  const sha = path.join(WORK, `sha-${w}x${h}.json`);
  if (!existsSync(sha)) execFileSync(PYTHON, ["-I", path.join(HERE, "sha.py"), String(w), String(h), sha], { stdio: "inherit" });
  const b = readFileSync(sbnd);
  const at = 16 + 12 * b.readUInt32LE(12);
  writeFileSync(path.join(WORK, `${name}.json`), b.subarray(at, at + b.readUInt32LE(8)));
  return { name, w, h, n, sbnd, frameBytes: w * h * 2, codedBytes: statSync(sbnd).size, metadata: `/lab/opfs-cache/work/${name}.json`, sha: `/lab/opfs-cache/work/sha-${w}x${h}.json` };
}

let cert = null;
function certificate() {
  if (cert) return cert;
  const dir = mkdtempSync(path.join(WORK, "cert-"));
  const [key, pem] = [path.join(dir, "key.pem"), path.join(dir, "cert.pem")];
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", key, "-out", pem,
    "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const hash = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: execFileSync("openssl", ["x509", "-in", pem, "-outform", "DER"]) })
    .toString().split(" ")[0];
  return (cert = { key, pem, hash });
}

async function serve(s) {
  const c = certificate();
  const port = await freeUdpPort();
  const server = own(`${BIN}/series-server`, ["--port", String(port), "--bind", "127.0.0.1", "--series", s.sbnd, "--cert-pem", c.pem, "--key-pem", c.key]);
  await started(server, "stdout", /transport=/);
  return { port, url: `https://127.0.0.1:${port}/` };
}

const LINKS = {
  clean: ["--delay-ms", "20", "--rate-kbit", "20000", "--rate-up-kbit", "20000", "--queue-pkts", "500"],
  loss2: ["--delay-ms", "20", "--rate-kbit", "20000", "--rate-up-kbit", "20000", "--queue-pkts", "500", "--loss", "2"],
};
async function relay(link, to) {
  const port = await freeUdpPort();
  const r = own("python3", [path.join(ROOT, "lab/scripts/link_impair.py"), "--udp", `${port}:${to}`, ...LINKS[link], "--self-timing"],
    { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  r.stdout.on("data", (d) => (out += d));
  r.stderr.on("data", (d) => (out += d));
  await started(r, "stdout", /READY/);
  return {
    url: `https://127.0.0.1:${port}/`,
    stop: async () => { process.kill(r.pid, "SIGTERM"); await new Promise((res) => r.once("exit", res)); return { void: /VOID/.test(out), tally: out.trim().split("\n").slice(-3) }; },
  };
}

const viewerUrl = (s, wt) => `${origin}/?${new URLSearchParams({ wt, hash: cert.hash, metadata: s.metadata })}`;
const reopenUrl = (s, key) => `${origin}/lab/opfs-cache/reopen.html?${new URLSearchParams({ key, metadata: s.metadata, sha: s.sha })}`;

/** The rig's stand-ins for the product's files, served in their place: the store switched off, and the mutants. */
const STAND_INS = {
  off: { file: "client/viewer/store.js", body: () => `onmessage = ({ data }) => postMessage({ id: data.id, error: "off" });` },
  "window-never-drops": { file: "client/viewer/viewer.js", from: "function trim() {\n", to: "function trim() {\n  return;\n" },
  "evict-most-recent": { file: "client/viewer/store.js", from: "others.sort((a, b) => a.opened - b.opened);", to: "others.sort((a, b) => b.opened - a.opened);" },
  "evict-without-probe": { file: "client/viewer/store.js", from: "(await frames.createSyncAccessHandle()).close();\n", to: "" },
  "shared-to-store": { file: "client/viewer/viewer.js", from: `call("write", { index, info: { ...info, pixels } }, [pixels])`, to: `call("write", { index, info })` },
  "read-without-check": { file: "client/viewer/store.js", from: `if (xxh3.init().update(bytes).digest("hex") !== series.digests[index]) {`, to: "if (false) {" },
};
async function standIn(context, name) {
  const s = STAND_INS[name];
  if (!s) return;
  let body = s.body?.() ?? readFileSync(path.join(ROOT, s.file), "utf8");
  if (s.from !== undefined) {
    if (!body.includes(s.from)) throw new Error(`stand-in ${name}: its text is not in ${s.file}`);
    body = body.replace(s.from, s.to);
  }
  await context.route(`**/${s.file}`, (route) => route.fulfill({ status: 200, body, headers: {
    "content-type": "text/javascript", "cross-origin-embedder-policy": "require-corp", "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin", "cache-control": "no-store" } }));
}

/** The engine's browser on a profile of its own, the stand-ins in place: in Chromium routed, in Firefox written over the file and put back. */
async function browser(profile, standIns = [], args = []) {
  if (ENGINE === "firefox") return firefox(profile, standIns);
  const b = await chromiumAt(profile, args);
  for (const s of standIns) await standIn(b.context, s);
  return b;
}
function firefox(profile, standIns) {
  for (const name of standIns) {
    const f = path.join(ROOT, STAND_INS[name].file);
    const was = readFileSync(f, "utf8");
    const body = STAND_INS[name].body?.() ?? was.replace(STAND_INS[name].from, STAND_INS[name].to);
    if (body === was) throw new Error(`stand-in ${name}: its text is not in ${f}`);
    writeFileSync(f, body);
    restore.push(() => writeFileSync(f, was));
  }
  return firefoxAt(profile, { "dom.quotaManager.temporaryStorage.fixedLimit": FIREFOX_LIMIT_MIB * 5 * 1024,
    "browser.cache.disk.enable": false, "browser.sessionstore.resume_from_crash": false });
}
const restore = [];
process.on("exit", () => { for (const r of restore) r(); });

const available = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))[1]) / 1024;
function cpuBusy() {
  const [, ...v] = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).map(Number);
  return { busy: v[0] + v[1] + v[2] + v[5] + v[6] + v[7], total: v.reduce((a, b) => a + b, 0) };
}
const busyShare = (a, b) => (b.busy - a.busy) / (b.total - a.total);

const STATUS = () => document.getElementById("status")?.textContent ?? "";
const statusOf = (text) => ({
  text,
  received: Number(/received (\d+)/.exec(text)?.[1] ?? 0),
  exact: Number(/, exact (\d+)/.exec(text)?.[1] ?? 0),
  inexact: Number(/not exact (\d+)/.exec(text)?.[1] ?? 0),
  onDisk: Number(/on disk (\d+)/.exec(text)?.[1] ?? NaN),
  fillMs: /fill (\d+) ms/.test(text) ? Number(/fill (\d+) ms/.exec(text)[1]) : null,
  error: /error: ([^·]+)/.exec(text)?.[1]?.trim() ?? null,
});

/** The viewer opened on a series and watched to its fill's end, sampling the browser's PSS each second. */
async function fill(b, s, wt, { deadlineS = 1800, until } = {}) {
  const t0 = Date.now();
  await b.page.goto(viewerUrl(s, wt));
  let st = statusOf(""), peak = 0, lastSample = 0;
  while (Date.now() - t0 < deadlineS * 1000) {
    await sleep(100);
    if (Date.now() - lastSample >= 1000) { peak = Math.max(peak, treePss(b.pid)); lastSample = Date.now(); }
    if (available() < 1536) return { ...st, peakPssMiB: peak, stoppedBy: "host saturated: under 1536 MiB available" };
    st = statusOf(await b.page.evaluate(STATUS).catch(() => st.text));
    if (until?.(st)) return { ...st, peakPssMiB: peak, stoppedBy: "until" };
    if (st.fillMs !== null || /^connect/.test(st.error ?? "")) break;
  }
  // The page's fill ends at its last delivery; the store's writes trail it, so the disk count is read once they settle.
  for (let still = 0; still < 30 && st.onDisk < st.exact; ) {
    const last = st.onDisk;
    await sleep(100);
    peak = Math.max(peak, treePss(b.pid));
    st = statusOf(await b.page.evaluate(STATUS));
    still = st.onDisk === last ? still + 1 : 0;
  }
  return { ...st, peakPssMiB: peak, wallS: (Date.now() - t0) / 1000 };
}

/** The viewer's store worker lets go of the series' lock some time after its page is gone, so a held lock is waited out. */
async function reopen(b, s, key) {
  for (let t0 = Date.now(); ;) {
    await b.page.goto(reopenUrl(s, key));
    const r = await b.page.evaluate(() => globalThis.result);
    if (r.error !== "NoModificationAllowedError" || Date.now() - t0 > 20000) return { ...r, lockWaitMs: Date.now() - t0 };
    await sleep(250);
  }
}
async function listed(page) {
  const was = page.url();
  return page.evaluate(async () => {
    const all = await (await navigator.storage.getDirectory()).getDirectoryHandle("series", { create: true });
    const out = [];
    for await (const name of all.keys()) out.push(decodeURIComponent(name));
    return out.sort();
  }).catch((e) => ({ error: `${e.message} on ${was}` }));
}

const profile = (tag) => mkdtempSync(path.join(WORK, `profile-${tag}-`));
const drop = (dir) => rmSync(dir, { recursive: true, force: true });
const write = (row) => { appendFileSync(OUT, JSON.stringify(row) + "\n"); console.log(JSON.stringify(row).slice(0, 400)); };
const settings = (more) => write({ settings: true, cell: CELL, at: new Date().toISOString(), host: hostInfo(), mutant: MUTANT || null, ...more });
function hostInfo() {
  const chrome = execFileSync(ENGINE === "firefox" ? process.env.FIREFOX_PATH : chromiumPath(), ["--version"]).toString().trim();
  const mem = /MemTotal:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))[1];
  return { browser: chrome, cpus: readFileSync("/proc/cpuinfo", "utf8").match(/^processor/gm).length, memMiB: Math.round(mem / 1024) };
}

async function m1() {
  await staticHost();
  const sets = [
    { s: series(512, 512, 256), links: ["clean", "loss2"] },
    { s: series(3328, 4096, 32), links: ["clean"] },
  ];
  for (const { s, links } of sets) {
    const server = await serve(s);
    const kept = profile("m1-kept");
    const warm = await browser(kept);
    const prefill = await fill(warm, s, server.url);
    await warm.context.close();
    settings({ series: s, server: server.url, prefill, arms: { F: "fresh profile, the viewer's fill over the relay", R: "kept profile, reopen.html through client/viewer/store.js" },
      links: Object.fromEntries(links.map((l) => [l, LINKS[l]])) });
    for (const link of links) {
      for (let round = 0; round < ROUNDS; round++) {
        for (const arm of order(["F", "F2", "R", "R2"], round)) {
          const before = cpuBusy();
          let row;
          if (arm.startsWith("F")) {
            const r = await relay(link, server.port);
            const dir = profile("m1-fresh");
            const b = await browser(dir);
            const f = await fill(b, s, r.url);
            const timing = await r.stop();
            const check = await reopen(b, s, r.url);
            await b.context.close();
            drop(dir);
            row = { ms: f.fillMs, exact: f.exact, inexact: f.inexact, received: f.received, onDisk: f.onDisk, error: f.error, relay: timing, readBack: check };
          } else {
            const b = await browser(kept);
            const r = await reopen(b, s, server.url);
            await b.context.close();
            row = { ...r };
          }
          write({ cell: "m1", set: s.name, link, round, arm, cpuBusy: busyShare(before, cpuBusy()), ...row });
        }
      }
    }
    drop(kept);
  }
}

async function m2(big) {
  await staticHost();
  const s = big ? series(3328, 4096, 512) : series(3328, 4096, 80);
  const server = await serve(s);
  const arms = big ? ["on"] : MUTANT ? ["on"] : ["on", "on2", "off", "was"];
  settings({ series: s, decodedMiB: (s.n * s.frameBytes) / 2 ** 20, arms: { on: "the store as built", off: "store.js answering every call with an error (the page's no-OPFS path)", was: "the build before the store was handed copies" },
    window: "256 MiB", link: "loopback, no relay" });
  for (let round = 0; round < ROUNDS; round++) {
    for (const arm of order(arms, round)) {
      const dir = profile(`m2-${arm}`);
      const b = await browser(dir, [...(arm === "off" ? ["off"] : arm === "was" ? ["shared-to-store"] : []), ...(MUTANT ? [MUTANT] : [])]);
      await sleep(1000);
      const baseline = treePss(b.pid);
      const before = cpuBusy();
      const f = await fill(b, s, server.url);
      await b.context.close();
      drop(dir);
      write({ cell: big ? "m2-13g" : "m2", round, arm, mutant: MUTANT || null, baselineMiB: baseline, growthMiB: f.peakPssMiB - baseline, cpuBusy: busyShare(before, cpuBusy()), ...f });
    }
  }
}

/** Not pre-registered: after M2's fill, whether the dropped frames' memory comes back on its own, after a page GC, after a measurement's. */
async function m2Trace() {
  await staticHost();
  const s = series(3328, 4096, 80);
  const server = await serve(s);
  settings({ series: s, arm: "on", flags: "--js-flags=--expose-gc", trace: "PSS each second for 30 s after the fill, then gc() on the page, then in its workers one kind at a time: store, paint, downloader, decoders" });
  for (let round = 0; round < ROUNDS; round++) {
    const dir = profile("m2-trace");
    const b = await browser(dir, MUTANT ? [MUTANT] : [], ["--js-flags=--expose-gc"]);
    await sleep(1000);
    const baseline = treePss(b.pid);
    const f = await fill(b, s, server.url);
    const after = [];
    for (let i = 0; i < 30; i++) { after.push(Math.round(treePss(b.pid) - baseline)); await sleep(1000); }
    await b.page.evaluate(() => globalThis.gc());
    await sleep(2000);
    const afterPageGc = treePss(b.pid) - baseline;
    const workers = b.page.workers().map((w) => w.url().split("/").pop());
    const byWorker = [];
    for (const name of ["store.js", "paint-worker.js", "downloader.js", "decoder.js"]) {
      for (const w of b.page.workers().filter((x) => x.url().endsWith(name))) await w.evaluate(() => globalThis.gc()).catch(() => {});
      await sleep(2000);
      byWorker.push([name, Math.round(treePss(b.pid) - baseline)]);
    }
    const afterWorkerGc = treePss(b.pid) - baseline;
    await b.context.close();
    drop(dir);
    write({ cell: "m2-trace", round, mutant: MUTANT || null, growthMiB: f.peakPssMiB - baseline, fillMs: f.fillMs, exact: f.exact, afterFillMiB: after, afterPageGcMiB: afterPageGc, workers, byWorker, afterWorkerGcMiB: afterWorkerGc });
  }
}

async function m3() {
  await staticHost();
  const s = series(3328, 4096, 20);
  const servers = {};
  for (const k of ["A", "B", "C", "D"]) servers[k] = await serve(s);
  const letter = Object.fromEntries(Object.entries(servers).map(([k, v]) => [v.url, k]));
  const QUOTA = 1300 * 2 ** 20;
  settings({ engine: ENGINE, limit: ENGINE === "firefox" ? `dom.quotaManager.temporaryStorage.fixedLimit = ${FIREFOX_LIMIT_MIB * 5 * 1024} KiB, a per-site ${FIREFOX_LIMIT_MIB} MiB` : `Storage.overrideQuotaForOrigin ${QUOTA}`, seriesBytes: s.n * (s.frameBytes + 12), servers: Object.fromEntries(Object.entries(servers).map(([k, v]) => [k, v.url])) });
  const want = { A: ["A"], B: ["A", "B"], C: ["B", "C"], D: ["B", "D"], A2: ["A", "D"] };
  for (let round = 0; round < ROUNDS; round++) {
    const dir = profile("m3");
    const b = await browser(dir, MUTANT ? [MUTANT] : []);
    await b.page.goto(`${origin}/lab/opfs-cache/reopen.html?list=1`);
    if (ENGINE === "chromium") await (await b.context.newCDPSession(b.page)).send("Storage.overrideQuotaForOrigin", { origin, quotaSize: QUOTA });
    let second = null;
    const steps = [];
    for (const [step, k] of [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["A2", "A"]]) {
      if (step === "B") second = await b.context.newPage();
      if (step === "A2") await second.close();
      const page = step === "B" ? second : b.page;
      const f = await fill({ ...b, page }, s, servers[k].url, { deadlineS: 300 });
      const names = await listed(b.page);
      const on = Array.isArray(names) ? names.map((u) => letter[u] ?? u).sort() : names;
      const usage = await b.page.evaluate(() => navigator.storage.estimate());
      steps.push({ step, onDiskSet: on, want: want[step], holds: JSON.stringify(on) === JSON.stringify(want[step]),
        exact: f.exact, inexact: f.inexact, received: f.received, onDiskShown: f.onDisk, error: f.error, usage });
    }
    const final = [];
    for (const k of want.A2) final.push({ k, ...(await reopen(b, s, servers[k].url)) });
    await b.context.close();
    drop(dir);
    for (const r of restore.splice(0)) r();
    write({ cell: "m3", engine: ENGINE, round, mutant: MUTANT || null, holds: steps.every((x) => x.holds && x.inexact === 0) && final.every((x) => x.read === s.n && !x.wrong.length), steps, final });
  }
}

/** The profile's OPFS file for the series, found by its size, and the present flags in its records. */
function framesFile(dir, s) {
  const size = s.n * (s.frameBytes + 12);
  const found = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : statSync(p).size === size && found.push(p); } };
  walk(dir);
  if (found.length !== 1) throw new Error(`${found.length} files of ${size} bytes in ${dir}`);
  const fd = openSync(found[0], "r");
  const rec = Buffer.alloc(s.n * 12);
  readSync(fd, rec, 0, rec.length, s.n * s.frameBytes);
  closeSync(fd);
  return { file: found[0], present: [...Array(s.n).keys()].filter((i) => rec.readInt32LE(i * 12 + 8) === 1) };
}

async function m4() {
  await staticHost();
  const s = series(3328, 4096, 64);
  const server = await serve(s);
  settings({ series: s, kill: "SIGKILL to the browser's process tree once the status shows >= 32 on disk", flip: "rounds 0, 2, 4, 6: one byte in the middle of frame 0, or the first present, XORed 0xff" });
  for (let round = 0; round < ROUNDS; round++) {
    const dir = profile("m4");
    const b = await browser(dir);
    const atKill = await fill(b, s, server.url, { until: (st) => st.onDisk >= 32 });
    for (const p of tree(b.pid).reverse()) try { process.kill(Number(p), "SIGKILL"); } catch {}
    await sleep(1000);
    const after = framesFile(dir, s);
    let flipped = null;
    if (round % 2 === 0 && after.present.length) {
      flipped = after.present.includes(0) ? 0 : after.present[0];
      const fd = openSync(after.file, "r+");
      const at = flipped * s.frameBytes + (s.frameBytes >> 1);
      const byte = Buffer.alloc(1);
      readSync(fd, byte, 0, 1, at);
      byte[0] ^= 0xff;
      writeSync(fd, byte, 0, 1, at);
      closeSync(fd);
    }
    for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(path.join(dir, lock), { force: true });
    const b2 = await browser(dir, MUTANT ? [MUTANT] : []);
    const again = await fill(b2, s, server.url);
    await sleep(2000);
    const shown = statusOf(await b2.page.evaluate(STATUS));
    const end = await reopen(b2, s, server.url);
    await b2.context.close();
    drop(dir);
    const asked = s.n - after.present.length;
    write({ cell: "m4", round, mutant: MUTANT || null, onDiskAtKill: atKill.onDisk, presentAfterKill: after.present.length, flipped,
      reopen: { receivedAtFillEnd: again.received, received: shown.received, exact: shown.exact, inexact: shown.inexact, error: shown.error, fillMs: again.fillMs },
      receivedPredicted: asked + (flipped === 0 ? 1 : 0), end,
      holds: after.present.length >= atKill.onDisk && shown.inexact === 0 && shown.received === asked + (flipped === 0 ? 1 : 0) && end.read === s.n && !end.wrong.length && !end.misses.length &&
        (flipped === null || flipped !== 0 || /did not match/.test(shown.error ?? "")) });
  }
}

const cells = { m1, m2: () => m2(false), "m2-13g": () => m2(true), "m2-trace": m2Trace, m3, m4 };
await cells[CELL]();
process.exit(0);
