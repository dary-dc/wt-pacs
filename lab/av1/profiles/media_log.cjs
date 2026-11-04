// The WebCodecs decoder Chromium reports in its media log (CDP Media domain), for README.md §6; run from the repo root.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
(async () => {
  const http = spawn("python3", ["server/dev-server.py", "--port", "31998"], { cwd: "/home/user/wt-pacs", stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1000));
  const b = await chromium.launch(); const p = await b.newPage();
  const cdp = await p.context().newCDPSession(p);
  const events = [];
  for (const e of ["playerPropertiesChanged", "playerEventsAdded", "playerMessagesLogged", "playersCreated"]) cdp.on(`Media.${e}`, (x) => events.push([e, x]));
  await cdp.send("Media.enable");
  await p.goto("http://127.0.0.1:31998/lab/av1/profiles/media_log.html"); await p.waitForFunction(() => globalThis.ready);
  console.log("frames", await p.evaluate(() => run("/lab/.av1-work/profiles-decode/dbts_a1/top10-q16-g1/020.obu")));
  await new Promise((r) => setTimeout(r, 1500));
  console.log(b.version());
  console.log(JSON.stringify(events, null, 0).slice(0, 3000));
  await b.close(); http.kill();
})();
