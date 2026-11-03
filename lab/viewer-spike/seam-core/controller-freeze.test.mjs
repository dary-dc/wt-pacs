// node controller-freeze.test.mjs --core DIR — a defect of the core's controller, found by the seam on it. README.md here.
//   ... --fixed   the same test on the fix proposed for the core: the paint loop yields once before its first frame.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const core = process.argv[process.argv.indexOf("--core") + 1];
const view = join(core, "client/view");
let dir = view;
if (process.argv.includes("--fixed")) {
  dir = mkdtempSync(join(tmpdir(), "controller-"));
  copyFileSync(join(view, "store.js"), join(dir, "store.js"));
  const from = "this.#painting = (async () => {\n";
  const text = readFileSync(join(view, "controller.js"), "utf8");
  if (!text.includes(from)) throw new Error("the fix does not apply");
  writeFileSync(join(dir, "controller.js"), text.replace(from, `${from}      await null;\n`));
}
const { Controller } = await import(pathToFileURL(join(dir, "controller.js")));

/** A display change before the current frame arrives must not stop the frame from being painted once it does. */
const shown = [];
const meta = { frameCount: 2, window: { center: [0], width: [2] } };
const c = new Controller({ meta, fillMode: true, size: { width: 4, height: 4, dpr: 1 }, emit: (t, e) => t === "shown" && shown.push(e.i), paint: async () => ({}) });
c.setDisplay({ window: { center: 1, width: 2, function: "LINEAR" } });
c.take({ frameIndex: 0, info: { pixels: new SharedArrayBuffer(8), width: 2, height: 2, bits: 16, components: 1, signed: false, exact: true } });
await new Promise((r) => setTimeout(r, 10));
console.log(shown.length ? `pass  frame 0 painted after an early display change (${shown.length})` : "FAIL  frame 0 never painted: a repaint with no frame held leaves the controller's paint in flight for good");
process.exit(shown.length ? 0 : 1);
