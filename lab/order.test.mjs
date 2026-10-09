// node lab/order.test.mjs — the variant order and the predecessor split, in JS and in lab/scripts/order.py.
import { execFileSync } from "node:child_process";
import { balanced, leadsByPredecessor, order, williams } from "./order.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const py = (code) => JSON.parse(execFileSync("python3", ["-c", `import sys, json; sys.path.insert(0, "lab/scripts"); from order import *; ${code}`], { encoding: "utf8" }));

// Over one period every unit sits at every position, and follows every other unit, equally often.
for (let n = 1; n <= 9; n++) {
  const rows = williams(n);
  check(rows.length === (n % 2 ? 2 * n : n), `n=${n}: period ${rows.length}`);
  const at = new Map(), after = new Map();
  for (const row of rows) {
    check([...row].sort((a, b) => a - b).every((u, i) => u === i), `n=${n}: ${row} is not a permutation`);
    row.forEach((u, i) => {
      at.set(`${u}@${i}`, (at.get(`${u}@${i}`) ?? 0) + 1);
      if (i) after.set(`${row[i - 1]}>${u}`, (after.get(`${row[i - 1]}>${u}`) ?? 0) + 1);
    });
  }
  check(at.size === n * n && new Set(at.values()).size === 1, `n=${n}: positions unbalanced`);
  check(after.size === n * (n - 1) && new Set(after.values()).size <= 1, `n=${n}: predecessors unbalanced`);
  check(JSON.stringify(py(`print(json.dumps(williams(${n})))`)) === JSON.stringify(rows), `n=${n}: order.py differs`);
}

// A campaign in which B is slowed by 10 when it follows C: the split shows it under C, and
// the flag goes up for the old orders (fixed, and rotated by one a round) but not for the square.
const UNITS = ["A", "B", "C", "D"];
const BASE = { A: 100, B: 110, C: 120, D: 130 };
const campaign = (orderOf, rounds) =>
  Array.from({ length: rounds }, (_, round) => orderOf(round)).flatMap((seq, round) =>
    seq.map((unit, k) => ({ round, unit, prev: seq[k - 1] ?? null, v: BASE[unit] + (unit === "B" && seq[k - 1] === "C" ? 10 : 0) })),
  );
const ORDERS = {
  williams: (round) => order(UNITS, round),
  fixed: () => UNITS,
  rotated: (round) => UNITS.map((_, k) => UNITS[(round + k) % UNITS.length]),
};
for (const [name, orderOf] of Object.entries(ORDERS)) {
  const rows = campaign(orderOf, 8);
  const flagged = leadsByPredecessor(rows, UNITS, [["B", "A"], ["D", "A"]]).some((l) => l.includes("UNBALANCED"));
  const pyFlagged = py(`print(json.dumps(any("UNBALANCED" in l for l in leads_by_predecessor(${JSON.stringify(rows).replaceAll("null", "None")}, ${JSON.stringify(UNITS)}, [["B", "A"], ["D", "A"]]))))`);
  check(flagged === (name !== "williams"), `${name}: flagged ${flagged}`);
  check(pyFlagged === flagged, `${name}: order.py flagged ${pyFlagged}`);
}
const [line] = leadsByPredecessor(campaign(ORDERS.williams, 4), UNITS, [["B", "A"]]);
check(/C \+20 \(1\)/.test(line) && /first \+10 \(1\)/.test(line) && /A \+10 \(1\)/.test(line), `the split: ${line}`);

// A campaign cut short of a whole period — 7 rounds of 3 variants, 4 or 6 of 5 — is not flagged.
const cut = (units, rounds) => Array.from({ length: rounds }, (_, round) => order(units, round))
  .flatMap((seq, round) => seq.map((unit, k) => ({ round, unit, prev: seq[k - 1] ?? null })));
for (const [units, rounds] of [[["A", "B", "C"], 7], [UNITS.concat("E"), 4], [UNITS.concat("E"), 6]]) {
  check(units.every((u) => balanced(cut(units, rounds), u, units)), `${rounds} rounds of ${units.length}: flagged`);
}

console.log(failed ? `${failed} failed` : "order: all passed");
process.exit(failed ? 1 : 0);
