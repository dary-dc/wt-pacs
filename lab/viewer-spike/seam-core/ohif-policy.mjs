// OHIF's built app, unchanged, under our page's isolation headers and policy: what is refused, and whether it boots.
//   NODE_PATH=$(npm root -g) node ohif-policy.mjs --dist DIR      DIR: dist/ of `npm pack @ohif/app@VERSION`. README.md here.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { policy } from "./host.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const dist = process.argv[process.argv.indexOf("--dist") + 1];
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml" };

/** Each arm: the headers on every response. `ours` is the product's (deploy/README.md), connecting to the page's origin alone. */
const ARMS = {
  ours: { isolated: true, csp: policy("'self'") },
  "ours with 'unsafe-inline'": { isolated: true, csp: policy("'self'").replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") },
  "isolation alone": { isolated: true, csp: null },
};

function serve({ isolated, csp }) {
  const server = createServer(async (req, res) => {
    let path = new URL(req.url, "http://x").pathname;
    if (!extname(path)) path = "/index.html";
    if (isolated) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    }
    if (csp) res.setHeader("Content-Security-Policy", csp);
    try {
      const body = await readFile(join(dist, normalize(path)));
      res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function visit(browser, arm) {
  const server = await serve(arm);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
  await page.addInitScript(() => {
    window.__refused = [];
    addEventListener("securitypolicyviolation", (e) => window.__refused.push(`${e.effectiveDirective} ${e.blockedURI || "?"} ${e.sourceFile ? e.sourceFile.split("/").pop() : ""}:${e.lineNumber}`));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => ({
    isolated: crossOriginIsolated,
    refused: window.__refused,
    rendered: document.getElementById("root")?.innerText.slice(0, 80).replace(/\s+/g, " ") ?? "",
    publicUrl: window.PUBLIC_URL ?? null,
  }));
  await page.close();
  server.close();
  return { ...r, errors };
}

/** Each check states its claim about OHIF unchanged; `refused` counts by directive. */
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
let bad = 0;
try {
  const out = {};
  for (const [name, arm] of Object.entries(ARMS)) {
    out[name] = await visit(browser, arm);
    const r = out[name];
    const inline = r.refused.filter((v) => v.startsWith("script-src-elem inline")).length;
    console.log(`${name}: isolated ${r.isolated}; ${r.refused.length} refused (${inline} inline scripts): ${r.refused.slice(0, 8).join(" | ")}; PUBLIC_URL ${r.publicUrl}; page errors ${r.errors.length}: ${r.errors.slice(0, 3).join(" | ")}; root text "${r.rendered}"`);
  }
  /** Under our policy the page's two inline scripts are refused; allowing inline scripts is what lets them run. */
  const inline = (n) => out[n].refused.filter((v) => v.startsWith("script-src-elem inline")).length;
  const claim = inline("ours") === 2 && inline("ours with 'unsafe-inline'") === 0;
  console.log(`${claim ? "pass" : "FAIL"}  OHIF's inline scripts: ${inline("ours")} refused under ours, ${inline("ours with 'unsafe-inline'")} with 'unsafe-inline'`);
  if (!claim) bad++;
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
