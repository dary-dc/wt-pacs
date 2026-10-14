// What the exactness checks cost a frame, per decoder path, in Chromium and Firefox: a fresh browser a round and engine,
// the engines in a Williams order. lab/av1/exact/checkcost/README.md
//   node run.mjs --firefox FIREFOX [--chrome CHROME] [--rounds 6] [--passes 3] [--mutate] --out rows.jsonl
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
const PATHS = { chromium: "htj2k,av1-webcodecs,av1-dav1d", firefox: "htj2k,av1-dav1d" };

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
  for (let round = 0; round < Number(arg("--rounds", 6)); round++) {
    for (const [engine, binary] of order(engines, round)) {
      const r = await visit(engine, binary, `http://127.0.0.1:${port}/lab/av1/exact/checkcost/index.html?round=${round}` +
        `&passes=${arg("--passes", 3)}&sets=${SETS}&paths=${PATHS[engine]}&dir=${DIR}${process.argv.includes("--mutate") ? "&mutate=1" : ""}`);
      if (!r.ok) { failures++; console.error(`round ${round} ${engine}: ${r.error}`); }
      for (const row of r.rows ?? []) appendFileSync(out, JSON.stringify({ engine, ua: r.ua, ...row }) + "\n");
      const bad = (r.rows ?? []).filter((x) => !["xxh3", "fault", "skipped"].includes(x.arm) && !(x.truth && x.exact !== false));
      failures += bad.length;
      console.error(`round ${round} ${engine}: ${r.rows?.length ?? 0} rows, ${bad.length} not exact`);
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
  const profile = mkdtempSync(path.join(tmpdir(), "checkcost-"));
  const page = `${url}&post=${encodeURIComponent(`http://127.0.0.1:${collector.address().port}/`)}`;
  let args;
  if (engine === "firefox") {
    writeFileSync(path.join(profile, "user.js"), 'user_pref("browser.shell.checkDefaultBrowser", false);\n');
    args = ["--headless", "--no-remote", "--profile", profile, page];
  } else {
    args = ["--headless=new", "--no-sandbox", "--no-first-run", `--user-data-dir=${profile}`, page];
  }
  const b = spawn(binary, args, { stdio: "ignore", detached: true, env: { ...process.env, MOZ_CRASHREPORTER_DISABLE: "1" } });
  const timer = setTimeout(() => done({ ok: false, error: "no result in 30 min" }), 30 * 60e3);
  const r = await got;
  clearTimeout(timer);
  process.kill(-b.pid, "SIGKILL");
  collector.close();
  rmSync(profile, { recursive: true, force: true });
  return r;
}

function summary(rows) {
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const f = (v) => v.toFixed(v < 10 ? 2 : 1);
  const span = (v) => `${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}]`;
  const key = (r) => `${r.engine} ${r.set} ${r.path}`;
  console.log("ms a frame: median over rounds of each round's median [range over rounds]; × off, paired by round");
  for (const r of rows.filter((r) => r.arm === "skipped")) console.log(`${key(r)}: not taken, the payload went to ${r.took}`);
  for (const k of [...new Set(rows.filter((r) => r.arm !== "skipped").map(key))]) {
    const of = (arm) => rows.filter((r) => key(r) === k && r.arm === arm && r.ms !== undefined);
    const rounds = [...new Set(of("off").map((r) => r.round))];
    const per = (arm) => new Map(rounds.map((n) => [n, med(of(arm).filter((r) => r.round === n).map((r) => r.ms))]));
    const [off, on, fault] = ["off", "on", "fault"].map(per);
    const x = rows.filter((r) => key(r) === k && r.arm === "xxh3");
    const hx = (a) => new Map(rounds.map((n) => [n, med(x.filter((r) => r.round === n).flatMap((r) => r[a]))]));
    const [check, recheck] = ["check", "recheck"].map(hx);
    const ratio = (m) => med(rounds.map((n) => m.get(n) / off.get(n))).toFixed(3);
    const diff = (a, b) => span(rounds.map((n) => a.get(n) - b.get(n)));
    const r0 = of("on")[0] ?? {};
    const exact = (arm) => `${of(arm).filter((r) => r.truth).length}/${of(arm).length}`;
    const took = (arm) => [...new Set(of(arm).map((r) => `${r.took}${r.mismatchOn ? ` after ${r.mismatchOn}` : ""}${r.exact === false ? " false" : ""}`))].join(",");
    console.log(`${k} ${r0.width}×${r0.height} ${r0.bits}-bit ${(r0.bytes / 1e6).toFixed(2)} MB n=${rounds.length}` +
      `\n  off ${span([...off.values()])} | on ${span([...on.values()])} ×${ratio(on)} (on−off ${diff(on, off)})` +
      `\n  xxh3 check ${span([...check.values()])} ×${ratio(check)} | recheck (a copy) ${span([...recheck.values()])} ×${ratio(recheck)}` +
      `\n  fault ${span([...fault.values()])} ×${ratio(fault)} (fault−on ${diff(fault, on)}) took ${took("fault")}` +
      `\n  truth off ${exact("off")} on ${exact("on")} fault ${exact("fault")}; on took ${took("on")}; hasher ${x.reduce((n, r) => n + r.ok, 0)}/${x.reduce((n, r) => n + r.of, 0)}`);
  }
}
