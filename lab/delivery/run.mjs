/**
 * The delivery comparison's driver: one cell's loads (plan.mjs) through the relay's TUN plane in a namespace of its
 * own, the viewer with each arm's round levers, a fresh browser a load; raw rows to `--out` as they land.
 * docs/client/evidence/delivery-comparison.md §2, §5, §6; lab/delivery/README.md
 *
 *   node lab/delivery/run.mjs --cell CLEAN --series DIR --predictions FILE [--rounds N] [--pilot] [--pilot-medians FILE]
 *     [--view VOLUME=ID …] [--out FILE] [--fill-s 300] [--after-s 300] [--mutate fixed-order|relay-no-loss|decoders-3|flip-exact]
 *   node lab/delivery/run.mjs --bench --series DIR [--view VOLUME=ID …] [--out FILE]     # K2
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { CELLS, UNIMPAIRED, VOLUMES, cellLoads } from "./plan.mjs";
import { digestOf } from "./predict.mjs";
import { voidOf } from "./judge.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const args = (k) => argv.flatMap((a, i) => (a === k ? [argv[i + 1]] : []));
const flag = (k) => argv.includes(k);

// The relay needs CAP_NET_ADMIN, so the whole driver runs in a user and network namespace of its own.
if (!process.env.DELIVERY_NS) {
  const r = spawnSync("unshare", ["-rn", process.execPath, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, DELIVERY_NS: "1" } });
  process.exit(r.status ?? 1);
}

const { chromium } = createRequire(import.meta.url)("playwright");
const BENCH = flag("--bench");
const CELL = arg("--cell");
const MUTATE = arg("--mutate", "");
const PILOT = flag("--pilot");
const SERIES = path.resolve(arg("--series", ""));
const SERVER = path.join(ROOT, "target/release/series-server");
const IDLE_MS = Number(arg("--idle-ms", 10_000));
/** The three timed volumes' views, as scripts/demo-series.sh names them; each names its exact series. */
const VIEWS = { dbts_a1: "dbts_a1-q8-g8-cut", dbts_b1: "dbts_b1-q8-g8", dbts_c1: "dbts_c1-q8-g8-cut", ...Object.fromEntries(args("--view").map((v) => v.split("="))) };
const VOLS = arg("--volumes")?.split(",") ?? VOLUMES;
const SERVER_IP = "10.77.0.2";
const [VIEW_PORT, EXACT_PORT, PAIR_PAGE, EXACT_PAGE, ROUND_PORT, CTRL_PORT] = [4433, 4434, 8765, 8767, 8790, 5599];
const [FILL_S, AFTER_S] = [Number(arg("--fill-s", 300)), Number(arg("--after-s", 300))];

if (!BENCH && !CELLS[CELL]) throw new Error(`--cell ${CELL}: one of ${Object.keys(CELLS).join(" ")}, or --bench`);
const form = BENCH ? { relay: UNIMPAIRED } : CELLS[CELL];
const OUT = arg("--out", path.join(ROOT, `lab/delivery/rows/${BENCH ? "K2" : CELL}${PILOT ? "-pilot" : ""}${MUTATE ? `-${MUTATE}` : ""}.jsonl`));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const predictionsText = BENCH ? null : fs.readFileSync(arg("--predictions"), "utf8");
const predictionsXxh3 = predictionsText && (await digestOf(predictionsText));

const T = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-"));
const kids = new Set();
const start = (cmd, a, log) => {
  const k = spawn(cmd, a, { cwd: ROOT, stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")] });
  kids.add(k);
  return k;
};
const stop = async (k) => {
  if (k.exitCode === null) k.kill("SIGTERM");
  await new Promise((r) => (k.exitCode !== null || k.signalCode !== null ? r() : k.once("exit", r)));
  kids.delete(k);
};
process.on("exit", () => {
  for (const k of kids) k.kill("SIGKILL");
  fs.rmSync(T, { recursive: true, force: true });
});
process.on("SIGTERM", () => process.exit(143));
process.on("SIGINT", () => process.exit(130));
const sh = (cmd) => execFileSync("bash", ["-c", cmd], { cwd: ROOT }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(file, text, ms = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const line = (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "").split("\n").find((l) => l.includes(text));
    if (line) return line;
    await sleep(50);
  }
  throw new Error(`${path.basename(file)} never said ${text}: ${fs.existsSync(file) ? fs.readFileSync(file, "utf8").slice(-400) : ""}`);
}

// §2's cores: the relay on 0, the server on 1, this driver and so the browser on 2–3.
sh(`taskset -a -p -c 2,3 ${process.pid} >/dev/null; ip link set lo up`);
sh(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem -out ${T}/cert.pem \
  -days 10 -nodes -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:${SERVER_IP}' 2>/dev/null`);
const certHash = sh(`openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 -hex | sed 's/.* //'`);
const transportFile = (port) => {
  const file = `${T}/t-${port}.json`;
  fs.writeFileSync(file, JSON.stringify({ wt_url: `https://${SERVER_IP}:${port}/`, cert_sha256: certHash }));
  return file;
};
const BEACON = `${T}/beacon.jsonl`;

/** Per core, busy and total jiffies. */
const cpuStat = () => fs.readFileSync("/proc/stat", "utf8").split("\n").filter((l) => /^cpu\d/.test(l)).map((l) => {
  const v = l.split(/\s+/).slice(1).map(Number);
  return { busy: v[0] + v[1] + v[2] + v[5] + v[6] + v[7], total: v.slice(0, 8).reduce((a, b) => a + b, 0) };
});
const ticks = (pid) => {
  const f = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const v = f.slice(f.lastIndexOf(")") + 2).split(" ");
  return Number(v[11]) + Number(v[12]);
};
/** The relay's exit tally: each way's counts, bytes to the client by flow, and its guard. */
function tally(log) {
  const tun = log.match(/tun client->server sent (\d+) lost (\d+) overflowed (\d+) codel \d+ \| server->client sent (\d+) lost (\d+) overflowed (\d+)/);
  const flows = [...log.matchAll(/^flow client (\S+) (\S+) (\S+) packets (\d+) bytes (\d+)/gm)].map((m) => ({ proto: m[1], from: m[2], to: m[3], packets: Number(m[4]), bytes: Number(m[5]) }));
  return {
    up: tun && { sent: Number(tun[1]), lost: Number(tun[2]), overflowed: Number(tun[3]) },
    down: tun && { sent: Number(tun[4]), lost: Number(tun[5]), overflowed: Number(tun[6]) },
    flows, timing: log.match(/self-timing .*/)?.[0] ?? null, late: /VOID: p99 over/.test(log),
  };
}

/** The page's round host: each load ends by asking it for /next?after=k. */
let ended = () => {};
const roundHost = http.createServer((req, res) => {
  res.end("<!doctype html>next");
  const k = new URL(req.url, "http://x").searchParams.get("after");
  if (k !== null) ended(Number(k));
}).listen(ROUND_PORT, "127.0.0.1");

const seriesIds = (volume) => {
  const view = VIEWS[volume];
  const exact = JSON.parse(fs.readFileSync(path.join(SERIES, `${view}.metadata.json`), "utf8")).exactSeries;
  const p = form.prefix ? `-p${form.prefix}` : "";
  return { view: view + p, exact: exact + p };
};

/** The mutant of §10's first check: the exact series' metadata with frame 0's digest flipped, as if its entry were. */
function flipped(id) {
  const m = JSON.parse(fs.readFileSync(path.join(SERIES, `${id}.metadata.json`), "utf8"));
  m.digests.frames[0] = m.digests.frames[0].replace(/^./, (c) => (c === "0" ? "1" : "0"));
  const file = `${T}/${id}.flipped.json`;
  fs.writeFileSync(file, JSON.stringify(m));
  return file;
}

/** One load: the relay, both series' servers and the page server behind it, one browser, its beacon's records. */
async function load(k, spec) {
  const relayArgs = [...form.relay];
  if (MUTATE === "relay-no-loss") for (let j = 0; j < relayArgs.length; j++) if (/^--(loss|ge-p)$/.test(relayArgs[j])) relayArgs[j + 1] = "0";
  const relay = start("taskset", ["-c", "0", "python3", "lab/scripts/link_impair.py", "--tun", ...relayArgs, "--seed", String((spec.round ?? 0) + 1),
    "--self-timing", "--control-port", String(CTRL_PORT)], `${T}/relay.log`);
  const row = { ...spec, pilot: PILOT, mutate: MUTATE || undefined, predictionsXxh3, step: k, at: new Date().toISOString() };
  const servers = [];
  let browser;
  try {
    const netns = (await until(`${T}/relay.log`, "READY")).match(/server_netns=(\S+)/)[1];
    const ids = seriesIds(spec.volume);
    const quic = (port, id) => start("taskset", ["-c", "1", "nsenter", `--net=${netns}`, SERVER, "--port", String(port), "--bind", SERVER_IP,
      "--congestion", "cubic-restart", "--series", path.join(SERIES, `${id}.sbnd`), "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], `${T}/server-${port}.log`);
    servers.push(quic(VIEW_PORT, ids.view), quic(EXACT_PORT, ids.exact));
    const meta = (id) => (MUTATE === "flip-exact" && id === ids.exact ? flipped(id) : path.join(SERIES, `${id}.metadata.json`));
    const page = (port, a) => start("taskset", ["-c", "1", "nsenter", `--net=${netns}`, "python3", "server/dev-server.py", "--bind", SERVER_IP, "--port", String(port), "--beacon", BEACON, ...a], `${T}/page-${port}.log`);
    servers.push(page(PAIR_PAGE, ["--metadata", meta(ids.view), "--transport", transportFile(VIEW_PORT), "--exact-metadata", meta(ids.exact), "--exact-transport", transportFile(EXACT_PORT)]),
      page(EXACT_PAGE, ["--metadata", meta(ids.exact), "--transport", transportFile(EXACT_PORT)]));
    for (const port of [VIEW_PORT, EXACT_PORT]) row[`banner${port}`] = await until(`${T}/server-${port}.log`, "transport=");
    for (const port of [PAIR_PAGE, EXACT_PAGE]) await until(`${T}/page-${port}.log`, "port=");
    if (k === 0) Object.assign(row, { relay: relayArgs, series: ids });
    const blackouts = form.blackoutEveryMs && setInterval(() => {
      const s = dgram.createSocket("udp4");
      s.send("blackout 40", CTRL_PORT, "127.0.0.1", () => s.close());
    }, form.blackoutEveryMs);
    const switches = [`--unsafely-treat-insecure-origin-as-secure=http://${SERVER_IP}:${PAIR_PAGE},http://${SERVER_IP}:${EXACT_PAGE}`, "--enable-quic", "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
    browser = await chromium.launch({ channel: "chromium", headless: true, args: switches });
    Object.assign(row, { browser: browser.version(), switches });
    const params = new URLSearchParams({ overlay: "1", view: "page", beacon: "cubic-restart", round: `http://127.0.0.1:${ROUND_PORT}/`, at: String(k), cell: spec.cell ?? "K2", arm: spec.arm, fillS: String(FILL_S), afterS: String(AFTER_S), ...spec.params });
    if (MUTATE === "decoders-3") params.set("decoders", "3");
    const tab = await browser.newPage();
    row.console = [];
    tab.on("console", (m) => m.type() !== "debug" && row.console.length < 50 && row.console.push(`${m.type()}: ${m.text()}`));
    tab.on("pageerror", (e) => row.console.push(`pageerror: ${e.message}`));
    const done = new Promise((r) => { ended = (n) => n === k && r(); });
    const [cpu0, server0] = [cpuStat(), servers.slice(0, 2).map((s) => ticks(s.pid))];
    await tab.goto(`http://${SERVER_IP}:${spec.series === "exact" ? EXACT_PAGE : PAIR_PAGE}/?${params}`);
    await Promise.race([done, sleep((FILL_S + AFTER_S + 30) * 1000).then(() => { throw new Error(`load ${k}: no end in ${FILL_S + AFTER_S + 30} s`); })]);
    const cpu1 = cpuStat();
    row.busy = cpu1.map((c, j) => (c.busy - cpu0[j].busy) / Math.max(1, c.total - cpu0[j].total));
    row.serverTicks = servers.slice(0, 2).map((s, j) => ticks(s.pid) - server0[j]);
    if (blackouts) clearInterval(blackouts);
    await sleep(500);
  } catch (e) {
    Object.assign(row, { crash: true, error: String(e?.message ?? e) });
  } finally {
    await browser?.close().catch(() => {});
    for (const s of servers) await stop(s);
    await stop(relay);
  }
  const records = (fs.existsSync(BEACON) ? fs.readFileSync(BEACON, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []).filter((r) => r.step === k);
  const one = (kind) => records.find((r) => r.kind === kind);
  Object.assign(row, { load: one("load"), exactFill: one("exactFill"), bench: one("bench"), verdict: one("verdict"), errors: records.filter((r) => r.kind === "error"),
    records: records.filter((r) => ["label", "lossless"].includes(r.kind)), relayTally: tally(fs.readFileSync(`${T}/relay.log`, "utf8")) });
  if (!row.crash && !row.verdict) Object.assign(row, { crash: true, error: "no verdict record" });
  return row;
}

/** K2's loads: each volume's view and exact series benched on two decoders, the exact series on one too; three each. */
const benchLoads = () => VOLS.flatMap((volume) => [0, 1, 2].flatMap((rep) => [["view", 2], ["exact", 2], ["exact", 1]].map(([series, decoders]) => {
  const n = JSON.parse(fs.readFileSync(path.join(SERIES, `${series === "view" ? VIEWS[volume] : seriesIds(volume).exact}.metadata.json`), "utf8")).frameCount;
  return { volume, rep, series, arm: `${series}-${decoders}`, params: { decoders: String(decoders), bench: String(n) } };
})));

/** §6's pilot check: the relay's loss each visit within 3× of the form's, pooled over the visits when too few packets. */
function relayLossRefusal(rows) {
  if (!form.lossPct) return null;
  const sum = (f) => rows.reduce((a, r) => a + (r.relayTally?.down?.[f] ?? 0) + (r.relayTally?.up?.[f] ?? 0), 0);
  const pct = (100 * sum("lost")) / Math.max(1, sum("sent"));
  return pct < form.lossPct / 3 || pct > form.lossPct * 3 ? `PILOT REFUSES: relay loss ${pct.toFixed(3)} %, asked ${form.lossPct} %` : null;
}

const pilotMedians = JSON.parse(arg("--pilot-medians") ? fs.readFileSync(arg("--pilot-medians"), "utf8") : "{}");
const plan = BENCH ? benchLoads() : cellLoads(CELL, { rounds: Number(arg("--rounds", PILOT ? 2 : 10)), fixedOrder: MUTATE === "fixed-order" })
  .filter((l) => VOLS.includes(l.volume));
console.log(`${BENCH ? "K2" : CELL}: ${plan.length} loads; rows to ${path.relative(ROOT, OUT)}; series ${SERIES}${predictionsXxh3 ? `; predictions ${predictionsXxh3}` : ""}`);
const rows = [];
let stopped = null;
for (const [k, spec] of plan.entries()) {
  const row = await load(k, spec);
  const v = voidOf(row, { pilotMedian: pilotMedians[`${spec.cell}/${spec.volume}/${spec.arm}`] });
  Object.assign(row, v.why.length && { void: v.why });
  rows.push(row);
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  console.log(`${k} ${spec.cell ?? "K2"} r${spec.round ?? spec.rep} ${spec.volume} ${spec.arm.padEnd(7)} fill ${row.load?.fillMs?.toFixed?.(0) ?? "—"} ms` +
    `${row.exactFill ? ` C2 span ${row.exactFill.spanMs.toFixed(0)} ms` : ""}${row.bench ? ` bench ${row.bench.effectiveMs?.toFixed(2)} ms/frame` : ""}` +
    ` ${row.verdict?.ok ? "ok" : `FAILED ${row.verdict?.why ?? row.error}`}${row.void ? `  VOID ${row.void.join("; ")}` : ""}`);
  if ((stopped = v.stop)) break;
  await sleep(IDLE_MS);
}
if (!stopped && PILOT && !BENCH) stopped = relayLossRefusal(rows);
roundHost.close();
if (stopped) {
  console.log(stopped);
  process.exit(3);
}
