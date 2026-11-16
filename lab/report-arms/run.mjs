// The rig's driver, Chromium by raw CDP: one load per row, its ending, the wait, then what reached the sink, read by
// the read tool (report-plan.md §7.2–§7.3). Smoke here: the contract's grey-16 frame as a 32-frame series, not
// dbts_c1; D6 (the link drop under --tun) is not wired.
// node lab/report-arms/run.mjs --units "off,beacon:H,beacon:Y,off'" --endings D1,D2 [--rounds 18] [--mutant M]
//   [--sink-mutant ack-before-write] [--wait 60] [--receiver sink|nginx|receiver] --out rows.jsonl
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { startSink } from "./sink.mjs";
import { startNginx, nginxCounters } from "./nginx/nginx.mjs";
import { readLines, byLoad } from "./read.mjs";
import { order, balanced } from "../order.mjs";
import * as cdp from "./cdp.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const WORK = join(ROOT, "lab/.report-work");
const FRAMES = 32;
const AT = 10;
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

/** The server's banner; a build without `telemetry` has no link line nor SESSION's receiver, so it is refused. */
export function serverBanner(text) {
  const telemetry = /telemetry=(\S+)/.exec(text)?.[1];
  if (telemetry !== "compile-time") throw new Error(`${bin("series-server")} is not a telemetry build (telemetry=${telemetry}): cargo build --release -p series-server --features telemetry`);
  return { hash: /cert_sha256=(\S+)/.exec(text)[1] };
}

/** The load's steps and its ending, then the wait with the browser still alive (§7.3), then the close. */
export async function drive(launch, steps, waitMs) {
  const b = await launch();
  let error = null;
  try {
    await steps(b);
  } catch (e) {
    error = String(e?.message ?? e);
  }
  await pause(waitMs);
  b.close();
  return error;
}

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

async function server(d, out) {
  const tls = join(WORK, "tls");
  mkdirSync(tls, { recursive: true });
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout",
    `${tls}/key.pem`, "-out", `${tls}/cert.pem`, "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const port = 4600 + Math.floor(Math.random() * 300);
  const srv = spawn(bin("series-server"), ["--port", String(port), "--bind", "127.0.0.1",
    "--series", `${d}/series.sbnd`, "--cert-pem", `${tls}/cert.pem`, "--key-pem", `${tls}/key.pem`],
    { env: { ...process.env, WTPACS_LINK_RECORD_PATH: join(out, "link.jsonl"), WTPACS_SESSION_REPORT_DIR: out }, stdio: ["ignore", "pipe", "ignore"] });
  const banner = await new Promise((ok) => { let s = ""; srv.stdout.on("data", (b) => { s += b; if (/telemetry=\S+\n/.test(s)) ok(s); }); });
  try {
    return { srv, wt: `https://127.0.0.1:${port}/`, ...serverBanner(banner) };
  } catch (e) {
    srv.kill();
    throw e;
  }
}

const waitFor = async (b, page, expr, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cdp.evaluate(b, page, expr).catch(() => false)) return true; await pause(20); }
  return false;
};

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
  D9: async (b, p) => { await cdp.hide(b, p); await pause(5000); await cdp.freeze(b, p); await pause(55000); },
};

/** The receiver the carriers post to, and the origin the page loads from: the sink itself, NGINX, or RECEIVER behind
 * nginx; nginx proxies the pages to the sink. */
async function front(receiver, out, sink, sinkMutant) {
  if (receiver === "sink") return { port: sink.port, counters: async () => sink.counters, close: async () => {} };
  let rec = null;
  if (receiver === "receiver") {
    rec = spawn(bin("report-receiver"), ["--port", "0", "--dir", out, "--fields", join(ROOT, "lab/report-arms/report-fields.json"),
      ...(sinkMutant ? ["--mutant", sinkMutant] : [])], { stdio: ["ignore", "pipe", "inherit"] });
    rec.port = await new Promise((ok) => rec.stdout.on("data", (b) => ok(Number(String(b).split(" ")[1]))));
  }
  const port = 18000 + Math.floor(Math.random() * 1000);
  const n = await startNginx({ dir: out, port, pages: sink.port, receiver: rec ? rec.port : "nginx" });
  const counters = rec ? () => fetch(`http://127.0.0.1:${port}/report/counters`).then((r) => r.json())
    : async () => nginxCounters(out);
  return { port, counters, close: async () => { rec?.kill(); await n.close(); } };
}

async function load({ unit: u, ending, mutant, sinkMutant, wait, sink, srv, dir, out, via }) {
  const { arm, timing } = unit(u);
  const row = { unit: u, arm, timing, ending, mutant: mutant ?? null, sinkMutant: sinkMutant ?? null, engine: "chromium" };
  row.error = await drive(cdp.launch, async (b) => {
    await cdp.openPage(b, "about:blank");
    const q = new URLSearchParams({ arm, timing, dir: `/${relative(ROOT, dir)}`, fault: "sample", at: AT,
      wt: srv?.wt ?? "https://127.0.0.1:9/", hash: srv?.hash ?? "00", ...(mutant ? { mutant } : {}),
      ...(ending === "D8" ? { forced: "page" } : {}) });
    const p = await cdp.openPage(b, `http://127.0.0.1:${via.port}/lab/report-arms/index.html?${q}`);
    row.load = await cdp.evaluate(b, p, "new Promise((r) => { const t = setInterval(() => rig.load && (clearInterval(t), r(rig.load)), 10); })");
    const other = `http://localhost:${sink.port}/lab/report-arms/probe.html?id=away`;
    if (ending.startsWith("D5")) {
      row.reached = await waitFor(b, p, "rig.safety > 0", 30000) ? "mismatch" : "no mismatch";
      await pause(ending === "D5a" ? 50 : 500);
    } else {
      row.reached = ending === "D8" ? (await pause(6000), await cdp.evaluate(b, p, "rig.state"))
        : (await waitFor(b, p, "rig.state === 'filled'", 30000) ? "filled" : await cdp.evaluate(b, p, "rig.error ?? rig.state"));
      for (const text of ["frame", "frame", "frame", "Lossless"]) await cdp.evaluate(b, p, `rig.press(${JSON.stringify(text)})`);
      await pause(6000);
    }
    await ENDINGS[ending](b, p, { other });
  }, wait * 1000);
  const files = readdirSync(out).filter((f) => /^(load|safety)-.*\.jsonl$/.test(f) || f === "report-fallback.log");
  const lines = ["load.jsonl", "safety.jsonl", "link.jsonl", "server-load.jsonl", "server-safety.jsonl"]
    .filter((f) => existsSync(join(out, f))).concat(files)
    .flatMap((f) => readFileSync(join(out, f), "utf8").split("\n"));
  const e = byLoad(readLines(lines).records).get(row.load);
  Object.assign(row, { fill: !!e?.records.some((r) => r.seq === 0 && r.fillMs != null), seqs: e?.seqs ?? [],
    safety: e?.safety.length ?? 0, duplicates: e?.duplicates ?? 0, unkeyed: e?.unkeyed ?? 0, outside: e?.outside ?? [],
    link: !!e?.link, receiver: via.name, counters: structuredClone(await via.counters()) });
  const server = join(out, "server-counters.json");
  if (existsSync(server)) row.serverCounters = JSON.parse(readFileSync(server, "utf8"));
  return row;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: o } = parseArgs({ options: { units: { type: "string", default: "off,stub:Y" },
    endings: { type: "string", default: "D1" }, rounds: { type: "string", default: "1" }, mutant: { type: "string" },
    "sink-mutant": { type: "string" }, receiver: { type: "string", default: "sink" }, wait: { type: "string", default: "60" }, out: { type: "string", default: "rows.jsonl" } } });
  if (o["sink-mutant"] && o.receiver === "nginx") throw new Error("--sink-mutant has no lever in NGINX");
  const units = o.units.split(",");
  const out = join(WORK, `sink-${Date.now()}`);
  mkdirSync(out, { recursive: true });
  const dir = series();
  const sink = await startSink({ dir: out, port: 0, statics: ROOT, mutant: o["sink-mutant"] });
  const via = { name: o.receiver, ...await front(o.receiver, out, sink, o["sink-mutant"]) };
  const servers = {};
  try {
    for (const ending of o.endings.split(",")) {
      const rows = plan(units, Number(o.rounds));
      for (const { round, unit: u, predecessor } of rows) {
        const srv = ending === "D8" ? null : (servers.up ??= await server(dir, out));
        const row = { round, predecessor, ...await load({ unit: u, ending, mutant: o.mutant, sinkMutant: o["sink-mutant"],
          wait: Number(o.wait), sink, srv, dir, out, via }) };
        appendFileSync(o.out, JSON.stringify(row) + "\n");
        console.log(JSON.stringify(row));
      }
      const line = { cell: ending, rounds: Number(o.rounds), balanced: balance(rows, units) };
      appendFileSync(o.out, JSON.stringify(line) + "\n");
      console.log(JSON.stringify(line));
    }
  } finally {
    servers.up?.srv.kill();
    await via.close();
    await sink.close();
  }
}
