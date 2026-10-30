// The viewer's page check: a series served, the page opened with ?check=1, and anything short of a complete,
// exact, drawn page failed by name. client/README.md §The viewer
//
//   NODE_PATH=$(npm root -g) node client/viewer/check.mjs --series X.sbnd --decoder htj2k [--pair Y.sbnd --pair-decoder D]
//     [--engine chromium|firefox] [--cine] [--fill 0] [--client ts|wasm] [--view page|worker]
//   ... --url http://host/ --decoder htj2k [--client C]   (a host already running, such as the deploy image, whose transport
//     file names C; no request log, so no code check)
//   ... --url http://host/ --fill 0 --restart CMD   (CMD restarts the host's server and prints its `transport=` line)
import { execFileSync, spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ENGINE = arg("--engine", "chromium");
const CLIENT = arg("--client", "ts");
const VIEW = arg("--view", "page");
const CLIENTS = {
  ts: ["/client/transport/ts/dist/session.js"],
  wasm: ["/client/transport/wasm/session-adapter.js", "/client/transport/wasm/pkg/transport_wasm.js", "/client/transport/wasm/pkg/transport_wasm_bg.wasm"],
};
const T = mkdtempSync(path.join(tmpdir(), "viewer-check-"));
const children = [];
process.on("exit", () => { for (const c of children) c.kill("SIGKILL"); rmSync(T, { recursive: true, force: true }); });
const failures = [];
const fail = (why) => failures.push(why);

const started = (child, re) => new Promise((resolve, reject) => {
  let out = "";
  child.stdout.on("data", (d) => { out += d; const m = re.exec(out); if (m) resolve(m); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});

/** A UDP port nothing holds, for the server's QUIC endpoint. */
async function freeUdpPort() {
  const s = createSocket("udp4");
  await new Promise((r) => s.bind(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

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
  const port = await freeUdpPort();
  const server = spawn(path.resolve(ROOT, process.env.CARGO_TARGET_DIR || "target", "release/series-server"), ["--port", String(port), "--bind", "127.0.0.1", "--series", sbnd,
    "--cert-pem", cert, "--key-pem", key], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(server);
  await started(server, /transport=/);
  writeFileSync(`${T}/${name}.json`, JSON.stringify(metadataOf(sbnd)));
  writeFileSync(`${T}/${name}-transport.json`, JSON.stringify({ wt_url: `https://127.0.0.1:${port}/`, cert_sha256: hash, client: CLIENT }));
  const http = spawn("python3", [path.join(ROOT, "server/dev-server.py"), "--port", "0", "--metadata", `${T}/${name}.json`,
    "--transport", `${T}/${name}-transport.json`, "--log-requests"], { stdio: ["ignore", "pipe", "inherit"] });
  children.push(http);
  const [, p] = await started(http, /port=(\d+)/);
  const requests = [];
  // A chunk can end inside a line: only whole lines are read.
  let partial = "";
  http.stdout.on("data", (d) => {
    const lines = (partial + d).split("\n");
    partial = lines.pop();
    requests.push(...lines.filter((l) => l.startsWith("GET ")));
  });
  return { url: `http://127.0.0.1:${p}/`, requests };
}

/** The page's own result, read off it in headless Chromium through playwright, or off a stock Firefox's stdout. */
async function open(url) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: "no result in 300 s" }), 300000).unref());
  const q = new URLSearchParams({ check: "1", ...(process.argv.includes("--cine") && { cine: "1" }), ...(arg("--fill") && { fill: arg("--fill") }), ...(VIEW !== "page" && { view: VIEW }) });
  const page = `${url}?${q}`;
  if (ENGINE === "firefox") {
    const profile = mkdtempSync(path.join(T, "ff-"));
    // No GPU in a container: WebGL forced on, through the software rasterizer Firefox finds.
    writeFileSync(path.join(profile, "user.js"), ['user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("webgl.force-enabled", true);', 'user_pref("webgl.disabled", false);',
      'user_pref("devtools.console.stdout.content", true);'].join("\n") + "\n");
    // Headless Firefox has no WebGL: given a display (xvfb-run on a host without one), it runs windowed.
    const mode = process.env.DISPLAY ? ["-width", "1024", "-height", "768"] : ["--headless", "--window-size=1024,768"];
    const ff = spawn(process.env.FIREFOX_PATH, [...mode, "--no-remote", "--profile", profile, page],
      { stdio: ["ignore", "pipe", "ignore"], detached: true });
    // Firefox prints each console.log as `console.log: "<the string, JSON-quoted>"`.
    const read = new Promise((resolve) => {
      let out = "";
      ff.stdout.on("data", (d) => {
        out += d;
        const m = /^console\.log: (".*viewer-result .*")\n/m.exec(out);
        if (m) resolve(JSON.parse(JSON.parse(m[1]).slice("viewer-result ".length)));
      });
    });
    try {
      return await Promise.race([read, timeout]);
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
    const read = tab.waitForFunction(() => globalThis.__viewerResult, null, { timeout: 0 }).then((h) => h.jsonValue());
    return await Promise.race([read, timeout]);
  } finally {
    await browser.close();
  }
}

/** Every way the page can fall short, each by name. */
function judge(name, r, requests, codec, decoder) {
  if (r.error) return fail(`${name}: ${r.error}`);
  const say = (ok, why) => ok || fail(`${name}: ${why}`);
  const onDemand = arg("--fill") === "0";
  // On demand the page holds what it asked, not the series.
  const want = onDemand ? r.asked : r.n;
  say(r.received === want && !r.errors.length, `the ${onDemand ? "asks" : "fill"} did not complete: ${r.received} of ${want} frames, errors ${JSON.stringify(r.errors)}`);
  say(r.exact === want, `not every frame exact: ${r.exact} exact, ${r.inexact} not, ${r.unchecked} unchecked of ${want}`);
  // The page asks and cancels; the view worker wants, and a replaced want keeps what it asked. docs/adr/frame-path.md §3, *Built*
  const [a, b] = [r.n >> 1, r.n - 1];
  if (onDemand && VIEW === "page") say(r.raced === "newest alone", `three quick steps did not keep the newest ask alone: ${r.raced}`);
  if (onDemand && VIEW === "page") say(r.twice === String(b), `two steps to frame ${b} sent ${r.twice}, not its one ask`);
  if (onDemand && VIEW === "worker") say(r.raced === "both kept", `a replaced want did not keep the frame it asked: ${r.raced}`);
  if (onDemand && VIEW === "worker") say(r.twice === `want ${a}, want ${b}`, `steps to ${a}, ${a}, ${b} sent ${r.twice}, not one want each`);
  say(r.askDelivered === true, `an ask of a delivered frame: ${JSON.stringify(r.askDelivered)}`);
  say(r.cancelledFill === "cancelled", `a fill cancelled at once: ${JSON.stringify(r.cancelledFill)}`);
  say(r.askAfterCancel === true, `an ask after the cancel: ${JSON.stringify(r.askAfterCancel)}`);
  const paths = Object.keys(r.paths);
  if (decoder) say(paths.length === 1 && paths[0] === decoder, `decoded by ${paths.join(", ") || "none"}, not ${decoder} alone`);
  if (codec === "av1") say(paths.length > 0 && paths.every((p) => p.startsWith("av1-")), `an AV1 page whose frames were decoded by ${paths.join(", ")}`);
  say(r.status.includes(`client ${CLIENT}`), `the status line does not name client ${CLIENT}: ${r.status}`);
  say(r.status.includes(`view ${VIEW}`), `the status line does not name view ${VIEW}: ${r.status}`);
  say(r.heldStep === "painted 1, sent nothing", `a step to a held frame: ${r.heldStep}, not one paint and nothing sent`);
  say(r.windowStep === "painted 1, uploaded false, sent nothing", `a window change: ${r.windowStep}, not one paint from the texture held and nothing sent`);
  const again = (r.readbacks ?? []).find((b) => b.window);
  say(again && again.uploaded === false, `the last frame under another window: ${JSON.stringify(again)}, not painted without an upload`);
  // In the worker variant the page holds no frame: what reaches it carries no pixel, and the downloader posts it nothing.
  if (VIEW === "worker") say(r.page?.messages > 0 && r.page.pixels === 0 && r.page.fromDownloader === 0, `what reached the page: ${JSON.stringify(r.page)}`);
  for (const f of CLIENTS[CLIENT]) say(r.preloaded.includes(f), `the ${CLIENT} client's ${f} was not preloaded`);
  if (requests) {
    const av1 = requests.filter((l) => /\/av1[^/]*\.js|dav1d/.test(l));
    if (codec !== "av1") say(av1.length === 0, `an HTJ2K page fetched AV1 code: ${av1.join(", ")}`);
    for (const f of CLIENTS[CLIENT]) say(requests.includes(`GET ${f}`), `the ${CLIENT} client's ${f} is not in the request log`);
    // Every page fetches TS's module: the HTML preloads it.
    const wasm = CLIENTS.wasm.filter((f) => requests.includes(`GET ${f}`));
    if (CLIENT === "ts") say(wasm.length === 0, `a ts page fetched the WASM client's code: ${wasm.join(", ")}`);
  }
  for (const b of r.readbacks ?? []) say(!b.error && b.worst === 0, `frame ${b.i} at zoom 1 differs from the CPU reference: ${b.error ?? `worst |Δ| ${b.worst}`}`);
  if (process.argv.includes("--cine")) say(r.cine >= 3, `the cine showed ${r.cine} frames in 1.5 s`);
}

const summary = (name, r) => `${name}, client ${CLIENT}, view ${VIEW}: ${r.received}/${r.n} received, ${r.exact} exact, paths ${JSON.stringify(r.paths)}, renderer ${r.renderer}, ` +
  `${r.fillMs === null ? "on demand" : `fill ${Math.round(r.fillMs)} ms`}, first exact on screen ${Math.round(r.firstShownMs)} ms, readbacks ${(r.readbacks ?? []).map((b) => `${b.i}:${b.worst}`).join(" ")}` +
  `${r.cine !== undefined ? `, cine ${r.cine} frames` : ""}${r.page ? `, page heard ${r.page.messages} messages, ${r.page.pixels} with pixels` : ""}`;

/** A page open on demand across a server restart: its step after the restart must arrive exact. docs/ARCHITECTURE.md §An open page follows a server restart */
async function acrossARestart(url, cmd) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const tab = await browser.newPage();
  tab.on("pageerror", (e) => fail(`page error: ${e.message}`));
  const line = () => tab.textContent("#status");
  const reads = (text, ms) => tab.waitForFunction((t) => document.getElementById("status").textContent.includes(t), text, { timeout: ms })
    .then(() => true, () => false);
  try {
    await tab.goto(`${url}?fill=0`);
    if (!(await reads("received 1, exact 1", 60_000))) return fail(`before the restart: ${await line()}`);
    const restart = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "inherit"], detached: true });
    const up = await started(restart, /transport=/).then(() => true, (e) => fail(`the restart: ${e.message}`));
    try {
      process.kill(-restart.pid, "SIGKILL");
    } catch {
      /* it ended on its own */
    }
    if (!up) return;
    await tab.keyboard.press("ArrowRight");
    const stepped = await reads("received 2, exact 2", 20_000);
    const after = await line();
    console.log(`after the restart: ${after}`);
    if (!stepped || after.includes("error:")) fail(`the step after the restart: ${after}`);
  } finally {
    await browser.close();
  }
}

const runs = [];
if (arg("--restart")) {
  await acrossARestart(arg("--url"), arg("--restart"));
} else if (arg("--url")) {
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
console.log(failures.length ? `viewer check: ${failures.length} failing (${ENGINE}, ${CLIENT}, view ${VIEW})` : `viewer check: every frame complete, exact and drawn (${ENGINE}, ${CLIENT}, view ${VIEW})`);
process.exit(failures.length ? 1 : 0);
