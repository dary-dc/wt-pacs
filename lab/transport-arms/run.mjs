/**
 * The transport comparison's driver: stacks.md §5's eight arms, one cell at a time, through the relay's TUN plane
 * in a namespace of its own, a fresh browser a visit, the arms in a Williams order. Raw rows go to `--out` as they
 * land. docs/transport/evidence/stacks.md §5, lab/transport-arms/README.md
 *
 *   node lab/transport-arms/run.mjs --cell CLEAN [--rounds N] [--series DIR] [--out FILE] [--limit-ms MS]
 *     [--pilot] [--mutate wrong-protocol|drop-frame|relay-no-loss|fixed-order|cpu-wrong-pid]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { order, balanced } from "../order.mjs";
import { sampleTree } from "../scripts/proc_sampler.mjs";
import { judge } from "./judge.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);

// The relay needs CAP_NET_ADMIN, so the whole driver runs in a user and network namespace of its own.
if (!process.env.TRANSPORT_ARMS_NS) {
  const r = spawnSync("unshare", ["-rn", process.execPath, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, TRANSPORT_ARMS_NS: "1" } });
  process.exit(r.status ?? 1);
}

const { chromium } = createRequire(import.meta.url)("playwright");
const CELL = arg("--cell");
const MUTATE = arg("--mutate", "");
const SERIES = path.resolve(arg("--series", path.join(ROOT, "lab/transport-arms/.series")));
const SERVER = arg("--server", path.join(ROOT, "target/release/series-server"));
const LIMIT_MS = Number(arg("--limit-ms", 120_000));
const IDLE_MS = Number(arg("--idle-ms", 10_000));
const PILOT = flag("--pilot");
const SERVER_IP = "10.77.0.2";
const [WT_PORT, GET_PORT, HTTP_PORT, CTRL_PORT] = [4433, 4434, 8765, 5599];

/** stacks.md §5.1. `proto`: what `nextHopProtocol` must read, or the visit is VOID. */
const ARMS = {
  "WT-TS": { module: "/client/transport/ts/dist/session.js", url: "wt" },
  "WT-TS'": { module: "/client/transport/ts/dist/session.js", url: "wt" },
  "WT-WASM": { module: "/client/transport/wasm/session-adapter.js", url: "wt" },
  WS: { module: "/client/transport/ts/dist/ws-session.js", url: "wt" },
  "H3-frame": { module: "/lab/transport-arms/dist/fetch-session.js", url: "get", shape: "frame", proto: "h3" },
  "H3-fill": { module: "/lab/transport-arms/dist/fetch-session.js", url: "get", shape: "fill", proto: "h3" },
  "H2-frame": { module: "/lab/transport-arms/dist/fetch-session.js", url: "get", shape: "frame", proto: "h2" },
  "H2-fill": { module: "/lab/transport-arms/dist/fetch-session.js", url: "get", shape: "fill", proto: "h2" },
};
const NAMES = (arg("--arms") ?? Object.keys(ARMS).join(",")).split(",");

const ge = (mean) => { const r = 100 / 3.5, m = mean / 100; return ["--loss-model", "ge", "--ge-p", (m * r / (1 - m)).toFixed(5), "--ge-r", r.toFixed(4)]; };
const link = (delay, kbit, pkts, ...rest) => ["--delay-ms", String(delay), "--rate-kbit", String(kbit), "--queue-pkts", String(pkts), ...rest];
const PUB = link(10, 90000, 2000);
const LTE = link(19, 50000, 3300, "--loss", "0.1");
/** stacks.md §5.3: each cell's forms; `loss` is the configured mean the pilot's tally is held to, in percent. */
const CELLS = {
  CLEAN: { rounds: 8, forms: [{ name: "clean", relay: link(1, 90000, 300), n: 50, action: "fill" }] },
  PUB: { rounds: 8, forms: [{ name: "pub", relay: PUB, n: 50, action: "fill" }] },
  ENT: { rounds: 8, forms: [{ name: "ent", relay: link(2, 90000, 2000, "--jitter-ms", "10", "--jitter-mode", "reorder"), n: 50, action: "fill" }] },
  LTE: { rounds: 8, forms: [{ name: "lte", relay: LTE, loss: 0.1, blackoutEveryMs: 30_000, n: 16, action: "fill" }] },
  CR: { rounds: 16, forms: [{ name: "cr", relay: link(400, 90000, 1875), n: 50, action: "fill" }] },
  LOSS: { rounds: 8, forms: [{ name: "loss", relay: link(20, 20000, 200, ...ge(1)), loss: 1, n: 8, action: "fill", hol: true }] },
  FF: { rounds: 8, forms: [1, 10, 19, 28].map((d) => ({ name: `ff-${2 * d}ms`, relay: link(d, 90000, 2000), n: 1, action: "first" })) },
  FP: { rounds: 8, forms: [10, 28].map((d) => ({ name: `fp-${2 * d}ms`, relay: link(d, 90000, 2000), n: 1, action: "first", pooled: true })) },
  AD: { rounds: 16, forms: [{ name: "ad-pub", relay: PUB, n: 50, action: "ad", askAfter: 8 }, { name: "ad-lte", relay: LTE, loss: 0.1, n: 16, action: "ad", askAfter: 4 }] },
  AA: { rounds: 16, forms: [["pub", PUB], ["38ms", link(19, 90000, 2000)]].flatMap(([name, relay]) =>
    [100, 1000, 5000].map((gapMs) => ({ name: `aa-${name}-${gapMs}ms`, relay, n: 17, action: "aa", gapMs }))) },
};
// The pilot's prefixes of LTE and LOSS (§5.4) are set here, by flag, before any counted row.
for (const [cell, key] of [["LTE", "--lte-frames"], ["LOSS", "--loss-frames"]]) if (arg(key)) CELLS[cell].forms[0].n = Number(arg(key));

if (!CELLS[CELL]) throw new Error(`--cell ${CELL}: one of ${Object.keys(CELLS).join(" ")}`);
const ROUNDS = Number(arg("--rounds", PILOT ? 2 : CELLS[CELL].rounds));
const OUT = arg("--out", path.join(ROOT, `lab/transport-arms/rows/${CELL}${PILOT ? "-pilot" : ""}${MUTATE ? `-${MUTATE}` : ""}.jsonl`));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const T = fs.mkdtempSync(path.join(os.tmpdir(), "transport-arms-"));
const kids = new Set();
const start = (cmd, args, log) => {
  const k = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")] });
  kids.add(k);
  return k;
};
const stop = async (k, signal = "SIGTERM") => {
  if (k.exitCode === null) k.kill(signal);
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
async function until(file, text, ms = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const log = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const line = log.split("\n").find((l) => l.includes(text));
    if (line) return line;
    await sleep(50);
  }
  throw new Error(`${path.basename(file)} never said ${text}: ${fs.existsSync(file) ? fs.readFileSync(file, "utf8").slice(-400) : ""}`);
}

// §5.2's cores: the relay on 0, the server on 1, this driver and so the browser on 2–3.
sh(`taskset -a -p -c 2,3 ${process.pid} >/dev/null; ip link set lo up`);
if (!arg("--server")) execFileSync("cargo", ["build", "-q", "--release", "-p", "series-server", "--features", "lab-get"], { cwd: ROOT, stdio: "inherit" });
execFileSync("bash", ["lab/transport-arms/build.sh"], { cwd: ROOT, stdio: "ignore" });
const meta = JSON.parse(fs.readFileSync(path.join(SERIES, "metadata.json"), "utf8"));
const digests = meta.digests?.frames;
if (!digests?.length) throw new Error(`${SERIES}/metadata.json has no digests: every frame is checked (§5.2)`);
sh(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem -out ${T}/cert.pem \
  -days 10 -nodes -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:${SERVER_IP}' 2>/dev/null`);
const spki = sh(`openssl x509 -in ${T}/cert.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64`);
const certHash = sh(`openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 -hex | sed 's/.* //'`);
const http = start("python3", ["server/dev-server.py", "--port", String(HTTP_PORT)], `${T}/http.log`);
await sleep(500);

const SYSCTLS = ["net/ipv4/tcp_congestion_control", "net/ipv4/tcp_slow_start_after_idle", "net/ipv4/tcp_rmem", "net/ipv4/tcp_wmem"];
const sysctls = (netns) => Object.fromEntries(SYSCTLS.map((k) => [k, sh(`${netns ? `nsenter --net=${netns} ` : ""}cat /proc/sys/${k}`)]));
const ticks = (pid) => {
  const f = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  const v = f.slice(f.lastIndexOf(")") + 2).split(" ");
  return Number(v[11]) + Number(v[12]);
};
/** Per core, busy and total jiffies; and the host's softirq jiffies. */
const cpuStat = () => {
  const lines = fs.readFileSync("/proc/stat", "utf8").split("\n");
  const cores = lines.filter((l) => /^cpu\d/.test(l)).map((l) => {
    const v = l.split(/\s+/).slice(1).map(Number);
    return { busy: v[0] + v[1] + v[2] + v[5] + v[6] + v[7], total: v.slice(0, 8).reduce((a, b) => a + b, 0) };
  });
  const softirq = Number(lines.find((l) => l.startsWith("cpu "))?.split(/\s+/)[7] ?? 0);
  return { cores, softirq };
};
const browserPid = () => {
  for (const p of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const stat = fs.readFileSync(`/proc/${p}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, "utf8");
      if (ppid === process.pid && /chrom/.test(cmd) && !cmd.includes("--type=")) return Number(p);
    } catch { /* gone */ }
  }
  return null;
};

/** The relay's exit tally: its counts each way, bytes server → client by flow, and the self-timing verdict. */
function tally(log) {
  const tun = log.match(/tun client->server sent (\d+) lost (\d+) overflowed (\d+) codel \d+ \| server->client sent (\d+) lost (\d+) overflowed (\d+)/);
  const toClient = [...log.matchAll(/^flow client (\S+) \S+ \S+ packets (\d+) bytes (\d+)/gm)];
  return {
    up: tun && { sent: Number(tun[1]), lost: Number(tun[2]), overflowed: Number(tun[3]) },
    down: tun && { sent: Number(tun[4]), lost: Number(tun[5]), overflowed: Number(tun[6]) },
    bytesToClient: toClient.reduce((a, m) => a + Number(m[3]), 0),
    flows: toClient.map((m) => ({ proto: m[1], packets: Number(m[2]), bytes: Number(m[3]) })),
    timing: log.match(/self-timing .*/)?.[0] ?? null,
    late: /VOID: p99 over/.test(log),
  };
}

const p99 = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.99 * s.length) - 1)] : null; };
/** §5.3's metric for the form's action, from the downloader's stamps (epoch ms). */
function metric(form, r) {
  const last = r.frames.find((f) => f.i === form.n - 1);
  if (form.action === "first") return r.frames.find((f) => f.i === 0)?.lastByte - r.dial;
  if (form.action === "fill") return Math.max(...r.frames.map((f) => f.lastByte)) - r.dial;
  return last && r.askAt ? last.lastByte - r.askAt : null;
}
const holOf = (r) => {
  const at = r.frames.map((f) => f.lastByte).sort((a, b) => a - b);
  return p99(at.slice(1).map((t, k) => t - at[k]));
};

async function visit(round, armName, form, prev, browserArgs) {
  const arm = ARMS[armName];
  const relayArgs = [...form.relay];
  if (MUTATE === "relay-no-loss") for (let k = 0; k < relayArgs.length; k++) if (/^--(loss|ge-p)$/.test(relayArgs[k])) relayArgs[k + 1] = "0";
  const relay = start("taskset", ["-c", "0", "python3", "lab/scripts/link_impair.py", "--tun", ...relayArgs, "--seed", String(round + 1),
    "--self-timing", "--control-port", String(CTRL_PORT)], `${T}/relay.log`);
  const netns = (await until(`${T}/relay.log`, "READY")).match(/server_netns=(\S+)/)[1];
  const serverArgs = ["--series", path.join(SERIES, "series.sbnd"), "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`,
    "--port", String(WT_PORT), "--bind", SERVER_IP, "--websocket", "--lab-get-port", String(GET_PORT), "--lab-get-static", ROOT,
    ...(MUTATE === "drop-frame" ? ["--lab-get-drop", "0"] : [])];
  const server = start("taskset", ["-c", "1", "nsenter", `--net=${netns}`, SERVER, ...serverArgs], `${T}/server.log`);
  const row = { cell: CELL, form: form.name, round, arm: armName, prev, pilot: PILOT, mutate: MUTATE || undefined, at: new Date().toISOString() };
  let browser;
  try {
    const banner = await until(`${T}/server.log`, "wt_url=");
    const pid = MUTATE === "cpu-wrong-pid" ? Number(fs.readFileSync(`/proc/${relay.pid}/task/${relay.pid}/children`, "utf8").split(" ")[0]) : server.pid;
    if (round === 0 && armName === NAMES[0]) Object.assign(row, { banner, kernel: { client: sysctls(null), server: sysctls(netns) }, relay: relayArgs });
    const blackouts = form.blackoutEveryMs && setInterval(() => {
      const s = dgram.createSocket("udp4");
      s.send("blackout 40", CTRL_PORT, "127.0.0.1", () => s.close());
    }, form.blackoutEveryMs);
    const proto = arm.proto === "h3" && MUTATE !== "wrong-protocol" ? [`--origin-to-force-quic-on=${SERVER_IP}:${GET_PORT}`] : [];
    browser = await chromium.launch({ headless: true, args: [...browserArgs, ...proto] });
    row.browser = browser.version();
    const page = await browser.newPage();
    const origin = form.pooled ? `https://${SERVER_IP}:${GET_PORT}` : `http://127.0.0.1:${HTTP_PORT}`;
    await page.goto(`${origin}/lab/transport-arms/page.html`);
    await page.waitForFunction(() => globalThis.__ready);
    if (form.action === "aa") {
      await page.exposeFunction("go", async () => {
        await sleep(form.gapMs);
        // §5.3 AA: the gap against each TCP arm's RTO, read before the ask.
        row.ss = sh(`nsenter --net=${netns} ss -tin src ${SERVER_IP} || true`);
      });
    }
    const url = arm.url === "wt" ? `https://${SERVER_IP}:${WT_PORT}/` : `https://${SERVER_IP}:${GET_PORT}/?shape=${arm.shape}&k=6`;
    const [cpu0, ticks0, bpid] = [cpuStat(), ticks(pid), browserPid()];
    const client = bpid && sampleTree(bpid);
    const t0 = Date.now();
    const r = await page.evaluate((a) => globalThis.visit(a), { module: arm.module, url, hash: certHash, n: form.n, action: form.action, askAfter: form.askAfter, digests, limitMs: LIMIT_MS });
    row.wallMs = Date.now() - t0;
    if (blackouts) clearInterval(blackouts);
    const [cpu1, ticks1] = [cpuStat(), ticks(pid)];
    const tree = client?.stop();
    row.serverTicks = ticks1 - ticks0;
    row.softirqTicks = cpu1.softirq - cpu0.softirq;
    row.clientCpuMs = tree ? tree.each.reduce((a, t) => a + t.cpu_ms, 0) : null;
    row.busiestCore = Math.max(...cpu1.cores.map((c, k) => (c.busy - cpu0.cores[k].busy) / Math.max(1, c.total - cpu0.cores[k].total)));
    row.error = r.error;
    row.failures = r.failures;
    row.protocols = [...new Set(r.protocols)];
    row.exact = r.frames.filter((f) => f.exact === true).length;
    row.frames = r.frames;
    row.v = metric(form, r);
    if (form.hol) row.hol = holOf(r);
  } catch (e) {
    row.error = String(e?.message ?? e);
    row.crash = true;
  } finally {
    await browser?.close().catch(() => {});
    await stop(server);
    await stop(relay);
  }
  Object.assign(row, { relayTally: tally(fs.readFileSync(`${T}/relay.log`, "utf8")) });
  return row;
}

const browserArgs = [`--ignore-certificate-errors-spki-list=${spki}`, "--enable-quic", "--disable-background-networking",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
const rows = [];
const pilot = JSON.parse(arg("--pilot-medians") ? fs.readFileSync(arg("--pilot-medians"), "utf8") : "{}");
console.log(`${CELL}: ${ROUNDS} rounds of ${NAMES.join(" ")}; rows to ${path.relative(ROOT, OUT)}; series ${SERIES} (${digests.length} frames)`);
let stopped = null;
// A series shorter than a form's frames serves a prefix of it, said so: the build's test series has 12.
for (const form of CELLS[CELL].forms) {
  if (form.n <= digests.length) continue;
  console.log(`${form.name}: the series' ${digests.length} frames, not ${form.n}`);
  form.n = digests.length;
}
outer: for (const form of CELLS[CELL].forms) {
  for (let round = 0; round < ROUNDS; round++) {
    let prev = null;
    for (const armName of MUTATE === "fixed-order" ? NAMES : order(NAMES, round)) {
      const row = await visit(round, armName, form, prev, browserArgs);
      stopped = judge(form, row, { proto: ARMS[armName].proto, pilot: PILOT, pilotMedian: pilot[`${form.name}/${armName}`] });
      rows.push(row);
      fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.log(`${form.name} r${round} ${armName.padEnd(8)} v ${row.v?.toFixed?.(1) ?? "—"} ms exact ${row.exact ?? 0}` +
        ` ${row.protocols?.join(",") ?? ""}${row.void ? `  VOID ${row.void.join("; ")}` : ""}${row.flags ? `  ${row.flags.join("; ")}` : ""}`);
      if (stopped) break outer;
      prev = armName;
      await sleep(IDLE_MS);
    }
  }
}
await stop(http);

for (const form of CELLS[CELL].forms) {
  const counted = rows.filter((r) => r.form === form.name && !r.void && Number.isFinite(r.v));
  const unbalanced = NAMES.filter((a) => !balanced(rows.filter((r) => r.form === form.name).map((r) => ({ ...r, unit: r.arm })), a, NAMES));
  const ref = new Map(counted.filter((r) => r.arm === "WT-TS").map((r) => [r.round, r.v]));
  for (const a of NAMES) {
    const ratios = counted.filter((r) => r.arm === a && ref.has(r.round)).map((r) => r.v / ref.get(r.round)).sort((x, y) => x - y);
    const med = ratios.length ? ratios[(ratios.length - 1) >> 1] : NaN;
    console.log(`${form.name} ${a.padEnd(8)} ratio to WT-TS median ${med.toFixed(3)} over ${ratios.length} rounds`);
  }
  if (unbalanced.length) console.log(`${form.name} UNBALANCED: ${unbalanced.join(" ")}`);
  const aa = Object.fromEntries(NAMES.filter((a) => !a.startsWith("WT-TS")).map((a) => {
    const byRound = (arm) => Array.from({ length: ROUNDS }, (_, k) => counted.find((r) => r.arm === arm && r.round === k)?.v ?? null);
    return [`${form.name}/${a}`, { ref: byRound("WT-TS"), aa: byRound("WT-TS'"), arm: byRound(a) }];
  }));
  fs.writeFileSync(OUT.replace(/\.jsonl$/, `.${form.name}.aa.json`), JSON.stringify(aa, null, 1));
}
if (stopped) {
  console.log(stopped);
  process.exit(3);
}
