/**
 * Every distinct sequence header of every AV1 item under the given directories, and of the client's probes:
 * the codecs string av1-item.js derives, against one built from ffmpeg's own reading of the same OBU
 * (trace_headers for the coded fields, ffprobe for the inferred ones). Queue row 67; README.md
 *
 * A `.obu` file (a low-overhead OBU stream, as aomenc --obu writes it), and an `.av1` file that is not an item, counts as one unit.
 *
 *   node lab/av1/codecstr/check.mjs DIR... [--mutate profile|level|tier|bits|mono] [--out strings.json]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { codecString, parseItem, sequence, units } from "../../../client/downloader/av1-item.js";
import { PROBES } from "../../../client/downloader/av1-probe.js";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const MUTATE = arg("--mutate");
const OUT = arg("--out");
const dirs = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const ROOT = new URL("../../..", import.meta.url).pathname;

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const hex = (b) => Buffer.from(b).toString("hex");

/** The first sequence header OBU's bytes, the OBU header included, as the key of a distinct header. */
function headerKey(unit) {
  for (let at = 0; at < unit.length; ) {
    const h = unit[at];
    let p = at + 1 + ((h >> 2) & 1);
    let size = 0;
    for (let shift = 0; ; shift += 7) {
      const b = unit[p++];
      size += (b & 127) * 2 ** shift;
      if (!(b & 128)) break;
    }
    if (((h >> 3) & 15) === 1) return hex(unit.subarray(at, p + size));
    at = p + size;
  }
  return null;
}

const MUTATIONS = {
  profile: (s) => ({ ...s, profile: s.profile ^ 1 }),
  level: (s) => ({ ...s, level: s.level + 1 }),
  tier: (s) => ({ ...s, tier: s.tier ^ 1 }),
  bits: (s) => ({ ...s, bits: s.bits === 8 ? 10 : 8 }),
  mono: (s) => ({ ...s, mono: s.mono ^ 1 }),
};
const derive = (unit) => codecString((MUTATIONS[MUTATE] ?? ((s) => s))(sequence(unit)));

const PIX = { gray: [8, 1, "11"], gray10le: [10, 1, "11"], gray12le: [12, 1, "11"],
  yuv420p: [8, 0, "11"], yuv420p10le: [10, 0, "11"], yuv420p12le: [12, 0, "11"],
  yuv444p: [8, 0, "00"], yuv444p10le: [10, 0, "00"], yuv444p12le: [12, 0, "00"],
  gbrp: [8, 0, "00"], gbrp10le: [10, 0, "00"], gbrp12le: [12, 0, "00"] };
const two = (n) => String(n).padStart(2, "0");

/** The string from ffmpeg's reading: field bits as trace_headers prints them, pixel format and range as ffprobe infers them. */
function reference(unit) {
  const trace = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "trace", "-f", "obu", "-i", "pipe:0", "-c", "copy",
    "-bsf:v", "trace_headers", "-frames:v", "1", "-f", "null", "-"], { input: unit, encoding: "latin1", maxBuffer: 1 << 28 });
  const fields = {};
  for (const line of trace.stderr.split("\n")) {
    const m = line.match(/\]\s+\d+\s+(\S+)\s+([01]+) = /);
    if (m && !(m[1] in fields)) fields[m[1]] = parseInt(m[2], 2);
    if (line.includes("Frame Header") || line.includes("Tile Group")) break;
  }
  const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-f", "obu", "-i", "pipe:0", "-show_streams", "-of", "json"],
    { input: unit, encoding: "utf8" }).stdout).streams[0];
  const [bits, mono, ss] = PIX[probe.pix_fmt] ?? [NaN, NaN, "??"];
  const csp = ss === "11" ? fields.chroma_sample_position ?? 0 : 0;
  const [cp, tc, mc] = ["color_primaries", "transfer_characteristics", "matrix_coefficients"].map((k) => fields[k] ?? 2);
  const range = probe.color_range === "pc" ? 1 : probe.color_range === "tv" ? 0 : NaN;
  return `av01.${fields.seq_profile}.${two(fields["seq_level_idx[0]"])}${fields["seq_tier[0]"] ? "H" : "M"}.${two(bits)}`
    + `.${mono}.${ss}${csp}.${two(cp)}.${two(tc)}.${two(mc)}.${range}`;
}

const headers = new Map();
const see = (unit, where) => {
  const key = unit && headerKey(unit);
  if (!key) return;
  if (!headers.has(key)) headers.set(key, { unit, where, count: 0 });
  headers.get(key).count++;
};
for (const [layout, p] of Object.entries(PROBES)) see(Uint8Array.from(atob(p.unit), (c) => c.charCodeAt(0)), `probe ${layout}`);
for (const dir of dirs) {
  for (const f of walk(dir).filter((x) => x.endsWith(".obu")).sort()) see(new Uint8Array(readFileSync(f)), relative(ROOT, f));
  for (const f of walk(dir).filter((x) => x.endsWith(".av1")).sort()) {
    const bytes = new Uint8Array(readFileSync(f));
    let item;
    try {
      item = parseItem(bytes, bytes.length >= 16 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true) : 0);
    } catch {
      see(bytes, `${relative(ROOT, f)} (a bare unit)`);
      continue;
    }
    for (const frame of item.frames) {
      const [top, low] = units(frame, item.split);
      see(top, `${relative(ROOT, f)} top`);
      see(low, `${relative(ROOT, f)} low`);
    }
  }
}

let wrong = 0;
const rows = [];
for (const { unit, where, count } of headers.values()) {
  const [ours, theirs] = [derive(unit), reference(unit)];
  if (ours !== theirs) wrong++;
  rows.push({ codec: ours, reference: theirs, where, count, header: headerKey(unit) });
  if (ours !== theirs) console.log(`DIFFER ${where}: ${ours} against ${theirs}`);
}
const tally = {};
for (const r of rows) tally[r.codec] = (tally[r.codec] ?? 0) + r.count;
console.log(`${headers.size} distinct sequence headers, ${rows.reduce((a, r) => a + r.count, 0)} units: ${headers.size - wrong} as ffmpeg reads them, ${wrong} not`);
for (const [c, n] of Object.entries(tally).sort()) console.log(`  ${c}  ${n} units`);
if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1));
process.exit(wrong ? 1 : 0);
