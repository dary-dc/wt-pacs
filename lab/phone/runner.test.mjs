/** node lab/phone/runner.test.mjs — the runner's plan, its URLs and its rule for a filled load. */
import assert from "node:assert/strict";
import { amendedPlan, fillFailure, loadUrl, parseLoads } from "./runner.js";
import { levers } from "../viewer/levers.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** The amended timed run: 56 loads, 8 warm-ups; each arm 6 counted loads per link; each block's quads are Williams rows. */
test("the amended plan is docs/devices.md §7's 56 loads", () => {
  const loads = parseLoads(amendedPlan());
  assert.equal(loads.length, 56);
  assert.equal(loads.filter((l) => !l.counted).length, 8);
  const arm = (l) => `${l.controller} ${l.view}`;
  for (const link of ["tether", "wifi"]) {
    const counts = {};
    for (const l of loads.filter((x) => x.counted && x.link === link)) counts[arm(l)] = (counts[arm(l)] ?? 0) + 1;
    assert.deepEqual(counts, { "cubic-restart page": 6, "cubic-restart worker": 6, "bbr worker": 6, "bbr page": 6 });
  }
  const letters = { "cubic-restart page": "A", "cubic-restart worker": "B", "bbr worker": "C", "bbr page": "D" };
  const quads = loads.filter((l) => l.counted).map((l) => letters[arm(l)]).join("").match(/.{4}/g);
  assert.deepEqual(quads, ["ABDC", "BCAD", "CDBA", "ABDC", "BCAD", "CDBA", "DACB", "ABDC", "BCAD", "DACB", "ABDC", "BCAD"]);
  assert.deepEqual([...new Set(loads.map((l) => l.link))].join(), "tether,wifi");
  assert.deepEqual(loads.slice(0, 2).map((l) => [l.controller, l.view, l.counted]), [["cubic-restart", "page", false], ["bbr", "page", false]]);
});

/** A plan line that names an unknown link, controller or view, or carries more, is refused with its line number. */
test("a malformed line is refused by its number", () => {
  assert.throws(() => parseLoads("tether cubic-restart page\nwifi bbr2 page"), /line 2, controller bbr2/);
  assert.throws(() => parseLoads("cable bbr page"), /line 1, link cable/);
  assert.throws(() => parseLoads("wifi bbr cine"), /view cine/);
  assert.throws(() => parseLoads("wifi bbr page counted"), /line 1/);
  assert.deepEqual(parseLoads("# c\n\nwifi bbr worker # x").map((l) => l.counted), [true]);
});

/** Each load's URL names its link's address, its controller's port, its view and controller, and its step in the plan. */
test("a load's URL carries its origin, its levers and its step", () => {
  const plan = { addresses: { tether: "10.0.0.2", wifi: "192.168.1.5" }, series: "dbts_b1-q8-g8", gapS: 10, fillS: 120,
    loads: parseLoads("tether cubic-restart page warm-up\nwifi bbr worker") };
  const u = new URL(loadUrl(plan, 1));
  assert.equal(u.origin, "http://192.168.1.5:8766");
  assert.deepEqual(["view", "beacon", "at", "overlay"].map((k) => u.searchParams.get(k)), ["worker", "bbr", "1", "1"]);
  assert.equal(new URL(loadUrl(plan, 0)).origin, "http://10.0.0.2:8765");
  assert.equal(new URL(loadUrl(plan, 0)).searchParams.get("run"), u.searchParams.get("run"));
});

/** A filled load passes only with every frame here, each through WebCodecs, and no error. */
test("the fill's rule: every frame, WebCodecs only, no error", () => {
  const f = (i, path = "av1-webcodecs", refusal) => ({ i, path, refusal });
  assert.equal(fillFailure({ frames: [f(0), f(1)], errors: [] }, 2), null);
  assert.equal(fillFailure({ frames: [f(0)], errors: [] }, 2), "received 1 of 2");
  assert.equal(fillFailure({ frames: [f(0), f(1, "av1-dav1d", "codec")], errors: [] }, 2), "frame 1 through av1-dav1d (codec)");
  assert.equal(fillFailure({ frames: [f(0), f(1)], errors: ["frame 1: x"] }, 2), "frame 1: x");
  assert.equal(fillFailure({ error: "connect: refused" }, 2), "connect: refused");
});

/** The runner reads the fill's end, as the rig's `post` does: the two are refused together, and a run names its controller. */
test("levers refuse run without beacon, and either beside post", () => {
  assert.throws(() => levers(new URLSearchParams({ run: "x", at: "0" })), /run without beacon/);
  assert.throws(() => levers(new URLSearchParams({ beacon: "bbr", post: "http://rig/" })), /post with beacon or run/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`runner: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
