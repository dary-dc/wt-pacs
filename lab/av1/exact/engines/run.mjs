/**
 * XBROWSER: the product's AV1 decode path in Chromium, Firefox and WebKit, against its HTJ2K path in the
 * same engine. Each (engine × throttle) cell is a fresh browser opening page.js, the cells in a Williams
 * order every round; sets and variants rotate inside it. lab/av1/exact/engines/README.md
 *
 *   node lab/av1/exact/engines/run.mjs [--caps | --probe] [--rounds 8] [--throttles 1,4] [--engines chromium,firefox,webkit,webkit+sab]
 *     [--frames lab/.av1-work/xbrowser] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CAPS = process.argv.includes("--caps");
const PROBE = process.argv.includes("--probe");
const ROUNDS = CAPS || PROBE ? 1 : Number(arg("--rounds", 8));
const THROTTLES = CAPS || PROBE ? [1] : arg("--throttles", "1,4").split(",").map(Number);
const ENGINE_NAMES = arg("--engines", "chromium,firefox,webkit,webkit+sab").split(",");
const FRAMES = arg("--frames", "lab/.av1-work/xbrowser");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const CELL_MS = 40 * 60 * 1000;
const ROOT = new URL("../../../..", import.meta.url).pathname;
const DISPLAY = ":77";

const MINIBROWSER = process.env.MINIBROWSER_PATH ?? "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser";
const ENGINES = {
  chromium: (url, dir) => [process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${dir}`, url]],
  firefox: (url, dir) => {
    writeFileSync(join(dir, "user.js"), [
      ["browser.shell.checkDefaultBrowser", false], ["browser.aboutwelcome.enabled", false],
      ["datareporting.policy.dataSubmissionEnabled", false], ["browser.startup.homepage_override.mstone", "ignore"],
      ["app.update.disabledForTesting", true], ["toolkit.telemetry.reportingpolicy.firstRun", false],
    ].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
    return [process.env.FIREFOX_PATH, ["--headless", "--no-remote", "--profile", dir, url]];
  },
  webkit: (url) => [MINIBROWSER, [url]],
  // WebKitGTK leaves SharedArrayBuffer off under cross-origin isolation, where Safari turns it on.
  "webkit+sab": (url) => [MINIBROWSER, [url], { JSC_useSharedArrayBuffer: "1" }],
};

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json" };
let cell = null;

const server = createServer((req, res) => {
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store" };
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = JSON.parse(body || "{}");
      if (req.url === "/xb/hello") {
        cell.caps = m;
        // The slow CPU starts after the page has loaded, as in every other row's throttled cell.
        cell.stop = throttleTree(cell.pid, cell.throttle);
        res.writeHead(200, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify(CAPS ? {} : { frames: FRAMES, round: cell.round, mutate: MUTATE, probe: PROBE }));
      } else {
        res.writeHead(200, headers).end();
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
const URL_ = `http://127.0.0.1:${server.address().port}/lab/av1/exact/engines/index.html`;

let xvfb = null;
if (ENGINE_NAMES.some((e) => e.startsWith("webkit"))) {
  xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1000));
}

async function inEngine(engine, throttle, round) {
  const dir = mkdtempSync(join(tmpdir(), "xb-"));
  const [bin, args, extra] = ENGINES[engine](URL_, dir);
  const env = { ...process.env, DISPLAY, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", MOZ_CRASHREPORTER_DISABLE: "1", ...extra };
  const proc = spawn(bin, args, { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (c) => (stderr = (stderr + c).slice(-4000)));
  const result = new Promise((resolve) => {
    cell = { pid: proc.pid, throttle, round, done: resolve, stop: () => {} };
    setTimeout(() => resolve({ error: `no result in ${CELL_MS / 60000} min; stderr: ${stderr}` }), CELL_MS);
    proc.on("exit", (code) => setTimeout(() => resolve({ error: `exited ${code}; stderr: ${stderr}` }), 2000));
  });
  const r = await result;
  cell.stop();
  const caps = cell.caps;
  proc.kill("SIGKILL");
  await new Promise((res) => setTimeout(res, 500));
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
  return { caps, ...r };
}

const cells = ENGINE_NAMES.flatMap((e) => THROTTLES.map((t) => ({ engine: e, throttle: t })));
const rows = [];
const caps = {};
const probes = {};
for (let round = 0; round < ROUNDS; round++) {
  for (const { engine, throttle } of order(cells, round)) {
    const r = await inEngine(engine, throttle, round);
    caps[engine] ??= r.caps;
    if (r.probe) probes[engine] = r.probe;
    if (r.error) console.error(`round ${round} ${engine} ${throttle}x: ${r.error}`);
    for (const row of r.rows ?? []) rows.push({ round, engine, throttle, ...row });
    for (const row of (r.rows ?? []).filter((x) => x.error || x.exact !== x.frames)) {
      console.error(`round ${round} ${engine} ${throttle}x ${row.set} ${row.variant}: ${row.exact}/${row.frames} exact, ${row.units} units to WebCodecs ${row.error ?? ""}`);
    }
    console.error(`round ${round} ${engine} ${throttle}x done`);
  }
}
xvfb?.kill();
server.close();
console.log(JSON.stringify(caps, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify({ caps, probes, rows }));
if (CAPS) process.exit(0);
if (PROBE) {
  for (const [engine, ps] of Object.entries(probes)) {
    for (const p of ps) {
      console.log(`${engine} ${p.set} ${p.variant} ${p.unit}: ${p.error ?? `${p.format} ${p.coded} matrix ${p.matrix}${p.exactAsRgb === undefined ? "" : ` exact as RGB ${p.exactAsRgb}`}`}`);
    }
  }
  process.exit(0);
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
const span = (a) => `[${Math.min(...a).toFixed(2)}–${Math.max(...a).toFixed(2)}]`;
console.log("ms a frame in its decoder: median over rounds of each round's median [range]; exact frames; units to WebCodecs;" +
  " ×HTJ2K: the median of paired round ratios [range], rounds slower than HTJ2K");
for (const engine of ENGINE_NAMES) {
  for (const throttle of THROTTLES) {
    for (const set of [...new Set(rows.map((r) => r.set))]) {
      const of = (variant) => rows.filter((r) => r.engine === engine && r.throttle === throttle && r.set === set && r.variant === variant);
      const per = (variant) => new Map(of(variant).filter((r) => r.ms.length === r.frames).map((r) => [r.round, med(r.ms)]));
      const ref = per("htj2k");
      const parts = [];
      for (const variant of [...new Set(rows.filter((r) => r.set === set).map((r) => r.variant))]) {
        const rs = of(variant);
        if (!rs.length) continue;
        const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
        const units = rs.reduce((n, r) => n + r.units, 0);
        const m = per(variant);
        if (!m.size) { parts.push(`${variant} failed ${exact} (${rs.find((r) => r.error)?.error})`); continue; }
        const v = [...m.values()];
        let line = `${variant} ${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] n=${v.length} exact ${exact} wc ${units}`;
        const ratio = [...m].filter(([r]) => ref.has(r)).map(([r, x]) => x / ref.get(r));
        if (variant !== "htj2k" && ratio.length) line += `, ×${med(ratio).toFixed(2)} ${span(ratio)} slower ${ratio.filter((x) => x > 1).length}/${ratio.length}`;
        parts.push(line);
      }
      console.log(`${engine} ${throttle}x ${set}: ${parts.join(" · ")}`);
    }
  }
}
process.exit(0);
