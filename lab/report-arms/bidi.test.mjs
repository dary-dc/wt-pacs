// node lab/report-arms/bidi.test.mjs — a BiDi remote value read as plain JSON: numbers, strings, booleans, null and
// undefined as null, arrays and objects element by element, as run.mjs reads rig's fields.
import { plain } from "./bidi.mjs";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));
const v = { type: "object", value: [["a", { type: "array", value: [{ type: "number", value: 1 }, { type: "string", value: "x" }] }],
  ["n", { type: "null" }], ["u", { type: "undefined" }], ["ok", { type: "boolean", value: true }],
  ["o", { type: "object", value: [["k", { type: "number", value: 2.5 }]] }]] };
check(JSON.stringify(plain(v)) === JSON.stringify({ a: [1, "x"], n: null, u: null, ok: true, o: { k: 2.5 } }),
  `plain: nested values (${JSON.stringify(plain(v))})`);
check(plain({ type: "number", value: "NaN" }) !== plain({ type: "number", value: "NaN" }), "plain: NaN as a number");
if (failed) process.exit(1);
console.log("report-arms: BiDi values read as JSON");
