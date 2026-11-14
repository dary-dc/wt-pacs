/**
 * D0's hardware-decode probe in headless Chromium through the kit's own host (collector.py), once as written and once
 * per mutant of hwdecode.js's `?mutate=`, each a check that must turn. Software paths only: headless Chromium has
 * no hardware decoder. lab/devices/README.md §The hardware-decode probe
 *
 *   node lab/devices/hwdecode.test.mjs [--out report.json]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codecString, sequence } from "../../client/decode/av1-payload.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../..", import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH ?? "/ms-playwright/chromium-1194/chrome-linux/chrome";
const FLAGS = ["--headless=new", "--no-sandbox", "--no-first-run", ...(process.env.NO_WEBGPU ? [] : ["--enable-unsafe-webgpu"]), "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader"];
const TOKEN = "hwdecode-test-token-0123456789";
const work = mkdtempSync(join(tmpdir(), "hwdecode-"));

const host = spawn("python3", [join(ROOT, "lab/devices/collector.py"), "--studies", work, "--wt", work, "--out", join(work, "rows"),
  "--host", "127.0.0.1", "--port", "0"], { env: { ...process.env, DEVICES_TOKEN: TOKEN }, stdio: ["ignore", "pipe", "inherit"] });
const port = await new Promise((resolve) => host.stdout.on("data", (c) => { const m = /port=(\d+)/.exec(c); if (m) resolve(m[1]); }));

/** The D0 row the page posts, or null. */
function d0() {
  for (const f of readdirSync(join(work, "rows"))) {
    const rows = readFileSync(join(work, "rows", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const r = rows.find((x) => x.run === "D0" || x.run === "error");
    if (r) return r;
  }
  return null;
}

async function probe(mutate) {
  for (const f of readdirSync(join(work, "rows"))) unlinkSync(join(work, "rows", f));
  const dir = mkdtempSync(join(tmpdir(), "hwdecode-chrome-"));
  const url = `http://127.0.0.1:${port}/?t=${TOKEN}&link=wifi&run=D0${mutate ? `&mutate=${mutate}` : ""}`;
  const proc = spawn(CHROME, [...FLAGS, "--enable-logging=stderr", `--user-data-dir=${dir}`, url], { stdio: ["ignore", "ignore", "pipe"], detached: true });
  let log = "";
  proc.stderr.on("data", (c) => (log = (log + String(c).split("\n").filter((l) => /CONSOLE/.test(l)).map((l) => l.replace(/^.*CONSOLE[^"]*/, "")).join("\n") + "\n").slice(-3000)));
  let row = null;
  for (let t = 0; t < Number(process.env.WAIT_S ?? 300) && !row; t++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { row = d0(); } catch {}
  }
  process.kill(-proc.pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  if (row?.run !== "D0") throw new Error(`${mutate ?? "as written"}: no D0 row (${row?.error ?? "none"}); the browser's log ends\n${log}`);
  return row.caps.hardwareDecode;
}

const failures = [];
const claim = (ok, what) => { console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"} ${what}`); if (ok === false) failures.push(what); };
const decoded = (r) => r.cells.filter((c) => c.frame);
const own = (c) => c.copyTo.find((k) => k.format === null);
const judged = (c) => c.copyTo.filter((k) => Array.isArray(k.planes) && k.planes.some((p) => "exact" in p));
const ramps = (r) => decoded(r).filter((c) => c.unit.startsWith("ramp10"));
const paths = (c) => [["webgl2 RGBA16F", c.paint.webgl2.RGBA16F], ["webgl2 RGBA32F", c.paint.webgl2.RGBA32F], ["webgpu", c.paint.webgpu]];

const base = await probe(null);
const units = JSON.parse(readFileSync(join(ROOT, "lab/devices/hw-units.json"))).units;
for (const c of base.cells) {
  const k = c.frame && own(c);
  const paint = c.frame ? paths(c).map(([n, p]) => `${n} ${p?.error ? p.error.message.slice(0, 40) : `${p.distinct} levels, ${p.exact}/${p.of} exact`}`).join("; ") : "";
  console.log(`${c.unit} ${c.acceleration}: supported ${c.isConfigSupported?.supported ?? JSON.stringify(c.isConfigSupported)}, ` +
    `decodes ${c.decodes?.map((d) => d.outcome + (d.error ? ` (${d.error.name}: ${d.error.message})` : "")).join(",") ?? JSON.stringify(c.configure ?? c.error)}` +
    (c.frame ? `; ${c.frame.format}; own copy ${k.ok ? k.planes.map((p) => `${p.plane}${"exact" in p ? (p.exact ? "=" : "≠") : "?"}`).join("") : k.error?.name}; ${paint}` : ""));
}
claim(base.cells.length === units.length * 3 && base.cells.every((c) => c.isConfigSupported && (c.configure || c.error)),
  "every unit × acceleration has its support answer and configure outcome");
claim(base.cells.every((c) => !c.decodes || c.decodes.every((d) => d.outcome === "frame" || d.error || d.outcome === "timeout")),
  "every decode that gave no frame carries its error or a timeout");
claim(decoded(base).every((c) => c.copyTo.length === 24 && c.copyTo.every((k) => k.ok || k.error?.name)),
  "every decoded frame has a copyTo outcome for no format and each of the 23 formats");
claim(base.sourceCheck.every((s) => s.Y && s.U && s.V), "the worker's source planes hash to make_hw_units.py's digests");
claim(base.cells.every((c) => c.config.codec === codecString(sequence(Uint8Array.from(Buffer.from(units.find((u) => u.name === c.unit).unit, "base64"))))),
  "each cell is configured with the client's codec string for its unit");
const soft = decoded(base).filter((c) => c.acceleration === "prefer-software" && own(c).ok);
claim(soft.length > 0 && soft.every((c) => own(c).planes[0].exact), `prefer-software's own copy gives the luma exactly (${soft.map((c) => c.unit).join(", ")})`);

if (process.env.BASE_ONLY) { writeFileSync(arg("--out"), JSON.stringify(base, null, 1)); host.kill(); process.exit(0); }
const plane = await probe("plane");
claim(decoded(plane).flatMap(judged).length > 0 && decoded(plane).every((c) => judged(c).every((k) => k.planes.some((p) => p.exact === false && p.differing >= 1))),
  "mutant plane (one byte of each copy flipped): every judged copy turns inexact");
const expected = await probe("expected");
claim(expected.sourceCheck.every((s) => !s.Y), "mutant expected (wrong digests): the source check fails for every unit");
const codec = await probe("codec");
claim(decoded(codec).length === 0 && codec.cells.every((c) => c.isConfigSupported.supported === false || c.isConfigSupported.error || c.configure?.error || c.decodes?.some((d) => d.error)),
  "mutant codec (an invalid string): no frame, and each cell records why");
const unit = await probe("unit");
claim(unit.cells.every((c) => !c.frame || !own(c).ok || own(c).planes[0].exact === false),
  "mutant unit (half the unit overwritten): no frame comes back exact");
const hang = await probe("hang");
claim(decoded(hang).length > 0 && decoded(hang).every((c) => c.copyTo.find((k) => k.format === "I420P10").error?.name === "hung"
    && c.copyTo.length === 24 && c.copyTo.filter((k) => k.error?.name === "hung").length === 1 && !c.redecode),
  "mutant hang (copyTo to I420P10 never returns): recorded as hung, a fresh worker decodes again, and the later formats keep their outcomes");
const paint = await probe("paint");
const fine = ramps(base).flatMap((c) => paths(c).filter(([, p]) => p?.distinct > 256).map(([n]) => [c.acceleration, n]));
const after = (acc, n) => paths(ramps(paint).find((c) => c.acceleration === acc)).find(([m]) => m === n)[1];
claim(fine.length === 0 ? null : fine.every(([acc, n]) => after(acc, n).distinct <= 256),
  fine.length ? `mutant paint (read back at 8 bits): ${fine.length} paths with more than 256 levels drop to 256 or fewer`
    : "mutant paint: no path here kept more than 256 levels, so this host cannot kill it");

if (arg("--out")) writeFileSync(arg("--out"), JSON.stringify(base, null, 1));
host.kill();
rmSync(work, { recursive: true, force: true });
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exit(failures.length ? 1 : 0);
