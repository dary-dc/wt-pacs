/**
 * What enc.mjs and h2.mjs share: a study behind exact-server, a certificate the browser trusts, nginx
 * on a generated config, and a browser whose process tree the CPU throttle can find.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const T = fs.mkdtempSync(path.join(os.tmpdir(), "host-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const FRAMES = 12;
const kids = [];
const cleanups = [];
export const onExit = (fn) => cleanups.push(fn);
process.on("exit", () => {
  for (const p of kids) p.kill();
  for (const fn of cleanups) fn();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  fs.rmSync(T, { recursive: true, force: true });
});
export const port = () => 30000 + ((Math.random() * 20000) | 0);

export function start(cmd, args) {
  const out = fs.openSync(path.join(T, `${path.basename(cmd)}.log`), "a");
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", out, out] });
  kids.push(p);
  return p;
}

/** A file an hour old, as a deployed one would be: one written seconds ago gets no heuristic freshness (rig-limits.md §6). */
export function aged(file) {
  const then = new Date(Date.now() - 3600e3);
  fs.utimesSync(file, then, then);
}

/** A 12-frame colour study behind exact-server, and the transport config pointing the page at it. */
export function study() {
  execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
  const bin = path.join(ROOT, process.env.CARGO_TARGET_DIR || "target", "release");
  execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -keyout ${T}/key.pem -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' \
    -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
    -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null \
    && mkdir -p ${T}/home/.pki/nssdb && certutil -N -d sql:${T}/home/.pki/nssdb --empty-password \
    && certutil -A -d sql:${T}/home/.pki/nssdb -n page -t P,, -i ${T}/cert.pem`]);
  const hash = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`])
    .toString().trim();
  fs.mkdirSync(path.join(T, "frames"));
  const src = path.join(ROOT, "lab/fixtures/decode_c512");
  const codestreams = fs.readdirSync(src).filter((f) => f.endsWith(".j2c")).sort();
  if (!codestreams.length) throw new Error(`no codestreams in ${src} — lab/scripts/gen_htj2k_fixtures.sh c512`);
  for (let i = 0; i < FRAMES; i++) {
    fs.copyFileSync(path.join(src, codestreams[i % codestreams.length]), path.join(T, "frames", `${String(i).padStart(3, "0")}.htj2k`));
  }
  fs.writeFileSync(path.join(T, "study.json"), JSON.stringify({ frameCount: FRAMES }));
  execFileSync(path.join(bin, "pack-study"), ["--metadata", path.join(T, "study.json"), "--frames", path.join(T, "frames"),
    "--output", path.join(T, "study.sbnd")]);
  const wt = port();
  start(path.join(bin, "exact-server"), ["--port", String(wt), "--study", path.join(T, "study.sbnd"),
    "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem")]);
  fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${wt}/`, cert_sha256: hash }) + "\n");
  aged(CFG);
  return { cfg: CFG, cert: path.join(T, "cert.pem") };
}

/** nginx on `servers`, a string of `server { }` blocks. */
export async function nginx(servers) {
  fs.writeFileSync(path.join(T, "nginx.conf"), `pid ${T}/nginx.pid;\nerror_log ${T}/nginx-error.log error;\nevents {}\n` +
    `http {\n  access_log off;\n` +
    ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((d) => `  ${d}_temp_path ${T};\n`).join("") + servers + "\n}\n");
  start("nginx", ["-c", path.join(T, "nginx.conf"), "-g", "daemon off;"]);
  await new Promise((r) => setTimeout(r, 1500));
}
export const tls = (p, http2) => `listen 127.0.0.1:${p} ssl${http2 ? " http2" : ""};
    ssl_certificate ${T}/cert.pem;
    ssl_certificate_key ${T}/key.pem;`;

/** A browser that trusts the certificate through its own NSS store: one that ignores the error caches nothing. */
export async function browser() {
  const server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    args: ["--disable-background-networking"],
    env: { ...process.env, HOME: `${T}/home` },
  });
  const b = await chromium.connect(server.wsEndpoint());
  return { server, browser: b, cdp: await b.newBrowserCDPSession() };
}

/** The trace's events while `fn` runs, every process and thread. */
export async function traced(cdp, categories, fn) {
  const events = [];
  const collect = (d) => events.push(...(d.value ?? []));
  cdp.on("Tracing.dataCollected", collect);
  await cdp.send("Tracing.start", { categories, transferMode: "ReportEvents" });
  const out = await fn();
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", collect);
  return { out, events };
}

export const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
