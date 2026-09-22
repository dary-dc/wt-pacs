/**
 * LF: none · a warm-up of the wrong shape · a warm-up of the series' own, against each other on
 * both shapes. One fresh page and one fresh session per visit; the arm order rotates every round,
 * so a drift in the host lands on all three alike. docs/decode/README.md §Warming the decoders
 *
 *   NODE_PATH=$(npm root -g) CHROME_PATH=... node lab/decoder-warmup/run.mjs [rounds]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 12);
const FRAMES = Number(process.env.FRAMES || 12);
/** Each set's own shape; the other set's file is the mismatched arm. */
const WARMUP = {
  cine512: "/client/downloader/warmup/colour-8.j2c",
  g512: "/client/downloader/warmup/grey-16.j2c",
};
const SETS = (process.env.SETS || "cine512,g512").split(",");
const ARMS = ["none", "mismatch", "match"];
const METRICS = ["d0", "d1", "d2", "first_ms", "fill_ms"];

const port = () => 30000 + ((Math.random() * 20000) | 0);
const T = fs.mkdtempSync(path.join(os.tmpdir(), "lf-"));
const kids = [];
const start = (cmd, args, out) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", out, out] });
  kids.push(p);
  return p;
};
process.on("exit", () => {
  for (const p of kids) p.kill();
  fs.rmSync(T, { recursive: true, force: true });
});

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
const BIN = path.join(ROOT, process.env.CARGO_TARGET_DIR || "target", "release");
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout ${T}/key.pem -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null`]);
const hash = execFileSync("bash", [
  "-c",
  `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`,
]).toString().trim();

const wt = {};
for (const set of SETS) {
  const src = path.join(ROOT, "lab/fixtures", `decode_${set}`);
  const codestreams = fs.readdirSync(src).filter((f) => f.endsWith(".j2c")).sort();
  if (!codestreams.length) throw new Error(`no codestreams in ${src} — lab/scripts/gen_htj2k_fixtures.sh`);
  fs.mkdirSync(path.join(T, set, "frames"), { recursive: true });
  for (let i = 0; i < FRAMES; i++) {
    fs.copyFileSync(
      path.join(src, codestreams[i % codestreams.length]),
      path.join(T, set, "frames", `${String(i).padStart(3, "0")}.htj2k`),
    );
  }
  const meta = JSON.parse(fs.readFileSync(path.join(src, "metadata.json"), "utf8"));
  fs.writeFileSync(path.join(T, set, "metadata.json"), JSON.stringify({ ...meta, frameCount: FRAMES }));
  execFileSync(path.join(BIN, "pack-study"), [
    "--metadata", path.join(T, set, "metadata.json"),
    "--frames", path.join(T, set, "frames"),
    "--output", path.join(T, set, "study.sbnd"),
  ]);
  const p = port();
  start(path.join(BIN, "exact-server"), [
    "--port", String(p), "--study", path.join(T, set, "study.sbnd"),
    "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem"),
  ], fs.openSync(path.join(T, `server-${set}.log`), "a"));
  wt[set] = `https://127.0.0.1:${p}/`;
}

const TCP = port();
start("python3", ["server/dev-server.py", "--port", String(TCP)], fs.openSync(path.join(T, "static.log"), "a"));
await new Promise((r) => setTimeout(r, 2000));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--disable-background-networking", "--ignore-certificate-errors-spki-list"],
});

const rows = [];
async function visit(set, arm) {
  const warmup = arm === "none" ? "" : WARMUP[arm === "match" ? set : SETS.find((s) => s !== set) ?? set];
  const page = await browser.newPage();
  let err = null;
  page.on("pageerror", (e) => (err = e.message));
  const url = `http://127.0.0.1:${TCP}/lab/decoder-warmup/index.html?set=${set}&frames=${FRAMES}` +
    `&warmup=${encodeURIComponent(warmup)}&wt=${encodeURIComponent(wt[set])}&hash=${hash}`;
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 120000 });
  const out = await page.evaluate(() => globalThis.__wtpacsResult);
  await page.close();
  if (err || out.error) throw new Error(err || out.error);
  if (out.delivered !== FRAMES) throw new Error(`${out.delivered}/${FRAMES} frames`);
  return { d0: out.decode_ms[0], d1: out.decode_ms[1], d2: out.decode_ms[2], ...out };
}

for (const set of SETS) {
  await visit(set, "none").catch((e) => process.stderr.write(`${set} warm visit: ${e.message}\n`));
  for (let round = 0; round < ROUNDS; round++) {
    for (let k = 0; k < ARMS.length; k++) {
      const arm = ARMS[(round + k) % ARMS.length];
      try {
        rows.push({ set, arm, round, ...(await visit(set, arm)) });
      } catch (e) {
        process.stderr.write(`${set} ${arm} round ${round}: ${e.message.split("\n")[0]}\n`);
      }
    }
  }
  process.stderr.write(`${set} done\n`);
}

fs.writeFileSync(path.join(ROOT, process.env.OUT || path.join(T, "rows.jsonl")),
  rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const cell = (set, arm) => rows.filter((r) => r.set === set && r.arm === arm);

console.log(`\nframes ${FRAMES}, rounds ${ROUNDS}, three arms interleaved inside every round`);
for (const set of SETS) {
  const none = new Map(cell(set, "none").map((r) => [r.round, r]));
  console.log(`\n${"set " + set} (${WARMUP[set]})`);
  console.log(`${"arm".padEnd(9)} ${"metric".padEnd(9)} ${"n".padStart(3)} ${"median".padStart(8)} ` +
    `${"min".padStart(8)} ${"max".padStart(8)} ${"wins vs none".padStart(13)}`);
  for (const arm of ARMS) {
    const got = cell(set, arm);
    for (const m of METRICS) {
      const v = got.map((r) => r[m]).filter((x) => x != null);
      if (!v.length) continue;
      const paired = arm === "none" ? [] : got.filter((r) => none.has(r.round));
      const wins = paired.filter((r) => r[m] < none.get(r.round)[m]).length;
      console.log(`${arm.padEnd(9)} ${m.padEnd(9)} ${String(v.length).padStart(3)} ` +
        `${median(v).toFixed(2).padStart(8)} ${Math.min(...v).toFixed(2).padStart(8)} ` +
        `${Math.max(...v).toFixed(2).padStart(8)} ` +
        `${(arm === "none" ? "—" : `${wins}/${paired.length}`).padStart(13)}`);
    }
  }
  const digests = new Set(cell(set, "none").concat(cell(set, "match"), cell(set, "mismatch")).map((r) => r.digest));
  console.log(`pixels: ${digests.size === 1 ? "identical on every arm and every round" : `DIFFER — ${digests.size} distinct digests`}`);
}

process.exit(0);
