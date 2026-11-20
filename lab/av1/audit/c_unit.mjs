// One AV1 payload's top unit, as the tip's av1.js hands it to a decoder, to stdout: c.mjs's native reference.
//
//   node lab/av1/audit/c_unit.mjs TIP PAYLOAD > unit.obu
import fs from "node:fs";

const [tip, file] = process.argv.slice(2);
const { parsePayload, units } = await import(`${tip}/client/decode/av1-payload.js`);
const p = parsePayload(new Uint8Array(fs.readFileSync(file)));
process.stdout.write(units(p.frames[0], p.split)[0]);
