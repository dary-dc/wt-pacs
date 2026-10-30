// The client cache's owed cells, M1–M5, in headless Chromium: docs/adr/frame-path.md §Proposed, *Pre-registered 2026-10-27*.
//
//   NODE_PATH=$(npm root -g) PYTHON=.venv/bin/python node lab/opfs-cache/run.mjs --cell m1|m2|m2-13g|m2-trace|m3|m4|m5|m5-busy --out rows.jsonl
//     [--rounds 7] [--engine chromium|firefox] [--mutant NAME [--arm ARM]]
import { execFileSync, spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { order } from "../order.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const HERE = new URL(".", import.meta.url).pathname;
const BIN = path.resolve(ROOT, process.env.CARGO_TARGET_DIR || "target", "release");
const WORK = path.join(HERE, "work");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CELL = arg("--cell");
const OUT = path.resolve(arg("--out", path.join(WORK, `${CELL}.jsonl`)));
const ROUNDS = Number(arg("--rounds", 7));
/** The round a cell resumes at, its interleaved order unchanged: rows already written for earlier rounds stand. */
const FIRST_ROUND = Number(arg("--first-round", 0));
const MUTANT = arg("--mutant", "");
const ENGINE = arg("--engine", "chromium");
// MiB the store may hold in Firefox: its per-site limit is a fifth of this pref, in KiB (ActorsParent.cpp 1413–1416). M5's series is 2.03 GiB.
const FIREFOX_LIMIT_MIB = CELL?.startsWith("m5") ? 4096 : 1300;
const PYTHON = process.env.PYTHON || "python3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { chromium } = createRequire(import.meta.url)("playwright");
const children = new Set();
process.on("exit", () => { for (const c of children) try { process.kill(-c.pid, "SIGKILL"); } catch {} });
mkdirSync(WORK, { recursive: true });

function own(cmd, args, opts = {}) {
  const c = spawn(cmd, args, { detached: true, stdio: ["ignore", "pipe", "inherit"], ...opts });
  children.add(c);
  c.once("exit", () => children.delete(c));
  return c;
}
const started = (child, stream, re) => new Promise((resolve, reject) => {
  let out = "";
  child[stream].on("data", (d) => { out += d; const m = re.exec(out); if (m) resolve(m); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});
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

let origin = null;
async function staticHost() {
  if (origin) return origin;
  const http = own("python3", [path.join(ROOT, "server/dev-server.py"), "--port", "0"]);
  const [, p] = await started(http, "stdout", /port=(\d+)/);
  return (origin = `http://127.0.0.1:${p}`);
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
const armsUrl = (s, wt, a) => `${origin}/lab/opfs-cache/arms.html?${new URLSearchParams({ wt, hash: cert.hash, metadata: s.metadata, sha: s.sha, ...a.query })}`;
const reopenUrl = (s, key) => `${origin}/lab/opfs-cache/reopen.html?${new URLSearchParams({ key, metadata: s.metadata, sha: s.sha })}`;

/** M5's credits: dispatch only while fewer than `cfg.credits` frames are unacknowledged, and each ack dispatches again. */
const CREDIT_GATE = ["decoders.some((d) => d.outstanding < cfg.perDecoder); ) {",
  `decoders.some((d) => d.outstanding < cfg.perDecoder) && [...records.values()].filter((r) => r.state === "decoding").length < cfg.credits; ) {`];
const ACK_PUMPS = ["return void (m.gen === generation && records.delete(m.index));", "return void (m.gen === generation && records.delete(m.index), pump());"];

/** The fill's last frame fails once its decoder holds a slot: a test of the release, not a mutant. */
const THROWS_AFTER_SLOT = ["    if (exact) {", `    if (m.index === 78) throw new Error("throws-after-slot");\n    if (exact) {`];

/** The rig's stand-ins for the product's files, served in their place: the store switched off, and the mutants. */
const STAND_INS = {
  off: { file: "client/viewer/store.js", body: () => `onmessage = ({ data }) => postMessage({ id: data.id, error: "off" });` },
  "window-never-drops": { file: "client/viewer/viewer.js", from: "function trim() {\n", to: "function trim() {\n  return;\n" },
  "evict-most-recent": { file: "client/viewer/store.js", from: "others.sort((a, b) => a.opened - b.opened);", to: "others.sort((a, b) => b.opened - a.opened);" },
  "evict-without-probe": { file: "client/viewer/store.js", from: "(await frames.createSyncAccessHandle()).close();\n", to: "" },
  "shared-to-store": { file: "client/viewer/viewer.js", from: `call("write", { index, info: { ...info, pixels } }, [pixels])`, to: `call("write", { index, info })` },
  "read-without-check": { file: "client/viewer/store.js", from: `if (xxh3.init().update(bytes).digest("hex") !== series.digests[index]) {`, to: "if (false) {" },
  credits: { file: "client/transport/downloader.js", edits: [CREDIT_GATE, ACK_PUMPS] },
  "credits-ignored": { file: "client/transport/downloader.js", edits: [ACK_PUMPS] },
  "slots-never-freed": { file: "lab/opfs-cache/arms-view.js", from: "if (h.slot !== undefined) ring.free(h.slot);", to: "" },
  "fresh-when-dry": { file: "lab/opfs-cache/arms-decoder.js", from: `dry.postMessage("dry");\n    ring.waitFree(seen);`,
    to: "return { bytes: new Uint8Array(new SharedArrayBuffer(ring.slotBytes)), waits, waitedMs: 0 };" },
  "disk-keeps-frames": { file: "lab/opfs-cache/arms-decoder.js", from: `into.slot === undefined && arm !== "disk" ?`, to: "into.slot === undefined ?" },
  "throws-after-slot": { file: "lab/opfs-cache/arms-decoder.js", edits: [THROWS_AFTER_SLOT] },
  "throws-slot-kept": { file: "lab/opfs-cache/arms-decoder.js", edits: [THROWS_AFTER_SLOT, ["if (into?.slot !== undefined) ring.free(into.slot);", ""]] },
};
const editsOf = (s) => s.edits ?? (s.from === undefined ? [] : [[s.from, s.to]]);
function edited(name, body) {
  for (const [from, to] of editsOf(STAND_INS[name])) {
    if (!body.includes(from)) throw new Error(`stand-in ${name}: its text is not in ${STAND_INS[name].file}`);
    body = body.replace(from, to);
  }
  return body;
}
/** Written over the file and put back by `putBack`: a route in Chromium misses the scripts a worker's own workers load. */
function standIn(name) {
  const f = path.join(ROOT, STAND_INS[name].file);
  const was = readFileSync(f, "utf8");
  writeFileSync(f, STAND_INS[name].body?.() ?? edited(name, was));
  restore.push(() => writeFileSync(f, was));
}
const putBack = () => { for (const r of restore.splice(0).reverse()) r(); };

/** Chromium on a profile of its own, and the browser process's pid, for PSS and for a kill. */
async function browser(profile, standIns = [], args = []) {
  for (const s of standIns) standIn(s);
  if (ENGINE === "firefox") return firefox(profile);
  const before = new Set(readdirSync("/proc"));
  const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1024, height: 768 }, args });
  const pid = Number(readdirSync("/proc").find((p) => !before.has(p) && /^\d+$/.test(p) && parent(p) === String(process.pid)));
  return { context, pid, page: context.pages()[0] ?? (await context.newPage()) };
}
/** Firefox over WebDriver BiDi on an Xvfb display (headless it has no WebGL). */
async function firefox(profile) {
  writeFileSync(path.join(profile, "user.js"), [`user_pref("browser.shell.checkDefaultBrowser", false);`,
    `user_pref("dom.quotaManager.temporaryStorage.fixedLimit", ${FIREFOX_LIMIT_MIB * 5 * 1024});`,
    `user_pref("browser.cache.disk.enable", false);`, `user_pref("browser.sessionstore.resume_from_crash", false);`].join("\n") + "\n");
  const ff = own(process.env.FIREFOX_PATH, ["--no-remote", "--profile", profile, "--remote-debugging-port", "0", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":99" } });
  const [, ws] = await started(ff, "stderr", /WebDriver BiDi listening on (ws:\/\/\S+)/);
  const sock = new WebSocket(`${ws}/session`);
  await new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = reject; });
  let id = 0;
  const waiting = new Map();
  sock.onmessage = (m) => {
    const r = JSON.parse(m.data);
    const w = waiting.get(r.id);
    waiting.delete(r.id);
    if (w) r.type === "error" ? w.reject(new Error(`${r.error}: ${r.message}`)) : w.resolve(r.result);
  };
  // A call Firefox never answers fails after BIDI_MS instead of hanging the cell.
  const send = (method, params) => new Promise((resolve, reject) => {
    const at = ++id;
    const timer = setTimeout(() => (waiting.delete(at), reject(new Error(`${method}: no answer in ${BIDI_MS} ms`))), BIDI_MS);
    waiting.set(at, { resolve: (r) => (clearTimeout(timer), resolve(r)), reject: (e) => (clearTimeout(timer), reject(e)) });
    sock.send(JSON.stringify({ id: at, method, params }));
  });
  await send("session.new", { capabilities: {} });
  const tab = (context) => {
    let at = "about:blank";
    return {
      url: () => at,
      goto: async (url) => { at = url; await send("browsingContext.navigate", { context, url, wait: "complete" }); },
      async evaluate(fn) {
        const r = await send("script.evaluate", { expression: `(async () => JSON.stringify(await (${fn})()))()`, target: { context }, awaitPromise: true });
        if (r.type === "exception") throw new Error(r.exceptionDetails.text);
        return JSON.parse(r.result.value);
      },
      close: () => send("browsingContext.close", { context }),
    };
  };
  const first = (await send("browsingContext.getTree", {})).contexts[0].context;
  return {
    pid: ff.pid, page: tab(first),
    context: {
      newPage: async () => tab((await send("browsingContext.create", { type: "tab" })).context),
      close: async () => {
        await send("browser.close", {}).catch(() => {});
        const exited = new Promise((r) => (ff.exitCode !== null ? r() : ff.once("exit", r)));
        await Promise.race([exited, sleep(10000).then(() => process.kill(-ff.pid, "SIGKILL"))]);
        await exited;
      },
    },
  };
}
const BIDI_MS = 60000;
const restore = [];
process.on("exit", putBack);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));

function parent(p) {
  try { return readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1]; } catch { return null; }
}
function tree(root) {
  const kids = new Map();
  for (const p of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) kids.set(parent(p), [...(kids.get(parent(p)) ?? []), p]);
  const all = [];
  for (const todo = [String(root)]; todo.length;) { const p = todo.pop(); all.push(p); todo.push(...(kids.get(p) ?? [])); }
  return all;
}
/** MiB, shared pages counted once across the browser's processes. */
function treePss(root) {
  let kib = 0;
  for (const p of tree(root)) try { kib += parseInt(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${p}/smaps_rollup`, "utf8"))[1], 10); } catch {}
  return kib / 1024;
}
/** MiB of the host's page cache, which OPFS files fill and no process's PSS counts. */
const cached = () => Number(/^Cached:\s+(\d+)/m.exec(readFileSync("/proc/meminfo", "utf8"))[1]) / 1024;
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
async function fill(b, s, wt, { deadlineS = 1800, until, url = viewerUrl(s, wt) } = {}) {
  const t0 = Date.now();
  const cached0 = cached();
  let st = statusOf(""), peak = 0, lastSample = 0, cachedPeak = 0;
  try {
    await b.page.goto(url);
  } catch (e) {
    return { ...st, peakPssMiB: treePss(b.pid), stoppedBy: `rig: ${e.message}` };
  }
  while (Date.now() - t0 < deadlineS * 1000) {
    await sleep(100);
    if (Date.now() - lastSample >= 1000) { peak = Math.max(peak, treePss(b.pid)); cachedPeak = Math.max(cachedPeak, cached() - cached0); lastSample = Date.now(); }
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
  return { ...st, peakPssMiB: peak, pageCacheGrowthMiB: cachedPeak, wallS: (Date.now() - t0) / 1000 };
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
  const chrome = execFileSync(ENGINE === "firefox" ? process.env.FIREFOX_PATH : chromium.executablePath(), ["--version"]).toString().trim();
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
      putBack();
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
    putBack();
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
    putBack();
    drop(dir);
    const asked = s.n - after.present.length;
    write({ cell: "m4", round, mutant: MUTANT || null, onDiskAtKill: atKill.onDisk, presentAfterKill: after.present.length, flipped,
      reopen: { receivedAtFillEnd: again.received, received: shown.received, exact: shown.exact, inexact: shown.inexact, error: shown.error, fillMs: again.fillMs },
      receivedPredicted: asked + (flipped === 0 ? 1 : 0), end,
      holds: after.present.length >= atKill.onDisk && shown.inexact === 0 && shown.received === asked + (flipped === 0 ? 1 : 0) && end.read === s.n && !end.wrong.length && !end.misses.length &&
        (flipped === null || flipped !== 0 || /did not match/.test(shown.error ?? "")) });
  }
}

/** Unacknowledged frames the downloader may hold under credits: its decoders × `perDecoder`, so credits bind only on a view that falls behind. */
const K = 6;
/** ms the busy cell holds the view per frame: twice M2's measured delivery period, 7.87 s over 80 frames. */
const BUSY_MS = 200;
const M5_ARMS = {
  ring: { query: { arm: "ring" } },
  ring2: { query: { arm: "ring" } },
  transfer: { query: { arm: "transfer" } },
  "transfer-k": { query: { arm: "transfer", credits: K }, standIns: ["credits"] },
  disk: { query: { arm: "disk" } },
  today: { today: true },
};

/** M5 as amended, before any data: docs/adr/frame-path.md §Who owns a frame's memory, M5 amended. */
async function m5(busy) {
  await staticHost();
  const s = series(3328, 4096, 80);
  const server = await serve(s);
  const names = MUTANT ? [arg("--arm")] : busy ? ["ring", "ring2", "transfer", "transfer-k"] : Object.keys(M5_ARMS);
  const arms = Object.fromEntries(names.map((k) => [k, busy ? { ...M5_ARMS[k], query: { ...M5_ARMS[k].query, holdMs: BUSY_MS } } : M5_ARMS[k]]));
  settings({ series: s, decodedMiB: (s.n * s.frameBytes) / 2 ** 20, window: "256 MiB", link: "loopback, no relay", K, arms, firstRound: FIRST_ROUND });
  for (let round = FIRST_ROUND; round < ROUNDS; round++) {
    for (const arm of order(names, round)) {
      const a = arms[arm];
      const dir = profile(`m5-${arm}`);
      // A mutant of a file the arm already stands in for takes its place.
      const own = (a.standIns ?? []).filter((x) => !MUTANT || STAND_INS[x].file !== STAND_INS[MUTANT].file);
      const b = await browser(dir, [...own, ...(MUTANT ? [MUTANT] : [])]);
      await sleep(1000);
      const baseline = treePss(b.pid);
      const before = cpuBusy();
      const f = await fill(b, s, server.url, { deadlineS: 120, ...(!a.today && { url: armsUrl(s, server.url, a) }) });
      const cpu = busyShare(before, cpuBusy());
      const settled = (p) => Promise.race([b.page.evaluate(p), sleep(10000).then(() => ({ error: "no answer in 10 s" }))]);
      const view = a.today ? null : await settled(() => globalThis.armsResult).catch((e) => ({ error: e.message }));
      const second = a.today || f.exact !== s.n ? null : await settled(() => globalThis.verify()).catch((e) => ({ error: e.message }));
      await b.context.close();
      putBack();
      drop(dir);
      write({ cell: busy ? "m5-busy" : "m5", engine: ENGINE, round, arm, mutant: MUTANT || null, baselineMiB: baseline, growthMiB: f.peakPssMiB - baseline, cpuBusy: cpu, ...f, view, second });
    }
  }
}

const cells = { m1, m2: () => m2(false), "m2-13g": () => m2(true), "m2-trace": m2Trace, m3, m4, m5: () => m5(false), "m5-busy": () => m5(true) };
if (CELL?.startsWith("m5") && MUTANT && !Object.hasOwn(M5_ARMS, arg("--arm") ?? "")) {
  console.error(`--mutant on ${CELL} names the arm it runs on: --arm ${Object.keys(M5_ARMS).join("|")}`);
  process.exit(2);
}
await cells[CELL]();
process.exit(0);
