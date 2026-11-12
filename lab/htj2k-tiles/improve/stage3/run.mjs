/**
 * Stage 3's driver: cells (set × link × impairment × throttle) in a Williams order each round, the five arms inside
 * each cell the same way; a visit is its own servers, relays and browser: the fill, the Lossless request, then the page
 * reopened in the same tab. Rows appended as they land. lab/htj2k-tiles/improve/README.md §Stage 3
 *
 *   NODE_PATH=$(npm root -g) node lab/htj2k-tiles/improve/stage3/run.mjs --series DIR --bands DIR --out rows.jsonl
 *     [--rounds 6] [--first-round 0] [--cells r5000,r20000,lte-good,wifi-home,r20000:l1] [--throttles 1,4]
 *     [--sets dbts_a1/phone,...] [--arms D,D′,D+T3,D+L★,S★] [--oq q8-g16] [--mutate sample|truth|preview|bands-dropped]
 *   Run from the served tree (the demo commit plus lab/htj2k-tiles/improve; lab/.demo-series the series dir); its target/release has the servers.
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 6));
const FIRST = Number(arg("--first-round", 0));
const CELLS = arg("--cells", "r5000,r20000,lte-good,wifi-home,r20000:l1").split(",").map((c) => c.split(":")).map(([link, imp = "clean"]) => ({ link, impairment: imp }));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const SETS = arg("--sets", "dbts_a1/phone,dbts_b1/phone,dbts_c1/phone,dbts_c1/sideways").split(",");
const ARMS = arg("--arms", "D,D′,D+T3,D+L★,S★").split(",");
const OQ = arg("--oq", "q8-g16");
const SERIES = path.resolve(arg("--series"));
const BANDS = path.resolve(arg("--bands"));
const OUT = arg("--out");
const MUTATE = arg("--mutate", "");
const ROOT = new URL("../../../..", import.meta.url).pathname;
const T = mkdtempSync(path.join(tmpdir(), "htj2k-s3-"));
const RELEASE = path.join(ROOT, "target/release");
const BROWSER_CORES = "0-2";
const RIG_CORE = "3";
const ONE_WAY = 20;
const debug = (...a) => process.env.DEBUG && console.error("debug:", ...a);
const port = () => 20000 + ((Math.random() * 25000) | 0);

/** The rig's links, as lab/av1/delivery/total-time/run.mjs at the demo commit defines them. */
const LTE = "TMobile-LTE-short.down";
const ge = (mean) => { const r = 100 / 3.5, m = mean / 100; return ["--loss-model", "ge", "--ge-p", (m * r / (1 - m)).toFixed(5), "--ge-r", r.toFixed(4)]; };
function link(name, impairment) {
  const loss = impairment[0] === "l" ? Number(impairment.slice(1)) : 0;
  const fixed = /^r(\d+)$/.exec(name);
  if (fixed) return [ONE_WAY, ["--rate-kbit", fixed[1], "--queue-pkts", "200", ...(loss ? ["--loss", String(loss)] : [])]];
  if (name === "lte-good") return [25, ["--trace", path.join(ROOT, "lab/.traces", LTE), ...ge(loss || 0.01), "--queue-ms", "500"]];
  if (name === "wifi-home") return [15, ["--trace", `${T}/wifi-home.trace`, ...ge(loss || 0.5), "--queue-ms", "300"]];
  throw new Error(`unknown link ${name}`);
}
writeFileSync(`${T}/wifi-home.trace`, execFileSync("python3", [path.join(ROOT, "lab/scripts/gen_step_trace.py"),
  "15000:12000", "40000:12000", "10000:12000", "30000:12000", "15000:12000"]));
if (!existsSync(path.join(ROOT, "lab/.traces", LTE))) throw new Error(`lab/.traces/${LTE}: fetch it as total-time/run.mjs does`);

execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", `${T}/key.pem`, "-out", `${T}/cert.pem`,
  "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
const HASH = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: execFileSync("openssl", ["x509", "-in", `${T}/cert.pem`, "-outform", "DER"]) }).toString().split(" ")[0];

/** Each set's inputs: the OQ and exact series of the demo commit, and the strip series packed once. */
function inputs(vol) {
  const oqId = `${vol}-${OQ}${vol === "dbts_b1" ? "" : "-cut"}`;
  const bands = `${T}/${vol}-bands.sbnd`;
  if (!existsSync(bands)) execFileSync(path.join(RELEASE, "pack-series"), ["--metadata", `${BANDS}/${vol}-bands/metadata.json`, "--frames", `${BANDS}/${vol}-bands`, "--output", bands], { stdio: "ignore" });
  // D′: the same series under another name.
  const twin = `${T}/${oqId}-twin.sbnd`;
  if (!existsSync(twin)) symlinkSync(`${SERIES}/${oqId}.sbnd`, twin);
  const frames = JSON.parse(readFileSync(`${BANDS}/${vol}-bands/frames.json`, "utf8"));
  const exactMeta = JSON.parse(readFileSync(`${SERIES}/${vol}.metadata.json`, "utf8"));
  return { oqId, oq: `${SERIES}/${oqId}.sbnd`, twin, exact: `${SERIES}/${vol}.sbnd`, bands, frames, exactDigests: exactMeta.digests.frames };
}

let waiting = {};
const collector = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    debug("collector", req.url);
    if (req.url === "/hello") waiting.hello?.();
    if (req.url === "/result") waiting.result?.(JSON.parse(body));
    res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end();
  });
});
await new Promise((r) => collector.listen(0, "127.0.0.1", r));
const POST = `http://127.0.0.1:${collector.address().port}/`;

const HTTP = port();
const http = spawn("python3", ["server/dev-server.py", "--port", String(HTTP)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
for (let k = 0; ; k++) {
  try { await fetch(`http://127.0.0.1:${HTTP}/`); break; } catch { if (k > 300) throw new Error("dev-server not answering"); await new Promise((r) => setTimeout(r, 100)); }
}
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
writeFileSync(`${T}/chrome.sh`, `#!/bin/sh\nexec taskset -c ${BROWSER_CORES} "${CHROME}" "$@"\n`, { mode: 0o755 });

const started = (child, re) => new Promise((resolve, reject) => {
  let out = "";
  child.stdout.on("data", (d) => { out += d; if (re.test(out)) resolve(out); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});

/** A series behind its own relay on the cell's link; the seed is the round's, so two relays of a visit start alike. */
async function serve(series, cell, round) {
  const srv = port();
  const relayPort = port();
  const server = spawn("taskset", ["-c", BROWSER_CORES, path.join(RELEASE, "series-server"), "--port", String(srv), "--bind", "127.0.0.1",
    "--series", series, "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], { stdio: ["ignore", "pipe", "ignore"] });
  const serverOut = await started(server, /transport=.*\n/);
  const [oneWay, linkArgs] = link(cell.link, cell.impairment);
  const relay = spawn("chrt", ["-f", "50", "taskset", "-c", RIG_CORE, "python3", "lab/scripts/link_impair.py", "--udp", `${relayPort}:${srv}`,
    "--seed", String(round), "--delay-ms", String(oneWay), ...linkArgs, "--self-timing"], { cwd: ROOT });
  let log = "";
  relay.stdout.on("data", (d) => (log += d));
  relay.stderr.on("data", (d) => (log += d));
  for (let k = 0; !/READY/.test(log); k++) { if (k > 100) throw new Error(`relay not ready: ${log}`); await new Promise((r) => setTimeout(r, 50)); }
  return {
    url: `https://127.0.0.1:${relayPort}/`, hash: HASH, congestion: /congestion=([\w-]+)/.exec(serverOut)?.[1] ?? "cubic",
    async stop() {
      const exited = new Promise((res) => relay.once("exit", res));
      relay.kill("SIGTERM");
      await exited;
      server.kill();
      const late = log.match(/self-timing packets \d+ late p50 [\d.]+ p99 ([\d.]+)/g)?.pop();
      return { relayP99: late ? Number(late.split(" p99 ")[1]) : null, void: !late || /VOID/.test(log), s2c: log.match(/server->client sent (\d+) lost (\d+)/)?.slice(1).map(Number) };
    },
  };
}

async function visit(set, arm, cell, throttle, round) {
  const [vol, viewport] = set.split("/");
  const inp = inputs(vol);
  const fit = inp.frames.fit[viewport];
  const N = inp.frames.N;
  const mid = N >> 1;
  debug("inputs", vol);
  const servers = {};
  if (arm !== "S★") servers.oq = await serve(arm === "D′" ? inp.twin : inp.oq, cell, round);
  if (arm === "D" || arm === "D′") servers.exact = await serve(inp.exact, cell, round);
  else servers.bands = await serve(inp.bands, cell, round);
  debug("served", Object.keys(servers));
  const key = `${round}-${vol}-${viewport}-${arm}-${Date.now()}`;
  const cfg = { debug: Boolean(process.env.DEBUG), arm, key, N, fit, mid, mutate: MUTATE, frames: `/lab/.av1-work/htj2k-improve/${vol}-bands/frames.json`,
    ...(servers.oq && { oq: { url: servers.oq.url, hash: HASH, meta: `/lab/.demo-series/${inp.oqId}.metadata.json` } }),
    ...(servers.exact && { exact: { url: servers.exact.url, hash: HASH, digests: inp.exactDigests } }),
    ...(servers.bands && { bands: { url: servers.bands.url, hash: HASH } }) };
  const errors = [];
  const browser = await chromium.launchServer({ executablePath: `${T}/chrome.sh` });
  const client = await chromium.connect(browser.wsEndpoint());
  const tab = await client.newPage();
  debug("browser up");
  tab.on("pageerror", (e) => (errors.push(e.message), debug("pageerror", e.message)));
  if (process.env.DEBUG) tab.on("console", (m) => console.error(`page: ${m.text()}`));
  let stop = () => {};
  const page = (c) => {
    const r = new Promise((resolve, reject) => {
      waiting = { hello: () => { if (!c.reopen) stop = throttleTree(browser.process().pid, throttle); }, result: resolve };
      setTimeout(() => reject(new Error("no result in 720 s")), 720000);
    });
    tab.goto(`http://127.0.0.1:${HTTP}/lab/htj2k-tiles/improve/stage3/index.html?cfg=${encodeURIComponent(JSON.stringify(c))}&post=${encodeURIComponent(POST)}`).catch((e) => errors.push(e.message));
    return r;
  };
  let fill = null;
  let again = null;
  let stalled = null;
  try {
    fill = await page(cfg);
    if (fill.error) throw new Error(fill.error);
    again = await page({ ...cfg, reopen: true });
  } catch (e) {
    errors.push(String(e.message).split("\n")[0]);
    stalled = await Promise.race([tab.evaluate(() => globalThis.__stage ?? null), new Promise((r) => setTimeout(() => r("no answer"), 5000))]).catch((x) => String(x.message));
  } finally {
    stop();
    waiting = {};
    await client.close();
    await browser.close();
  }
  const relays = {};
  for (const [k, s] of Object.entries(servers)) relays[k] = await s.stop();
  return figures({ round, set, vol, viewport, fit, arm, link: cell.link, impairment: cell.impairment, throttle, mid, N,
    congestion: Object.values(servers)[0].congestion, relays, ...(stalled && { stalled }), void: Object.values(relays).some((r) => r.void), errors }, fill, again, inp.frames);
}

const oqDigest = (sha) => {
  const oq = Object.entries(sha).filter(([k]) => k.endsWith(".oq")).sort(([a], [b]) => parseInt(a) - parseInt(b)).map(([, v]) => v);
  return oq.length ? createHash("sha256").update(oq.join("")).digest("hex").slice(0, 16) : null;
};

/** A visit's row: times from the fill's issue or the request, and every picture against its truth. */
function figures(row, r, again, frames) {
  if (!r?.allAt) return { ...row, failed: r ? `not every slice pictured; ${r.failures?.[0]?.reason ?? ""}` : "no result" };
  const flip = (t) => (MUTATE === "truth" ? t.replace(/^./, (c) => (c === "0" ? "1" : "0")) : t);
  const truth = (f, level) => flip(frames.frames[f].truth[level]);
  let exact = 0, owed = 0;
  for (const [k, sha] of Object.entries(r.sha)) {
    const [f, level] = k.split(".");
    if (level === "oq") continue;
    owed += 1;
    exact += sha === truth(Number(f), level);
  }
  const reopenSame = again ? Object.entries(again.sha).filter(([f, sha]) => sha === r.sha[`${f}.${again.pictured[f] === "oq" ? "oq" : again.pictured[f]}`]).length : 0;
  return {
    ...row,
    firstMs: Math.round(r.firstAt - r.issuedAt),
    allMs: Math.round(r.allAt - r.issuedAt),
    levelMs: r.levelAt && Math.round(r.levelAt - r.askAt),
    losslessMs: r.losslessAt && Math.round(r.losslessAt - r.askAt),
    fillBytes: r.fillBytes, bytes: r.bytes, asks: r.asks, decodes: r.decodes,
    // OQ pictures have no truth (lossy, no digests in their metadata): one digest of them all, equal across a set's D visits.
    oq: r.oq, oqDigest: oqDigest(r.sha), exact, owed, losslessExact: r.sha[`${row.mid}.0`] === truth(row.mid, "0"), failures: r.nFailures, failure: r.failures[0]?.reason,
    reopen: again && { allMs: Math.round(again.allAt - again.issuedAt), wouldAsk: again.wouldAsk, bandsAgain: again.bandsAgain, decodes: again.decodes,
      same: reopenSame, of: row.N, failures: again.failures.length },
  };
}

const cells = SETS.flatMap((set) => CELLS.flatMap((c) => THROTTLES.map((throttle) => ({ set, ...c, throttle }))));
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const [k, c] of order(cells, round).entries()) {
    let prev = null;
    for (const arm of order(ARMS, round + k)) {
      const row = { ...(await visit(c.set, arm, c, c.throttle, round)), prev };
      prev = arm;
      if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.error(`round ${round} ${c.set} ${c.link} ${c.impairment} ${c.throttle}x ${arm}: first ${row.firstMs} all ${row.allMs} level ${row.levelMs} lossless ${row.losslessMs} ms, ` +
        `bytes ${row.bytes}, exact ${row.exact}/${row.owed} lossless ${row.losslessExact}, oq ${JSON.stringify(row.oq)}, reopen ${JSON.stringify(row.reopen)}` +
        `${row.void ? " VOID" : ""}${row.failed ? " FAILED " + row.failed : ""}${row.failure ? " " + row.failure : ""}${row.errors.length ? " " + row.errors[0] : ""}`);
    }
  }
}
process.exit(0);
