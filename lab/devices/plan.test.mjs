// node lab/devices/plan.test.mjs
import { readFileSync } from "node:fs";
import { balanced } from "../order.mjs";
import { QUICK, reading, schedule } from "./plan.mjs";
import { readBundle } from "./sbnd.js";

let failed = 0;
const check = (ok, what) => (console.log(`${ok ? "ok" : "FAIL"}: ${what}`), (failed += !ok));

/** A schedule runs every arm once a round, and over a full Williams period each arm follows every other equally. */
{
  const arms = ["shared", "asksfirst", "iw12000", "iw38400"];
  const v = schedule(arms, 4);
  const perRound = [0, 1, 2, 3].every((r) => v.filter((x) => x.round === r).map((x) => x.arm).sort().join() === [...arms].sort().join());
  check(perRound, "every arm once a round");
  check(arms.every((a) => balanced(v.map((x) => ({ ...x, unit: x.arm })), a, arms)), "predecessors balanced over the period");
  check(v.filter((x) => x.prev === null).length === 4, "one first visit a round");
  check(schedule(arms, 2, 3)[0].round === 3, "a schedule resumes at its first round");
}

/** Quick mode keeps today's server as the reference and stays short. */
check(QUICK.d2Arms.includes("shared") && QUICK.rounds <= 3, "quick mode: today's arm, 3 rounds");

/** A reading pairs visits in a round, drops a pair either of whose visits is void, and gives the median ratio. */
{
  const rows = [
    { round: 0, arm: "ref", exact: true, t: 100 }, { round: 0, arm: "x", exact: true, t: 50 },
    { round: 1, arm: "ref", exact: true, t: 100 }, { round: 1, arm: "x", exact: true, t: 80 },
    { round: 2, arm: "ref", exact: false, t: 100 }, { round: 2, arm: "x", exact: true, t: 1 },
    { round: 3, arm: "ref", exact: true, t: 100 }, { round: 3, arm: "x", exact: true, error: "cut", t: 1 },
    { round: 4, arm: "ref", exact: true, t: 100 }, { round: 4, arm: "x", exact: true, t: 60 },
  ];
  const [r] = reading(rows, "ref", "t");
  check(r.n === 3 && r.voided === 2, `void pairs dropped (n ${r.n}, void ${r.voided})`);
  check(r.median === 0.6 && r.lo === 0.5 && r.hi === 0.8, `median and range of in-round ratios (${r.median}, ${r.lo}–${r.hi})`);
}

/** A bundle's table and metadata are read as the server reads them: the smoke series' frames are its loose files. */
{
  const buf = readFileSync(new URL("../../fixtures/us_cine_smoke/us_cine_smoke.sbnd", import.meta.url));
  const b = readBundle(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const meta = JSON.parse(readFileSync(new URL("../../fixtures/us_cine_smoke/metadata.json", import.meta.url)));
  check(b.frames.length === meta.frameCount && b.meta.frameCount === meta.frameCount, `frame count (${b.frames.length})`);
  const loose = (i) => readFileSync(new URL(`../../fixtures/us_cine_smoke/frames/${String(i).padStart(3, "0")}.htj2k`, import.meta.url));
  check(b.frames.every((f, i) => Buffer.from(f).equals(loose(i))), "every frame's bytes are its loose file's");
  let refused = false;
  try {
    const wrong = Uint8Array.from(buf);
    wrong[0] = 0x58;
    readBundle(wrong.buffer);
  } catch {
    refused = true;
  }
  check(refused, "a bundle with another magic is refused");
}

console.log(failed ? `${failed} failed` : "all tests passed");
process.exit(failed ? 1 : 0);
