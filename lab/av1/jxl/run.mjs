/**
 * JXL in the browsers: `--probe` hands each set's first frame to every native path of every engine and compares
 * it with the fetched series; otherwise each (engine × throttle) cell is a fresh browser timing every set's arms —
 * native, libjxl-WASM per coding, OpenJPH on the served HTJ2K — in a Williams order every round, arms rotating
 * inside. Engines are launched as row XBROWSER launched them. lab/av1/jxl/README.md
 *
 *   node lab/av1/jxl/run.mjs --probe [--engines ...] [--codings jxl-e7-f0,...] [--mutate source]
 *   node lab/av1/jxl/run.mjs [--rounds 10] [--throttles 1,4] [--engines chromium154+jxl] [--codings ...]
 *     [--sets a,b] [--frames 8] [--work lab/.av1-work/jxl] [--mutate hash] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PROBE = process.argv.includes("--probe");
const ROUNDS = PROBE ? 1 : Number(arg("--rounds", 10));
const THROTTLES = PROBE ? [1] : arg("--throttles", "1,4").split(",").map(Number);
const ENGINE_NAMES = arg("--engines", PROBE ? "chromium141,chromium154,chromium154+jxl,firefox,firefox+jxl,webkit" : "chromium154+jxl").split(",");
const CODINGS = arg("--codings", "jxl-e7-f0").split(",");
const FRAMES = Number(arg("--frames", 8));
const WORK = arg("--work", "lab/.av1-work/jxl");
const DATA = arg("--data", "lab/av1/data");
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const CELL_MS = 30 * 60 * 1000;
const ROOT = new URL("../../..", import.meta.url).pathname;
const DISPLAY = ":78";

const CHROME154 = `${ROOT}/lab/.av1-build/chromium-154.0.8037.92/chrome-headless-shell-linux64/chrome-headless-shell`;
const chrome = (bin, extra = []) => (url, dir) => [bin,
  ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${dir}`, ...extra, url]];
const firefox = (prefs) => (url, dir) => {
  writeFileSync(join(dir, "user.js"), [
    ["browser.shell.checkDefaultBrowser", false], ["browser.aboutwelcome.enabled", false],
    ["datareporting.policy.dataSubmissionEnabled", false], ["browser.startup.homepage_override.mstone", "ignore"],
    ["app.update.disabledForTesting", true], ["toolkit.telemetry.reportingpolicy.firstRun", false], ...prefs,
  ].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
  return [process.env.FIREFOX_PATH, ["--headless", "--no-remote", "--profile", dir, url]];
};
const ENGINES = {
  chromium141: chrome("/opt/pw-browsers/chromium-1194/chrome-linux/chrome"),
  chromium154: chrome(CHROME154),
  // Chromium's JPEG XL decoder (jxl-rs) sits behind this feature, off by default.
  "chromium154+jxl": chrome(CHROME154, ["--enable-features=JXLImageFormat"]),
  firefox: firefox([]),
  "firefox+jxl": firefox([["image.jxl.enabled", true]]),
  webkit: (url) => [process.env.MINIBROWSER_PATH ?? "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", [url]],
};

const SETS = arg("--sets", "");
const sets = JSON.parse(readFileSync(`${ROOT}/${WORK}/manifest.json`, "utf8")).sets
  .filter((s) => !SETS || SETS.split(",").includes(s.name));
const unit = (s, c, i) => `/${WORK}/${s.name}/${c}/${String(i).padStart(3, "0")}.${c.split("-")[0]}`;
const probeSets = sets.map((s) => ({ name: s.name, data: DATA, stored: s.stored, shift: s.shift, channels: s.channels,
  width: s.width, height: s.height, truth: s.truth, probe: CODINGS.map((c) => unit(s, c, 0)) }));
const arms = sets.flatMap((s) => {
  const n = Math.min(FRAMES, s.frames);
  const urls = (c) => Array.from({ length: n }, (_, i) => unit(s, c, i));
  const want = MUTATE === "hash" ? s.truth.slice(0, n).map((h) => h.replace(/^./, (c) => (c === "0" ? "1" : "0"))) : s.truth.slice(0, n);
  const fmt = { bits: s.stored, signed: s.signed, shift: s.shift, width: s.width, height: s.height, channels: s.channels };
  return [
    { set: s.name, arm: "htj2k", o: { arm: "htj2k", urls: urls("htj2k"), ...fmt }, want },
    ...CODINGS.flatMap((c) => [
      { set: s.name, arm: `${c} wasm`, o: { arm: "jxl", urls: urls(c), ...fmt }, want },
      { set: s.name, arm: `${c} native`, o: { arm: "native", urls: urls(c), ...fmt }, want },
    ]),
  ];
});

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html",
  ".jxl": "image/jxl" };
let cell = null;
const server = createServer((req, res) => {
  const headers = { "Cache-Control": "no-store" };
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = JSON.parse(body || "{}");
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      if (req.url === "/jx/log") {
        console.error(`  ${m.line}`);
        res.end("{}");
      } else if (req.url === "/jx/hello") {
        cell.ua = m.ua;
        cell.stop = throttleTree(cell.pid, cell.throttle);
        res.end(JSON.stringify(PROBE ? { mode: "probe", sets: probeSets, mutate: MUTATE === "source" } : { mode: "time", round: cell.round, arms }));
      } else {
        res.end("{}");
        cell.done(m);
      }
    });
    return;
  }
  const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    if (!statSync(path).isFile()) throw new Error();
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404, headers).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/lab/av1/jxl/index.html`;

const xvfb = ENGINE_NAMES.includes("webkit")
  ? spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" }) : null;
if (xvfb) await new Promise((r) => setTimeout(r, 1000));

async function inEngine(engine, throttle, round) {
  const dir = mkdtempSync(join(tmpdir(), "jx-"));
  const [bin, args] = ENGINES[engine](URL_, dir);
  const env = { ...process.env, DISPLAY, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", MOZ_CRASHREPORTER_DISABLE: "1" };
  const proc = spawn(bin, args, { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (c) => (stderr = (stderr + c).slice(-4000)));
  const r = await new Promise((resolve) => {
    cell = { pid: proc.pid, throttle, round, done: resolve, stop: () => {} };
    setTimeout(() => resolve({ error: `no result in ${CELL_MS / 60000} min; stderr: ${stderr}` }), CELL_MS);
    proc.on("exit", (code) => setTimeout(() => resolve({ error: `exited ${code}; stderr: ${stderr}` }), 2000));
  });
  cell.stop();
  const ua = cell.ua;
  proc.kill("SIGKILL");
  await new Promise((res) => setTimeout(res, 500));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  return { ua, ...r };
}

const cells = ENGINE_NAMES.flatMap((e) => THROTTLES.map((t) => ({ engine: e, throttle: t })));
const rows = [];
const probes = {};
for (let round = 0; round < ROUNDS; round++) {
  for (const { engine, throttle } of order(cells, round)) {
    const r = await inEngine(engine, throttle, round);
    if (r.error) console.error(`round ${round} ${engine} ${throttle}x: ${r.error}`);
    if (r.probes) probes[engine] = { ua: r.ua, probes: r.probes };
    for (const row of r.rows ?? []) {
      rows.push({ round, engine, throttle, ...row });
      if (row.error || (row.exact !== row.frames && !row.arm.endsWith("native"))) {
        console.error(`round ${round} ${engine} ${throttle}x ${row.set} ${row.arm}: ${row.exact}/${row.frames} ${row.error ?? ""}`);
      }
    }
    console.error(`round ${round} ${engine} ${throttle}x done`);
  }
}
xvfb?.kill();
server.close();
if (OUT) writeFileSync(OUT, JSON.stringify(PROBE ? probes : rows));
if (PROBE) {
  for (const [engine, { ua, probes: ps }] of Object.entries(probes)) {
    console.log(`${engine}: ${ua}`);
    for (const p of ps) {
      const cell = (k) => {
        const v = p[k];
        if (v.error) return `${k} ${v.error}`;
        if (v.supported === false) return `${k} unsupported`;
        return `${k} ${v.format ? `${v.format} ` : ""}${v.exact === undefined ? "" : v.exact ? "exact" : `max err ${v.maxErr}`}`;
      };
      console.log(`  ${p.set} ${p.coding}: ${["img", "bitmap", "float16", "imageDecoder"].map(cell).join(" | ")}`);
    }
  }
  process.exit(0);
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
console.log("engine\tthrottle\tset\tarm\tms a frame: median [min–max] n\tpaired ratio to htj2k (median)\texact frames");
for (const engine of ENGINE_NAMES) {
  for (const throttle of THROTTLES) {
    for (const { set, arm } of arms) {
      const pick = (a) => rows.filter((r) => r.engine === engine && r.throttle === throttle && r.set === set && r.arm === a);
      const rs = pick(arm);
      const ht = new Map(pick("htj2k").map((r) => [r.round, r.ms / r.frames]));
      const per = rs.filter((r) => r.ms !== undefined).map((r) => r.ms / r.frames);
      const ratio = rs.filter((r) => r.ms !== undefined && ht.has(r.round)).map((r) => r.ms / r.frames / ht.get(r.round));
      const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
      const t = per.length ? `${med(per).toFixed(2)} [${Math.min(...per).toFixed(2)}–${Math.max(...per).toFixed(2)}] n=${per.length}\t${med(ratio).toFixed(2)}`
        : `failed (${rs[0]?.error})\t`;
      console.log(`${engine}\t${throttle}x\t${set}\t${arm}\t${t}\texact ${exact}`);
    }
  }
}
process.exit(0);
