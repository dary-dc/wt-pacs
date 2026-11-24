import { readFileSync } from "node:fs";
const { sequence, layouts } = await import(process.argv[2] + "/client/decode/av1-payload.js");
for (const i of [0, 1, 7, 8, 9]) {
  const unit = readFileSync(`${process.argv[2]}/client/contract/av1/g8x20/${String(i).padStart(3, "0")}.av1`);
  const seq = sequence(new Uint8Array(unit));
  console.log(i, seq ? `profile ${seq.profile} mono ${seq.mono}` : "no sequence header", "→ layouts", JSON.stringify(layouts({ depth: 8, split: 0 }, new Uint8Array(unit))));
}
