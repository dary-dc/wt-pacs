// The frame check's XXH3-64 by four arms in Chromium and Firefox: a fresh browser a round and engine, the engines in a
// Williams order. lab/av1/exact/hashfast/README.md
//   node run.mjs --firefox FIREFOX [--chrome CHROME] [--rounds 10] [--passes 5] [--mutate] --out rows.jsonl
//   node run.mjs --summary rows.jsonl
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../../order.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../../..", import.meta.url).pathname;
const SETS = arg("--sets", "mr_ispy1,dbtproj_ge,ffdm_d");
const DIR = arg("--frames", "lab/.av1-work/checkcost");
const ARMS = ["A", "B", "C", "C0"];

if (arg("--summary")) summary(readFileSync(arg("--summary"), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
else await run();

async function run() {
  const chrome = arg("--chrome", process.env.CHROME_PATH || createRequire(import.meta.url)("playwright").chromium.executablePath());
  const engines = [["chromium", chrome], ...(arg("--firefox") ? [["firefox", arg("--firefox")]] : [])];
  const out = arg("--out");
  const port = 30000 + ((Math.random() * 10000) | 0);
  const http = spawn("python3", ["server/dev-server.py", "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  process.on("exit", () => http.kill());
  await new Promise((r) => setTimeout(r, 1000));
  let failures = 0;
  for (let round = 0; round < Number(arg("--rounds", 10)); round++) {
    for (const [engine, binary] of order(engines, round)) {
      const r = await visit(engine, binary, `http://127.0.0.1:${port}/lab/av1/exact/hashfast/index.html?round=${round}` +
        `&passes=${arg("--passes", 5)}&sets=${SETS}&dir=${DIR}${process.argv.includes("--mutate") ? "&mutate=1" : ""}`);
      if (!r.ok) { failures++; console.error(`round ${round} ${engine}: ${r.error}`); }
      for (const row of r.rows ?? []) appendFileSync(out, JSON.stringify({ engine, ua: r.ua, ...row }) + "\n");
      const bad = (r.rows ?? []).filter((x) => !x.exact || ARMS.some((a) => x.ok?.[a] !== x.of));
      failures += bad.length;
      console.error(`round ${round} ${engine}: ${r.rows?.length ?? 0} frames, ${bad.length} not exact or a digest that differs`);
    }
  }
  process.exit(failures ? 1 : 0);
}

async function visit(engine, binary, url) {
  let done;
  const got = new Promise((r) => (done = r));
  const collector = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end(); done(JSON.parse(body)); });
  });
  await new Promise((r) => collector.listen(0, "127.0.0.1", r));
  const profile = mkdtempSync(path.join(tmpdir(), "hashfast-"));
  const page = `${url}&post=${encodeURIComponent(`http://127.0.0.1:${collector.address().port}/`)}`;
  let args;
  if (engine === "firefox") {
    writeFileSync(path.join(profile, "user.js"), 'user_pref("browser.shell.checkDefaultBrowser", false);\n');
    args = ["--headless", "--no-remote", "--profile", profile, page];
  } else {
    args = ["--headless=new", "--no-sandbox", "--no-first-run", `--user-data-dir=${profile}`, page];
  }
  const b = spawn(binary, args, { stdio: "ignore", detached: true, env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: "1" } });
  const timer = setTimeout(() => done({ ok: false, error: "no result in 10 min" }), 10 * 60e3);
  const r = await got;
  clearTimeout(timer);
  process.kill(-b.pid, "SIGKILL");
  collector.close();
  rmSync(profile, { recursive: true, force: true });
  return r;
}

function summary(rows) {
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const f = (v, d = 2) => v.toFixed(d);
  const span = (v, d) => `${f(med(v), d)} [${f(Math.min(...v), d)}–${f(Math.max(...v), d)}]`;
  console.log("ms a frame: median over rounds of each round's median over frames × passes [range over rounds];" +
    " × A paired by round [range]");
  for (const k of [...new Set(rows.map((r) => `${r.engine} ${r.set}`))]) {
    const of = rows.filter((r) => `${r.engine} ${r.set}` === k);
    const rounds = [...new Set(of.map((r) => r.round))];
    const per = (arm) => new Map(rounds.map((n) => [n, med(of.filter((r) => r.round === n).flatMap((r) => r.ms[arm]))]));
    const a = per("A");
    const r0 = of[0];
    const digests = ARMS.map((arm) => `${arm} ${of.reduce((n, r) => n + r.ok[arm], 0)}/${of.reduce((n, r) => n + r.of, 0)}`);
    console.log(`${k} ${r0.width}×${r0.height} ${(r0.bytes / 1e6).toFixed(2)} MB n=${rounds.length} rounds, ` +
      `${of.length} frames, exact ${of.filter((r) => r.exact).length}/${of.length}; digests ${digests.join(", ")}; ` +
      `XXH_VECTOR C ${r0.vector.C} C0 ${r0.vector.C0}`);
    for (const arm of ARMS) {
      const m = per(arm);
      const x = rounds.map((n) => m.get(n) / a.get(n));
      console.log(`  ${arm.padEnd(2)} ${span([...m.values()])}${arm === "A" ? "" : `  ×${span(x, 3)}`}`);
    }
  }
}
