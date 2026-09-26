/**
 * A slow CPU for a whole process tree: every thread in its own cgroup (v1 `cpu`), capped at 1/rate of
 * one CPU. Chromium's own throttle refuses worker targets, so it cannot slow a decoder; this can.
 * docs/decode/README.md §A slow CPU, emulated
 *
 *   const stop = throttleTree(chrome.pid, 4);  ...  stop();
 *   node lab/scripts/cpu_throttle.mjs --check [rates]   the lever on a page's thread and a worker's
 */
import fs from "node:fs";
import path from "node:path";

const CPU = "/sys/fs/cgroup/cpu";
/** The kernel's floor for a quota, in µs; the period is `rate` of these, so a stall is never longer than a few ms. */
const QUOTA_US = 1000;

function descendants(root) {
  const kids = new Map();
  for (const p of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(p)) continue;
    try {
      // `pid (comm) state ppid …`: comm may hold spaces and parentheses, so split after the last `)`.
      const stat = fs.readFileSync(`/proc/${p}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(p));
    } catch { /* exited while listed */ }
  }
  const out = [root];
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) ?? []));
  return out;
}

const threads = (pid) => { try { return fs.readdirSync(`/proc/${pid}/task`).map(Number); } catch { return []; } };

/** Caps every thread under `rootPid`, including those started later, until the returned `stop()`.
 *  With `cores`, the tree as a whole also gets `cores` slowed CPUs: a slow phone, not slow threads on a fast box. */
export function throttleTree(rootPid, rate, { everyMs = 10, cores } = {}) {
  if (rate === 1) return () => {};
  const base = path.join(CPU, `wtpacs-${process.pid}-${rootPid}`);
  fs.mkdirSync(base);
  if (cores) {
    fs.writeFileSync(path.join(base, "cpu.cfs_period_us"), String(QUOTA_US * rate));
    fs.writeFileSync(path.join(base, "cpu.cfs_quota_us"), String(QUOTA_US * cores));
  }
  const placed = new Set();
  const place = () => {
    for (const pid of descendants(rootPid)) {
      for (const tid of threads(pid)) {
        if (placed.has(tid)) continue;
        const g = path.join(base, `thread-${tid}`);
        try {
          fs.mkdirSync(g);
          fs.writeFileSync(path.join(g, "cpu.cfs_period_us"), String(QUOTA_US * rate));
          fs.writeFileSync(path.join(g, "cpu.cfs_quota_us"), String(QUOTA_US));
          fs.writeFileSync(path.join(g, "tasks"), String(tid));
          placed.add(tid);
        } catch { /* exited before it was placed */ }
      }
    }
  };
  place();
  const timer = setInterval(place, everyMs);
  // A group left behind outlives the run and holds whatever lands in it; a signal must still reach `exit`.
  for (const sig of ["SIGINT", "SIGTERM"]) if (!process.listenerCount(sig)) process.once(sig, () => process.exit(130));
  const stop = () => {
    process.off("exit", stop);
    clearInterval(timer);
    for (const g of fs.readdirSync(base).filter((d) => d.startsWith("thread-"))) {
      const dir = path.join(base, g);
      // A thread started meanwhile lands in its parent's group, and one exiting holds it until reaped.
      for (let tries = 0; ; tries++) {
        for (const tid of fs.readFileSync(path.join(dir, "tasks"), "utf8").split("\n").filter(Boolean)) {
          try { fs.writeFileSync(path.join(CPU, "tasks"), tid); } catch { /* exited */ }
        }
        try { fs.rmdirSync(dir); break; } catch (e) { if (e.code !== "EBUSY" || tries === 200) throw e; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    fs.rmdirSync(base);
  };
  process.once("exit", stop);
  return stop;
}

/** The lever measured: the same loop on a page's thread and in a worker, free and capped. */
async function check(rates) {
  const { spawn } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(import.meta.url)("playwright");
  const loop = "const t0 = performance.now(); let x = 0; for (let i = 0; i < 1e8; i++) x += i % 7;";
  const page = `<script>const w = new Worker(URL.createObjectURL(new Blob(['onmessage = () => { ${loop} postMessage(performance.now() - t0 + x * 0); }'])));
    const main = () => { ${loop} return performance.now() - t0 + x * 0; };
    const worker = () => new Promise((r) => { w.onmessage = (e) => r(e.data); w.postMessage(0); });
    (async () => { const out = []; for (let k = 0; k < 5; k++) out.push([main(), await worker()]); document.title = JSON.stringify(out); })();</script>`;
  for (const rate of rates) {
    const profile = fs.mkdtempSync("/tmp/throttle-check-");
    const chrome = spawn(process.env.CHROME_PATH || chromium.executablePath(), ["--headless=new", "--no-sandbox", "--disable-background-networking",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, `data:text/html,${encodeURIComponent(page)}`], { stdio: "ignore" });
    const stop = throttleTree(chrome.pid, rate);
    const port = await new Promise((r) => { const t = setInterval(() => {
      try { r(fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]); clearInterval(t); } catch { /* not yet */ }
    }, 100); });
    let title = "";
    while (!title.startsWith("[")) {
      await new Promise((r) => setTimeout(r, 500));
      title = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.title ?? "";
    }
    stop();
    await new Promise((r) => { chrome.once("exit", r); chrome.kill(); });
    const runs = JSON.parse(title).slice(1);
    const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[runs.length >> 1];
    console.log(`${rate}x  page thread ${med(0).toFixed(0)} ms  worker ${med(1).toFixed(0)} ms  (median of 4)`);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname && process.argv[2] === "--check") {
  await check((process.argv[3] || "1,4,6").split(",").map(Number));
  process.exit(0);
}
