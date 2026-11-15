// One run of R5 (docs/lines/proposals.md §P6, §R5, its amendment): a pair as README §Demo serves it, both sessions and
// the static host's TCP through one lab/scripts/link_impair.py, one fresh headless Chromium; a cold load, then a warm
// one in the same profile; every request the static host answered, per load.
//
//   node lab/proposals/r5_cells.mjs TIP DIR LOSSY_ID --root ROOT --static dev|nginx --link "OPTIONS"
//        [--refuse] [--frames] [--cold-only]
//     ROOT: the page's host root (lab/proposals/r5_arm.sh's, or TIP); --refuse: the lab's refuseWebCodecs;
//     --frames: after the cold fill, step through every frame and keep the overlay's route of each (no warm load)
//   prints one JSON row; times are ms on the page's clock, from navigation
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const [tip, dir, id] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const words = (s) => (s ? s.split(/\s+/).filter(Boolean) : []);
const ROOT = arg("--root", tip);
const STATIC = arg("--static", "dev");
const REFUSE = process.argv.includes("--refuse");
const FRAMES = process.argv.includes("--frames");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const T = mkdtempSync(path.join(tmpdir(), "r5-cells-"));
const children = [];
let nginxConf = null;
// nginx's workers outlive a killed master: it is stopped by its own signal first.
const stop = () => {
  if (nginxConf) spawnSync("nginx", ["-s", "stop", "-c", nginxConf]), (nginxConf = null);
  for (const c of children.splice(0)) c.kill("SIGKILL");
};
process.on("exit", () => { stop(); rmSync(T, { recursive: true, force: true }); });

const lossyMeta = JSON.parse(readFileSync(path.join(dir, `${id}.metadata.json`)));
const exactId = lossyMeta.exactSeries;
const n = lossyMeta.frameCount;
const run = (cmd, args) => {
  const child = spawn(cmd, args, { cwd: tip, stdio: ["ignore", "pipe", "pipe"] });
  child.out = "";
  child.stdout.on("data", (d) => (child.out += d));
  child.stderr.on("data", (d) => (child.out += d));
  children.push(child);
  return child;
};
const started = (child, re) => new Promise((resolve, reject) => {
  const t = setInterval(() => re.test(child.out) && (clearInterval(t), resolve()), 20);
  child.once("exit", (c) => (clearInterval(t), reject(new Error(`exited ${c}: ${child.out}`))));
});

const cert = ["--cert-pem", "server/dev-cert/cert.pem", "--key-pem", "server/dev-cert/key.pem"];
const server = path.join(tip, "target/release/series-server");
const lossy = run(server, ["--port", "4433", "--series", path.join(dir, `${id}.sbnd`), ...cert]);
const exact = run(server, ["--port", "4434", "--series", path.join(dir, `${exactId}.sbnd`), ...cert]);
const transport = readFileSync(path.join(tip, "client/dev-transport.json"), "utf8");
mkdirSync(`${T}/wt`), mkdirSync(`${T}/exact-wt`);
writeFileSync(`${T}/wt/dev-transport.json`, transport.replace(":4433", ":5433"));
writeFileSync(`${T}/exact-wt/dev-transport.json`, transport.replace(":4433", ":5434"));
const relay = run("python3", [path.join(HERE, "../scripts/link_impair.py"), "--udp", "5433:4433", "--udp", "5434:4434",
  "--tcp", "8443:8765", "--tcp-rate", "shared", ...words(arg("--link"))]);
let host;
let requests = () => [];
if (STATIC === "dev") {
  host = run("python3", [path.join(ROOT, "server/dev-server.py"), "--port", "8765", "--log-requests",
    "--metadata", path.join(dir, `${id}.metadata.json`), "--transport", `${T}/wt/dev-transport.json`,
    "--exact-metadata", path.join(dir, `${exactId}.metadata.json`), "--exact-transport", `${T}/exact-wt/dev-transport.json`]);
  await started(host, /port=8765/);
  requests = () => host.out.split("\n").filter((l) => l.startsWith("GET ")).map((l) => ({ path: l.slice(4), bytes: null }));
} else {
  // The deploy template as deploy/check_equivalence.sh --local runs it, its access log on, and /lab/ for the lab gate.
  const conf = readFileSync(path.join(tip, "deploy/nginx/wt-pacs.conf.template"), "utf8")
    .replaceAll("${SERIES}", id).replaceAll("${EXACT_SERIES}", exactId).replaceAll("${TLS_LISTEN}", "")
    .replaceAll("${WT_ORIGINS}", "https://127.0.0.1:5433 https://127.0.0.1:5434")
    .replaceAll("/srv/wt-pacs/wt/", `${T}/wt/`).replaceAll("/srv/wt-pacs/exact-wt/", `${T}/exact-wt/`)
    .replaceAll("/srv/wt-pacs", ROOT).replaceAll("/studies/", `${dir}/`)
    .replace(/listen +8765;/, "listen 127.0.0.1:8765;")
    .replace("    location / { return 404; }", "    location /lab/ { try_files $uri =404; }\n    location / { return 404; }");
  writeFileSync(`${T}/server.conf`, conf);
  mkdirSync(`${T}/tmp`);
  writeFileSync(`${T}/nginx.conf`, `user root;\npid ${T}/nginx.pid;\nerror_log ${T}/error.log error;\nevents {}\nhttp {\n` +
    `  log_format r5 '$request_uri $status $body_bytes_sent';\n  access_log ${T}/access.log r5;\n  default_type application/octet-stream;\n` +
    ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((d) => `  ${d}_temp_path ${T}/tmp;\n`).join("") +
    `  include ${T}/server.conf;\n}\n`);
  host = run("nginx", ["-c", `${T}/nginx.conf`, "-g", "daemon off;"]);
  nginxConf = `${T}/nginx.conf`;
  await new Promise((r) => setTimeout(r, 300));
  requests = () => {
    let s = "";
    try { s = readFileSync(`${T}/access.log`, "utf8"); } catch {}
    return s.split("\n").filter(Boolean).map((l) => { const [p, status, b] = l.split(" "); return { path: p, status: Number(status), bytes: Number(b) }; });
  };
}
await Promise.all([started(lossy, /transport=/), started(exact, /transport=/), started(relay, /READY/)]);

function watch() {
  globalThis.__log = [];
  addEventListener("DOMContentLoaded", () => {
    for (const id of ["quality", "overlay", "status"]) {
      const el = document.getElementById(id);
      new MutationObserver(() => globalThis.__log.push({ t: performance.now(), id, text: el.hidden ? "" : el.textContent,
        frame: Number(document.getElementById("status").textContent.match(/^frame (\d+)/)?.[1]) }))
        .observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    }
  });
}

const dav1d = (rs) => rs.filter((r) => /dav1d/.test(r.path));
const row = { id, exactId, root: ROOT, static: STATIC, link: arg("--link"), refuse: REFUSE, frames: FRAMES };
const url = `http://127.0.0.1:8443/?overlay=1&view=page${REFUSE ? "&opts=" + encodeURIComponent('{"refuseWebCodecs":true}') : ""}`;
const browser = await createRequire(import.meta.url)("playwright").chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.addInitScript(watch);
  const log = () => page.evaluate(() => globalThis.__log);
  const until = async (pred, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(20)) if (pred(await log())) return true;
    return false;
  };
  const status = (l) => l.findLast((e) => e.id === "status")?.text ?? "";
  const load = async () => {
    const seen = requests().length;
    await page.goto(url);
    const out = {};
    const picture = (l) => l.find((e) => e.id === "quality" && e.text);
    await until(picture, 300000);
    out.firstPictureMs = Math.round(picture(await log())?.t) || null;
    // A forced failure leaves frames unfilled: the fill never ends, so that route waits 30 s, not 300.
    out.filled = await until((l) => /fill \d+ ms/.test(status(l)), FRAMES ? 30000 : 300000);
    const all = (await log()).find((e) => e.id === "status" && new RegExp(`received ${n}\\b`).test(e.text));
    out.fillMs = all ? Math.round(all.t) : null;
    out.status = status(await log());
    out.decoders = out.status.match(/decoders: ([^·]*)/)?.[1].trim();
    out.label = (await log()).findLast((e) => e.id === "quality")?.text ?? "";
    await page.waitForTimeout(500);
    out.requests = requests().slice(seen);
    out.dav1dRequests = dav1d(out.requests).map((r) => r.path);
    out.dav1dBytes = dav1d(out.requests).reduce((s, r) => s + (r.bytes ?? 0), 0);
    return out;
  };
  row.cold = await load();
  if (FRAMES) {
    row.routes = [];
    await page.keyboard.press("Home");
    for (let i = 0; i < n; i++) {
      await page.waitForTimeout(150);
      row.routes.push(await page.evaluate(() => [document.getElementById("status").textContent.match(/^frame (\d+)/)?.[1], document.getElementById("overlay").textContent, document.getElementById("status").textContent.match(/error: (.*)$/)?.[1] ?? null]));
      await page.keyboard.press("ArrowRight");
    }
    row.statusAfter = status(await log());
  } else if (!process.argv.includes("--cold-only")) {
    await page.evaluate(() => (globalThis.__log = []));
    row.warm = await load();
  }
} catch (e) {
  row.error = e.message;
} finally {
  await browser.close();
}
await new Promise((done) => (relay.once("exit", done), relay.kill("SIGTERM")));
row.relay = relay.out.trim().split("\n").filter((s) => !/^READY/.test(s));
stop();
console.log(JSON.stringify(row));
process.exit(0);
