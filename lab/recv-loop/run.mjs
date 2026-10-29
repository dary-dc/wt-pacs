// Does a WebTransport receive loop keep the fill's rate beside a disk cine or a drag on one worker's thread?
// docs/adr/frame-path.md §The receive loop beside the paint (2026-10-29); how to run it: README.md
//   node lab/recv-loop/run.mjs make DIR
//   taskset -c 1-2 node lab/recv-loop/run.mjs run DIR --rounds 12 [--cells a,b] [--arms split,split2,merged]
//        [--browser chromium|firefox] [--angle swiftshader|gl|vulkan] [--mutant leak|fold|corrupt] --out rows.jsonl
//   node lab/recv-loop/run.mjs summary rows.jsonl
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { order } from "../order.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const SERVER = path.join(ROOT, "target/release/series-server");
const PACK = path.join(ROOT, "target/release/pack-series");
const FRAMES = 800;
const FRAME_BYTES = 250_000;
const FPS = 30;
const WARM_MS = 1000;
const ARMS = ["split", "split2", "merged"];
const SERVER_CORE = "0";
const RELAY_CORE = "3";
// [one-way delay ms, kbit/s, frames]: the fill lasts ≥ 4 s at each rate; loopback is the host's own ceiling.
const LINKS = { loop: [0, 0, 800], "103/46": [23, 103_000, 200], "103/92": [46, 103_000, 200], "18/92": [46, 18_000, 60] };
const LOADS = ["cine", "drag"];
const MUTANTS = { leak: (arm) => arm === "merged", fold: (arm) => arm !== "merged", corrupt: () => true };
const CELLS = Object.fromEntries(Object.keys(LINKS).flatMap((l) => LOADS.map((k) => [`${l}-${k}`, [l, k]])));

const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const ANGLE = flag("angle", "swiftshader");
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : NaN;
};
const median = (xs) => quantile(xs, 0.5);

function make(dir) {
  const frames = path.join(dir, "frames");
  fs.mkdirSync(frames, { recursive: true });
  const sha256 = [];
  for (let i = 0; i < FRAMES; i++) {
    const body = crypto.randomBytes(FRAME_BYTES);
    fs.writeFileSync(path.join(frames, `${String(i).padStart(3, "0")}.htj2k`), body);
    sha256.push(crypto.createHash("sha256").update(body).digest("hex"));
  }
  fs.writeFileSync(path.join(dir, "sha256.txt"), sha256.join("\n") + "\n");
  fs.writeFileSync(path.join(frames, "metadata.json"), JSON.stringify({ frameCount: FRAMES, seriesLabel: "recv-loop" }));
  sh(PACK, ["--metadata", path.join(frames, "metadata.json"), "--frames", frames, "--output", path.join(dir, "series.sbnd")]);
  sh("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout",
    path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-days", "10", "-nodes", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
  console.log(`${FRAMES} x ${FRAME_BYTES} B packed in ${dir}, with a certificate valid 10 days`);
}

function staticHost() {
  const allowed = ["lab/recv-loop/", "client/transport/ts/dist/", "client/decode/wasm/vendor/hash-wasm/"];
  const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };
  const server = http.createServer((req, res) => {
    const rel = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "");
    const file = path.join(ROOT, rel);
    if (!allowed.some((a) => rel.startsWith(a)) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": mime[path.extname(file)] ?? "application/octet-stream" }).end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const freeUdp = () => new Promise((r) => {
  const s = dgram.createSocket("udp4");
  s.bind(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => r(port));
  });
});

function started(child, prefix) {
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const line = out.split("\n").find((l) => l.startsWith(prefix));
      if (line) resolve(line);
    });
    child.on("exit", (code) => reject(new Error(`${prefix} never printed (exit ${code}): ${out.slice(-300)}`)));
  });
}

const hostBusy = () => {
  const [, ...t] = fs.readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).map(Number);
  return { idle: t[3] + t[4], total: t.reduce((a, b) => a + b, 0) };
};

/** Arrivals strictly inside a busy interval, 0.5 ms in from each edge: none can exist when one thread holds both. */
export function insideBusy(arrivals, busy) {
  let n = 0;
  for (const t of arrivals) if (busy.some(([s, e]) => t > s + 0.5 && t < e - 0.5)) n++;
  return n;
}

/** The checks every row passes before it counts: exact frames, and the arm's threads as named. */
export function check(row, sha256) {
  const problems = [];
  const exact = row.sha256.filter((h, i) => h === sha256[i]).length;
  if (exact !== row.sha256.length) problems.push(`${row.sha256.length - exact} of ${row.sha256.length} frames not exact`);
  const during = row.arrivals.filter((t) => t >= row.busy[0]?.[0] && t <= row.busy.at(-1)?.[1]);
  const inside = insideBusy(during, row.busy);
  if (row.arm === "merged" && inside > 0) problems.push(`merged: ${inside} arrivals inside a busy interval`);
  if (row.arm !== "merged" && row.busyShare >= 0.2 && during.length >= 50 && inside === 0)
    problems.push(`${row.arm}: no arrival inside ${row.busy.length} busy intervals, as if on the load's thread`);
  return { exact, inside, problems };
}

async function visit({ browserType, arm, cell, round, dir, host, hash, mutant, sha256 }) {
  const [link, kind] = CELLS[cell];
  const [delay, kbit, count] = LINKS[link];
  const port = await freeUdp();
  const server = spawn("taskset", ["-c", SERVER_CORE, SERVER, "--port", String(port), "--bind", "127.0.0.1",
    "--series", path.join(dir, "series.sbnd"), "--cert-pem", path.join(dir, "cert.pem"),
    "--key-pem", path.join(dir, "key.pem")], { env: { ...process.env, RUST_LOG: "error", NO_COLOR: "1" } });
  await started(server, "transport=");
  let relay = null;
  let target = port;
  let relayOut = "";
  if (kbit) {
    target = await freeUdp();
    relay = spawn("taskset", ["-c", RELAY_CORE, "python3", path.join(ROOT, "lab/scripts/link_impair.py"),
      "--udp", `${target}:${port}`, "--delay-ms", String(delay), "--rate-kbit", String(kbit), "--queue-pkts", "1000",
      "--self-timing", "--seed", String(round)]);
    relay.stdout.on("data", (d) => (relayOut += d));
    await started(relay, "READY");
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "recv-loop-"));
  const context = await browserType.launchPersistentContext(profile, {
    headless: true,
    args: browserType.name() === "chromium" ? ["--no-sandbox", "--use-gl=angle", `--use-angle=${ANGLE}`] : [],
  });
  const row = { round, cell, arm, mutant: mutant ?? null, browser: browserType.name() };
  const cpu0 = hostBusy();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${host.address().port}/lab/recv-loop/page.html`);
    await page.waitForFunction(() => window.ready);
    const r = await page.evaluate((a) => window.visit(a), {
      arm, kind, fps: FPS, url: `https://127.0.0.1:${target}/`, hash, count, warmMs: WARM_MS,
      mutant: mutant && MUTANTS[mutant](arm) ? mutant : undefined,
    });
    const cpu1 = hostBusy();
    const gaps = r.arrivals.slice(1).map((t, i) => t - r.arrivals[i]);
    const span = r.busy.length ? r.busy.at(-1)[1] - r.busy[0][0] : 0;
    Object.assign(row, {
      engine: r.userAgent, renderer: r.renderer, frames: r.arrivals.length,
      lastMs: r.arrivals.at(-1) - r.dialed, gapP99: quantile(gaps, 0.99), gapMax: Math.max(...gaps),
      steps: r.steps, fps: kind === "cine" ? (r.steps * 1000) / r.loadMs : null, lateP99: quantile(r.late, 0.99),
      busyShare: span ? r.busy.reduce((a, [s, e]) => a + e - s, 0) / span : 0,
      hostBusy: 1 - (cpu1.idle - cpu0.idle) / (cpu1.total - cpu0.total), arrivals: r.arrivals, busy: r.busy,
      sha256: r.sha256,
    });
    Object.assign(row, check(row, sha256));
  } catch (e) {
    row.error = String(e.message ?? e).slice(0, 400);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
    server.kill();
    if (relay) {
      relay.kill("SIGTERM");
      await new Promise((r) => relay.on("exit", r));
      row.relay = relayOut.split("\n").find((l) => l.startsWith("self-timing")) ?? null;
    }
  }
  row.void = [row.hostBusy > 0.9 && "host over 90 % busy", row.relay?.includes("VOID") && "relay late"]
    .filter(Boolean).join("; ") || null;
  return row;
}

async function run(dir) {
  const playwright = createRequire(import.meta.url)("playwright");
  const name = flag("browser", "chromium");
  const browserType = playwright[name];
  const cells = flag("cells", Object.keys(CELLS).join(",")).split(",");
  const arms = flag("arms", ARMS.join(",")).split(",");
  const rounds = Number(flag("rounds", 12));
  const mutant = flag("mutant", null);
  const out = flag("out", "rows.jsonl");
  const sha256 = fs.readFileSync(path.join(dir, "sha256.txt"), "utf8").trim().split("\n");
  const host = await staticHost();
  const der = execFileSync("openssl", ["x509", "-in", path.join(dir, "cert.pem"), "-outform", "DER"]);
  const hash = crypto.createHash("sha256").update(der).digest("hex");
  console.log(`client cores ${fs.readFileSync("/proc/self/status", "utf8").match(/Cpus_allowed_list:\s*(\S+)/)[1]},`
    + ` server core ${SERVER_CORE}, relay core ${RELAY_CORE}; ${name}; mutant ${mutant ?? "none"}`);
  for (let round = 0; round < rounds; round++) {
    for (const cell of cells) {
      let prev = null;
      for (const arm of order(arms, round)) {
        const row = { ...(await visit({ browserType, arm, cell, round, dir, host, hash, mutant, sha256 })), prev };
        prev = arm;
        fs.appendFileSync(out, JSON.stringify(row) + "\n");
        const { arrivals, busy, sha256: _, ...brief } = row;
        console.log(JSON.stringify(brief, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
      }
    }
  }
  host.close();
}

/** The pre-registered rule of the ADR, cell by cell; aa_rule.py judges the fill's last frame. */
function summary(file) {
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse)
    .filter((r) => !r.mutant && !r.error && !r.void && !r.problems?.length);
  const byCell = Object.groupBy(rows, (r) => `${r.browser} ${r.cell}`);
  const forRule = {};
  const verdicts = {};
  console.log("| browser cell | arm | n | last frame ms | inter-arrival p99 ms | cine frames/s | step late p99 ms |");
  console.log("| --- | --- | --: | --: | --: | --: | --: |");
  for (const [key, rs] of Object.entries(byCell)) {
    const at = (arm, round) => rs.find((r) => r.arm === arm && r.round === round);
    const saturated = (round) => (at("split", round)?.fps ?? FPS) < 0.9 * FPS;
    const rounds = [...new Set(rs.map((r) => r.round))].filter((n) => ARMS.every((a) => at(a, n)) && !saturated(n));
    for (const arm of ARMS) {
      const v = rounds.map((n) => at(arm, n));
      const f = (k) => (v.length ? median(v.map((r) => r[k] ?? NaN)).toFixed(1) : "—");
      console.log(`| ${key} | ${arm} | ${v.length} | ${f("lastMs")} | ${f("gapP99")} | ${f("fps")} | ${f("lateP99")} |`);
    }
    if (rounds.length > 1) forRule[key] = Object.fromEntries([["ref", "split"], ["aa", "split2"], ["arm", "merged"]]
      .map(([k, arm]) => [k, rounds.map((n) => at(arm, n).lastMs)]));
    const within = (k, arm) => rounds.filter((n) => !(at(arm, n)[k] > at("split", n)[k] + 1000 / 60)).length;
    verdicts[key] = { rounds: rounds.length, gap: within("gapP99", "merged"), gapAA: within("gapP99", "split2"),
      late: within("lateP99", "merged"), lateAA: within("lateP99", "split2") };
  }
  const json = file.replace(/\.jsonl$/, "") + ".cells.json";
  fs.writeFileSync(json, JSON.stringify(forRule));
  const fill = Object.fromEntries(sh("python3", [path.join(ROOT, "lab/scripts/aa_rule.py"), json, "--bar", "0.02"])
    .trim().split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf(" {")), JSON.parse(l.slice(l.indexOf(" {")))]));
  console.log("\n| browser cell | fill: merged ÷ split, A/A | fill verdict | p99 within 16.7 ms (A/A) | late within 16.7 ms (A/A) |");
  console.log("| --- | --- | --- | --- | --- |");
  let merge = true;
  let decided = Object.keys(verdicts).some((key) => !key.includes(" loop-"));
  for (const [key, v] of Object.entries(verdicts)) {
    const f = fill[key] ?? { arm: "—", aa: "—", verdict: `undecided at n = ${v.rounds}` };
    const need = Math.ceil(0.75 * v.rounds);
    const gapOk = v.gap >= need && v.gapAA >= need;
    const lateOk = key.endsWith("drag") || (v.late >= need && v.lateAA >= need);
    const ceiling = key.includes(" loop-");
    if (!ceiling && (f.verdict === "worse" || v.gapAA >= need && v.gap < need || v.lateAA >= need && v.late < need)) {
      merge = false;
    }
    if (!ceiling && (!["tie", "better"].includes(f.verdict) || !gapOk || !lateOk)) decided = false;
    console.log(`| ${key}${ceiling ? " (the host's ceiling, outside the rule)" : ""} | ${f.arm}, ${f.aa} | ${f.verdict} |`
      + ` ${v.gap}/${v.rounds} (${v.gapAA}) |`
      + ` ${key.endsWith("drag") ? "—" : `${v.late}/${v.rounds} (${v.lateAA})`} |`);
  }
  console.log(`\nrule: ${!merge ? "the split stands" : decided ? "the downloader may merge" : "not decided"}`
    + " (on these rows only; the ADR's rule needs both engines and every cell)");
}

const [cmd, target] = argv;
if (cmd === "make") make(target);
else if (cmd === "run") await run(target);
else if (cmd === "summary") summary(target);
else console.error("usage: run.mjs make DIR | run DIR [...] | summary rows.jsonl");
