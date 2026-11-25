// node steps.mjs <tree>: round_plan.mjs's cell M steps on dbts_b1-q8-g8 against the frames PR 446's want holds.
const { memoryCell } = await import(process.argv[2] + "/lab/devices/round_plan.mjs");
const { wantFrom } = await import(process.argv[2] + "/client/view/controller.js");
for (const l of memoryCell("dbts_b1-q8-g8", 15, 50).slice(0, 4)) {
  const held = wantFrom(0, 50, true, true, l.budget, 8).length;
  console.log(l.arm, "steps", l.steps, "needs", 2 * l.steps + 1, "held", held, 2 * l.steps + 1 <= held ? "ok" : "FAILS");
}
