// The rigs' Firefox driver: Marionette's framing, and, with FIREFOX_PATH, a worker starting 300 workers under it.
//   NODE_PATH=$(npm root -g) [FIREFOX_PATH=... DISPLAY=:99] node lab/opfs-cache/browser.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { firefoxAt, marionetteMessages, staticHost } from "./browser.mjs";

const frame = (v) => { const b = Buffer.from(JSON.stringify(v)); return Buffer.concat([Buffer.from(`${b.length}:`), b]); };

/** Two messages in one chunk come out whole, and nothing is left over. */
{
  const { messages, rest } = marionetteMessages(Buffer.concat([frame([1, 1, null, { value: 1 }]), frame({ marionetteProtocol: 3 })]));
  assert.deepEqual(messages, [[1, 1, null, { value: 1 }], { marionetteProtocol: 3 }]);
  assert.equal(rest.length, 0);
}

/** A message cut inside its length or its body waits for the rest, then comes out whole. */
{
  const whole = frame([1, 7, null, { value: "a".repeat(40) }]);
  for (const cut of [1, 3, 20, whole.length - 1]) {
    const first = marionetteMessages(whole.subarray(0, cut));
    assert.deepEqual(first.messages, []);
    assert.deepEqual(marionetteMessages(Buffer.concat([first.rest, whole.subarray(cut)])).messages, [[1, 7, null, { value: "a".repeat(40) }]]);
  }
}

/** The length counts bytes, not characters: a status with "·" in it is read whole and the next message after it. */
{
  const { messages } = marionetteMessages(Buffer.concat([frame([1, 2, null, { value: "frame 1 · received 0" }]), frame([1, 3, null, { value: 2 }])]));
  assert.deepEqual(messages, [[1, 2, null, { value: "frame 1 · received 0" }], [1, 3, null, { value: 2 }]]);
}
console.log("marionette framing: ok");

/** Under the driver, a worker starts 300 workers one after another: none hangs (under a WebDriver BiDi session one did within 22–73). */
if (process.env.FIREFOX_PATH) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "nested-workers-"));
  const b = await firefoxAt(profile);
  try {
    await b.page.goto(`${await staticHost()}/lab/opfs-cache/test/nested-workers.html?n=300`);
    let started = 0;
    for (let last = -1, at = Date.now(); started < 300 && Date.now() - at < 10000; await new Promise((r) => setTimeout(r, 200))) {
      started = await b.page.evaluate(() => globalThis.started);
      if (started !== last) (last = started, at = Date.now());
    }
    assert.equal(started, 300, `the nested workers stopped at ${started} of 300`);
    console.log("nested workers under the driver: ok");
  } finally {
    await b.context.close();
    rmSync(profile, { recursive: true, force: true });
  }
} else {
  console.log("skipped: nested workers under the driver — no FIREFOX_PATH");
}
process.exit(0);
