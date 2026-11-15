// The rig's driver, Chromium by raw CDP: one load per row, its ending, the wait, then what reached the sink, read by
// the read tool (report-plan.md §7.2–§7.3). Smoke here: the contract's grey-16 frame as a 32-frame series, not
// dbts_c1; D6 (the link drop under --tun) is not wired.
// node lab/report-arms/run.mjs --arms off,stub --timing Y --endings D1,D2 [--mutant M] [--wait 60] --out rows.jsonl
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { startSink } from "./sink.mjs";
import { readLines, byLoad } from "./read.mjs";
import * as cdp from "./cdp.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const WORK = join(ROOT, "lab/.report-work");
const FRAMES = 32;
const AT = 10;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function series() {
  const d = join(WORK, "series");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const base = join(ROOT, "client/contract/frames/grey-16");
  const digest = readFileSync(`${base}.xxh3`, "utf8").trim();
  for (let i = 0; i < FRAMES; i++) symlinkSync(`${base}.j2c`, join(d, `${String(i).padStart(3, "0")}.htj2k`));
  writeFileSync(join(d, "metadata.json"), JSON.stringify({ frameCount: FRAMES, seriesLabel: "report-arms",
    sourceFingerprint: "0000000000000000", digests: { algorithm: "xxh3-64", frames: Array(FRAMES).fill(digest) } }));
  execFileSync(join(ROOT, "target/release/pack-series"), ["--metadata", join(d, "metadata.json"), "--frames", d,
    "--output", join(d, "series.sbnd")]);
  return d;
}

async function server(d, out) {
  const tls = join(WORK, "tls");
  mkdirSync(tls, { recursive: true });
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout",
    `${tls}/key.pem`, "-out", `${tls}/cert.pem`, "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const port = 4600 + Math.floor(Math.random() * 300);
  const srv = spawn(join(ROOT, "target/release/series-server"), ["--port", String(port), "--bind", "127.0.0.1",
    "--series", `${d}/series.sbnd`, "--cert-pem", `${tls}/cert.pem`, "--key-pem", `${tls}/key.pem`],
    { env: { ...process.env, WTPACS_LINK_RECORD_PATH: join(out, "link.jsonl") }, stdio: ["ignore", "pipe", "ignore"] });
  const banner = await new Promise((ok) => { let s = ""; srv.stdout.on("data", (b) => { s += b; if (/transport=/.test(s)) ok(s); }); });
  return { srv, wt: `https://127.0.0.1:${port}/`, hash: banner.split("cert_sha256=")[1].split(/\s/)[0] };
}

const waitFor = async (b, page, expr, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cdp.evaluate(b, page, expr).catch(() => false)) return true; await pause(20); }
  return false;
};

/** Each ending of §7.3, from the fill's end + 6 s (D5: from the mismatch). */
const ENDINGS = {
  D1: (b, p, o) => cdp.navigate(b, p, o.other),
  D2: (b, p) => cdp.close(b, p),
  D3: async (b, p) => { await cdp.hide(b, p); await pause(1000); cdp.crash(b, p); },
  D4: async (b, p) => { await cdp.hide(b, p); await pause(1000); cdp.killBrowser(b); },
  D5a: (b, p) => cdp.crash(b, p),
  D5b: (b, p) => cdp.crash(b, p),
  D7: async (b, p, o) => { await cdp.navigate(b, p, o.other); await pause(1500); await cdp.back(b, p); await pause(1500);
                           await cdp.evaluate(b, p, "rig.press('frame')"); await cdp.navigate(b, p, o.other); },
  D8: (b, p, o) => cdp.navigate(b, p, o.other),
  D9: async (b, p) => { await cdp.hide(b, p); await pause(5000); await cdp.freeze(b, p); await pause(55000); },
};

async function load({ arm, timing, ending, mutant, wait, sink, srv, dir, out }) {
  const b = await cdp.launch();
  const row = { arm, timing, ending, mutant: mutant ?? null, engine: "chromium" };
  try {
    await cdp.openPage(b, "about:blank");
    const q = new URLSearchParams({ arm, timing, dir: `/${relative(ROOT, dir)}`, fault: "sample", at: AT,
      wt: srv?.wt ?? "https://127.0.0.1:9/", hash: srv?.hash ?? "00", ...(mutant ? { mutant } : {}) });
    const p = await cdp.openPage(b, `http://127.0.0.1:${sink.port}/lab/report-arms/index.html?${q}`);
    row.load = await cdp.evaluate(b, p, "new Promise((r) => { const t = setInterval(() => rig.load && (clearInterval(t), r(rig.load)), 10); })");
    const other = `http://localhost:${sink.port}/lab/report-arms/probe.html?id=away`;
    if (ending.startsWith("D5")) {
      row.reached = await waitFor(b, p, "rig.safety > 0", 30000) ? "mismatch" : "no mismatch";
      await pause(ending === "D5a" ? 50 : 500);
    } else {
      row.reached = ending === "D8" ? (await pause(6000), await cdp.evaluate(b, p, "rig.state"))
        : (await waitFor(b, p, "rig.state === 'filled'", 30000) ? "filled" : await cdp.evaluate(b, p, "rig.error ?? rig.state"));
      for (const text of ["frame", "frame", "frame", "Lossless"]) await cdp.evaluate(b, p, `rig.press(${JSON.stringify(text)})`);
      await pause(6000);
    }
    await ENDINGS[ending](b, p, { other });
  } catch (e) {
    row.error = String(e?.message ?? e);
  } finally {
    b.close();
  }
  await pause(wait * 1000);
  const lines = ["load.jsonl", "safety.jsonl", "link.jsonl"].filter((f) => existsSync(join(out, f)))
    .flatMap((f) => readFileSync(join(out, f), "utf8").split("\n"));
  const e = byLoad(readLines(lines).records).get(row.load);
  Object.assign(row, { fill: !!e?.records.some((r) => r.seq === 0 && r.fillMs != null), seqs: e?.seqs ?? [],
    safety: e?.safety.length ?? 0, duplicates: e?.duplicates ?? 0, unkeyed: e?.unkeyed ?? 0, outside: e?.outside ?? [],
    link: !!e?.link, counters: { ...sink.counters, byKind: { ...sink.counters.byKind }, refused: { ...sink.counters.refused } } });
  return row;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: o } = parseArgs({ options: { arms: { type: "string", default: "off,stub" },
    timing: { type: "string", default: "Y" }, endings: { type: "string", default: "D1" }, mutant: { type: "string" },
    "sink-mutant": { type: "string" }, wait: { type: "string", default: "60" }, out: { type: "string", default: "rows.jsonl" } } });
  const out = join(WORK, `sink-${Date.now()}`);
  mkdirSync(out, { recursive: true });
  const dir = series();
  const sink = await startSink({ dir: out, port: 0, statics: ROOT, mutant: o["sink-mutant"] });
  const servers = {};
  try {
    for (const ending of o.endings.split(",")) {
      for (const arm of o.arms.split(",")) {
        const srv = ending === "D8" ? null : (servers.up ??= await server(dir, out));
        const row = await load({ arm, timing: o.timing, ending, mutant: o.mutant, wait: Number(o.wait), sink, srv, dir, out });
        appendFileSync(o.out, JSON.stringify(row) + "\n");
        console.log(JSON.stringify(row));
      }
    }
  } finally {
    servers.up?.srv.kill();
    await sink.close();
  }
}
