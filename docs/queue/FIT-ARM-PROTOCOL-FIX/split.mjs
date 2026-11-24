// FIT-ARM-PROTOCOL-FIX: SPLIT's fill against A's, fluid and with A's makespan factor. Run from a claude/delivery checkout with this file copied into it:
//   node split.mjs lab/delivery/inputs.json
import { readFileSync } from "node:fs";
import { fill, wire, decodeFloor, unitsOf } from "../../../lab/delivery/predict.mjs";
const inputs = JSON.parse(readFileSync(process.argv[2] ?? "lab/delivery/inputs.json"));
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
for (const cell of ["CLEAN", "PUB"]) {
  const link = inputs.forms[cell];
  const G = link.goodputMbit * 1000; // bits per ms
  for (const [vol, v] of Object.entries(inputs.volumes)) {
    const n = v.view.frames.length;
    const bV = 8 * mean(v.view.frames), bE = 8 * mean(v.exact.frames);
    const dV = v.view.frameMs / 2, dE = v.exact.frameMs / 2;
    const t = (bE * dV - bV * dE) / (G * (dV - dE) + (bE - bV));
    const x = (dV - t) / (dV - dE);
    const A = fill(v.view.frames, { group: 8, frameMs: v.view.frameMs }, link);
    const k = decodeFloor(unitsOf(n, 8), v.view.frameMs, 2) / (n * dV);
    const w1 = wire(v.view.frames.slice(0, 8).reduce((a, b) => a + b, 0), link);
    const fluid = w1 + n * t, gran = w1 + k * n * t;
    console.log(cell, vol, `t/dV x${(t / dV).toFixed(2)} x=${x.toFixed(2)} k=${k.toFixed(2)} A=${A.ms.toFixed(0)} fluid x${(fluid / A.ms).toFixed(2)} withK x${(gran / A.ms).toFixed(2)} (${gran.toFixed(0)} ms)`);
  }
}
