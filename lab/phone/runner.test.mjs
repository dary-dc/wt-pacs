/** node lab/phone/runner.test.mjs — the runner's plan, its URLs and its rule for a filled load. */
import assert from "node:assert/strict";
import { blockPlan, DEFAULTS, fillFailure, loadUrl, octetPlan, parseLoads, pressesFailure, withOrigins } from "./runner.js";
import { levers } from "../viewer/levers.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const letters = { "cubic-restart page": "A", "cubic-restart worker": "B", "bbr worker": "C", "bbr page": "D" };
const arm = (l) => letters[`${l.controller} ${l.view}`];

/**
 * The Second amendment's timed run: four warm-ups (page, one per origin, the links alternating so the first two read
 * one link each), then six octets of eight counted loads, the links alternating load by load, the tether first in
 * odd octets; the tether plays Williams rows 1 2 3 4 1 2 and Wi-Fi 3 4 1 2 3 4, each row in order.
 */
test("the octet plan is the Second amendment's 52 loads", () => {
  const loads = parseLoads(octetPlan());
  assert.equal(loads.length, 52);
  assert.deepEqual(loads.slice(0, 4).map((l) => [l.link, l.controller, l.view, l.counted]), [
    ["tether", "cubic-restart", "page", false], ["wifi", "cubic-restart", "page", false],
    ["tether", "bbr", "page", false], ["wifi", "bbr", "page", false]]);
  const counted = loads.slice(4);
  assert.ok(counted.every((l) => l.counted));
  const octets = counted.map((l) => l.link[0]).join("").match(/.{8}/g);
  assert.deepEqual(octets, ["twtwtwtw", "wtwtwtwt", "twtwtwtw", "wtwtwtwt", "twtwtwtw", "wtwtwtwt"]);
  const rows = (link) => counted.filter((l) => l.link === link).map(arm).join("").match(/.{4}/g);
  assert.deepEqual(rows("tether"), ["ABDC", "BCAD", "CDBA", "DACB", "ABDC", "BCAD"]);
  assert.deepEqual(rows("wifi"), ["CDBA", "DACB", "ABDC", "BCAD", "CDBA", "DACB"]);
  for (const link of ["tether", "wifi"]) {
    const counts = {};
    for (const l of counted.filter((x) => x.link === link)) counts[arm(l)] = (counts[arm(l)] ?? 0) + 1;
    assert.deepEqual(counts, { A: 6, B: 6, C: 6, D: 6 });
  }
});

/** The first two warm-ups wait for the owner, who reads the device counters around them; the octets never wait. */
test("the octet plan pauses only around the first two warm-ups", () => {
  const loads = parseLoads(octetPlan());
  assert.deepEqual(loads.map((l, k) => l.pauseBefore && k), [0, 1, 2, ...Array(49).fill(undefined)]);
});

/** The Amendment's blocks, the fallback: 56 loads, two warm-ups a block, its quads, and a pause at each change of link. */
test("the block plan is the Amendment's 56 loads, paused at each link change", () => {
  const loads = parseLoads(blockPlan());
  assert.equal(loads.length, 56);
  assert.equal(loads.filter((l) => !l.counted).length, 8);
  const quads = loads.filter((l) => l.counted).map(arm).join("").match(/.{4}/g);
  assert.deepEqual(quads, ["ABDC", "BCAD", "CDBA", "ABDC", "BCAD", "CDBA", "DACB", "ABDC", "BCAD", "DACB", "ABDC", "BCAD"]);
  assert.deepEqual(loads.flatMap((l, k) => (l.pauseBefore ? [[k, l.link]] : [])), [[14, "wifi"], [42, "tether"]]);
});

/** `pause <why>` holds the next load until the owner continues; a pause with no load after it is refused. */
test("a pause belongs to the load after it", () => {
  const loads = parseLoads("tether bbr page\npause tether off\nwifi bbr page");
  assert.deepEqual(loads.map((l) => l.pauseBefore), [undefined, "tether off"]);
  assert.throws(() => parseLoads("tether bbr page\npause end"), /line 2, a pause with no load after it/);
});

/** Each step carries a full origin, the address of its link and the port of its controller; an unused link needs none. */
test("each step's origin is its link's address and its controller's port", () => {
  const loads = withOrigins(parseLoads("tether cubic-restart page\nwifi bbr worker"), { tether: "10.0.0.2", wifi: "192.168.1.5" });
  assert.deepEqual(loads.map((l) => l.origin), ["http://10.0.0.2:8765", "http://192.168.1.5:8766"]);
  assert.throws(() => withOrigins(parseLoads("wifi bbr page"), { tether: "", wifi: "host" }), /the wifi address "host"/);
  assert.equal(withOrigins(parseLoads("wifi bbr page"), { tether: "", wifi: "192.168.1.5" }).length, 1);
});

/** The pre-registered gap between loads is 15 s. */
test("the gap is the Second amendment's 15 s", () => {
  assert.equal(DEFAULTS.gapS, 15);
});

/** A plan line that names an unknown link, controller or view, or carries more, is refused with its line number. */
test("a malformed line is refused by its number", () => {
  assert.throws(() => parseLoads("tether cubic-restart page\nwifi bbr2 page"), /line 2, controller bbr2/);
  assert.throws(() => parseLoads("cable bbr page"), /line 1, link cable/);
  assert.throws(() => parseLoads("wifi bbr cine"), /view cine/);
  assert.throws(() => parseLoads("wifi bbr page counted"), /line 1/);
  assert.deepEqual(parseLoads("# c\n\nwifi bbr worker # x").map((l) => l.counted), [true]);
});

/** A load's URL is its own origin with its levers and its step; every load of a plan carries the same plan. */
test("a load's URL carries its origin, its levers and its step", () => {
  const plan = { series: "dbts_b1-q8-g8", gapS: 15, fillS: 120,
    loads: withOrigins(parseLoads("tether cubic-restart page warm-up\nwifi bbr worker"), { tether: "10.0.0.2", wifi: "192.168.1.5" }) };
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

/** A label stand-in that takes the classes of `course` at the given ms after each press. */
function fakeLabel(courses) {
  const quality = { className: "optimal", textContent: "Optimal quality" };
  const lossless = { hidden: false, click: () => {
    for (const [ms, c] of courses.shift() ?? []) setTimeout(() => (quality.className = c), ms);
  } };
  return { quality, lossless };
}
const limits = { losslessMs: 300, optimalMs: 100 };

/** Lossless within its limit of the first press and Optimal within its limit of the second pass; a late label fails. */
test("the presses' limits: Lossless within 30 s, Optimal within 10 s", async () => {
  const ok = fakeLabel([[[10, "asking"], [200, "lossless"]], [[50, "optimal"]]]);
  assert.equal(await pressesFailure(ok.quality, ok.lossless, limits), null);
  const slow = fakeLabel([[[10, "asking"], [400, "lossless"]]]);
  assert.match(await pressesFailure(slow.quality, slow.lossless, limits), /no Lossless 0.3 s after the press/);
  const back = fakeLabel([[[10, "asking"], [20, "lossless"]], [[150, "optimal"]]]);
  assert.match(await pressesFailure(back.quality, back.lossless, limits), /not Optimal quality 0.1 s after the second press/);
  const failed = fakeLabel([[[10, "asking"], [20, "failed"]]]);
  assert.match(await pressesFailure(failed.quality, failed.lossless, limits), /lossless pressed: failed/);
  assert.deepEqual([DEFAULTS.losslessMs, DEFAULTS.optimalMs], [30000, 10000]);
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
