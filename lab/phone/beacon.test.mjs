/** node lab/phone/beacon.test.mjs — the beacon is a switch: the product's load report on, to the test sink, with the run's fields. */
import assert from "node:assert/strict";
import { loadReport } from "../../client/viewer/load-report.js";
import { BEACON_PATH, beaconHooks } from "./beacon.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
globalThis.location = { port: "8766" };
const q = new URLSearchParams({ beacon: "bbr", view: "worker" });

/** Every load is drawn and its report goes to dev-server.py's sink, carrying the controller, the page's port and the run's fields. */
test("the switch draws every load and names the sink and the run's fields", () => {
  const { telemetry } = beaconHooks(q, { step: 3, link: "wifi" });
  assert.deepEqual(telemetry, { rate: 1, url: BEACON_PATH, fields: { controller: "bbr", port: "8766", step: 3, link: "wifi" } });
});

/** One implementation: the switch's configuration draws the product's report, which carries the lab's fields and is sent to the sink. */
test("the product's report, under the switch, reaches the sink with the lab's fields", () => {
  const hooks = beaconHooks(q, { step: 3 });
  const sent = [];
  const r = loadReport(hooks.telemetry, { load: "L", ...hooks.telemetry.fields }, { random: () => 0.999, send: (url, body) => sent.push([url, JSON.parse(body)]) });
  r.end();
  assert.equal(sent[0][0], "/lab/beacon");
  assert.deepEqual([sent[0][1].controller, sent[0][1].port, sent[0][1].step], ["bbr", "8766", 3]);
});

/** console.error, which the product does not watch, is recorded on the report the page hands the switch, and still reaches the console. */
test("console.error is recorded on the page's report", () => {
  const hooks = beaconHooks(q);
  const said = [];
  const original = console.error;
  console.error = (...a) => said.push(a.join(" "));
  try {
    const errors = [];
    hooks.reported({ error: (source, message) => errors.push({ source, message }) });
    console.error("decode", 3);
    assert.deepEqual(errors, [{ source: "console.error", message: "decode 3" }]);
    assert.deepEqual(said, ["decode 3"]);
    assert.ok(hooks.report);
  } finally {
    console.error = original;
  }
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
console.log(`beacon: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
