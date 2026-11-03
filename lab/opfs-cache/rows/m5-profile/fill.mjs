// M5_ROOT=<a checkout of the M5 run, marks.py applied> CHROME_PATH=... FIREFOX_PATH=... node fill.mjs ENGINE ARM OUT
// One fill with the per-frame stage marks on, no driver: the browser opened on the URL, its console read.
import { spawn, execFileSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdtempSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import path from "node:path";
const ROOT = process.env.M5_ROOT;
const { own, started } = await import(`${ROOT}/lab/opfs-cache/browser.mjs`);
const [ENGINE, ARM, OUT] = process.argv.slice(2);
const WORK = `${ROOT}/lab/opfs-cache/work`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const name = "3328x4096-80", meta = `/lab/opfs-cache/work/${name}.json`, sha = "/lab/opfs-cache/work/sha-3328x4096.json";
const certDir = mkdtempSync(`${WORK}/cert-`);
const [key, pem] = [`${certDir}/key.pem`, `${certDir}/cert.pem`];
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", key, "-out", pem, "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
const hash = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: execFileSync("openssl", ["x509", "-in", pem, "-outform", "DER"]) }).toString().split(" ")[0];
const s = createSocket("udp4"); await new Promise((r) => s.bind(0, "127.0.0.1", r)); const port = s.address().port; await new Promise((r) => s.close(r));
const server = own(`${ROOT}/target/release/series-server`, ["--port", String(port), "--bind", "127.0.0.1", "--series", `${WORK}/${name}.sbnd`, "--cert-pem", pem, "--key-pem", key]);
await started(server, "stdout", /transport=/);
const http = own("python3", [`${ROOT}/server/dev-server.py`, "--port", "0"]);
const [, hp] = await started(http, "stdout", /port=(\d+)/);
const origin = `http://127.0.0.1:${hp}`, wt = `https://127.0.0.1:${port}/`;
const url = ARM === "today" ? `${origin}/?${new URLSearchParams({ wt, hash, metadata: meta })}` : `${origin}/lab/opfs-cache/arms.html?${new URLSearchParams({ wt, hash, metadata: meta, sha, arm: ARM })}`;
const dir = mkdtempSync(`${WORK}/profile-prof-`);
let child;
if (ENGINE === "firefox") {
  writeFileSync(path.join(dir, "user.js"), Object.entries({ "browser.shell.checkDefaultBrowser": false, "dom.quotaManager.temporaryStorage.fixedLimit": 4096 * 5 * 1024,
    "browser.cache.disk.enable": false, "browser.sessionstore.resume_from_crash": false, "devtools.console.stdout.content": true })
    .map(([k, v]) => `user_pref("${k}", ${JSON.stringify(v)});`).join("\n") + "\n");
  child = own(process.env.FIREFOX_PATH, ["--no-remote", "--profile", dir, url], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DISPLAY: ":99" } });
} else {
  child = own(process.env.CHROME_PATH, ["--headless=new", "--no-sandbox", "--no-first-run", `--user-data-dir=${dir}`, "--window-size=1024,768",
    "--enable-logging=stderr", "--v=0", url], { stdio: ["ignore", "pipe", "pipe"] });
}
let out = "";
const log = createWriteStream(OUT + ".log");
for (const st of [child.stdout, child.stderr]) st.on("data", (d) => { out += d; log.write(d); });
const want = (re) => (out.match(re) ?? []).length;
const t0 = Date.now();
// the fill's 80 frames decoded, and under today its store's 80 writes too, or 120 s
while (Date.now() - t0 < 120000 && !(want(/PROF \{"who":"(arm|today)"/g) >= 80 && (ARM !== "today" || want(/PROF \{"who":"store"/g) >= 80 || Date.now() - t0 > 60000))) await sleep(200);
await sleep(500);
process.kill(-child.pid, "SIGKILL");
log.end();
const rows = out.split("\n").filter((l) => l.includes("PROF {")).map((l) => { const t = l.slice(l.indexOf("PROF {") + 5); try { return JSON.parse(t.slice(0, t.indexOf("}") + 1).replace(/\\"/g, '"')); } catch { return null; } }).filter(Boolean);
writeFileSync(OUT, rows.map((r) => JSON.stringify({ engine: ENGINE, arm: ARM, ...r })).join("\n") + "\n");
console.log(ENGINE, ARM, rows.length, "marks");
rmSync(dir, { recursive: true, force: true });
process.exit(0);
