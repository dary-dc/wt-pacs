/**
 * The key-parse protocol (docs/decode/README.md §Safety without the flush): the product's decoder worker flushed
 * after every unit against `keyParse`, in each engine. Every (engine × throttle) cell is a fresh browser opening
 * page.js, the cells in a Williams order every round; streams and arms rotate inside it. README.md here
 *
 *   node lab/av1/decode/key-parse/run.mjs time|mutate|bare [--rounds 10] [--throttles 1,4] [--engines chromium141,chromium,firefox,webkit]
 *     [--frames lab/.av1-work/keyparse/frames] [--sets a,b] [--flip] [--no-digests] [--load] [--trace dir] [--cores n] [--arms flush,keyParse] [--out rows.json] [--summary]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { order } from "../../../order.mjs";
import { descendants, throttleTree } from "../../../scripts/cpu_throttle.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = process.argv[2];
if (!["time", "mutate", "bare"].includes(MODE)) throw new Error("usage: run.mjs time|mutate|bare ...");
const ROUNDS = Number(arg("--rounds", MODE === "mutate" ? 1 : 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const ENGINE_NAMES = arg("--engines", "chromium141,chromium,firefox").split(",");
const FRAMES = arg("--frames", "lab/.av1-work/keyparse/frames");
const SETS = arg("--sets", null)?.split(",");
const OUT = arg("--out", null);
const SUMMARY = process.argv.includes("--summary");
const LOAD = process.argv.includes("--load");
const TRACE = arg("--trace", null);
// Row WCLAT's host: the browser on n cores, and at 4x the tree as a whole on n slowed CPUs.
const CORES = arg("--cores", null) && Number(arg("--cores"));
const TASK = { mode: MODE, frames: FRAMES, sets: SETS, arms: arg("--arms", null)?.split(","), flip: process.argv.includes("--flip"), noDigests: process.argv.includes("--no-digests") };
const CELL_MS = 90 * 60 * 1000;
const ROOT = new URL("../../../..", import.meta.url).pathname;
const BROWSERS = `${ROOT}/lab/.av1-build/browsers`;

const chrome = (bin) => (url, dir) => [bin, ["--no-sandbox", "--no-first-run", `--user-data-dir=${dir}`,
  ...(TRACE ? ["--remote-debugging-port=0"] : []), url]];
const ENGINES = {
  chromium141: chrome(process.env.CHROME141_PATH ?? `${BROWSERS}/chs141/chrome-headless-shell-linux64/chrome-headless-shell`),
  chromium: chrome(process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"),
  firefox: (url, dir) => {
    writeFileSync(join(dir, "user.js"), [
      ["browser.shell.checkDefaultBrowser", false], ["browser.aboutwelcome.enabled", false],
      ["datareporting.policy.dataSubmissionEnabled", false], ["browser.startup.homepage_override.mstone", "ignore"],
      ["app.update.disabledForTesting", true], ["toolkit.telemetry.reportingpolicy.firstRun", false],
    ].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
    return [process.env.FIREFOX_PATH ?? `${BROWSERS}/ff159/firefox/firefox`, ["--headless", "--no-remote", "--profile", dir, url]];
  },
  // WebKitGTK leaves SharedArrayBuffer off under cross-origin isolation, where Safari turns it on.
  webkit: (url) => [process.env.MINIBROWSER_PATH ?? "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", [url], { DISPLAY, JSC_useSharedArrayBuffer: "1" }],
};
const DISPLAY = ":77";

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
      if (req.url === "/kp/hello") {
        cell.caps = m;
        // The slow CPU starts once the page has loaded, as in every other row's throttled cell.
        cell.stop = throttleTree(cell.pid, cell.throttle, { cores: CORES ?? undefined });
        res.writeHead(200, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...TASK, round: cell.round }));
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

/** Busy CPUs over the host, every 100 ms from /proc/stat: the cell's mean and its share of samples with every CPU busy. */
function sampleLoad(root) {
  const read = () => readFileSync("/proc/stat", "utf8").split("\n").filter((l) => /^cpu\d/.test(l))
    .map((l) => { const v = l.split(/\s+/).slice(1).map(Number); return [v[3] + v[4], v.reduce((a, b) => a + b, 0)]; });
  const busy = [];
  let last = read();
  const timer = setInterval(() => {
    const now = read();
    busy.push(now.reduce((n, [idle, all], i) => n + 1 - (idle - last[i][0]) / Math.max(1, all - last[i][1]), 0));
    last = now;
  }, 100);
  return () => {
    clearInterval(timer);
    const ticks = (pid) => { try { const v = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" "); return Number(v[11]) + Number(v[12]); } catch { return 0; } };
    return { cpuSeconds: descendants(root).reduce((n, pid) => n + ticks(pid), 0) / 100, cpus: last.length, mean: busy.reduce((a, b) => a + b, 0) / busy.length, full: busy.filter((b) => b > last.length - 0.25).length / busy.length };
  };
}

/** Chromium's trace of a cell over CDP, launch to result: GC, WebCodecs and the media thread. */
async function tracer(dir) {
  let port = [];
  for (let i = 0; i < 100 && !port[1]; i++) {
    try { port = readFileSync(join(dir, "DevToolsActivePort"), "utf8").split("\n"); } catch { /* not yet written */ }
    if (!port[1]) await new Promise((r) => setTimeout(r, 50));
  }
  const ws = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);
  await new Promise((r) => (ws.onopen = r));
  const events = [];
  let done = null;
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === "Tracing.dataCollected") events.push(...m.params.value);
    if (m.method === "Tracing.tracingComplete") done?.();
  };
  const call = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));
  call(1, "Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories:
    ["v8", "disabled-by-default-v8.gc", "media", "blink.worker", "toplevel", "disabled-by-default-devtools.timeline"] } });
  return async (file) => {
    const end = new Promise((r) => (done = r));
    call(2, "Tracing.end");
    await end;
    ws.close();
    writeFileSync(file, JSON.stringify({ traceEvents: events }));
  };
}

async function inEngine(engine, throttle, round, url) {
  const dir = mkdtempSync(join(tmpdir(), "kp-"));
  const [bin, args, extra] = ENGINES[engine](url, dir);
  const env = { ...process.env, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", MOZ_CRASHREPORTER_DISABLE: "1", ...extra };
  const proc = CORES ? spawn("taskset", ["-c", `0-${CORES - 1}`, bin, ...args], { env, stdio: ["ignore", "ignore", "pipe"] })
    : spawn(bin, args, { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (c) => (stderr = (stderr + c).slice(-4000)));
  const load = LOAD ? sampleLoad(proc.pid) : () => null;
  const trace = TRACE && engine.startsWith("chromium") ? tracer(dir) : null;
  const r = await new Promise((resolve) => {
    cell = { pid: proc.pid, throttle, round, done: resolve, stop: () => {} };
    setTimeout(() => resolve({ error: `no result in ${CELL_MS / 60000} min; stderr: ${stderr}` }), CELL_MS);
    proc.on("exit", (code) => setTimeout(() => resolve({ error: `exited ${code}; stderr: ${stderr}` }), 2000));
  });
  cell.stop();
  if (trace) await (await trace)(join(TRACE, `${engine}-${throttle}x-r${round}.json`));
  r.load = load();
  const caps = cell.caps;
  proc.kill("SIGKILL");
  await new Promise((res) => setTimeout(res, 500));
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
  return { caps, ...r };
}

const FIRST = Number(arg("--first-round", 0));
// A later first round adds to the rows OUT holds: a run cut short resumes there.
const saved = SUMMARY || (FIRST && OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { caps: {}, rows: [] };
const { caps } = saved;
const rows = saved.rows.filter((r) => SUMMARY || r.round < FIRST);
if (!SUMMARY) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/lab/av1/decode/key-parse/index.html`;
  const xvfb = ENGINE_NAMES.includes("webkit") && spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
  if (xvfb) await new Promise((r) => setTimeout(r, 1000));
  process.on("exit", () => xvfb && xvfb.kill());
  const cells = ENGINE_NAMES.flatMap((e) => THROTTLES.map((t) => ({ engine: e, throttle: t })));
  for (let round = FIRST; round < FIRST + ROUNDS; round++) {
    for (const { engine, throttle } of order(cells, round)) {
      const r = await inEngine(engine, throttle, round, url);
      caps[engine] ??= r.caps;
      if (r.error) console.error(`round ${round} ${engine} ${throttle}x: ${r.error}`);
      if (r.load) console.log(`${engine} ${throttle}x ${SETS ?? "all"} ${TASK.arms ?? ""}: ${r.load.cpuSeconds.toFixed(1)} CPU s; ${r.load.mean.toFixed(2)} of ${r.load.cpus} CPUs busy on average, all busy in ${(100 * r.load.full).toFixed(0)} % of 100 ms samples`);
      for (const row of r.rows ?? []) rows.push({ round, engine, throttle, ...row });
      console.error(`round ${round} ${engine} ${throttle}x done`);
      if (OUT) writeFileSync(OUT, JSON.stringify({ caps, rows }));
    }
  }
  server.close();
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
const sd = (a) => Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / Math.max(1, a.length - 1));
const PHASES = ["pre", "out", "copy", "flush", "post"];
const span = (a, d = f) => `[${d(Math.min(...a))}–${d(Math.max(...a))}]`;
const engines = [...new Set(rows.map((r) => r.engine))];
const throttles = [...new Set(rows.map((r) => r.throttle))].sort((a, b) => a - b);
for (const e of engines) console.log(`${e}: ${caps[e]?.ua} (${caps[e]?.cores} cores, isolated ${caps[e]?.isolated}, VideoDecoder ${caps[e]?.videoDecoder})`);

if (MODE === "time") {
  console.log("ms a frame in the decoder worker: median over rounds of each round's mean [range]; keyParse ÷ flush, the median of" +
    " paired round ratios [range], rounds faster; exact frames; paths; flushes and units per frame reaching VideoDecoder");
  const verdict = {};
  for (const e of engines) {
    for (const t of throttles) {
      const sets = [...new Set(rows.filter((r) => r.engine === e).map((r) => r.set))];
      const byRound = new Map();
      for (const set of sets) {
        const of = (arm) => rows.filter((r) => r.engine === e && r.throttle === t && r.set === set && r.arm === arm);
        const per = (arm) => new Map(of(arm).filter((r) => !r.error && r.ms.length === r.frames).map((r) => [r.round, mean(r.ms)]));
        const [fl, kp] = [per("flush"), per("keyParse")];
        const ratio = [...kp].filter(([r]) => fl.has(r)).map(([r, x]) => [r, x / fl.get(r)]);
        for (const [r, x] of ratio) byRound.set(r, [...(byRound.get(r) ?? []), x]);
        const parts = ["flush", "keyParse"].map((arm) => {
          const rs = of(arm);
          const v = [...per(arm).values()];
          const paths = [...new Set(rs.flatMap((r) => Object.keys(r.paths)))].join("+");
          const n = rs.reduce((s, r) => s + r.frames, 0);
          const err = rs.find((r) => r.error)?.error;
          return `${arm} ${v.length ? `${f(med(v))} ${span(v)}` : "—"} exact ${rs.reduce((s, r) => s + r.exact, 0)}/${n} ${paths}` +
            ` flushes ${f(rs.reduce((s, r) => s + (r.flushes ?? 0), 0) / n)} units ${f(rs.reduce((s, r) => s + (r.units ?? 0), 0) / n)}${err ? ` ERROR ${err}` : ""}`;
        });
        const x = ratio.map(([, v]) => v);
        const vs = x.length ? ` · ×${med(x).toFixed(3)} ${span(x, (v) => v.toFixed(3))} faster ${x.filter((v) => v < 1).length}/${x.length}` : "";
        console.log(`${e} ${t}x ${set}: ${parts.join(" · ")}${vs}`);
      }
      // Each round's geometric mean over streams of keyParse ÷ flush.
      const g = [...byRound.values()].filter((v) => v.length === sets.length).map((v) => Math.exp(mean(v.map(Math.log))));
      const fast = g.filter((v) => v < 1).length;
      console.log(`${e} ${t}x all streams: ×${g.length ? med(g).toFixed(3) : "—"} ${g.length ? span(g, (v) => v.toFixed(3)) : ""} faster ${fast}/${g.length}`);
      (verdict[e] ??= []).push(fast >= 9 && g.length >= 10);
      const lg = g.map(Math.log);
      console.log(`${e} ${t}x all streams: sd of ln(keyParse ÷ flush) over rounds ${(100 * sd(lg)).toFixed(2)} %`);
    }
  }
  console.log("phases, ms a frame (median over rounds of each round's mean): before decode(), to output, copy, flush, after (merge, XXH3); sd of ln(×) over rounds");
  for (const e of engines) {
    for (const t of throttles) {
      for (const set of [...new Set(rows.map((r) => r.set))]) {
        const of = (arm) => rows.filter((r) => r.engine === e && r.throttle === t && r.set === set && r.arm === arm && r.phases?.length && r.phases.every(Boolean));
        const parts = ["flush", "keyParse"].map((arm) => `${arm} ` + PHASES.map((k) => f(med(of(arm).map((r) => mean(r.phases.map((p) => p[k])))))).join(" / "));
        const kp = new Map(of("keyParse").map((r) => [r.round, mean(r.ms)]));
        const lr = of("flush").filter((r) => kp.has(r.round)).map((r) => Math.log(kp.get(r.round) / mean(r.ms)));
        console.log(`${e} ${t}x ${set}: ${parts.join(" · ")} · sd ${(100 * sd(lr)).toFixed(2)} % over ${lr.length}`);
      }
    }
  }
  for (const [e, v] of Object.entries(verdict)) console.log(`${e}: faster in at least 9 of 10 paired rounds at every throttle: ${v.every(Boolean)}`);
} else if (MODE === "bare") {
  console.log("bare VideoDecoder, ms a frame (median over rounds of each round's mean): decode() to output, copy, flush; latency ÷ flush on decode() to output, paired");
  for (const e of engines) {
    for (const t of throttles) {
      for (const set of [...new Set(rows.map((r) => r.set))]) {
        const of = (v) => rows.filter((r) => r.engine === e && r.throttle === t && r.set === set && r.variant === v && !r.error);
        const m = (v, k) => med(of(v).map((r) => mean(r[k])));
        const parts = ["flush", "latency", "latencyFlush"].map((v) => `${v} ${f(m(v, "out"))} / ${f(m(v, "copy"))} / ${f(m(v, "flush"))}`);
        const fl = new Map(of("flush").map((r) => [r.round, mean(r.out)]));
        const x = of("latency").filter((r) => fl.has(r.round)).map((r) => mean(r.out) / fl.get(r.round));
        const err = rows.find((r) => r.engine === e && r.throttle === t && r.set === set && r.error)?.error;
        console.log(`${e} ${t}x ${set}: ${parts.join(" · ")} · ×${x.length ? med(x).toFixed(3) : "—"}${err ? ` ERROR ${err}` : ""}`);
      }
    }
  }
} else {
  // Caught: no send is an escape or a stall, and the mutated send is refused or off its digest, or WebCodecs refused it
  // (its picture then dav1d's, checked); a control's mutated send is exact.
  console.log("each case: outcome of the mutated send (path), the slowest send's wall ms, every send's outcomes; caught or not");
  const caught = {};
  for (const r of rows) {
    const i = r.sends.findIndex((x) => x.index === r.at);
    const s = r.sends[i] ?? { outcome: r.error ? "error" : "unsent" };
    // Units the mutated send put on VideoDecoder: a split payload's clean low is one of them.
    const reached = i > 0 ? s.units - r.sends[i - 1].units : "?";
    const escape = r.sends.some((x) => x.outcome === "wrong" || x.outcome === "stalled");
    const rejected = s.outcome === "refused" || s.outcome === "off-digest" || (s.outcome === "exact" && s.path !== "av1-webcodecs");
    const ok = !r.error && !escape && (r.control ? s.outcome === "exact" : rejected);
    const key = `${r.engine} ${r.throttle}x ${r.arm}`;
    (caught[key] ??= []).push(ok);
    const all = Object.entries(r.sends.reduce((n, x) => ((n[x.outcome] = (n[x.outcome] ?? 0) + 1), n), {})).map(([k, v]) => `${k} ${v}`).join(", ");
    const slow = Math.max(...r.sends.map((x) => x.wallMs));
    console.log(`${key} ${r.set} G${r.g} ${r.case}${r.control ? " (control)" : ""}: ${s.outcome} (${s.path ?? s.reason ?? ""})` +
      ` to WebCodecs ${reached}, slowest ${f(slow)} ms; ${all}; ${ok ? "caught" : "NOT CAUGHT"}${r.error ? ` ERROR ${r.error}` : ""}`);
  }
  for (const [k, v] of Object.entries(caught)) console.log(`${k}: ${v.filter(Boolean).length}/${v.length} cases caught`);
}
process.exit(0);
