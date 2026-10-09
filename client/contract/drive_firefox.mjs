// Drive a test page in a stock headless Firefox, print its log, and exit with its failure count.
// usage: FIREFOX_PATH=... node drive_firefox.mjs URL [timeout_ms]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const [url, timeoutMs = 300000] = process.argv.slice(2);
let done;
const result = new Promise((r) => (done = r));
const collector = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end();
    done(JSON.parse(body));
  });
});
await new Promise((r) => collector.listen(0, "127.0.0.1", r));
const profile = mkdtempSync(path.join(tmpdir(), "ff-"));
writeFileSync(path.join(profile, "user.js"), 'user_pref("browser.shell.checkDefaultBrowser", false);\n');
const post = `http://127.0.0.1:${collector.address().port}/`;
const ff = spawn(process.env.FIREFOX_PATH, ["--headless", "--no-remote", "--profile", profile, `${url}&post=${encodeURIComponent(post)}`],
  { stdio: "ignore", detached: true });
const timer = setTimeout(() => done({ failed: 1, log: `FAIL: no result in ${timeoutMs} ms` }), Number(timeoutMs));
const { failed, log } = await result;
clearTimeout(timer);
process.kill(-ff.pid, "SIGKILL");
rmSync(profile, { recursive: true, force: true });
console.log(log);
process.exit(failed ? 1 : 0);
