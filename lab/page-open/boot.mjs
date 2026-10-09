/**
 * BOOT: the downloader's worker graph booted sooner, as four pages beside first-byte.html.
 * `bundle` preloads one file holding the worker and its transport; `blob` carries the worker's
 * script in the page; `both` carries the bundle in the page; `page` carries the consumer too, so
 * nothing is fetched before the dial. lab/page-open/README.md §The worker graph's boot
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = path.join(ROOT, "lab/page-open/boot");
export const BOOT_STAGES = ["bundle", "blob", "both", "page"];
export const BUNDLE = "/lab/page-open/boot/downloader.bundle.js";

const WORKER_PRELOAD = '  <link rel="preload" as="script" href="/client/transport/downloader.js" />';
const CONSUMER_PRELOAD = '  <link rel="modulepreload" href="/client/transport/consumer.js" />';
const CONSUMER_IMPORT = '    import { DownloaderClient } from "/client/transport/consumer.js";';
const TRANSPORT_IMPORT = "import(cfg.transport ?? DEFAULT_TRANSPORT)";

function bundle() {
  const esbuild = createRequire(path.join(ROOT, "client/transport/ts/package.json"))("esbuild");
  const src = path.join(ROOT, "client/transport/downloader.js");
  const code = fs.readFileSync(src, "utf8");
  if (!code.includes(TRANSPORT_IMPORT)) throw new Error(`downloader.js no longer has ${TRANSPORT_IMPORT}`);
  // A literal specifier is one esbuild inlines; the seam stays for a page that names another transport.
  const inlined = code.replace(TRANSPORT_IMPORT, `(cfg.transport ? import(cfg.transport) : import("wtpacs-transport"))`);
  const out = esbuild.buildSync({
    stdin: { contents: inlined, resolveDir: path.dirname(src), sourcefile: "downloader.js" },
    alias: { "wtpacs-transport": path.join(ROOT, "client/transport/ts/session.ts") },
    bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
  });
  const js = out.outputFiles[0].text;
  if (js.match(/\bimport\(/g).length !== 1 || !js.includes("import(cfg.transport)")) {
    throw new Error("the bundle still imports its transport over the wire");
  }
  return js;
}

/** The worker's source as the page's text: no `</script` inside it may end the element early. */
function embed(page, js) {
  if (/<\/script/i.test(js)) throw new Error("the worker's source holds </script and cannot be embedded");
  return page.replace("</body>", `  <script type="text/plain" id="worker-src">${js}</script>\n</body>`);
}

/** Writes boot/<stage>.html for each stage and the bundle they share; returns the files written. */
export function buildBoot() {
  const page = fs.readFileSync(path.join(ROOT, "lab/page-open/first-byte.html"), "utf8");
  for (const line of [WORKER_PRELOAD, CONSUMER_PRELOAD, CONSUMER_IMPORT]) {
    if (!page.includes(line)) throw new Error(`first-byte.html no longer has ${line.trim()}`);
  }
  const js = bundle();
  const worker = fs.readFileSync(path.join(ROOT, "client/transport/downloader.js"), "utf8");
  const consumer = fs.readFileSync(path.join(ROOT, "client/transport/consumer.js"), "utf8");
  if (!consumer.includes("export class DownloaderClient")) throw new Error("consumer.js no longer exports the class alone");
  if (/<\/script/i.test(consumer)) throw new Error("consumer.js holds </script and cannot be inlined");
  const both = embed(page.replace(WORKER_PRELOAD + "\n", ""), js);
  const pages = {
    bundle: page.replace(WORKER_PRELOAD, `  <link rel="preload" as="script" href="${BUNDLE}" />`),
    blob: embed(page.replace(WORKER_PRELOAD + "\n", ""), worker),
    both,
    page: both.replace(CONSUMER_PRELOAD + "\n", "")
      .replace(CONSUMER_IMPORT, () => consumer.replace("export class DownloaderClient", "class DownloaderClient")),
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, BUNDLE), js);
  for (const [stage, html] of Object.entries(pages)) fs.writeFileSync(path.join(OUT, `${stage}.html`), html);
  return Object.fromEntries([["bundle.js", js], ...Object.entries(pages)].map(([k, v]) => [k, Buffer.byteLength(v)]));
}

export function removeBoot() {
  fs.rmSync(OUT, { recursive: true, force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(buildBoot());
