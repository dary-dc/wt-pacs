// The seam on our core: Cornerstone3D's tools on a viewport our view worker paints, fed by our transport. README.md here.
//   NODE_PATH=$(npm root -g) node run.mjs --core DIR --series X.sbnd     every check, then every mutant against the check it must fail
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { seriesServer, staticHost } from "./host.mjs";
import { CHECKS, MUTANTS } from "./checks.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(HERE, "../../.."));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const core = arg("--core"), sbnd = arg("--series"), only = arg("--only");

export async function bundle(mutant) {
  const patch = {
    name: "mutant",
    setup(b) {
      // xmlbuilder2, under @cornerstonejs/tools, imports two Node builtins; the spike never builds XML.
      b.onResolve({ filter: /^(url|events)$/ }, ({ path }) => ({ path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class EventEmitter {}; export default { EventEmitter, URL };", loader: "js" }));
      b.onLoad({ filter: /(core-viewport|page)\.js$/ }, async ({ path }) => {
        const text = await readFile(path, "utf8");
        if (!mutant || !path.endsWith(mutant.file ?? "core-viewport.js")) return { contents: text, loader: "js" };
        if (!text.includes(mutant.from)) throw new Error(`mutant "${mutant.name}" does not apply`);
        return { contents: text.replace(mutant.from, mutant.to), loader: "js" };
      });
    },
  };
  const out = await build({ entryPoints: [join(HERE, "page.js")], bundle: true, format: "esm", write: false, external: ["/client/*"], plugins: [patch], logLevel: "silent" });
  return out.outputFiles[0].contents;
}

export async function hosts() {
  const series = await seriesServer(core, sbnd);
  const page = { current: await bundle(null) };
  const routes = {
    "/lab/viewer-spike/seam-core/dist/page.js": () => page.current,
    "/series/metadata": () => series.metadata,
    "/wt/dev-transport.json": () => JSON.stringify(series.transport),
  };
  const server = await staticHost({ core, root: ROOT, routes, wt: series.wt });
  return { page, server, url: `http://127.0.0.1:${server.address().port}/lab/viewer-spike/seam-core/index.html` };
}

/** A fresh tab on the page, once both viewports are open and every frame has arrived. */
export async function visit(browser, url, { viewport = { width: 560, height: 220 } } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.spikeReady || window.spikeError, null, { timeout: 60_000 });
  const failed = await page.evaluate(() => window.spikeError);
  if (failed) throw new Error(failed);
  await page.waitForFunction(() => Object.values(spike.viewports).every((v) => v.heard.some((e) => e.type === "progress" && e.have === e.total)), null, { timeout: 60_000 });
  return { page, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { page: pageRef, server, url } = await hosts();
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  const names = only ? only.split(",") : Object.keys(CHECKS);
  let bad = 0;
  const run = async (list) => {
    const { page, errors } = await visit(browser, url);
    const out = { renderer: await page.evaluate(() => spike.viewports.vp1.heard.find((e) => e.type === "renderer")?.renderer) };
    for (const name of list) {
      try {
        await page.evaluate(() => spike.reset());
        out[name] = await CHECKS[name](page);
      } catch (e) {
        out[name] = { ok: false, seen: `threw: ${e.message.split("\n")[0]}` };
      }
    }
    out.errors = errors;
    await page.close();
    return out;
  };
  try {
    const clean = await run(names);
    console.log(`Chromium ${browser.version()}, ${clean.renderer}`);
    for (const name of names) {
      console.log(`${clean[name].ok ? "pass" : "FAIL"}  ${name}: ${clean[name].seen}`);
      if (!clean[name].ok) bad++;
    }
    if (clean.errors.length) console.log(`page errors: ${clean.errors.join(" | ")}`);
    for (const m of MUTANTS.filter((m) => names.includes(m.check))) {
      pageRef.current = await bundle(m);
      const r = (await run([m.check]))[m.check];
      console.log(`${r.ok ? "MISSED" : "caught"}  mutant "${m.name}" by ${m.check}: ${r.seen}`);
      if (r.ok) bad++;
    }
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(bad ? 1 : 0);
}
