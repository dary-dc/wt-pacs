/**
 * The delivery comparison's driver: one cell's loads (plan.mjs) through the relay's TUN plane in a namespace of its
 * own, the viewer with each arm's round levers, a fresh browser a load; raw rows to `--out` as they land.
 * docs/client/evidence/delivery-comparison.md §2, §5, §6; lab/delivery/README.md
 *
 *   node lab/delivery/run.mjs --cell CLEAN --series DIR --predictions FILE [--rounds N] [--pilot] [--pilot-medians FILE]
 *     [--view VOLUME=ID …] [--volumes A,B] [--arms FIT,B] [--out FILE] [--fill-s 300] [--after-s 300]
 *     [--mutate fixed-order|relay-no-loss|decoders-3|flip-exact|fit-ignored|escaped|flip-level|no-clamp|canvas-readback|split-view-only]
 *   node lab/delivery/run.mjs --k3-prime --cell LTE --series DIR [--mutate k3-from-a]     # K3′, A2.4: rows/K3P-<CELL>.jsonl
 *   node lab/delivery/run.mjs --bench --series DIR [--view VOLUME=ID …] [--out FILE]     # K2
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { CELLS, ROUNDS, UNIMPAIRED, VOLUMES, cellLoads, k3PrimeLoads, sessionLoads } from "./plan.mjs";
import { digestOf } from "./predict.mjs";
import { blackoutsFromDial, fitRefusal, voidOf, voidShares } from "./judge.mjs";

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
const K3P = flag("--k3-prime");
/** The mutants the page itself carries out: lab/delivery/fit-decoder.js, fit-page.js. */
const PAGE_MUTANTS = ["flip-level", "no-clamp", "canvas-readback", "split-view-only", "skip-step"];
/** A2.2: a phone held upright, its browser's bars off, at DPR 1. */
const VIEWPORT = { width: 1080, height: 2100 };
const CELL = arg("--cell");
const MUTATE = arg("--mutate", "");
const PILOT = flag("--pilot");
/** docs/server/session-cost.md §6: a reading session a load, each series server sampled. */
const SESSION = flag("--session");
const SERIES = path.resolve(arg("--series", ""));
const SERVER = path.join(ROOT, "target/release/series-server");
const IDLE_MS = Number(arg("--idle-ms", 10_000));
/** The three timed volumes' views, as scripts/demo-series.sh names them; each names its exact series. */
const VIEWS = { dbts_a1: "dbts_a1-q8-g8-cut", dbts_b1: "dbts_b1-q8-g8", dbts_c1: "dbts_c1-q8-g8-cut", ...Object.fromEntries(args("--view").map((v) => v.split("="))) };
const VOLS = arg("--volumes")?.split(",") ?? VOLUMES;
/** A smoke's subset of the arms; a counted cell runs them all. */
const ARMS_RUN = arg("--arms")?.split(",");
const SERVER_IP = "10.77.0.2";
const [VIEW_PORT, EXACT_PORT, PAIR_PAGE, EXACT_PAGE, ROUND_PORT, CTRL_PORT] = [4433, 4434, 8765, 8767, 8790, 5599];
const [FILL_S, AFTER_S] = [Number(arg("--fill-s", 300)), Number(arg("--after-s", 300))];

if (!BENCH && !CELLS[CELL]) throw new Error(`--cell ${CELL}: one of ${Object.keys(CELLS).join(" ")}, or --bench`);
const form = BENCH ? { relay: UNIMPAIRED } : CELLS[CELL];
const OUT = arg("--out", path.join(ROOT, `lab/delivery/rows/${BENCH ? "K2" : K3P ? `K3P-${CELL}` : SESSION ? `session-${CELL}` : CELL}${PILOT ? "-pilot" : ""}${MUTATE ? `-${MUTATE}` : ""}.jsonl`));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const predictionsText = BENCH || K3P || SESSION ? null : fs.readFileSync(arg("--predictions"), "utf8");
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
const beaconOf = (k) => (fs.existsSync(BEACON) ? fs.readFileSync(BEACON, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []).filter((r) => r.step === k);

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

/** Each volume's series at the form's prefix; FIT's is the exact series where the fit is level 0 (A2.2), and under `fit-ignored`. */
const seriesIds = (volume) => {
  const view = VIEWS[volume];
  if (!view) return { view: volume, exact: volume, fit: volume };
  const exact = JSON.parse(fs.readFileSync(path.join(SERIES, `${view}.metadata.json`), "utf8")).exactSeries;
  const p = form.prefix ? `-p${form.prefix}` : "";
  const fit = `${exact}-fit${p}`;
  return { view: view + p, exact: exact + p, fit: MUTATE !== "fit-ignored" && fs.existsSync(path.join(SERIES, `${fit}.metadata.json`)) ? fit : exact + p };
};

/** A2.6: every process under this driver, the browser's, with the cores it may run on. */
function browserCpus() {
  const status = (pid) => { try { return fs.readFileSync(`/proc/${pid}/status`, "utf8"); } catch { return ""; } };
  const field = (text, k) => text.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1];
  const all = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map((pid) => ({ pid: Number(pid), text: status(pid) })).filter((p) => p.text);
  const parent = new Map(all.map((p) => [p.pid, Number(field(p.text, "PPid"))]));
  const under = (pid) => { for (let q = parent.get(pid); q; q = parent.get(q)) if (q === process.pid) return true; return false; };
  return all.filter((p) => under(p.pid) && /chrom/i.test(field(p.text, "Name") ?? "")).map((p) => ({ pid: p.pid, name: field(p.text, "Name"), allowed: field(p.text, "Cpus_allowed_list") }));
}
/** session-cost.md §6: a process's CPU in ns over its threads' schedstat, its VmRSS in kB, its name. */
const schedNs = (pid) => fs.readdirSync(`/proc/${pid}/task`).reduce((a, t) => { try { return a + Number(fs.readFileSync(`/proc/${pid}/task/${t}/schedstat`, "utf8").split(" ")[0]); } catch { return a; } }, 0);
const rssKb = (pid) => { try { return Number(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmRSS:\s*(\d+)/m)?.[1]); } catch { return NaN; } };
const comm = (pid) => fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
const softirqJiffies = () => fs.readFileSync("/proc/stat", "utf8").split("\n").filter((l) => /^cpu\d/.test(l)).map((l) => Number(l.split(/\s+/)[7]));

/** A2.6: NET_RX softirqs per core, and a process's involuntary context switches. */
const softirqs = () => fs.readFileSync("/proc/softirqs", "utf8").split("\n").find((l) => /^\s*NET_RX:/.test(l)).trim().split(/\s+/).slice(1).map(Number);
const ctxsw = (pid) => Number(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^nonvoluntary_ctxt_switches:\s*(\d+)/m)?.[1]);

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
  const blackoutsAt = [];
  let browser, blackouts;
  try {
    const netns = (await until(`${T}/relay.log`, "READY")).match(/server_netns=(\S+)/)[1];
    const ids = seriesIds(spec.volume);
    const second = spec.series === "fit" ? ids.fit : ids.exact;
    const quic = (port, id) => start("taskset", ["-c", "1", "nsenter", `--net=${netns}`, SERVER, "--port", String(port), "--bind", SERVER_IP,
      "--congestion", "cubic-restart", "--series", path.join(SERIES, `${id}.sbnd`), "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], `${T}/server-${port}.log`);
    servers.push(quic(VIEW_PORT, ids.view), quic(EXACT_PORT, second));
    const meta = (id) => (MUTATE === "flip-exact" && id === ids.exact ? flipped(id) : path.join(SERIES, `${id}.metadata.json`));
    const page = (port, a) => start("taskset", ["-c", "1", "nsenter", `--net=${netns}`, "python3", "server/dev-server.py", "--bind", SERVER_IP, "--port", String(port), "--beacon", BEACON, ...a], `${T}/page-${port}.log`);
    servers.push(page(PAIR_PAGE, ["--metadata", meta(ids.view), "--transport", transportFile(VIEW_PORT), ...(ids.view === ids.exact ? [] : ["--exact-metadata", meta(ids.exact), "--exact-transport", transportFile(EXACT_PORT)])]),
      page(EXACT_PAGE, ["--metadata", meta(second), "--transport", transportFile(EXACT_PORT)]));
    for (const port of [VIEW_PORT, EXACT_PORT]) row[`banner${port}`] = await until(`${T}/server-${port}.log`, "transport=");
    for (const port of [PAIR_PAGE, EXACT_PAGE]) await until(`${T}/page-${port}.log`, "port=");
    if (k === 0) Object.assign(row, { relay: relayArgs, series: ids });
    const blackout = () => {
      blackoutsAt.push(Date.now());
      const s = dgram.createSocket("udp4");
      s.send("blackout 40", CTRL_PORT, "127.0.0.1", () => s.close());
      blackouts = setTimeout(blackout, form.blackoutEveryMs);
    };
    if (form.blackoutEveryMs) blackouts = setTimeout(blackout, spec.blackoutPhaseMs);
    const switches = [`--unsafely-treat-insecure-origin-as-secure=http://${SERVER_IP}:${PAIR_PAGE},http://${SERVER_IP}:${EXACT_PAGE}`, "--enable-quic", "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
    browser = await chromium.launch({ channel: "chromium", headless: true, args: switches });
    Object.assign(row, { browser: browser.version(), switches });
    const params = new URLSearchParams({ overlay: "1", view: "page", beacon: "cubic-restart", round: `http://127.0.0.1:${ROUND_PORT}/`, at: String(k), cell: spec.cell ?? "K2", arm: spec.arm, fillS: String(FILL_S), afterS: String(AFTER_S), ...spec.params });
    if (MUTATE === "decoders-3") params.set("decoders", "3");
    if (PAGE_MUTANTS.includes(MUTATE)) params.set("mutate", MUTATE);
    if (MUTATE === "escaped") sh(`taskset -p -c 0,2,3 ${browserCpus()[0].pid} >/dev/null`);
    const tab = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    row.console = [];
    tab.on("console", (m) => m.type() !== "debug" && row.console.length < 50 && row.console.push(`${m.type()}: ${m.text()}`));
    tab.on("pageerror", (e) => row.console.push(`pageerror: ${e.message}`));
    const done = new Promise((r) => { ended = (n) => n === k && r(); });
    const [cpu0, server0, softirq0, relay0] = [cpuStat(), servers.slice(0, 2).map((s) => ticks(s.pid)), softirqs(), ctxsw(relay.pid)];
    const sampled = (MUTATE === "sampler-relay" ? [relay, relay] : servers.slice(0, 2)).map((s) => s.pid);
    const sess0 = SESSION && { ns: sampled.map(schedNs), rss: sampled.map(rssKb), softirq: softirqJiffies(), peak: sampled.map(rssKb) };
    const rssTimer = SESSION && setInterval(() => sampled.forEach((pid, j) => (sess0.peak[j] = Math.max(sess0.peak[j], rssKb(pid)))), 50);
    await tab.goto(`http://${SERVER_IP}:${spec.series === "view" ? PAIR_PAGE : EXACT_PAGE}/?${params}`);
    await Promise.race([done, sleep((FILL_S + AFTER_S + 30) * 1000).then(() => { throw new Error(`load ${k}: no end in ${FILL_S + AFTER_S + 30} s`); })]);
    const cpu1 = cpuStat();
    row.busy = cpu1.map((c, j) => (c.busy - cpu0[j].busy) / Math.max(1, c.total - cpu0[j].total));
    row.serverTicks = servers.slice(0, 2).map((s, j) => ticks(s.pid) - server0[j]);
    if (SESSION) {
      clearInterval(rssTimer);
      row.serverCost = sampled.map((pid, j) => ({ comm: comm(pid), cpuNs: schedNs(pid) - sess0.ns[j], ticks: ticks(pid) - (MUTATE === "sampler-relay" ? ticks(pid) : server0[j]), rssBeforeKb: sess0.rss[j], rssPeakKb: sess0.peak[j] }));
      row.softirqJiffies = softirqJiffies().map((n, j) => n - sess0.softirq[j]);
    }
    Object.assign(row, { cpus: browserCpus(), netRxSoftirqs: softirqs().map((n, j) => n - softirq0[j]), relayInvoluntary: ctxsw(relay.pid) - relay0 });
    clearTimeout(blackouts);
    // The page's last beacon crosses the relay after the page has left: CR's round trip is 0.8 s.
    for (const t0 = Date.now(); Date.now() - t0 < 30_000 && !beaconOf(k).some((r) => r.kind === "verdict");) await sleep(100);
  } catch (e) {
    Object.assign(row, { crash: true, error: String(e?.message ?? e) });
  } finally {
    clearTimeout(blackouts);
    await browser?.close().catch(() => {});
    for (const s of servers) await stop(s);
    await stop(relay);
  }
  const records = beaconOf(k);
  const one = (kind) => records.find((r) => r.kind === kind);
  Object.assign(row, { load: one("load"), exactFill: one("exactFill"), bench: one("bench"), verdict: one("verdict"), errors: records.filter((r) => r.kind === "error"),
    records: records.filter((r) => ["label", "lossless", "askLastByte", "zoom", "windowRead", "split", "switch", "memory"].includes(r.kind)), session: one("session"),
    relayTally: tally(MUTATE === "tally-dropped" ? "" : fs.readFileSync(`${T}/relay.log`, "utf8")) });
  if (form.blackoutEveryMs) row.blackoutsFromDialMs = blackoutsFromDial(blackoutsAt, row.load?.fillFrom);
  if (!row.crash && !row.verdict) Object.assign(row, { crash: true, error: "no verdict record" });
  return row;
}

/** K2's loads: each volume's view and exact series benched on two decoders, the exact series on one too, FIT's level prefixes on two where it has a level (A2.7); three each. */
const benchLoads = () => VOLS.flatMap((volume) => [0, 1, 2].flatMap((rep) => [["view", 2], ["exact", 2], ["exact", 1], ...(seriesIds(volume).fit !== seriesIds(volume).exact ? [["fit", 2]] : [])].map(([series, decoders]) => {
  const n = JSON.parse(fs.readFileSync(path.join(SERIES, `${series === "view" ? VIEWS[volume] : seriesIds(volume)[series]}.metadata.json`), "utf8")).frameCount;
  return { volume, rep, series, arm: `${series}-${decoders}`, params: { decoders: String(decoders), bench: String(n) } };
})));

/** §6's pilot check: the relay's loss each visit within 3× of the form's, pooled over the visits when too few packets. */
function relayLossRefusal(rows) {
  if (!form.lossPct) return null;
  const sum = (f) => rows.reduce((a, r) => a + (r.relayTally?.down?.[f] ?? 0) + (r.relayTally?.up?.[f] ?? 0), 0);
  const pct = (100 * sum("lost")) / Math.max(1, sum("sent"));
  return pct < form.lossPct / 3 || pct > form.lossPct * 3 ? `PILOT REFUSES: relay loss ${pct.toFixed(3)} %, asked ${form.lossPct} %` : null;
}

/** A2.8's pilot: every FIT load asked only its prefixes before its zoom; on CLEAN, SPLIT asked an exact group on `dbts_b1`. */
function armRefusal(rows) {
  const inputs = predictionsText && JSON.parse(predictionsText).inputs;
  const notFit = rows.map((r) => fitRefusal(r, inputs?.volumes?.[r.volume]?.fit)).find(Boolean);
  if (notFit) return `PILOT REFUSES: ${notFit}`;
  const split = rows.filter((r) => r.arm === "SPLIT" && r.volume === "dbts_b1" && !r.void?.length);
  const x = (r) => r.records?.find((x) => x.kind === "split")?.x ?? 0;
  return CELL === "CLEAN" && split.length && split.every((r) => x(r) === 0) ? "PILOT REFUSES: SPLIT asked no exact group on CLEAN dbts_b1" : null;
}

/** session-cost.md §6's VOID and stop, and the flags its three mutants must raise. */
function sessionVoid(row) {
  const why = [];
  if (row.crash || !row.verdict) why.push(`crash: ${row.error ?? "no verdict"}`);
  // session-cost.md §9 (SESSION-COST-RUN): the guard guards a time, which is no result here; recorded, VOIDs nothing.
  if (row.relayTally?.late) row.guardLate = true;
  if (row.cpus?.some((c) => c.allowed !== "2,3" && c.allowed !== "2-3")) why.push("escaped: a browser process outside cores 2-3");
  if (row.busy?.[1] > 0.95) why.push(`saturated: the servers' core ${(100 * row.busy[1]).toFixed(0)} % busy`);
  if (row.session?.lengthMs > 300_000 || /^no end \d+ s after the fill/.test(row.verdict?.why ?? "")) why.push("over 300 s");
  if (row.verdict?.void) why.push(`${row.verdict.void}: ${row.verdict.why}`);
  const flags = [];
  if (row.serverCost && (row.serverCost.some((c) => c.comm !== "series-server") || !(row.serverCost.reduce((a, c) => a + c.cpuNs, 0) > 0))) flags.push("sampler: not a series server, or CPU zero");
  if (!(row.relayTally?.flows?.some((f) => f.bytes > 0))) flags.push("tally: no bytes");
  if (row.session && row.session.steps !== row.session.stepsExpected) flags.push(`trace: ${row.session.steps} steps, §1 says ${row.session.stepsExpected}`);
  if (flags.length) row.flags = flags;
  const failed = row.verdict && !row.verdict.ok && !row.crash && !why.length;
  return { why, stop: failed ? `STOP: ${row.verdict.why}` : flags.length && !MUTATE ? `STOP: ${flags.join("; ")}` : null };
}

const pilotMedians = JSON.parse(arg("--pilot-medians") ? fs.readFileSync(arg("--pilot-medians"), "utf8") : "{}");
const k3Prime = () => k3PrimeLoads(CELL).map((l) => (MUTATE === "k3-from-a" ? { ...l, arm: "A", series: "view" } : l));
const plan = (BENCH ? benchLoads() : K3P ? k3Prime() : SESSION ? [...(flag("--warmup") ? sessionLoads(CELL, { rounds: 1, volumes: ["dbts_b1"] }).filter((l) => l.arm === "B").map((l) => ({ ...l, warmup: true })) : []),
  ...sessionLoads(CELL, { rounds: Number(arg("--rounds", 1)), volumes: VOLS })] : cellLoads(CELL, { rounds: Number(arg("--rounds", PILOT ? 2 : ROUNDS)), fixedOrder: MUTATE === "fixed-order" }))
  .filter((l) => (l.warmup || VOLS.includes(l.volume)) && (!ARMS_RUN || ARMS_RUN.includes(l.arm)));
console.log(`${BENCH ? "K2" : CELL}: ${plan.length} loads; rows to ${path.relative(ROOT, OUT)}; series ${SERIES}${predictionsXxh3 ? `; predictions ${predictionsXxh3}` : ""}`);
const rows = [];
let stopped = null;
// A resumed cell: its first N loads are in an earlier rows file.
const SKIP = Number(arg("--skip", 0));
for (const [k, spec] of plan.entries()) {
  if (k < SKIP) continue;
  const row = await load(k, spec);
  const v = SESSION ? sessionVoid(row) : voidOf(row, { pilotMedian: pilotMedians[`${spec.cell}/${spec.volume}/${spec.arm}`] });
  Object.assign(row, v.why.length && { void: v.why });
  rows.push(row);
  fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
  console.log(`${k} ${spec.cell ?? "K2"} r${spec.round ?? spec.rep} ${spec.volume} ${spec.arm.padEnd(7)} fill ${row.load?.fillMs?.toFixed?.(0) ?? "—"} ms` +
    `${row.exactFill ? ` C2 span ${row.exactFill.spanMs.toFixed(0)} ms` : ""}${row.bench ? ` bench ${row.bench.effectiveMs?.toFixed(2)} ms/frame` : ""}` +
    ` ${row.verdict?.ok ? "ok" : `FAILED ${row.verdict?.why ?? row.error}`}${row.void ? `  VOID ${row.void.join("; ")}` : ""}`);
  if ((stopped = v.stop)) break;
  await sleep(IDLE_MS);
}
if (PILOT && !BENCH) for (const [cell, v] of Object.entries(voidShares(rows))) console.log(`${cell} pilot: ${v.void}/${v.loads} VOID; ${Object.entries(v.reasons).map(([why, n]) => `${n} ${why}`).join("; ") || "none"}`);
if (!stopped && PILOT && !BENCH) stopped = relayLossRefusal(rows) ?? armRefusal(rows);
roundHost.close();
if (stopped) console.log(stopped);
process.exit(stopped ? 3 : 0);
