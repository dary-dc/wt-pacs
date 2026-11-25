// The rig's driver, Chromium by raw CDP: one load per row, its ending, the wait, then what reached the sink, read by
// the read tool (report-plan.md §7.2–§7.3). Smoke here: the contract's grey-16 frame as a 32-frame series, not
// dbts_c1; D6 (the link drop under --tun) is not wired.
// node lab/report-arms/run.mjs --units "off,beacon:H,beacon:Y,off'" --endings D1,D2 [--rounds 18] [--mutant M]
//   [--sink-mutant ack-before-write] [--wait 60] [--receiver sink|nginx|receiver] [--tun] --out rows.jsonl
// --engine firefox: raw BiDi (bidi.mjs), FIREFOX_PATH. --tun (D6 needs it): reruns inside `unshare -rn`, the receivers and server behind link_impair.py --tun.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { startSink } from "./sink.mjs";
import { startNginx, nginxCounters } from "./nginx/nginx.mjs";
import { readLines, byLoad } from "./read.mjs";
import { latencies, quantile, floorTimes, bodies } from "./cells.js";
import { order, balanced } from "../order.mjs";
import * as chromium from "./cdp.mjs";
import * as firefox from "./bidi.mjs";
import { blackout } from "./levers.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const WORK = join(ROOT, "lab/.report-work");
const FRAMES = 32;
const AT = 10;
const LATER_FAULTS = 20;
/** The engine's driver: cdp.mjs or bidi.mjs, one set of calls. */
let cdp = chromium;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const bin = (name) => join(process.env.CARGO_TARGET_DIR ?? join(ROOT, "target"), "release", name);

/** A unit of §7.2: `arm:timing`, or `off` and its A/A twin `off'`, which loads as `off`. */
export function unit(name) {
  const [arm, timing = "off"] = name.split(":");
  return { unit: name, arm: arm.replace(/'$/, ""), timing };
}

/** One cell's loads: `rounds` rounds over the units, each round in Williams order, with its round and predecessor. */
export function plan(units, rounds) {
  const rows = [];
  for (let round = 0; round < rounds; round++) {
    order(units, round).forEach((u, i, run) => rows.push({ round, unit: u, predecessor: i ? run[i - 1] : null }));
  }
  return rows;
}

/** Per unit, whether its predecessors were balanced over the cell's rows (`lab/order.mjs`). */
export const balance = (rows, units) => Object.fromEntries(units.map((u) =>
  [u, balanced(rows.map((r) => ({ unit: r.unit, prev: r.predecessor })), u, units)]));

/** The relay's server namespace, from its READY line; null without --tun. */
export const relayNetns = (line) => /server_netns=(\S+)/.exec(line)?.[1] ?? null;

/** Chromium treats http on a non-loopback address as insecure: no isolation, no WebTransport, unless told. */
export const secureOrigins = (host, ports) => (host === "127.0.0.1" ? []
  : [`--unsafely-treat-insecure-origin-as-secure=${ports.map((p) => `http://${host}:${p}`).join(",")}`]);

/** Where the receivers and server live: loopback, or the relay's server namespace at §7.2's link. */
async function place(tun) {
  if (!tun) return { host: "127.0.0.1", ns: [], control: null, close: () => {} };
  execFileSync("ip", ["link", "set", "lo", "up"]);
  const control = 5600 + Math.floor(Math.random() * 300);
  const relay = spawn("python3", [join(ROOT, "lab/scripts/link_impair.py"), "--tun", "--delay-ms", "10", "--rate-kbit", "50000",
    "--queue-pkts", "200", "--blackout-mode", "drop", "--control-port", String(control)], { stdio: ["ignore", "pipe", "inherit"] });
  const netns = await new Promise((ok) => { let s = ""; relay.stdout.on("data", (b) => { s += b; if (/READY.*\n/.test(s)) ok(relayNetns(s)); }); });
  return { host: "10.77.0.2", ns: ["nsenter", `--net=${netns}`], control, close: () => relay.kill() };
}

/** The sink in-process on loopback; under --tun a process of its own in the server namespace. */
async function sinkAt(at, opts) {
  if (!at.ns.length) { const s = await startSink(opts); return { ...s, read: async () => s.counters }; }
  const [cmd, ...pre] = [...at.ns, process.execPath];
  const p = spawn(cmd, [...pre, join(ROOT, "lab/report-arms/sink.mjs"), "--dir", opts.dir, "--port", "0", "--statics", opts.statics,
    "--host", "0.0.0.0", ...(opts.mutant ? ["--mutant", opts.mutant] : [])], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((ok) => p.stdout.on("data", (b) => /READY (\d+)/.test(b) && ok(Number(/READY (\d+)/.exec(b)[1]))));
  return { port, read: () => fetch(`http://${at.host}:${port}/report/counters`).then((r) => r.json()), close: async () => p.kill() };
}

/** The server's banner; a build without `telemetry` has no link line nor SESSION's receiver, so it is refused. */
export function serverBanner(text) {
  const telemetry = /telemetry=(\S+)/.exec(text)?.[1];
  if (telemetry !== "compile-time") throw new Error(`${bin("series-server")} is not a telemetry build (telemetry=${telemetry}): cargo build --release -p series-server --features telemetry`);
  return { hash: /cert_sha256=(\S+)/.exec(text)[1] };
}

/** A load whose steps outlive `limitMs` (a driver that never answers): the browser killed, the row VOID. */
export const DRIVER_VOID = "VOID: driver";

/** The load's steps and its ending, then the wait with the browser still alive (§7.3), then the close. */
export async function drive(launch, steps, waitMs, limitMs = Infinity) {
  const b = await launch();
  let error = null, timer;
  const limit = new Promise((ok) => { if (limitMs < Infinity) timer = setTimeout(() => ok(DRIVER_VOID), limitMs); });
  try {
    error = await Promise.race([steps(b).then(() => null), limit]);
  } catch (e) {
    error = String(e?.message ?? e);
  }
  clearTimeout(timer);
  if (error !== DRIVER_VOID) await pause(waitMs);
  await b.close();
  return error;
}

/** Firefox's per-load bound (report-plan.md §7.9's driver hang); Chromium's driver never hung, so it has none. */
export const LOAD_LIMIT_MS = { firefox: 120_000, chromium: Infinity };

function series() {
  const d = join(WORK, "series");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const base = join(ROOT, "client/contract/frames/grey-16");
  const digest = readFileSync(`${base}.xxh3`, "utf8").trim();
  for (let i = 0; i < FRAMES; i++) symlinkSync(`${base}.j2c`, join(d, `${String(i).padStart(3, "0")}.htj2k`));
  writeFileSync(join(d, "metadata.json"), JSON.stringify({ frameCount: FRAMES, seriesLabel: "report-arms",
    sourceFingerprint: "0000000000000000", digests: { algorithm: "xxh3-64", frames: Array(FRAMES).fill(digest) } }));
  execFileSync(bin("pack-series"), ["--metadata", join(d, "metadata.json"), "--frames", d,
    "--output", join(d, "series.sbnd")]);
  return d;
}

async function server(d, out, at) {
  const tls = join(WORK, "tls");
  mkdirSync(tls, { recursive: true });
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout",
    `${tls}/key.pem`, "-out", `${tls}/cert.pem`, "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext",
    `subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${at.host}`], { stdio: "ignore" });
  const port = 4600 + Math.floor(Math.random() * 300);
  const [cmd, ...pre] = [...at.ns, bin("series-server")];
  const srv = spawn(cmd, [...pre, "--port", String(port), "--bind", at.host,
    "--series", `${d}/series.sbnd`, "--cert-pem", `${tls}/cert.pem`, "--key-pem", `${tls}/key.pem`],
    { env: { ...process.env, WTPACS_LINK_RECORD_PATH: join(out, "link.jsonl"), WTPACS_SESSION_REPORT_DIR: out }, stdio: ["ignore", "pipe", "ignore"] });
  const banner = await new Promise((ok) => { let s = ""; srv.stdout.on("data", (b) => { s += b; if (/telemetry=\S+\n/.test(s)) ok(s); }); });
  try {
    return { srv, wt: `https://${at.host}:${port}/`, ...serverBanner(banner) };
  } catch (e) {
    srv.kill();
    throw e;
  }
}

const waitFor = async (b, page, expr, ms, every = 20) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cdp.evaluate(b, page, expr).catch(() => false)) return true; await pause(every); }
  return false;
};

/** D5's wait: the kill falls `ms` after the decoder's fault, on the browser's clock, however late the driver learns. */
export async function killAfterFault({ since, pause }, ms) {
  const learned = await since();
  await pause(Math.max(0, ms - learned));
  const atKill = await since();
  return { learned, atKill, late: learned > ms };
}

/** `{load, at}` the decoder worker posts to the sink at its fault (D5a-busy), `at` epoch ms; one load at a time. */
const faults = [];
const nowMs = () => performance.timeOrigin + performance.now();

/** D5a-busy: the kill timed from the worker's own report of the fault and sent at once; every call through the busy
 * page thread waited for its long task, so the kill always fell after the hand-off (page-runs.md §2). */
export async function killOnFault({ heard, crash, pause, timeoutMs = 30000 }, ms) {
  const end = Date.now() + timeoutMs;
  while (heard() === null && Date.now() < end) await pause(1);
  if (heard() === null) return { reached: "no mismatch", kill: null };
  const kill = await killAfterFault({ since: async () => nowMs() - heard(), pause }, ms);
  await crash();
  return { reached: "mismatch", kill: { ...kill, safetyHanded: null } };
}

/** D5a-busy's kill delay, ms: uniform on 0–50, from seed = round × 100 + the unit's index (page-runs.md §2(b)). */
export function killDelay(round, index) {
  let x = (round * 100 + index + 0x6d2b79f5) | 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return { seed: round * 100 + index, ms: (((x ^ (x >>> 14)) >>> 0) / 2 ** 32) * 50 };
}

/** The spread check run on each D5a-busy cell before it is read: an arm's drawn delays span at least 30 ms. */
export function delaySpread(rows) {
  const by = Map.groupBy(rows.filter((r) => r.killDelay), (r) => r.unit);
  return Object.fromEntries([...by].map(([u, rs]) => {
    const ms = rs.map((r) => r.killDelay.ms);
    const span = Math.max(...ms) - Math.min(...ms);
    return [u, { span, void: span < 30 }];
  }));
}

/** Each ending of §7.3, from the fill's end + 6 s (D5: from the mismatch). */
const ENDINGS = {
  D1: (b, p, o) => cdp.navigate(b, p, o.other),
  D2: (b, p) => cdp.close(b, p),
  D3: async (b, p) => { await cdp.hide(b, p); await pause(1000); cdp.crash(b, p); },
  D4: async (b, p) => { await cdp.hide(b, p); await pause(1000); cdp.killBrowser(b); },
  D5a: (b, p) => cdp.crash(b, p),
  D5b: (b, p) => cdp.crash(b, p),
  D7: async (b, p, o) => { await cdp.navigate(b, p, o.other); await pause(1500); await cdp.back(b, p); await pause(1500);
                           await cdp.evaluate(b, p, "rig.press('frame')"); await cdp.navigate(b, p, o.other); },
  D8: (b, p, o) => cdp.navigate(b, p, o.other),
  D6: async (b, p, o) => { await blackout(o.control, 30000); await pause(1000); await cdp.hide(b, p); await pause(1000);
                           await cdp.navigate(b, p, o.other); },
  D9: async (b, p, o) => { await cdp.hide(b, p); await pause(5000); if (o.engine === "chromium") await cdp.freeze(b, p); await pause(55000); },
  L: async (b, p, o) => { o.row.faults = await laterFaults(b, p); },
  Lbusy: async (b, p, o) => { o.row.faults = await laterFaults(b, p); },
  C: async (b, p, o) => { await cdp.hide(b, p); await pause(500); o.row.cost = await cdp.evaluate(b, p, "rig.cost()");
                          await cdp.navigate(b, p, o.other); },
};

/** Cell L: the fill's own fault, then 20 more, 1 s apart, each a fresh ask of the faulted frame. */
async function laterFaults(b, p) {
  for (let k = 0; k < LATER_FAULTS; k++) { await cdp.evaluate(b, p, "rig.refault()"); await pause(1000); }
  return cdp.evaluate(b, p, "rig.faults");
}

/** The receiver the carriers post to, and the origin the page loads from: the sink itself, NGINX, or RECEIVER behind
 * nginx; nginx proxies the pages to the sink. */
async function front(receiver, out, sink, sinkMutant, at) {
  if (receiver === "sink") return { port: sink.port, counters: sink.read, close: async () => {} };
  let rec = null;
  if (receiver === "receiver") {
    const [cmd, ...pre] = [...at.ns, bin("report-receiver")];
    rec = spawn(cmd, [...pre, "--port", "0", "--dir", out, "--fields", join(ROOT, "lab/report-arms/report-fields.json"),
      ...(sinkMutant ? ["--mutant", sinkMutant] : [])], { stdio: ["ignore", "pipe", "inherit"] });
    rec.port = await new Promise((ok) => rec.stdout.on("data", (b) => ok(Number(String(b).split(" ")[1]))));
  }
  const port = 18000 + Math.floor(Math.random() * 1000);
  const n = await startNginx({ dir: out, port, pages: sink.port, receiver: rec ? rec.port : "nginx", host: at.host, prefix: at.ns });
  const counters = rec ? () => fetch(`http://${at.host}:${port}/report/counters`).then((r) => r.json())
    : async () => nginxCounters(out);
  return { port, counters, close: async () => { rec?.kill(); await n.close(); } };
}

async function load({ unit: u, ending, mutant, sinkMutant, wait, sink, srv, dir, out, via, at, engine, round, index }) {
  const { arm, timing } = unit(u);
  const row = { unit: u, arm, timing, ending, mutant: mutant ?? null, sinkMutant: sinkMutant ?? null, engine };
  if (ending === "D5a-busy") row.killDelay = killDelay(round, index);
  if (ending === "D6" && !at.control) throw new Error("D6 needs --tun");
  const origins = [via.port, sink.port].map((port) => `http://${at.host}:${port}`);
  const launch = engine === "firefox" ? () => cdp.launch({ secure: at.ns.length ? origins : [] })
    : () => cdp.launch({ args: secureOrigins(at.host, [via.port, sink.port]) });
  row.error = await drive(launch, async (b) => {
    await cdp.openPage(b, "about:blank");
    const q = new URLSearchParams({ arm, timing, dir: `/${relative(ROOT, dir)}`, fault: "sample", at: AT,
      wt: srv?.wt ?? "https://127.0.0.1:9/", hash: srv?.hash ?? "00", ...(mutant ? { mutant } : {}),
      ...(ending === "D8" ? { forced: "page" } : {}), ...(ending === "Lbusy" || ending === "D5a-busy" ? { busy: "1" } : {}),
      ...(ending.startsWith("L") ? { floor: "safety" } : ending === "C" ? { floor: "load" } : {}),
      ...(ending === "D5a-busy" ? { ping: "1" } : {}) });
    faults.length = 0;
    const opening = cdp.openPage(b, `http://${at.host}:${via.port}/lab/report-arms/index.html?${q}`);
    const killing = ending === "D5a-busy" && killOnFault({ heard: () => faults[0]?.at ?? null, pause,
      crash: async () => cdp.crash(b, await opening) }, row.killDelay.ms).then((k) => Object.assign(row, k));
    const p = await opening;
    // D5a-busy's page may be killed before any call through its thread returns; the worker's report names the load.
    row.load = killing ? (await killing, faults[0]?.load ?? null)
      : await cdp.evaluate(b, p, "new Promise((r) => { const t = setInterval(() => rig.load && (clearInterval(t), r(rig.load)), 10); })");
    const other = `http://${at.ns.length ? at.host : "localhost"}:${sink.port}/lab/report-arms/probe.html?id=away`;
    if (killing) return;
    if (ending.startsWith("D5")) {
      row.reached = await waitFor(b, p, "rig.faultAt !== null", 30000, 1) ? "mismatch" : "no mismatch";
      row.kill = await killAfterFault({ since: () => cdp.evaluate(b, p, "rig.sinceFault()"), pause }, ending === "D5a" ? 50 : 500);
      row.kill.safetyHanded = await cdp.evaluate(b, p, "rig.safety");
    } else {
      row.reached = ending === "D8" ? (await pause(6000), await cdp.evaluate(b, p, "rig.state"))
        : (await waitFor(b, p, "rig.state === 'filled'", 30000) ? "filled" : await cdp.evaluate(b, p, "rig.error ?? rig.state"));
      for (const text of ["frame", "frame", "frame", "Lossless"]) await cdp.evaluate(b, p, `rig.press(${JSON.stringify(text)})`);
      await pause(ending === "D6" ? 4000 : 6000);
    }
    if (!ending.startsWith("D5")) row.fillMs = await cdp.evaluate(b, p, "rig.fillMs ?? null");
    if (/^(L|C)/.test(ending)) row.floors = await cdp.evaluate(b, p, "rig.floors ?? null");
    await ENDINGS[ending](b, p, { other, row, control: at.control, engine });
  }, wait * 1000, LOAD_LIMIT_MS[engine]);
  const files = readdirSync(out).filter((f) => /^(load|safety)-.*\.jsonl$/.test(f) || f === "report-fallback.log");
  const lines = ["load.jsonl", "safety.jsonl", "link.jsonl", "server-load.jsonl", "server-safety.jsonl"]
    .filter((f) => existsSync(join(out, f))).concat(files)
    .flatMap((f) => readFileSync(join(out, f), "utf8").split("\n"));
  const { records } = readLines(lines);
  const e = byLoad(records).get(row.load);
  row.y = bodies(records, row.load);
  Object.assign(row, { fill: !!e?.records.some((r) => r.seq === 0 && r.fillMs != null), seqs: e?.seqs ?? [],
    safety: e?.safety.length ?? 0, duplicates: e?.duplicates ?? 0, unkeyed: e?.unkeyed ?? 0, outside: e?.outside ?? [],
    link: !!e?.link, receiver: via.name, counters: structuredClone(await via.counters()) });
  if (row.floors) row.floor = floorTimes(row.floors, lines);
  if (row.faults) {
    const l = latencies(row.faults, lines, row.load);
    row.latency = { fill: l[0], later: l.slice(1), p50: quantile(l.slice(1), 0.5), p99: quantile(l.slice(1), 0.99) };
  }
  const server = join(out, "server-counters.json");
  if (existsSync(server)) row.serverCounters = JSON.parse(readFileSync(server, "utf8"));
  return row;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: o } = parseArgs({ options: { units: { type: "string", default: "off,stub:Y" },
    endings: { type: "string", default: "D1" }, rounds: { type: "string", default: "1" }, mutant: { type: "string" },
    "from-round": { type: "string", default: "0" },
    "sink-mutant": { type: "string" }, receiver: { type: "string", default: "sink" }, tun: { type: "boolean" }, engine: { type: "string", default: "chromium" }, wait: { type: "string", default: "60" }, out: { type: "string", default: "rows.jsonl" } } });
  if (o["sink-mutant"] && o.receiver === "nginx") throw new Error("--sink-mutant has no lever in NGINX");
  if (o.tun && !process.env.REPORT_ARMS_NS) {
    process.exit(spawnSync("unshare", ["-rn", "env", "REPORT_ARMS_NS=1", process.execPath, ...process.argv.slice(1)], { stdio: "inherit" }).status ?? 1);
  }
  cdp = { chromium, firefox }[o.engine];
  // A Firefox that dies mid-load closes its socket under calls some step had dropped; the row records the error.
  process.on("unhandledRejection", (e) => {
    if (e?.message !== "BiDi socket closed") throw e;
    console.error("dropped call after the BiDi socket closed");
  });
  const at = await place(o.tun);
  const units = o.units.split(",");
  const out = join(WORK, `sink-${Date.now()}`);
  mkdirSync(out, { recursive: true });
  const dir = series();
  const sink = await sinkAt(at, { dir: out, port: 0, statics: ROOT, mutant: o["sink-mutant"], onFault: (t) => faults.push(t) });
  const via = { name: o.receiver, ...await front(o.receiver, out, sink, o["sink-mutant"], at) };
  const servers = {};
  try {
    for (const ending of o.endings.split(",")) {
      const rows = plan(units, Number(o.rounds));
      const done = [];
      // --from-round: a cell cut by a host restart goes on at a round boundary, its Williams order unchanged.
      for (const { round, unit: u, predecessor } of rows.filter((r) => r.round >= Number(o["from-round"]))) {
        const srv = ending === "D8" ? null : (servers.up ??= await server(dir, out, at));
        const row = { round, predecessor, ...await load({ unit: u, ending, mutant: o.mutant, sinkMutant: o["sink-mutant"],
          wait: Number(o.wait), sink, srv, dir, out, via, at, engine: o.engine, round, index: units.indexOf(u) }) };
        appendFileSync(o.out, JSON.stringify(row) + "\n");
        console.log(JSON.stringify(row));
        done.push(row);
      }
      const line = { cell: ending, rounds: Number(o.rounds), balanced: balance(rows, units),
                     ...(o["from-round"] !== "0" ? { fromRound: Number(o["from-round"]) } : {}),
                     ...(ending === "D5a-busy" ? { spread: delaySpread(done) } : {}) };
      appendFileSync(o.out, JSON.stringify(line) + "\n");
      console.log(JSON.stringify(line));
    }
  } finally {
    servers.up?.srv.kill();
    await via.close();
    await sink.close();
    at.close();
  }
}
