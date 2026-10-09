// The viewer's page check: a series served, the page opened with ?check=1, and anything short of a complete,
// exact, drawn page failed by name. client/README.md §The viewer
//
//   NODE_PATH=$(npm root -g) node client/viewer/check.mjs --series X.sbnd --decoder htj2k [--pair Y.sbnd --pair-decoder D]
//     [--engine chromium|firefox] [--cine] [--fill 0]
//   ... --url http://host/ --decoder htj2k   (a host already running: row DEPLOY; no request log, so no code check)
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ENGINE = arg("--engine", "chromium");
const T = mkdtempSync(path.join(tmpdir(), "viewer-check-"));
const children = [];
process.on("exit", () => { for (const c of children) c.kill("SIGKILL"); rmSync(T, { recursive: true, force: true }); });
const failures = [];
const fail = (why) => failures.push(why);

const collector = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end();
    if (req.url === "/result") collector.result?.(JSON.parse(body));
  });
});
await new Promise((r) => collector.listen(0, "127.0.0.1", r));
const POST = `http://127.0.0.1:${collector.address().port}/`;

const started = (child, re) => new Promise((resolve, reject) => {
  let out = "";
  child.stdout.on("data", (d) => { out += d; const m = re.exec(out); if (m) resolve(m); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});

/** The bundle's own metadata, which the page reads at /series/metadata. */
function metadataOf(sbnd) {
  const b = readFileSync(sbnd);
  return JSON.parse(b.subarray(16 + 12 * b.readUInt32LE(12), 16 + 12 * b.readUInt32LE(12) + b.readUInt32LE(8)).toString());
}

/** A series served: the server on a fresh cert, the static host told its metadata and transport, every request logged. */
async function host(sbnd, name) {
  const key = `${T}/${name}-key.pem`;
  const cert = `${T}/${name}-cert.pem`;
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", key, "-out", cert,
    "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const hash = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: execFileSync("openssl", ["x509", "-in", cert, "-outform", "DER"]) })
    .toString().split(" ")[0];
  const port = 20000 + ((Math.random() * 25000) | 0);
  const server = spawn(path.join(ROOT, "target/release/series-server"), ["--port", String(port), "--bind", "127.0.0.1", "--series", sbnd,
    "--cert-pem", cert, "--key-pem", key], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(server);
  await started(server, /transport=/);
  writeFileSync(`${T}/${name}.json`, JSON.stringify(metadataOf(sbnd)));
  writeFileSync(`${T}/${name}-transport.json`, JSON.stringify({ wt_url: `https://127.0.0.1:${port}/`, cert_sha256: hash }));
  const http = spawn("python3", [path.join(ROOT, "server/dev-server.py"), "--port", "0", "--metadata", `${T}/${name}.json`,
    "--transport", `${T}/${name}-transport.json`, "--log-requests"], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(http);
  const [, p] = await started(http, /port=(\d+)/);
  const requests = [];
  http.stdout.on("data", (d) => requests.push(...String(d).split("\n").filter((l) => l.startsWith("GET "))));
  return { url: `http://127.0.0.1:${p}/`, requests };
}

/** The page's own result, from headless Chromium through playwright or a stock headless Firefox. */
async function open(url) {
  const result = new Promise((resolve) => {
    collector.result = resolve;
    setTimeout(() => resolve({ error: "no result in 300 s" }), 300000).unref();
  });
  const q = new URLSearchParams({ check: "1", post: POST, ...(process.argv.includes("--cine") && { cine: "1" }), ...(arg("--fill") && { fill: arg("--fill") }) });
  const page = `${url}?${q}`;
  if (ENGINE === "firefox") {
    const profile = mkdtempSync(path.join(T, "ff-"));
    // No GPU in a container: WebGL forced on, through the software rasterizer Firefox finds.
    writeFileSync(path.join(profile, "user.js"), ['user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("webgl.force-enabled", true);', 'user_pref("webgl.disabled", false);'].join("\n") + "\n");
    // Headless Firefox has no WebGL: given a display (xvfb-run on a host without one), it runs windowed.
    const mode = process.env.DISPLAY ? ["-width", "1024", "-height", "768"] : ["--headless", "--window-size=1024,768"];
    const ff = spawn(process.env.FIREFOX_PATH, [...mode, "--no-remote", "--profile", profile, page],
      { stdio: "ignore", detached: true });
    try {
      return await result;
    } finally {
      process.kill(-ff.pid, "SIGKILL");
    }
  }
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const tab = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  tab.on("pageerror", (e) => fail(`page error: ${e.message}`));
  await tab.goto(page);
  try {
    // Read off the page too: a page off loopback may not reach the collector (Chrome's Local Network Access).
    const read = tab.waitForFunction(() => globalThis.__viewerResult, null, { timeout: 0 }).then((h) => h.jsonValue());
    return await Promise.race([result, read]);
  } finally {
    await browser.close();
  }
}

/** Every way the page can fall short, each by name. */
function judge(name, r, requests, codec, decoder) {
  if (r.error) return fail(`${name}: ${r.error}`);
  const say = (ok, why) => ok || fail(`${name}: ${why}`);
  say(r.received === r.n && !r.errors.length, `the fill did not complete: ${r.received} of ${r.n} frames, errors ${JSON.stringify(r.errors)}`);
  say(r.exact === r.n, `not every frame exact: ${r.exact} exact, ${r.inexact} not, ${r.unchecked} unchecked of ${r.n}`);
  say(r.askDelivered === true, `an ask of a delivered frame: ${JSON.stringify(r.askDelivered)}`);
  say(r.cancelledFill === "cancelled", `a fill cancelled at once: ${JSON.stringify(r.cancelledFill)}`);
  say(r.askAfterCancel === true, `an ask after the cancel: ${JSON.stringify(r.askAfterCancel)}`);
  const paths = Object.keys(r.paths);
  if (decoder) say(paths.length === 1 && paths[0] === decoder, `decoded by ${paths.join(", ") || "none"}, not ${decoder} alone`);
  if (codec === "av1") say(paths.length > 0 && paths.every((p) => p.startsWith("av1-")), `an AV1 page whose frames were decoded by ${paths.join(", ")}`);
  if (requests) {
    const av1 = requests.filter((l) => /\/av1[^/]*\.js|dav1d/.test(l));
    if (codec !== "av1") say(av1.length === 0, `an HTJ2K page fetched AV1 code: ${av1.join(", ")}`);
  }
  for (const b of r.readbacks ?? []) say(!b.error && b.worst === 0, `frame ${b.i} at zoom 1 differs from the CPU reference: ${b.error ?? `worst |Δ| ${b.worst}`}`);
  if (process.argv.includes("--cine")) say(r.cine >= 3, `the cine showed ${r.cine} frames in 1.5 s`);
}

const summary = (name, r) => `${name}: ${r.received}/${r.n} received, ${r.exact} exact, paths ${JSON.stringify(r.paths)}, renderer ${r.renderer}, ` +
  `fill ${Math.round(r.fillMs)} ms, first exact on screen ${Math.round(r.firstShownMs)} ms, readbacks ${(r.readbacks ?? []).map((b) => `${b.i}:${b.worst}`).join(" ")}` +
  `${r.cine !== undefined ? `, cine ${r.cine} frames` : ""}`;

const runs = [];
if (arg("--url")) {
  const r = await open(arg("--url"));
  judge("hosted", r, null, null, arg("--decoder"));
  runs.push(["hosted", r]);
} else {
  for (const [name, sbnd, decoder] of [["series", arg("--series"), arg("--decoder")], ["pair", arg("--pair"), arg("--pair-decoder")]].filter(([, s]) => s)) {
    const codec = metadataOf(sbnd).codec ?? "htj2k";
    const { url, requests } = await host(path.resolve(sbnd), name);
    const r = await open(url);
    judge(`${name} (${codec})`, r, requests, codec, decoder);
    runs.push([`${name} (${codec})`, r]);
  }
  if (runs.length === 2) {
    const [a, b] = runs.map(([, r]) => (r.readbacks ?? []).map((x) => x.sha256).join());
    if (a !== b || !a) fail(`the two codecs painted different readbacks: ${a} against ${b}`);
  }
}
for (const [name, r] of runs) if (!r.error) console.log(summary(name, r));
for (const f of failures) console.log(`FAIL: ${f}`);
console.log(failures.length ? `viewer check: ${failures.length} failing (${ENGINE})` : `viewer check: every frame complete, exact and drawn (${ENGINE})`);
process.exit(failures.length ? 1 : 0);
