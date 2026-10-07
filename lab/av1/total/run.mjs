/**
 * TOTAL: a whole series filled through the downloader, wire plus decode, every arm of a series on
 * the same link and CPU: HTJ2K, AV1 intra through dav1d-WASM and WebCodecs, the splits, one group,
 * a lossy preview, row LLSIZE's codings (TOTAL2), a layer-major scalable series (BASES), row ENCX's (TOTAL3),
 * the order the frames are asked in (ORDER), loss and jitter and asks after a partial fill (LOSSLINK). Fixed rates and
 * phone-like profiles behind the relay, headless Chromium at 1× and 4×. Every visit is its own server, relay and browser;
 * (set × link × impairment × throttle) cells in a Williams order each round, the arms inside each cell the same way.
 * lab/av1/total/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs [--rounds 10] [--first-round 0]
 *     [--links r5000,r20000,r50000,lte-good,wifi-home] [--impairs clean,l1,j5] [--throttles 1,4] [--sets a,b] [--arms a,b]
 *     [--fill N --asks-after K] [--frames lab/.av1-work/total] [--orders seq,prio] [--mutate sample|truth] [--out rows.jsonl]
 *     [--summary [--ref htj2k]]
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const FIRST = Number(arg("--first-round", 0));
const LINKS = arg("--links", "r5000,r20000,r50000,lte-good,wifi-home").split(",");
const IMPAIRS = arg("--impairs", "clean").split(",");
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
/** Frames 0 … FILL−1 filled, then FILL … FILL+AFTER−1 asked one at a time; FILL absent is the whole series. */
const FILL = arg("--fill", null);
const AFTER = Number(arg("--asks-after", 0));
const FRAMES = arg("--frames", "lab/.av1-work/total");
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const REF = arg("--ref", "htj2k");
const ORDERS = arg("--orders", "seq").split(",");
const ROOT = new URL("../../..", import.meta.url).pathname;
const T = mkdtempSync(path.join(tmpdir(), "av1-total-"));
const port = () => 20000 + ((Math.random() * 25000) | 0);
/** The relay times the link and anything that preempts it reads as jitter: it has a core to itself. */
const RIG_CORE = arg("--rig-core", "3");
const BROWSER_CORES = arg("--browser-cores", "0-2");
const TRACES = process.env.TRACES ?? path.join(homedir(), ".cache/wtpacs-traces");

/** Mahimahi's trace, fetched for local use only (GPL-3.0); its hash as PROF recorded it. */
const LTE = { file: "TMobile-LTE-short.down", sha256: "4f33dce8dd811b5702272af64aaf64d3913719919abd776edf1e0f7c0965da43" };
/** Gilbert–Elliott in percent, bursts of 3.5 packets on average, as profile_cells.sh. */
const ge = (mean) => { const r = 100 / 3.5, m = mean / 100; return ["--loss-model", "ge", "--ge-p", (m * r / (1 - m)).toFixed(5), "--ge-r", r.toFixed(4)]; };
/**
 * One way ms and the relay's link: PROF's profiles without their neighbour or outage. An impairment
 * `l<percent>` is loss each way, iid on a fixed rate and in the profile's bursts on a profile;
 * `j<ms>` is ± that jitter each way, in sequence as one radio leg delivers (docs/rig-limits.md §3).
 */
function link(name, impairment = "clean") {
  const loss = impairment[0] === "l" ? Number(impairment.slice(1)) : 0;
  const jitter = impairment[0] === "j" ? ["--jitter-ms", impairment.slice(1), "--jitter-mode", "ordered"] : [];
  if (impairment !== "clean" && !loss && !jitter.length) throw new Error(`unknown impairment ${impairment}`);
  if (name.startsWith("r")) return [20, ["--rate-kbit", name.slice(1), "--queue-pkts", "200", ...(loss ? ["--loss", String(loss)] : []), ...jitter]];
  if (name === "lte-good") return [25, ["--trace", path.join(TRACES, LTE.file), ...ge(loss || 0.01), "--queue-ms", "500", ...jitter]];
  if (name === "wifi-home") return [15, ["--trace", `${T}/wifi-home.trace`, ...ge(loss || 0.5), "--queue-ms", "300", ...jitter]];
  throw new Error(`unknown link ${name}`);
}

const sha256 = (file) => new Promise((resolve) => {
  const h = createHash("sha256");
  createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex")));
});
if (LINKS.includes("lte-good")) {
  mkdirSync(TRACES, { recursive: true });
  const file = path.join(TRACES, LTE.file);
  if (!existsSync(file)) execFileSync("curl", ["-sSfL", "-o", file, `https://raw.githubusercontent.com/ravinet/mahimahi/master/traces/${LTE.file}`]);
  if ((await sha256(file)) !== LTE.sha256) throw new Error(`${file}: not the trace PROF measured`);
}
writeFileSync(`${T}/wifi-home.trace`, execFileSync("python3", [path.join(ROOT, "lab/scripts/gen_step_trace.py"),
  "15000:12000", "40000:12000", "10000:12000", "30000:12000", "15000:12000"]));

const DAV1D = { codec: "av1", glue: "/lab/.av1-build/out/simd.js", wasm: "/lab/.av1-build/out/simd.wasm", dir: "/lab/.av1-build/out" };
const OPENJPH = { glue: "/lab/decode-bench/vendor/openjph/openjphjs.js", wasm: "/lab/decode-bench/vendor/openjph/openjphjs.wasm", dir: "/lab/decode-bench/vendor/openjph" };
/** What the store holds for an arm, and what connect is told: the product's own decoder choice. */
function arm(set, name) {
  const a = set.arms[name];
  const ext = a.ext ?? (name === "wc" ? "av1" : name);
  if (name === "htj2k" || a.codec === "htj2k" || a.downloader) {
    // A layered HTJ2K series (lab/av1/reslevel): F prefixes, then F rests.
    const layered = a.layers && { layers: a.layers, frames: set.frames, level: a.level };
    return { ext: a.ext ?? (a.layers ? name : "htj2k"), codec: "htj2k", entries: set.frames * (a.layers ?? 1), previewTruth: a.previewTruth,
      opts: { decoder: { ...OPENJPH, ...layered }, ...(a.worker && { decoderWorker: a.worker }),
        // Row ASKDEADLINE: the downloader's survival deadlines, and a transport that reports its silences.
        ...(a.survival !== undefined && { survival: a.survival }), ...(a.transport && { transport: a.transport }),
        // A `downloader` arm runs that revision of the downloader (row CLIENT).
        ...(a.downloader && { worker: a.downloader, decoderWorker: a.decoder }) } };
  }
  const decoder = { ...DAV1D, ...(a.split && { split: a.split }), ...(a.depth && { depth: a.depth }), ...(a.offset && { offset: a.offset }),
    ...(a.rct && { rct: true }), ...(a.mixed && { mixed: true }), ...(a.layers && { layers: a.layers, frames: set.frames }) };
  const entries = set.frames * (a.layers ?? 1);
  // A layer-major series decodes in lab/av1/bases' worker: the product's has no base entry.
  const worker = a.layers ? { decoderWorker: "/lab/av1/bases/decoder.js" } : a.worker && { decoderWorker: a.worker };
  return { ext, entries, opts: { decoder, ...worker, ...(a.group && { groupLength: a.group, frameCount: entries }) },
    truth: a.truth, previewTruth: a.previewTruth };
}

const sets = readdirSync(path.join(ROOT, FRAMES)).filter((d) => existsSync(path.join(ROOT, FRAMES, d, "arms.json")))
  .map((d) => JSON.parse(readFileSync(path.join(ROOT, FRAMES, d, "arms.json"), "utf8")))
  .filter((s) => arg("--sets", s.name).split(",").includes(s.name));
const ARMS = arg("--arms", null)?.split(",");
for (const s of sets) s.armNames = Object.keys(s.arms).filter((a) => !ARMS || ARMS.includes(a));

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT, stdio: "inherit" });
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
  "-keyout", `${T}/key.pem`, "-out", `${T}/cert.pem`, "-days", "2", "-nodes", "-subj", "/CN=localhost",
  "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
const der = execFileSync("openssl", ["x509", "-in", `${T}/cert.pem`, "-outform", "DER"]);
const HASH = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: der }).toString().split(" ")[0];

/** One study per (set × stored form): the store holds a frame's bytes whatever made them. */
function pack(set, ext, entries, codec = ext === "htj2k" ? "htj2k" : "av1") {
  const dir = `${T}/${set.name}-${ext}`;
  if (existsSync(`${dir}.sbnd`)) return `${dir}.sbnd`;
  mkdirSync(dir);
  for (let i = 0; i < entries; i++) {
    const n = String(i).padStart(3, "0");
    symlinkSync(path.join(ROOT, FRAMES, set.name, `${n}.${ext}`), `${dir}/${n}.${codec}`);
  }
  writeFileSync(`${dir}.json`, JSON.stringify({ frameCount: entries, codec }));
  execFileSync(path.join(ROOT, "target/release/pack-study"),
    ["--metadata", `${dir}.json`, "--frames", dir, "--output", `${dir}.sbnd`], { stdio: "ignore" });
  return `${dir}.sbnd`;
}

const CHROME = process.env.CHROME_PATH || chromium.executablePath();
writeFileSync(`${T}/chrome.sh`, `#!/bin/sh\nexec taskset -c ${BROWSER_CORES} "${CHROME}" "$@"\n`, { mode: 0o755 });

const HTTP = port();
const http = spawn("python3", ["server/dev-server.py", "--port", String(HTTP)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const started = (child, re) => new Promise((resolve, reject) => {
  let out = "";
  child.stdout.on("data", (d) => { out += d; if (re.test(out)) resolve(); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});

async function visit(set, variant, linkName, impairment, throttle, round) {
  const [armName, orderName = "seq"] = variant.split("@");
  const a = arm(set, armName);
  const fill = Number(FILL ?? a.entries);
  if (fill + AFTER > a.entries || (AFTER && (a.opts.groupLength || a.opts.decoder.layers))) throw new Error(`${set.name} ${armName}: ${fill} + ${AFTER} asks`);
  const need = useful(set);
  const flip = (t) => (MUTATE === "truth" ? t.replace(/^./, (c) => (c === "0" ? "1" : "0")) : t);
  const truth = (a.truth ?? set.truth).map(flip);
  const previewTruth = a.previewTruth?.map(flip);
  const srv = port();
  const relayPort = port();
  const server = spawn("taskset", ["-c", BROWSER_CORES, path.join(ROOT, "target/release/exact-server"), "--port", String(srv), "--bind", "127.0.0.1",
    "--study", pack(set, a.ext, a.entries, a.codec), "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], { stdio: "ignore" });
  const [oneWay, linkArgs] = link(linkName, impairment);
  const relay = spawn("chrt", ["-f", "50", "taskset", "-c", RIG_CORE, "python3", "lab/scripts/link_impair.py", "--udp", `${relayPort}:${srv}`,
    "--seed", String(round), "--delay-ms", String(oneWay), ...linkArgs, "--self-timing"], { cwd: ROOT });
  let relayLog = "";
  relay.stdout.on("data", (d) => (relayLog += d));
  relay.stderr.on("data", (d) => (relayLog += d));
  await new Promise((r) => setTimeout(r, 500));
  if (!/READY/.test(relayLog)) await started(relay, /READY/);

  const browser = await chromium.launchServer({ executablePath: `${T}/chrome.sh` });
  const client = await chromium.connect(browser.wsEndpoint());
  const page = await client.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stop = throttleTree(browser.process().pid, throttle);
  const q = new URLSearchParams({ opts: JSON.stringify(a.opts), fill, after: AFTER, wt: `https://127.0.0.1:${relayPort}/`, hash: HASH,
    ...(orderName === "prio" ? { asks: need.join(",") } : {}), ...(MUTATE === "sample" ? { mutate: "sample" } : {}) });
  let r = null;
  try {
    await page.goto(`http://127.0.0.1:${HTTP}/lab/av1/total/index.html?${q}`);
    await page.waitForFunction(() => globalThis.__result, null, { timeout: 600000, polling: 200 });
    r = await page.evaluate(() => globalThis.__result);
    if (r.error) throw new Error(r.error);
  } catch (e) {
    errors.push(String(e.message).split("\n")[0]);
    r = null;
  }
  stop();
  await client.close();
  await browser.close();
  const exited = new Promise((res) => relay.once("exit", res));
  relay.kill("SIGTERM");
  await exited;
  server.kill();

  const late = relayLog.match(/self-timing packets \d+ late p50 [\d.]+ p99 ([\d.]+)/g)?.pop();
  const s2c = relayLog.match(/server->client sent (\d+) lost (\d+)/)?.slice(1).map(Number);
  const row = { round, set: set.name, arm: variant, link: linkName, impairment, throttle, owed: fill + AFTER, s2c, errors, relayP99: late ? Number(late.split(" p99 ")[1]) : null,
    void: !late || /VOID/.test(relayLog) };
  if (!r?.frames.length) return { ...row, frames: 0, exact: 0, failure: r?.failures[0]?.reason };
  const t = (k, f) => f(...r.frames.map((x) => x[k])) - r.issuedAt;
  // A frame's first picture: its base when one came before its exact frame.
  const shown = new Map(r.frames.map((f) => [f.i, f.page]));
  for (const p of r.previews ?? []) if (!p.late) shown.set(p.i, Math.min(shown.get(p.i) ?? Infinity, p.page));
  // A layered arm owes one preview a frame, and exact frames only under frame indices.
  const previews = previewTruth ? {
    previews: r.previews.length,
    strays: r.frames.filter((f) => !(f.i >= 0 && f.i < set.frames)).length,
    late: r.previews.filter((p) => p.late).length,
    previewExact: r.previews.filter((p) => r.previewSha[p.i] === previewTruth?.[p.i]).length,
    firstMs: Math.round(Math.min(...shown.values()) - r.issuedAt),
    firstExactMs: Math.round(t("page", Math.min)),
    shownMs: Math.round(Math.max(...shown.values()) - r.issuedAt),
  } : {};
  return {
    ...row,
    frames: r.frames.length,
    failures: r.failures.length,
    failure: r.failures[0]?.reason,
    exact: [...r.frames, ...r.after].filter((f) => r.sha[f.i] === truth[f.i]).length,
    afterMs: r.after.map((f) => Math.round(f.ms)),
    resumes: r.resumes,
    survived: r.quiet?.filter((q) => q.survived).map((q) => Math.round(q.survived)),
    closedAfter: r.quiet?.filter((q) => q.closedAfter).map((q) => Math.round(q.closedAfter)),
    firstMs: Math.round(t("page", Math.min)),
    receivedMs: Math.round(t("lastByte", Math.max)),
    decodedMs: Math.round(t("page", Math.max)),
    centreMs: Math.round(shown.get(need[0]) - r.issuedAt),
    usefulMs: Math.round(Math.max(...need.map((i) => shown.get(i) ?? Infinity)) - r.issuedAt),
    ...previews,
  };
}

/** The frames a reader needs first, most needed first. lab/av1/total/README.md §Row ORDER */
function useful(set) {
  if (/^(ffdm|syn2d)_/.test(set.name)) return [2, 3];
  const c = set.frames >> 1;
  return [c, c - 1, c + 1, c - 2, c + 2];
}
/** `seq` fills every frame; `prio` asks the useful ones first, then fills. */
const variants = (set) => set.armNames.flatMap((a) => ORDERS.map((o) => (o === "seq" ? a : `${a}@${o}`)));

const cells = sets.flatMap((s) => LINKS.flatMap((l) => IMPAIRS.flatMap((impairment) => THROTTLES.map((throttle) => ({ set: s.name, link: l, impairment, throttle })))));
const rows = [];
for (let round = FIRST; round < FIRST + ROUNDS && !process.argv.includes("--summary"); round++) {
  for (const [k, { set: name, link: l, impairment, throttle }] of order(cells, round).entries()) {
    const set = sets.find((s) => s.name === name);
    let prev = null;
    for (const a of order(variants(set), round + k)) {
      const row = { ...(await visit(set, a, l, impairment, throttle, round)), prev };
      prev = a;
      rows.push(row);
      if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.error(`round ${round} ${name} ${l} ${impairment} ${throttle}x ${a}: first ${row.firstMs} useful ${row.usefulMs} received ${row.receivedMs} decoded ${row.decodedMs} ms,` +
        ` exact ${row.exact}/${row.owed}${row.afterMs?.length ? `, asks after ${row.afterMs.join(" ")} ms` : ""}${row.previews !== undefined ? `, every frame shown ${row.shownMs} ms, previews ${row.previewExact}/${set.frames} as native, ${row.late} late, ${row.strays} stray` : ""}, relay p99 ${row.relayP99}${row.void ? " VOID" : ""}${row.errors.length ? " " + row.errors[0] : ""}${row.failure ? " " + row.failure : ""}`);
    }
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const span = (a) => `${med(a).toFixed(0)} [${Math.min(...a)}–${Math.max(...a)}]`;
if (OUT) rows.splice(0, rows.length, ...readFileSync(OUT, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
for (const r of rows) r.impairment ??= "clean";
const kept = rows.filter((r) => !r.void && r.frames);
const quantile = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))];
console.log("ms from the fill's issue: first frame on the page, every frame on the page — median [min–max], n kept; " +
  `÷ ${REF} on every frame, median of rounds paired; frames exact over every visit`);
for (const { set: name, link: l, impairment, throttle } of cells) {
  const set = sets.find((s) => s.name === name);
  const of = (a, from = kept) => from.filter((r) => r.set === name && r.link === l && r.impairment === impairment && r.throttle === throttle && r.arm === a);
  const ref = new Map(of(REF).map((r) => [r.round, r.decodedMs]));
  const parts = variants(set).map((a) => {
    const rs = of(a);
    const all = of(a, rows);
    const exact = `${all.reduce((n, r) => n + r.exact, 0)}/${all.reduce((n, r) => n + (r.owed ?? set.frames), 0)}`;
    if (!rs.length) return `${a} none kept, exact ${exact}`;
    let s = `${a} first ${span(rs.map((r) => r.firstMs))}`;
    if (ORDERS.length > 1) s += ` centre ${span(rs.map((r) => r.centreMs))} useful ${span(rs.map((r) => r.usefulMs))}`;
    if (rs[0].previews !== undefined) s += ` shown ${span(rs.map((r) => r.shownMs))} previews ${all.reduce((n, r) => n + (r.previewExact ?? 0), 0)}/${all.length * set.frames} as native`;
    s += ` all ${span(rs.map((r) => r.decodedMs))} n=${rs.length} exact ${exact}`;
    const after = rs.flatMap((r) => r.afterMs ?? []);
    if (after.length) s += ` ask p50 ${quantile(after, 0.5)} p95 ${quantile(after, 0.95)} max ${Math.max(...after)} (${after.length})`;
    if (rs[0].resumes !== undefined) {
      const survived = rs.flatMap((r) => r.survived ?? []);
      s += ` failed ${all.reduce((n, r) => n + (r.failures ?? 0), 0)}, resumed ${rs.reduce((n, r) => n + r.resumes, 0)} in ${rs.filter((r) => r.resumes).length}` +
        `, silences survived ≥ 1 s ${survived.length} (≥ 3 s ${survived.filter((g) => g >= 3000).length}, max ${survived.length ? Math.max(...survived) : 0} ms)`;
    }
    const d = rs.filter((r) => a !== REF && ref.has(r.round)).map((r) => r.decodedMs / ref.get(r.round));
    if (d.length) s += ` ×${med(d).toFixed(2)} (slower ${d.filter((x) => x > 1).length}/${d.length})`;
    const seq = new Map(of(a.split("@")[0]).map((r) => [r.round, r]));
    const p = rs.filter((r) => a.includes("@") && seq.has(r.round));
    if (p.length) s += ` useful ×${med(p.map((r) => r.usefulMs / seq.get(r.round).usefulMs)).toFixed(2)}` +
      ` all ×${med(p.map((r) => r.decodedMs / seq.get(r.round).decodedMs)).toFixed(3)} of seq (n=${p.length})`;
    return s;
  });
  console.log(`${name} ${l}${impairment === "clean" ? "" : ` ${impairment}`} ${throttle}x: ${parts.join(" · ")}`);
}
console.log(`VOID, dropped: ${rows.filter((r) => r.void).length} of ${rows.length}`);
process.exit(0);
