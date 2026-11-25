// WINDOW-WHOLE-GROUPS-MEASURE-2: a pass forward and a pass back over one optimal-quality series in the product page,
// the tip against PR 446, through one relay that carries both planes. README.md beside this file, §The timed cells.
//
//   TIP=tree PR=tree DIR=demo-series ID=dbts_b1-q8-g8 FORMS=CLEAN,LTE RATES=1,4 ROUNDS=3 DWELL_MS=300 OUT=steps.jsonl \
//     NODE_PATH=$(npm root -g) taskset -c 0-2 node steps.mjs
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const env = process.env;
const TIP = env.TIP, PR = env.PR, DIR = env.DIR, ID = env.ID || "dbts_b1-q8-g8";
const FORMS_ASKED = (env.FORMS || "CLEAN,LTE").split(",");
const RATES = (env.RATES || "1,4").split(",").map(Number);
const ROUNDS = Number(env.ROUNDS || 3), FIRST = Number(env.FIRST || 0);
const DWELL_MS = Number(env.DWELL_MS || 300);
const OUT = env.OUT || "steps.jsonl";
const RELAY_CPU = env.RELAY_CPU || "3";
// claude/delivery lab/delivery/plan.mjs CELLS, one-way delay ms, kbit/s, queue packets; LTE without its blackout.
const FORMS = {
  CLEAN: ["--delay-ms", "1", "--rate-kbit", "90000", "--queue-pkts", "300"],
  LTE: ["--delay-ms", "19", "--rate-kbit", "50000", "--queue-pkts", "3300", "--loss", "0.1"],
};
const { order } = await import(path.join(PR, "lab/order.mjs"));
const { throttleTree } = await import(path.join(PR, "lab/scripts/cpu_throttle.mjs"));
const { chromium } = createRequire(import.meta.url)("playwright");

const meta = JSON.parse(readFileSync(path.join(DIR, `${ID}.metadata.json`)));
const N = meta.frameCount, EXACT = meta.exactSeries;
const RUN = path.join(PR, "target/steps-measure");
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

// PR 446 touches no server file: one pair of servers, one static host per tree.
const cert = JSON.parse(readFileSync(path.join(PR, "client/dev-transport.json"))).cert_sha256;
for (const [name, port] of [["lossy", 5433], ["exact", 5434]]) {
  writeFileSync(path.join(RUN, `${name}-transport.json`), JSON.stringify({ wt_url: `https://127.0.0.1:${port}/`, cert_sha256: cert }));
}
const SERVER = path.join(TIP, "target/release/series-server");
const certArgs = ["--cert-pem", path.join(TIP, "server/dev-cert/cert.pem"), "--key-pem", path.join(TIP, "server/dev-cert/key.pem")];
const servers = [
  run("taskset", ["-c", "0-2", SERVER, "--port", "4433", "--series", path.join(DIR, `${ID}.sbnd`), ...certArgs], TIP, path.join(RUN, "lossy.log")),
  run("taskset", ["-c", "0-2", SERVER, "--port", "4434", "--series", path.join(DIR, `${EXACT}.sbnd`), ...certArgs], TIP, path.join(RUN, "exact.log")),
];
const HOSTS = { tip: [TIP, 8765], pr: [PR, 8766] };
const hosts = Object.entries(HOSTS).map(([name, [root, port]]) => run("python3", ["server/dev-server.py", "--port", String(port),
  "--metadata", path.join(DIR, `${ID}.metadata.json`), "--transport", path.join(RUN, "lossy-transport.json"),
  "--exact-metadata", path.join(DIR, `${EXACT}.metadata.json`), "--exact-transport", path.join(RUN, "exact-transport.json")],
  root, path.join(RUN, `host-${name}.log`)));
await Promise.all([...servers.map((s) => ready(s, /transport=/)), ...hosts.map((h) => ready(h, /port=87/))]);

/** Each frame a decoder hands the page (index, wire bytes, page clock) and each overlay and status write. */
function watch() {
  globalThis.__frames = [];
  globalThis.__log = [];
  const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage");
  Object.defineProperty(MessagePort.prototype, "onmessage", {
    get() { return d.get.call(this); },
    set(fn) {
      d.set.call(this, fn && function (e) {
        const m = e.data;
        if (m?.kind === "frame") globalThis.__frames.push({ i: m.index, b: m.wireBytes, t: performance.now() });
        return fn.call(this, e);
      });
    },
  });
  addEventListener("DOMContentLoaded", () => {
    for (const id of ["overlay", "status"]) {
      const el = document.getElementById(id);
      new MutationObserver(() => globalThis.__log.push({ t: performance.now(), id, text: el.textContent }))
        .observe(el, { childList: true, characterData: true, subtree: true });
    }
  });
}

/** One step to frame `to`: the key, then the first overlay write once frame `to` is here (at once if it was held). */
async function step(page, key, to) {
  return page.evaluate(async ({ key, to }) => {
    const nf = globalThis.__frames.length, t0 = performance.now();
    dispatchEvent(new KeyboardEvent("keydown", { key }));
    const end = t0 + 60000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 2));
      const status = globalThis.__log.findLast((e) => e.id === "status")?.text ?? "";
      if (/error/.test(status)) return { to, error: status };
      const came = globalThis.__frames.slice(nf).find((f) => f.i === to);
      const after = came ? came.t : t0;
      const paint = globalThis.__log.find((e) => e.id === "overlay" && e.t >= after && e.t >= t0);
      if (paint && status.startsWith(`frame ${to + 1} of`)) {
        const got = globalThis.__frames.slice(nf);
        return { to, ms: paint.t - t0, waited: Boolean(came), frames: got.length, bytes: got.reduce((s, f) => s + f.b, 0) };
      }
      if (performance.now() > end) return { to, error: "no paint in 60 s" };
    }
  }, { key, to });
}

async function visit(arm, form, rate) {
  const relay = run("taskset", ["-c", RELAY_CPU, "chrt", "-f", "50", "python3", path.join(PR, "lab/scripts/link_impair.py"), "--self-timing",
    "--udp", "5433:4433", "--udp", "5434:4434", "--tcp", `9700:${HOSTS[arm][1]}`, ...FORMS[form]], PR);
  let tally = "";
  relay.stdout.on("data", (d) => (tally += d));
  relay.stderr.on("data", (d) => (tally += d));
  await ready(relay, /READY/);
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const row = { arm, form, rate, dwellMs: DWELL_MS };
  let stop = () => {};
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.addInitScript(watch);
    await page.goto(`http://127.0.0.1:9700/?overlay=1&view=page`, { waitUntil: "commit" });
    await page.waitForFunction(() => /fill \d+ ms|error/.test(globalThis.__log?.findLast((e) => e.id === "status")?.text ?? ""), null, { timeout: 120000, polling: 50 });
    row.fill = await page.evaluate(() => ({ status: globalThis.__log.findLast((e) => e.id === "status").text, frames: globalThis.__frames.length,
      bytes: globalThis.__frames.reduce((s, f) => s + f.b, 0) }));
    if (/error/.test(row.fill.status)) throw new Error(row.fill.status);
    await page.waitForTimeout(500);
    stop = throttleTree(server.process().pid, rate);
    for (const [pass, key, from, to, d] of [["forward", "ArrowDown", 1, N - 1, 1], ["backward", "ArrowUp", N - 2, 0, -1]]) {
      const steps = [];
      for (let i = from; d > 0 ? i <= to : i >= to; i += d) {
        const s = await step(page, key, i);
        if (s.error) throw new Error(`${pass} ${i}: ${s.error}`);
        steps.push(s);
        await page.waitForTimeout(DWELL_MS);
      }
      row[pass] = steps;
    }
    stop();
    stop = () => {};
    await page.waitForTimeout(300);
    row.total = await page.evaluate(() => ({ frames: globalThis.__frames.length, bytes: globalThis.__frames.reduce((s, f) => s + f.b, 0) }));
  } catch (e) {
    row.error = e.message.split("\n")[0];
  } finally {
    stop();
    await browser.close();
    await server.close();
  }
  await new Promise((done) => (relay.exitCode != null ? done() : (relay.once("exit", done), process.kill(-relay.pid, "SIGTERM"))));
  row.void = /VOID/.test(tally);
  row.relay = tally.match(/self-timing[^\n]*/)?.[0];
  row.udp = tally.match(/udp :\d+ [^\n]*/g);
  return row;
}

const ARMS = [["tip", "tip-a"], ["tip", "tip-b"], ["pr", "pr-a"], ["pr", "pr-b"]];
const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const form of FORMS_ASKED) for (const rate of RATES) {
    let prev = null;
    for (const [arm, label] of order(ARMS, round)) {
      const row = { round, label, prev, t: new Date().toISOString(), ...(await visit(arm, form, rate)) };
      appendFileSync(OUT, JSON.stringify(row) + "\n");
      const f = row.forward ?? [], b = row.backward ?? [];
      process.stderr.write(`${round} ${form} x${rate} ${label}: fwd ${sum(f, "frames")} fr ${(sum(f, "bytes") / 1e6).toFixed(1)} MB ` +
        `max ${Math.max(0, ...f.map((s) => s.ms)).toFixed(0)} ms | back ${sum(b, "frames")} fr ${(sum(b, "bytes") / 1e6).toFixed(1)} MB ` +
        `max ${Math.max(0, ...b.map((s) => s.ms)).toFixed(0)} ms ${row.void ? "VOID " : ""}${row.error ?? ""}\n`);
      prev = label;
    }
  }
}
stopAll();
process.exit(0);
