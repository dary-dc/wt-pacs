// DIAL-BEFORE-PAIR-MEASURE: the cold open of one optimal-quality series, the tip against PR 448, through one relay that
// delays both planes (the sessions' UDP and the static host's TCP). README.md beside this file.
//
//   TIP=tree PR=tree DIR=demo-series ID=dbts_b1-q8-g8 RTTS=10,100,400 VIEWS=page,worker ROUNDS=4 OUT=rows.jsonl \
//     NODE_PATH=$(npm root -g) taskset -c 0-2 node open.mjs
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const env = process.env;
const TIP = env.TIP, PR = env.PR, DIR = env.DIR, ID = env.ID || "dbts_b1-q8-g8";
const RTTS = (env.RTTS || "10,100,400").split(",").map(Number);
const VIEWS = (env.VIEWS || "page,worker").split(",");
const ROUNDS = Number(env.ROUNDS || 4);
const OUT = env.OUT || "rows.jsonl";
// The relay on a core of its own, the rest (`taskset -c 0-2 node open.mjs`) on the others: a preempted relay is VOID.
const RELAY_CPU = env.RELAY_CPU || "3";
const RELAY_ARGS = (env.RELAY_ARGS ?? "--rate-kbit 100000 --queue-pkts 1000").split(" ").filter(Boolean);
const { order } = await import(path.join(PR, "lab/order.mjs"));
const { chromium } = createRequire(import.meta.url)("playwright");

const meta = JSON.parse(readFileSync(path.join(DIR, `${ID}.metadata.json`)));
const EXACT = meta.exactSeries;
const RUN = path.join(PR, "target/dial-measure");
mkdirSync(RUN, { recursive: true });
const kids = [];
const run = (cmd, args, cwd, log) => {
  const c = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
  if (log) { c.stdout.on("data", (d) => appendFileSync(log, d)); c.stderr.on("data", (d) => appendFileSync(log, d)); }
  kids.push(c);
  return c;
};
const stopAll = () => { for (const c of kids) try { process.kill(-c.pid, "SIGKILL"); } catch {} };
process.on("exit", stopAll);
const ready = (c, re) => new Promise((ok, no) => {
  let out = "";
  const read = (d) => { out += d; if (re.test(out)) ok(); };
  c.stdout.on("data", read);
  c.stderr.on("data", read);
  c.once("exit", (code) => no(new Error(`exited ${code}: ${out}`)));
});

// One pair of servers (PR 448 touches no server file); one static host per tree, each serving its own client.
const cert = JSON.parse(readFileSync(path.join(PR, "client/dev-transport.json"))).cert_sha256;
for (const [name, port] of [["lossy", 5433], ["exact", 5434]]) {
  writeFileSync(path.join(RUN, `${name}-transport.json`), JSON.stringify({ wt_url: `https://127.0.0.1:${port}/`, cert_sha256: cert }));
}
const SERVER = path.join(PR, "target/release/series-server");
const certArgs = ["--cert-pem", "server/dev-cert/cert.pem", "--key-pem", "server/dev-cert/key.pem"];
const servers = [
  run(SERVER, ["--port", "4433", "--series", path.join(DIR, `${ID}.sbnd`), ...certArgs], PR, path.join(RUN, "lossy.log")),
  run(SERVER, ["--port", "4434", "--series", path.join(DIR, `${EXACT}.sbnd`), ...certArgs], PR, path.join(RUN, "exact.log")),
];
const HOSTS = { tip: [TIP, 8765], pr: [PR, 8766] };
const hosts = Object.entries(HOSTS).map(([name, [root, port]]) => run("python3", ["server/dev-server.py", "--port", String(port),
  "--metadata", path.join(DIR, `${ID}.metadata.json`), "--transport", path.join(RUN, "lossy-transport.json"),
  "--exact-metadata", path.join(DIR, `${EXACT}.metadata.json`), "--exact-transport", path.join(RUN, "exact-transport.json")],
  root, path.join(RUN, `host-${name}.log`)));
await Promise.all([...servers.map((s) => ready(s, /transport=/)), ...hosts.map((h) => ready(h, /port=87/))]);

/** Each write to the label, the overlay and the status line, on the page's clock (ms from navigation). */
function watch() {
  globalThis.__log = [];
  addEventListener("DOMContentLoaded", () => {
    for (const id of ["quality", "overlay", "status"]) {
      const el = document.getElementById(id);
      new MutationObserver(() => globalThis.__log.push({ t: performance.now(), id, text: el.hidden ? "" : el.textContent }))
        .observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    }
  });
}

async function visit(arm, view, rtt) {
  const relay = run("taskset", ["-c", RELAY_CPU, "chrt", "-f", "50", "python3", path.join(PR, "lab/scripts/link_impair.py"), "--self-timing",
    "--udp", "5433:4433", "--udp", "5434:4434", "--tcp", `9700:${HOSTS[arm][1]}`, "--delay-ms", String(rtt / 2), ...RELAY_ARGS], PR);
  let tally = "";
  relay.stdout.on("data", (d) => (tally += d));
  relay.stderr.on("data", (d) => (tally += d));
  await ready(relay, /READY/);
  // A fresh browser and context: no HTTP cache, no compiled code, no session.
  const browser = await chromium.launch();
  const row = { arm, view, rtt };
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.addInitScript(watch);
    await page.goto(`http://127.0.0.1:9700/?overlay=1&view=${view}`, { waitUntil: "commit" });
    const log = () => page.evaluate(() => globalThis.__log ?? []);
    let l = [];
    for (const end = Date.now() + 120000; Date.now() < end; await page.waitForTimeout(25)) {
      l = await log();
      if (l.some((e) => e.id === "status" && /fill \d+ ms|error/.test(e.text))) break;
    }
    const first = (id) => l.find((e) => e.id === id && e.text);
    const filled = l.find((e) => e.id === "status" && /fill \d+ ms/.test(e.text));
    const nav = await page.evaluate((exact) => {
      const r = (p) => performance.getEntriesByType("resource").find((e) => new URL(e.name).pathname === p);
      const span = (e) => e && [Math.round(e.requestStart || e.startTime), Math.round(e.responseEnd)];
      return { metadata: span(r("/series/metadata")), exactMeta: span(r(`/series/${exact}/metadata`)),
        manifest: span(performance.getEntriesByType("resource").find((e) => e.name.endsWith("manifest.sha256"))) };
    }, EXACT);
    Object.assign(row, {
      firstPicture: first("overlay") && Math.round(first("overlay").t),
      labelAt: first("quality") && Math.round(first("quality").t),
      fill: filled && Math.round(filled.t),
      fillStatus: filled?.text.match(/fill (\d+) ms/)?.[1] && Number(filled.text.match(/fill (\d+) ms/)[1]),
      status: l.findLast((e) => e.id === "status")?.text, errors, ...nav,
    });
  } catch (e) {
    row.error = e.message.split("\n")[0];
  }
  await browser.close();
  await new Promise((done) => (relay.exitCode != null ? done() : (relay.once("exit", done), process.kill(-relay.pid, "SIGTERM"))));
  row.void = /VOID/.test(tally);
  row.relay = tally.match(/self-timing[^\n]*/)?.[0];
  return row;
}

const ARMS = [["tip", "tip-a"], ["tip", "tip-b"], ["pr", "pr-a"], ["pr", "pr-b"]];
for (let round = 0; round < ROUNDS; round++) {
  for (const rtt of RTTS) for (const view of VIEWS) {
    let prev = null;
    for (const [arm, label] of order(ARMS, round)) {
      const row = { round, label, prev, t: new Date().toISOString(), ...(await visit(arm, view, rtt)) };
      appendFileSync(OUT, JSON.stringify(row) + "\n");
      process.stderr.write(`${round} ${rtt} ${view} ${label}: first ${row.firstPicture} fill ${row.fill} ${row.void ? "VOID" : ""}${row.error ?? ""}\n`);
      prev = label;
    }
  }
}
stopAll();
process.exit(0);
