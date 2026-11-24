// The delivery comparison's cells, arms and order. docs/client/evidence/delivery-comparison.md §1–§3, §Amendment 2
import { order } from "../order.mjs";

const link = (delayMs, kbit, pkts, ...rest) => ["--delay-ms", String(delayMs), ...(kbit ? ["--rate-kbit", String(kbit)] : []), "--queue-pkts", String(pkts), ...rest];
/** link_impair.py's Gilbert–Elliott pair for a mean loss in percent, bursts of 3.5 packets (claude/transport-arms run.mjs). */
export const ge = (mean) => { const r = 100 / 3.5, m = mean / 100; return ["--loss-model", "ge", "--ge-p", (m * r / (1 - m)).toFixed(5), "--ge-r", r.toFixed(4)]; };

/** §3. `relay`: link_impair.py's arguments (delay one way); `prefix`: the first N frames of both series; `lossPct`: what the pilot's tally is held to; `k3`: K3's two prefixes. */
export const CELLS = {
  CLEAN: { relay: link(1, 90000, 300), rttMs: 2, k3: [8, 50] },
  PUB: { relay: link(10, 90000, 2000), rttMs: 20, k3: [8, 50] },
  LTE: { relay: link(19, 50000, 3300, "--loss", "0.1"), rttMs: 38, prefix: 16, lossy: true, lossPct: 0.1, blackoutEveryMs: 30000, k3: [4, 16] },
  LOSS: { relay: link(20, 20000, 200, ...ge(1)), rttMs: 40, prefix: 8, lossy: true, lossPct: 1, k3: [4, 8] },
  CR: { relay: link(400, 90000, 1875), rttMs: 800, k3: [8, 50] },
};
/** K2's relay: CLEAN's form without a rate. */
export const UNIMPAIRED = link(1, 0, 300);

export const ARMS = ["A", "A'", "B", "C1", "FIT", "SPLIT"];
export const VOLUMES = ["dbts_a1", "dbts_b1", "dbts_c1"];
/** §1: C1 asks its exact frame this long after its fill ends. */
export const PRESS_AFTER_MS = 1000;
export const ZOOM_AFTER_MS = 1000;
export const DECODERS = 2;
export const ROUNDS = 12;
export const K3_PRIME_LOADS = 8;

/** A uniform draw in [0, 1) fixed by `key` (FNV-1a). */
export function draw(key) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/** ms from the servers' start to a load's first blackout, the form's period after that; undefined where the form has none. */
export const blackoutPhaseMs = (cell, key) => CELLS[cell].blackoutEveryMs && Math.floor(draw(`${cell}/${key}`) * CELLS[cell].blackoutEveryMs);

export const bdpBytes = (cell) => (CELLS[cell].rttMs * Number(CELLS[cell].relay[CELLS[cell].relay.indexOf("--rate-kbit") + 1])) / 8;

/** The URL parameters of one arm's load past the page's own. */
export function armParams(arm, cell) {
  const p = { decoders: String(DECODERS) };
  if (arm === "C1") Object.assign(p, { press: "lossless", pressAfter: String(PRESS_AFTER_MS) });
  if (arm === "C2") p.exactFill = "1";
  if (arm === "FIT") Object.assign(p, { fit: "1", zoomAfter: String(ZOOM_AFTER_MS) });
  if (arm === "SPLIT") Object.assign(p, { split: "1", ahead: String(bdpBytes(cell)) });
  return p;
}

/** B loads the exact series alone, FIT its fit series (the exact series where the fit is level 0); every other arm the view with its pair. */
export const seriesOf = (arm) => (arm === "B" ? "exact" : arm === "FIT" ? "fit" : "view");

/** One cell's loads in run order: a Williams row of the arms a round, run for each volume, the volumes rotated by one a round. */
export function cellLoads(cell, { rounds = ROUNDS, fixedOrder = false, arms: armSet = ARMS } = {}) {
  if (!CELLS[cell]) throw new Error(`cell ${cell}: one of ${Object.keys(CELLS).join(" ")}`);
  const loads = [];
  for (let round = 0; round < rounds; round++) {
    const arms = fixedOrder ? armSet : order(armSet, round);
    const volumes = VOLUMES.map((_, k) => VOLUMES[(k + round) % VOLUMES.length]);
    for (const volume of volumes) {
      arms.forEach((arm, k) => loads.push({ cell, round, volume, arm, prev: k ? arms[k - 1] : null, series: seriesOf(arm), params: armParams(arm, cell),
        blackoutPhaseMs: blackoutPhaseMs(cell, `${round}/${volume}/${arm}`) }));
    }
  }
  return loads;
}

export function k3PrimeLoads(cell) {
  if (!CELLS[cell]?.lossy) throw new Error(`K3′ ${cell}: only the lossy forms (${Object.keys(CELLS).filter((c) => CELLS[c].lossy).join(" ")})`);
  return Array.from({ length: K3_PRIME_LOADS }, (_, round) => VOLUMES.map((_, k) => VOLUMES[(k + round) % VOLUMES.length]).map((volume) => ({
    cell, round, volume, arm: "B", calibration: "K3′", series: "exact", params: armParams("B"), blackoutPhaseMs: blackoutPhaseMs(cell, `K3′/${round}/${volume}`),
  }))).flat();
}
