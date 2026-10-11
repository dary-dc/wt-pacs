// Whole fills of row 144's series with and without the page's ack, the arms interleaved: queue row 147 (FRAMELOSS).
// lab/frameloss/README.md
//   NODE_PATH=$(npm root -g) node lab/frameloss/cost.mjs --series DIR --before REV --rounds N [--firefox BINARY]
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../order.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((a) => a.trim().split(/\s+/)));
const series = path.resolve(args.series);
const rounds = Number(args.rounds ?? 4);
// The lever: the downloader and its page side, today's against the commit before the ack.
const FILES = ["client/transport/downloader.js", "client/transport/consumer.js"];
const git = (...a) => execFileSync("git", a, { cwd: ROOT }).toString();
const arms = {
  ack: FILES.map((f) => git("show", `HEAD:${f}`)),
  without: FILES.map((f) => git("show", `${args.before}:${f}`)),
};
const put = (arm) => FILES.forEach((f, i) => writeFileSync(path.join(ROOT, f), arms[arm][i]));
const n = JSON.parse(readFileSync(path.join(series, "metadata.json"))).frameCount;
const engines = ["chromium", ...(args.firefox ? ["firefox"] : [])];
const chromium = createRequire(import.meta.url)("playwright").chromium;

function waitFor(child, pattern) {
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(pattern);
      if (m) resolve(m);
    });
    child.on("exit", () => reject(new Error(`exited before ${pattern}: ${out}`)));
  });
}

async function visit(engine, tmp) {
  const port = 40000 + Math.floor(Math.random() * 20000);
  const srv = spawn(path.join(ROOT, "target/release/series-server"), ["--port", port, "--bind", "127.0.0.1", "--series",
    path.join(series, "series.sbnd"), "--cert-pem", `${tmp}/cert.pem`, "--key-pem", `${tmp}/key.pem`], { stdio: ["ignore", "pipe", "ignore"] });
  const [, url, hash] = await waitFor(srv, /wt_url=(\S+)\s+cert_sha256=(\S+)[\s\S]*transport=(\S+)/);
  writeFileSync(`${tmp}/transport.json`, JSON.stringify({ wt_url: url, cert_sha256: hash }));
  const host = spawn("python3", ["server/dev-server.py", "--port", "0", "--transport", `${tmp}/transport.json`], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
  const [, hostPort] = await waitFor(host, /port=(\d+)/);
  let done;
  const result = new Promise((r) => (done = r));
  const collector = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end();
      done(JSON.parse(body));
    });
  });
  await new Promise((r) => collector.listen(0, "127.0.0.1", r));
  const page = `http://127.0.0.1:${hostPort}/lab/ffportgc/index.html?n=${n}&follow=0&dir=/${path.relative(ROOT, series)}` +
    `&post=${encodeURIComponent(`http://127.0.0.1:${collector.address().port}/`)}`;
  let close;
  if (engine === "chromium") {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
    await (await browser.newPage()).goto(page);
    close = () => browser.close();
  } else {
    const profile = mkdtempSync(path.join(tmp, "ff-"));
    writeFileSync(path.join(profile, "user.js"), 'user_pref("browser.shell.checkDefaultBrowser", false);\n');
    const ff = spawn(args.firefox, ["--headless", "--no-remote", "--profile", profile, page], { stdio: "ignore", detached: true });
    close = () => process.kill(-ff.pid, "SIGKILL");
  }
  const timeout = setTimeout(() => done({ failed: 1, log: "no result in 180 s" }), 180_000);
  const { log } = await result;
  clearTimeout(timeout);
  await close();
  collector.close();
  srv.kill();
  host.kill();
  return log;
}

const tmp = mkdtempSync(path.join(tmpdir(), "frameloss-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", `${tmp}/key.pem`,
  "-out", `${tmp}/cert.pem`, "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
const probe = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const browserVersion = { chromium: probe.version() };
await probe.close();
if (args.firefox) browserVersion.firefox = execFileSync(args.firefox, ["--version"]).toString().trim();
console.log(JSON.stringify({ settings: {
  lever: `${FILES.join(" + ")}: HEAD (${git("rev-parse", "--short", "HEAD").trim()}) against ${args.before}`,
  same: "TS transport, decoders 3 spawned at start, perDecoder 2, HTJ2K OpenJPH WASM build, server congestion=cubic-restart and quinn's default initial window, loopback, no relay",
  series: `${n} frames, ${path.relative(ROOT, series)}`, browsers: browserVersion,
} }));
try {
  for (let round = 0; round < rounds; round++) {
    for (const engine of engines) {
      for (const arm of order(Object.keys(arms), round + engines.indexOf(engine))) {
        put(arm);
        const log = await visit(engine, tmp);
        const ms = Number(log.match(/last frame at (\d+) ms/)?.[1] ?? NaN);
        console.log(JSON.stringify({ round, engine, arm, ms, log }));
      }
    }
  }
} finally {
  put("ack");
  rmSync(tmp, { recursive: true, force: true });
}
