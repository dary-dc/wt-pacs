/**
 * What each engine's VideoDecoder.isConfigSupported answers for each codecs string: the strings check.mjs derived,
 * each with level 31 in place of its own, its short form, and the fixed string the client used before. Engines
 * launched as lab/av1/xbrowser launches them. Queue row 67; README.md
 *
 *   node lab/av1/codecstr/run.mjs strings.json [--engines chromium,firefox,webkit] [--out answers.json]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const derived = [...new Set(JSON.parse(readFileSync(process.argv[2], "utf8")).map((r) => r.codec))].sort();
const OUT = arg("--out", null);
const DISPLAY = ":79";
const variants = (c) => {
  const f = c.split(".");
  return [c, [...f.slice(0, 2), `31${f[2].slice(2)}`, ...f.slice(3)].join("."), f.slice(0, 4).join(".")];
};
const strings = [...new Set([...derived.flatMap(variants), "av01.0.04M.10"])];

const ENGINES = {
  chromium: (url, dir) => [process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${dir}`, url]],
  firefox: (url, dir) => {
    writeFileSync(join(dir, "user.js"), 'user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.aboutwelcome.enabled", false);\n');
    return [process.env.FIREFOX_PATH, ["--headless", "--no-remote", "--profile", dir, url]];
  },
  webkit: (url) => [process.env.MINIBROWSER_PATH ?? "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser", [url]],
};

let done = null;
const server = createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => (res.writeHead(200).end(), done(JSON.parse(body))));
    return;
  }
  if (req.url === "/cs/strings") return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(strings));
  res.writeHead(200, { "Content-Type": "text/html" }).end(readFileSync(new URL("index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PAGE = `http://127.0.0.1:${server.address().port}/`;
const names = arg("--engines", "chromium,firefox,webkit").split(",");
const xvfb = names.includes("webkit") && spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
if (xvfb) await new Promise((r) => setTimeout(r, 1000));

const results = {};
for (const engine of names) {
  const dir = mkdtempSync(join(tmpdir(), "cs-"));
  const [bin, args] = ENGINES[engine](PAGE, dir);
  const proc = spawn(bin, args, { env: { ...process.env, DISPLAY, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", MOZ_CRASHREPORTER_DISABLE: "1" }, stdio: "ignore" });
  results[engine] = await new Promise((r) => { done = r; setTimeout(() => r({ error: "no answer in 60 s" }), 60000); });
  proc.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
if (xvfb) xvfb.kill();
server.close();

console.log(["codec", ...names].join("\t"));
for (const s of strings) console.log([s, ...names.map((e) => results[e].answers?.[s] ?? results[e].error)].join("\t"));
for (const e of names) console.log(`${e}: ${results[e].ua}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ strings, results }, null, 1));
process.exit(0);
