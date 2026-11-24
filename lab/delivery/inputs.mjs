// K1–K3 as the predictor's inputs: each series' coded bytes, the bench's decode per frame, each form's start and
// goodput, K3′'s wire curves on the lossy forms, FIT's level prefixes. docs/client/evidence/delivery-comparison.md §4.2, A2.4, A2.7
//   node lab/delivery/inputs.mjs DIR K2.jsonl OUT.json --k3 CELL=ROWS.jsonl … [--k3-prime CELL=ROWS.jsonl …] [--view VOLUME=ID …] [--fit VOLUME=ID …]
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CELLS, VOLUMES } from "./plan.mjs";

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const rowsOf = (file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

/** K1: each frame's coded bytes, in frame order, from the series' directory as ingest_coded.py wrote it. */
export const frameBytes = (dir) => readdirSync(dir).filter((f) => /^\d{3}\.(htj2k|av1|j2c)$/.test(f)).sort().map((f) => statSync(path.join(dir, f)).size);

/** K2: the median per-frame decode of a (volume, series, decoders) over its bench loads, the check included. */
export function benchMs(rows, volume, series, decoders) {
  const ms = rows.filter((r) => r.volume === volume && r.series === series && r.bench?.decoders === decoders && !r.void && r.verdict?.ok).flatMap((r) => r.bench.frames.map((f) => f.ms));
  if (!ms.length) throw new Error(`K2: no bench rows for ${volume} ${series} on ${decoders} decoders`);
  return median(ms);
}

/** K3: the line through the two prefixes' medians of (bytes, dial → last frame's last byte): start in ms and goodput in Mbit/s. */
export function wireLine(points) {
  const by = new Map();
  for (const { bytes, ms } of points) by.set(bytes, [...(by.get(bytes) ?? []), ms]);
  if (by.size !== 2) throw new Error(`K3: want two prefixes, got ${by.size}`);
  const [[b1, m1], [b2, m2]] = [...by].map(([b, ms]) => [b, median(ms)]).sort((a, b) => a[0] - b[0]);
  const msPerByte = (m2 - m1) / (b2 - b1);
  return { startMs: m1 - msPerByte * b1, goodputMbit: 8 / msPerByte / 1000 };
}

/**
 * K3′: per volume, the points (Σ bytes of frames 0..i, the median over loads of frame i's last byte from the dial), from
 * arm B's loads alone; `exact` is each volume's exact frame bytes, `n` the form's prefix.
 */
export function wireCurves(rows, exact, n) {
  const notB = rows.find((r) => r.arm !== "B");
  if (notB) throw new Error(`K3′: its rows must be B's, got ${notB.arm} (${notB.volume} round ${notB.round})`);
  return Object.fromEntries(Object.entries(exact).map(([volume, frames]) => {
    const loads = rows.filter((r) => r.volume === volume && !r.void?.length && r.verdict?.ok && r.load?.frames);
    if (!loads.length) throw new Error(`K3′: no B loads of ${volume}`);
    let bytes = 0;
    return [volume, frames.slice(0, n).map((b, i) => [(bytes += b), median(loads.map((r) => r.load.frames.find((f) => f.i === i).lastByte - r.load.fillFrom))])];
  }));
}

export function inputs({ dir, k2, k3, k3Prime = {}, views, fits = {} }) {
  const volumes = {};
  for (const volume of VOLUMES.filter((v) => views[v])) {
    const viewMeta = JSON.parse(readFileSync(path.join(dir, `${views[volume]}.metadata.json`), "utf8"));
    volumes[volume] = {
      view: { id: views[volume], frames: frameBytes(path.join(dir, views[volume])), group: viewMeta.lossy.g, frameMs: benchMs(k2, volume, "view", 2) },
      exact: { id: viewMeta.exactSeries, frames: frameBytes(path.join(dir, viewMeta.exactSeries)), frameMs: benchMs(k2, volume, "exact", 2), loneMs: benchMs(k2, volume, "exact", 1) },
      shown: 0,
    };
    if (fits[volume]) volumes[volume].fit = fitOf(path.join(dir, fits[volume]), k2, volume);
  }
  const k3Bytes = volumes.dbts_b1?.exact.frames ?? Object.values(volumes)[0].exact.frames;
  const forms = Object.fromEntries(Object.entries(k3).map(([cell, rows]) => {
    const points = rows.filter((r) => r.arm === "WT-TS" && !r.void && Number.isFinite(r.v)).map((r) => ({ bytes: k3Bytes.slice(0, r.frames.length).reduce((a, b) => a + b, 0), ms: r.v }));
    return [cell, { ...wireLine(points), rttMs: CELLS[cell].rttMs }];
  }));
  for (const [cell, rows] of Object.entries(k3Prime)) {
    const exact = Object.fromEntries(Object.entries(volumes).map(([v, x]) => [v, x.exact.frames]));
    forms[cell] = { ...forms[cell], rttMs: CELLS[cell].rttMs, curves: wireCurves(rows, exact, CELLS[cell].prefix) };
  }
  return { volumes, forms };
}

/** FIT's series (prefix.mjs's layout: entry i < F frame i's level prefix, F + i its rest), its level, and K2's decode of a prefix at the level. */
function fitOf(fitDir, k2, volume) {
  const meta = JSON.parse(readFileSync(`${fitDir}.metadata.json`, "utf8"));
  const entries = frameBytes(fitDir);
  const f = entries.length / 2;
  return { id: path.basename(fitDir), level: meta.fit.level, prefixes: entries.slice(0, f), rests: entries.slice(f), frameMs: benchMs(k2, volume, "fit", 2) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, k2, out, ...rest] = process.argv.slice(2);
  const pairs = (k) => rest.flatMap((a, i) => (a === k ? [rest[i + 1].split("=")] : []));
  const views = { dbts_a1: "dbts_a1-q8-g8-cut", dbts_b1: "dbts_b1-q8-g8", dbts_c1: "dbts_c1-q8-g8-cut", ...Object.fromEntries(pairs("--view")) };
  const k3 = Object.fromEntries(pairs("--k3").map(([cell, file]) => [cell, rowsOf(file)]));
  const k3Prime = Object.fromEntries(pairs("--k3-prime").map(([cell, file]) => [cell, rowsOf(file)]));
  const fits = { dbts_b1: "dbts_b1-fit", ...Object.fromEntries(pairs("--fit")) };
  writeFileSync(out, JSON.stringify(inputs({ dir: path.resolve(dir), k2: rowsOf(k2), k3, k3Prime, views, fits }), null, 1));
  console.log(out);
}
