/**
 * DECODERBUILD: the product's OpenJPH build against the package, through the downloader with three decoders:
 * a fill and a cold ask at 1× and 4×, every unit Williams-ordered within each round, one fresh browser a visit,
 * each frame's sha256 against the encoder's input, the renderer's peak PSS. docs/decode/README.md §The build, as delivered
 *
 *   NODE_PATH=$(npm root -g) node lab/decode-bench/builds.mjs [rounds] [SERIES=g512] [CORES=4] [OUT=rows.jsonl]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { order } from "../order.mjs";
import { throttleTree } from "../scripts/cpu_throttle.mjs";
import { sampleTree } from "../scripts/proc_sampler.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 10);
const SERIES = process.env.SERIES || "g512";
const CORES = Number(process.env.CORES || 4);
const ARMS = ["package", "built"];
const UNITS = ARMS.flatMap((arm) => ["fill", "ask"].flatMap((scenario) => [1, 4].map((throttle) => ({ arm, scenario, throttle }))));
const name = (u) => `${u.arm} ${u.scenario} ${u.throttle}x`;
const T = fs.mkdtempSync(path.join(os.tmpdir(), "builds-"));
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

execFileSync("cargo", ["build", "-q", "--release", "-p", "series-server", "-p", "pack-series"], { cwd: ROOT });
const src = path.join(ROOT, `lab/fixtures/decode_${SERIES}`);
const truth = fs.readdirSync(src).filter((f) => f.endsWith(".sha256")).sort().map((f) => fs.readFileSync(path.join(src, f), "utf8").trim());
fs.mkdirSync(path.join(T, "frames"));
for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".j2c"))) {
  fs.copyFileSync(path.join(src, f), path.join(T, "frames", f.replace(".j2c", ".htj2k")));
}
execFileSync(path.join(ROOT, "target/release/pack-series"), ["--metadata", path.join(src, "metadata.json"),
  "--frames", path.join(T, "frames"), "--output", path.join(T, "s.sbnd")]);
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem \
  -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' 2>/dev/null`]);
const hash = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`])
  .toString().trim();
const wt = port();
const http = port();
kids.push(spawn(path.join(ROOT, "target/release/series-server"), ["--port", String(wt), "--bind", "127.0.0.1",
  "--series", path.join(T, "s.sbnd"), "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], { stdio: "ignore" }));
kids.push(spawn("python3", ["server/dev-server.py", "--port", String(http)], { cwd: ROOT, stdio: "ignore" }));
fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${wt}/`, cert_sha256: hash }) + "\n");
await new Promise((r) => setTimeout(r, 1500));

const CHROME = process.env.CHROME_PATH || chromium.executablePath();
fs.writeFileSync(path.join(T, "chrome"), `#!/bin/sh\nexec taskset -c 0-${CORES - 1} "${CHROME}" "$@"\n`, { mode: 0o755 });

async function visit({ arm, scenario, throttle }) {
  const server = await chromium.launchServer({ executablePath: path.join(T, "chrome"),
    args: ["--disable-background-networking", "--enable-blink-features=ForceEagerMeasureMemory"] });
  const unthrottle = throttleTree(server.process().pid, throttle, { cores: CORES });
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    const page = await browser.newPage();
    const decoder = arm === "built" ? "&decoder=built" : "";
    await page.goto(`http://127.0.0.1:${http}/lab/downloader-cost/index.html?variant=Dd&scenario=${scenario}&fill=${truth.length}` +
      `&askFrame=${truth.length - 1}&digest${decoder}`);
    const wait = (f) => page.waitForFunction(f, null, { timeout: 300000, polling: 200 });
    await wait(() => globalThis.__wtpacsReady || globalThis.__wtpacsDone);
    const sampler = sampleTree(server.process().pid);
    await page.evaluate(() => { globalThis.__wtpacsGo = true; });
    await wait(() => globalThis.__wtpacsScenarioDone || globalThis.__wtpacsDone);
    const { kinds } = sampler.stop();
    await page.evaluate(() => { globalThis.__wtpacsMeasure = true; });
    await wait(() => globalThis.__wtpacsDone);
    const r = await page.evaluate(() => globalThis.__wtpacsResult);
    await browser.close();
    if (r.error) throw new Error(`${arm} ${scenario}: ${r.error}`);
    const exact = scenario === "ask" ? Number(r.ask_digest === truth[truth.length - 1]) : r.digests.filter((d, i) => d === truth[i]).length;
    return { arm, scenario, throttle, ms: scenario === "ask" ? r.ask_ms : r.last_frame_ms, frames: scenario === "ask" ? 1 : truth.length,
      exact, rendererMb: kinds.renderer?.pss_mb ?? 0, jsMb: r.memory_bytes / 1048576 };
  } finally {
    await server.close();
    unthrottle();
  }
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  let prev = null;
  for (const u of order(UNITS, round)) {
    const r = await visit(u);
    rows.push({ round, unit: name(u), prev, ...r });
    prev = name(u);
    process.stderr.write(`round ${round} ${name(u)}: ${r.ms.toFixed(1)} ms, ${r.exact}/${r.frames} exact, renderer ${r.rendererMb.toFixed(0)} MB\n`);
  }
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const span = (a, d = 1) => `${med(a).toFixed(d)} [${Math.min(...a).toFixed(d)}–${Math.max(...a).toFixed(d)}]`;
console.log(`\n${SERIES}, ${truth.length} frames, ${ROUNDS} rounds, ${CORES} cores, three decoders; median [range]\n`);
console.log("| scenario | throttle | package ms | built ms | built ÷ package, paired by round (rounds faster) | exact | renderer peak PSS, package → built | JS+WASM, package → built |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const scenario of ["fill", "ask"]) {
  for (const throttle of [1, 4]) {
    const of = (arm) => rows.filter((r) => r.arm === arm && r.scenario === scenario && r.throttle === throttle);
    const [p, b] = ARMS.map(of);
    const ratio = b.map((r) => r.ms / p.find((q) => q.round === r.round).ms);
    const exact = [...p, ...b].reduce((n, r) => n + r.exact, 0);
    const frames = [...p, ...b].reduce((n, r) => n + r.frames, 0);
    console.log(`| ${scenario} | ${throttle}× | ${span(p.map((r) => r.ms))} | ${span(b.map((r) => r.ms))} | ×${med(ratio).toFixed(3)} ` +
      `(${ratio.filter((x) => x < 1).length}/${ratio.length}) | ${exact}/${frames} | ${span(p.map((r) => r.rendererMb), 0)} → ` +
      `${span(b.map((r) => r.rendererMb), 0)} MB | ${span(p.map((r) => r.jsMb))} → ${span(b.map((r) => r.jsMb))} MB |`);
  }
}
