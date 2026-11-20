// Cell R, the receivers' cost (report-plan.md §7.3): recorded D1 bodies posted at each rate for its seconds, load
// and safety reports in separate bursts, to NGINX and to RECEIVER behind nginx, each started fresh per burst; CPU
// and peak RSS of each process read from /proc. The server's row (report streams during a fill) is not built.
// NGINX_BIN=<nginx ≥ 1.31.5> node lab/report-arms/receivers.mjs --bodies FILE [--rates 10,100,1000] [--seconds 60]
//   [--rounds 6] --out rows.jsonl
import { spawn } from "node:child_process";
import { Agent, request } from "node:http";
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startSink } from "./sink.mjs";
import { startNginx, nginxCounters } from "./nginx/nginx.mjs";
import { descendants } from "./levers.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const HZ = 100;

/** Send offsets in ms: `rate` a second, evenly spaced, for `seconds`. */
export const ticks = (rate, seconds) => Array.from({ length: rate * seconds }, (_, k) => Math.round((k * 1000) / rate));

/** utime + stime of one process (fields 14 and 15), in seconds. */
export function cpuSeconds(stat, hz = HZ) {
  const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return (Number(f[11]) + Number(f[12])) / hz;
}

export const peakKb = (status) => Number(/VmHWM:\s+(\d+) kB/.exec(status)?.[1] ?? NaN);
export const perThousand = (cpu, sent) => (sent ? (cpu * 1000) / sent : null);
export const rotation = (xs, k) => xs.map((_, i) => xs[(i + k) % xs.length]);

/** Source addresses for `rate` a second, each under 5 a second: NGINX limits 10 r/s per address (nginx.mjs). */
export const sources = (rate) => Array.from({ length: Math.ceil(rate / 5) }, (_, i) => `127.1.${Math.floor(i / 250)}.${1 + (i % 250)}`);

/** Lines of a log that were appended: NGINX logs its refusals too, with their status; RECEIVER logs appends only. */
export const appended = (text) => text.split("\n").filter(Boolean).filter((l) => { const { s } = JSON.parse(l); return s === undefined || s.startsWith("2"); }).length;

const read = (pid, f) => { try { return readFileSync(`/proc/${pid}/${f}`, "utf8"); } catch { return null; } };

/** Per process of the receiver: CPU seconds since it started, and its peak RSS. */
function cost(roots) {
  const pids = roots.flatMap((r) => [r.pid, ...descendants(r.pid).map((d) => d.pid)].map((pid) => ({ name: r.name, pid })));
  return pids.map(({ name, pid }) => ({ name, pid, cpu: cpuSeconds(read(pid, "stat") ?? ""), peakKb: peakKb(read(pid, "status") ?? "") }));
}

async function receiver(target, dir, sink) {
  const port = 18000 + Math.floor(Math.random() * 1000);
  if (target === "nginx") {
    const n = await startNginx({ dir, port, pages: sink.port, receiver: "nginx" });
    return { port, roots: [{ name: "nginx", pid: n.pid }], counters: async () => nginxCounters(dir), close: n.close };
  }
  const rec = spawn(join(process.env.CARGO_TARGET_DIR ?? join(ROOT, "target"), "release", "report-receiver"),
    ["--port", "0", "--dir", dir, "--fields", join(ROOT, "lab/report-arms/report-fields.json")], { stdio: ["ignore", "pipe", "ignore"] });
  const recPort = await new Promise((ok) => rec.stdout.once("data", (b) => ok(Number(String(b).split(" ")[1]))));
  const n = await startNginx({ dir, port, pages: sink.port, receiver: recPort });
  return { port, roots: [{ name: "nginx", pid: n.pid }, { name: "receiver", pid: rec.pid }],
    counters: () => fetch(`http://127.0.0.1:${port}/report/counters`).then((r) => r.json()),
    close: async () => { rec.kill(); await n.close(); } };
}

function post(port, kind, body, agent) {
  return new Promise((ok) => {
    const req = request({ host: "127.0.0.1", port, path: `/report/${kind}`, method: "POST", agent,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => { res.resume(); res.on("end", () => ok(res.statusCode)); });
    req.on("error", () => ok("error"));
    req.end(body);
  });
}

/** One burst: each body under a fresh reportId, at its tick, from the sources in turn; the answers by status. */
async function burst(port, kind, bodies, rate, seconds) {
  const statuses = {};
  const agents = sources(rate).map((localAddress) => new Agent({ keepAlive: true, localAddress }));
  const start = performance.now();
  const cpu0 = process.cpuUsage();
  const sends = [];
  for (const [k, at] of ticks(rate, seconds).entries()) {
    const wait = start + at - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const body = bodies[k % bodies.length].replace(/"reportId":"[0-9a-f]{32}"/, `"reportId":"${crypto.randomUUID().replaceAll("-", "")}"`);
    sends.push(post(port, kind, body, agents[k % agents.length]).then((s) => { statuses[s] = (statuses[s] ?? 0) + 1; }));
  }
  await Promise.all(sends);
  for (const a of agents) a.destroy();
  const used = process.cpuUsage(cpu0);
  return { sent: sends.length, ms: performance.now() - start, statuses, generatorCores: (used.user + used.system) / 1000 / (performance.now() - start) };
}

const lines = (dir, kind) => readdirSync(dir).filter((f) => f.startsWith(`${kind}-`) && f.endsWith(".jsonl"))
  .reduce((n, f) => n + appended(readFileSync(join(dir, f), "utf8")), 0);

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: o } = parseArgs({ options: { bodies: { type: "string" }, rates: { type: "string", default: "10,100,1000" },
    seconds: { type: "string", default: "60" }, rounds: { type: "string", default: "6" }, out: { type: "string", default: "rows.jsonl" } } });
  const recorded = readFileSync(o.bodies, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).r);
  const bodies = { load: [], safety: [] };
  for (const r of recorded) bodies[r.kind]?.push(JSON.stringify(r));
  const work = join(ROOT, "lab/.report-work", `r-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const sink = await startSink({ dir: work, port: 0, statics: ROOT });
  try {
    for (let round = 0; round < Number(o.rounds); round++) {
      for (const target of rotation(["nginx", "receiver"], round)) {
        for (const rate of o.rates.split(",").map(Number)) {
          for (const kind of ["load", "safety"]) {
            const dir = join(work, `${round}-${target}-${rate}-${kind}`);
            mkdirSync(dir, { recursive: true });
            const r = await receiver(target, dir, sink);
            const before = new Map(cost(r.roots).map((p) => [p.pid, p.cpu]));
            const b = await burst(r.port, kind, bodies[kind], rate, Number(o.seconds));
            await new Promise((ok) => setTimeout(ok, 1000));
            const procs = cost(r.roots).map((p) => ({ ...p, cpu: p.cpu - (before.get(p.pid) ?? 0) }));
            const counters = await r.counters();
            await r.close();
            const cpu = procs.reduce((s, p) => s + p.cpu, 0);
            const row = { round, target, rate, kind, seconds: Number(o.seconds), ...b, procs, cpu,
              cpuPer1000: perThousand(cpu, b.sent), coreShare: cpu / (b.ms / 1000), peakKb: Math.max(...procs.map((p) => p.peakKb)),
              lines: lines(dir, kind), refused: counters.refused, saturated: b.generatorCores >= 3 };
            appendFileSync(o.out, JSON.stringify(row) + "\n");
            console.log(JSON.stringify(row));
          }
        }
      }
    }
  } finally {
    await sink.close();
  }
}
