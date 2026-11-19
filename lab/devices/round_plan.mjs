// round.py's plan for next-round.md's cells 1–3: roundOrder()'s loads, each on its page and the servers behind it.
//   node lab/devices/round_plan.mjs DIR RUN [--dial ADDR] [--views V1,V2] [--quick]
// DIR as scripts/demo-series.sh wrote it; RUN gets plan.json, the transport files and the beacon. lab/devices/README.md §The round
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BENCH, SERIES, roundOrder } from "./round.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
/** QUIC ports: each view, then its exact series; page ports: each view's pair, then its exact series alone. */
const QUIC = [[4433, 4434], [4435, 4436]];
const PAGE = [[8765, 8767], [8766, 8768]];
export const PAGE_PORTS = PAGE.flat();
/** s: next-round.md §6's budgets of loads' own time; the gap between loads, §6. */
const BUDGETS = { 1: 600, 2: 2100, 3: 3600 };
const QUICK = { rounds: 2, pairs: 2, benchReps: 1, steps: 3, cineS: 2, gapS: 1 };

export async function roundPlan({ dir, run, dial = "127.0.0.1", views = SERIES, quick = false, commit }) {
  const exactOf = (v) => JSON.parse(readFileSync(`${dir}/${v}.metadata.json`)).exactSeries;
  const pairs = views.map((v) => ({ view: v, exact: exactOf(v) }));
  const hash = JSON.parse(readFileSync(`${ROOT}/client/dev-transport.json`)).cert_sha256;
  const transport = (port) => {
    const file = `${run}/t-${port}.json`;
    writeFileSync(file, JSON.stringify({ wt_url: `https://${dial}:${port}/`, cert_sha256: hash }));
    return file;
  };
  const cert = ["--cert-pem", `${ROOT}server/dev-cert/cert.pem`, "--key-pem", `${ROOT}server/dev-cert/key.pem`];
  const quic = (port, id) => ({ cmd: [`${ROOT}target/release/series-server`, "--port", String(port), "--congestion", "cubic-restart", "--series", `${dir}/${id}.sbnd`, ...cert], readyLine: "transport=" });
  const beacon = `${run}/beacon.jsonl`;
  const host = (port, meta, quicPort, exact) => ({
    cmd: ["python3", `${ROOT}server/dev-server.py`, "--bind", "127.0.0.1", "--port", String(port), "--beacon", beacon,
      "--metadata", `${dir}/${meta}.metadata.json`, "--transport", transport(quicPort),
      ...(exact ? ["--exact-metadata", `${dir}/${exact.id}.metadata.json`, "--exact-transport", transport(exact.port)] : [])],
    ready: `http://127.0.0.1:${port}/`,
  });
  const servers = pairs.flatMap(({ view, exact }, s) => [
    quic(QUIC[s][0], view), quic(QUIC[s][1], exact),
    host(PAGE[s][0], view, QUIC[s][0], { id: exact, port: QUIC[s][1] }), host(PAGE[s][1], exact, QUIC[s][1]),
  ]);
  const pageOf = ({ series, arm, view }) => {
    const port = PAGE[series === SERIES[1] ? 1 : 0][arm === "B" || series === BENCH.series.htj2k ? 1 : 0];
    return `http://127.0.0.1:${port}/?overlay=1&view=${view}&beacon=cubic-restart`;
  };
  const loads = (await roundOrder(quick ? QUICK : {})).map((load) => ({
    ...load, url: pageOf(load), ...(quick && load.seq && { steps: QUICK.steps, cineS: QUICK.cineS }),
  }));
  return { commit, gapS: quick ? QUICK.gapS : 15, fillS: 120, budgetsS: BUDGETS, blocks: [{ name: "wifi", servers, loads }] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, run, ...rest] = process.argv.slice(2);
  if (!dir || !run) throw new Error("usage: node lab/devices/round_plan.mjs DIR RUN [--dial ADDR] [--views V1,V2] [--quick]");
  const opt = (k) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
  mkdirSync(run, { recursive: true });
  const commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"]).toString().trim();
  const plan = await roundPlan({ dir: resolve(dir), run: resolve(run), dial: opt("--dial"), views: opt("--views")?.split(","), quick: rest.includes("--quick"), commit });
  writeFileSync(`${run}/plan.json`, JSON.stringify(plan, null, 1));
  console.log(`${run}/plan.json: ${plan.blocks[0].loads.length} loads at ${commit}; adb reverse ${PAGE_PORTS.join(", ")} and the round's port`);
}
