/**
 * BYM: the downloader's media reads, the default reader against a BYOB reader at `readMin` K, on a
 * link that hands the browser one packet at a time — `link_impair.py --trace`, self-timed, a VOID visit
 * dropped. Decode off (Dw) and on (Dd), 1× and 4×, one fresh browser a visit, variants in a Williams order.
 * Every frame's sha256 is checked. docs/CLIENTS.md §Reading a frame whole
 *
 *   NODE_PATH=$(npm root -g) node lab/downloader-cost/reads.mjs [rounds=8] [OUT=rows.jsonl]
 *     [THROTTLES=1,4] [KS=0,whole,65536,16384] [DECODE=0,1] [TRACE=40000:1000] [DELAY_MS=20] [QUEUE_MS=200] [FILL=87]
 * With OUT, a run resumes after OUT's last round and appends to it, so each round can take its own lock hold.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { throttleTree } from "../scripts/cpu_throttle.mjs";
import { sampleTree } from "../scripts/proc_sampler.mjs";
import { leadsByPredecessor, order } from "../order.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 8);
const list = (k, d) => (process.env[k] || d).split(",");
const THROTTLES = list("THROTTLES", "1,4").map(Number);
const WHOLE = 1 << 30;
const KS = list("KS", "0,whole,65536,16384").map((k) => (k === "whole" ? WHOLE : Number(k)));
const DECODE = list("DECODE", "0,1").map((d) => d === "1");
const SET = process.env.SET || "decode_g512";
const T = fs.mkdtempSync(path.join(os.tmpdir(), "bym-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];
const port = () => 30000 + ((Math.random() * 20000) | 0);
process.on("exit", () => {
  for (const k of kids) k.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  else fs.rmSync(CFG, { force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

const src = path.join(ROOT, "lab/fixtures", SET);
const names = fs.readdirSync(src).filter((f) => f.endsWith(".j2c")).sort();
fs.mkdirSync(path.join(T, "frames"));
for (const f of names) fs.copyFileSync(path.join(src, f), path.join(T, "frames", f.replace(".j2c", ".htj2k")));
execFileSync(path.join(ROOT, "target/release/pack-series"), ["--metadata", path.join(src, "metadata.json"),
  "--frames", path.join(T, "frames"), "--output", path.join(T, "set.sbnd")]);
const wireSha = names.map((f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(src, f))).digest("hex"));
const pixelSha = names.map((f) => fs.readFileSync(path.join(src, f.replace(".j2c", ".sha256")), "utf8").trim().split(/\s/)[0]);
const FILL = Math.min(Number(process.env.FILL || names.length), names.length);

const trace = path.join(T, "trace.txt");
fs.writeFileSync(trace, execFileSync("python3", [path.join(ROOT, "lab/scripts/gen_step_trace.py"),
  ...list("TRACE", "40000:1000")]));
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem \
  -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' 2>/dev/null`]);
const hash = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`])
  .toString().trim();
const wt = port();
const front = port();
const http = port();
kids.push(spawn(path.join(ROOT, "target/release/series-server"), ["--port", String(wt), "--bind", "127.0.0.1",
  "--series", path.join(T, "set.sbnd"), "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], { stdio: "ignore" }));
kids.push(spawn("python3", ["server/dev-server.py", "--port", String(http)], { cwd: ROOT, stdio: "ignore" }));
fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${front}/`, cert_sha256: hash }) + "\n");
await new Promise((r) => setTimeout(r, 1500));

/** A fresh relay a visit, so the trace starts with it; its tally says whether the visit stands. */
async function relay() {
  const r = spawn("python3", [path.join(ROOT, "lab/scripts/link_impair.py"), "--udp", `${front}:${wt}`, "--self-timing",
    "--delay-ms", process.env.DELAY_MS || "20", "--trace", trace, "--queue-ms", process.env.QUEUE_MS || "200"]);
  kids.push(r);
  let out = "";
  r.stdout.on("data", (d) => { out += d; });
  while (!out.includes("READY")) await new Promise((res) => setTimeout(res, 50));
  return async () => {
    r.kill("SIGTERM");
    await new Promise((res) => r.on("exit", res));
    return out;
  };
}

async function visit(variant, throttle) {
  const stopRelay = await relay();
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    args: ["--disable-background-networking"] });
  const unthrottle = throttleTree(server.process().pid, throttle);
  let r, kinds, each;
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${http}/lab/downloader-cost/index.html?variant=${variant.decode ? "Dd" : "Dw"}` +
      `&scenario=fill&fill=${FILL}&decoders=3&digest=1&capMs=240000${variant.k ? `&readMin=${variant.k}` : ""}`);
    // Not the default: polling on every animation frame is main-thread work the visit would be charged.
    const wait = (f) => page.waitForFunction(f, null, { timeout: 300000, polling: 200 });
    await wait(() => globalThis.__wtpacsReady || globalThis.__wtpacsDone);
    const sampler = sampleTree(server.process().pid);
    await page.evaluate(() => { globalThis.__wtpacsGo = true; });
    await wait(() => globalThis.__wtpacsScenarioDone || globalThis.__wtpacsDone);
    ({ kinds, each } = sampler.stop());
    await page.evaluate(() => { globalThis.__wtpacsMeasure = true; });
    await wait(() => globalThis.__wtpacsDone);
    r = await page.evaluate(() => globalThis.__wtpacsResult);
    await browser.close();
  } finally {
    await server.close();
    unthrottle();
  }
  const tally = await stopRelay();
  if (r.error) throw new Error(r.error);
  if (tally.includes("VOID")) {
    process.stderr.write(`${tally.match(/self-timing.*/)?.[0]}\n`);
    return null;
  }
  // The downloader is the renderer's first worker; its decoders start after it.
  const downloader = each.filter((t) => t.kind === "renderer" && /DedicatedWorker/.test(t.name)).sort((a, b) => a.tid - b.tid)[0];
  const truth = (variant.decode ? pixelSha : wireSha).slice(0, FILL);
  return { fillMs: r.last_frame_ms, frame0Ms: r.received_ms[0], delivered: r.delivered,
    wrong: truth.filter((h, i) => r.digests?.[i] !== h).length, reads: r.stats.mediaReads / FILL,
    cpuMs: downloader?.cpu_ms ?? NaN, vcs: downloader?.vcs ?? NaN, rendererMb: kinds.renderer?.pss_mb ?? NaN,
    resumes: r.stats.resumedAt?.length ?? 0 };
}

const label = (a) => `${a.decode ? "Dd" : "Dw"} ${a.k === 0 ? "default" : a.k === WHOLE ? "whole" : `${a.k / 1024}K`}`;
const VARIANTS = DECODE.flatMap((decode) => KS.map((k) => ({ decode, k }))).map((a) => ({ ...a, name: label(a) }));
const OUT = process.env.OUT;
const taken = OUT && fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const FIRST = taken.length ? Math.max(...taken.map((r) => r.round)) + 1 : 0;
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  const visits = [];
  for (const throttle of round % 2 ? [...THROTTLES].reverse() : THROTTLES) {
    let prev = null;
    for (const variant of order(VARIANTS, round)) {
      const r = await visit(variant, throttle);
      if (!r) {
        process.stderr.write(`round ${round} ${throttle}x ${variant.name}: VOID, dropped\n`);
        visits.push({ round, throttle, unit: variant.name, prev, void: true });
      } else {
        visits.push({ round, throttle, unit: variant.name, prev, ...r });
        process.stderr.write(`round ${round} ${throttle}x ${variant.name}: fill ${r.fillMs.toFixed(0)} ms, ${r.reads.toFixed(1)} reads/frame, ` +
          `downloader ${r.cpuMs.toFixed(0)} ms ${r.vcs} vcs, wrong ${r.wrong}, resumed ${r.resumes}\n`);
      }
      prev = variant.name;
    }
  }
  taken.push(...visits);
  if (OUT) fs.appendFileSync(OUT, visits.map((r) => JSON.stringify(r) + "\n").join(""));
}
const rows = taken.filter((r) => !r.void);
const voids = taken.length - rows.length;
const rounds = new Set(taken.map((r) => r.round)).size;

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const METRICS = [["reads", "reads/frame", 1], ["cpuMs", "downloader CPU ms", 0], ["vcs", "downloader vcs", 0],
  ["fillMs", "fill ms", 0], ["frame0Ms", "frame 0 ms", 0], ["rendererMb", "renderer peak MB", 1]];
console.log(`${SET}, ${FILL} frames, trace ${list("TRACE", "40000:1000").join(" ")}, delay ${process.env.DELAY_MS || 20} ms one way; ` +
  `${rounds} rounds, ${voids} VOID visits dropped; medians, and each variant's paired lead on its decode's default reader (wins/rounds)`);
console.log(`| throttle | variant | n | wrong frames | resumed (visits, resumes) | ${METRICS.map((m) => m[1]).join(" | ")} |`);
console.log(`| --- | --- | --: | --: | --: | ${METRICS.map(() => "--:").join(" | ")} |`);
for (const t of THROTTLES) for (const a of VARIANTS) {
  const rs = rows.filter((r) => r.throttle === t && r.unit === a.name);
  const base = new Map(rows.filter((r) => r.throttle === t && r.unit === label({ ...a, k: 0 })).map((r) => [r.round, r]));
  const cell = ([k, , d]) => {
    const v = med(rs.map((r) => r[k])).toFixed(d);
    if (a.k === 0) return v;
    const leads = rs.filter((r) => base.has(r.round)).map((r) => r[k] - base.get(r.round)[k]);
    const m = med(leads);
    return `${v} (${m >= 0 ? "+" : ""}${m.toFixed(d)}, ${leads.filter((x) => x < 0).length}/${leads.length})`;
  };
  console.log(`| ${t}× | ${a.name} | ${rs.length} | ${rs.reduce((n, r) => n + r.wrong, 0)} | ` +
    `${rs.filter((r) => r.resumes).length}, ${rs.reduce((n, r) => n + r.resumes, 0)} | ${METRICS.map(cell).join(" | ")} |`);
}
for (const t of THROTTLES) {
  console.log(`${t}×, downloader CPU ms:`);
  const units = VARIANTS.map((a) => a.name);
  const pairs = VARIANTS.filter((a) => a.k).map((a) => [a.name, label({ ...a, k: 0 })]);
  for (const l of leadsByPredecessor(rows.filter((r) => r.throttle === t).map((r) => ({ ...r, v: r.cpuMs })), units, pairs)) console.log(l);
}
process.exit(0);
