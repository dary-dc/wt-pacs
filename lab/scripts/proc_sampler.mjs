/**
 * A browser's resources, per process and per thread, from /proc: each process's kind and its peak
 * PSS and RSS (`smaps_rollup`), each thread's name and on-CPU time (`schedstat`). Polls a process
 * tree until `stop()`, which sums them by kind and by thread name. docs/ARCHITECTURE.md §Resources
 *
 *   const s = sampleTree(chrome.pid);  ...  const { kinds, threads } = s.stop();
 */
import fs from "node:fs";

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };

function tree(root) {
  const kids = new Map();
  for (const p of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(p)) continue;
    const stat = read(`/proc/${p}/stat`);
    if (!stat) continue;
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(Number(p));
  }
  const out = [root];
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) ?? []));
  return out;
}

/** Chromium's `--type=` and, for a utility process, what it hosts: `browser` when there is none. */
function kind(pid) {
  // Chromium rewrites its title, so a child's arguments may be one space-separated string.
  const args = read(`/proc/${pid}/cmdline`).split(/[\0 ]/);
  const type = args.find((a) => a.startsWith("--type="))?.slice(7);
  const sub = args.find((a) => a.startsWith("--utility-sub-type="))?.slice(19).split(".").pop();
  return type ? (sub ? `${type}:${sub}` : type) : "browser";
}

/** kB, as smaps_rollup prints them. */
function memory(pid) {
  const text = read(`/proc/${pid}/smaps_rollup`);
  const kb = (k) => Number(text.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
  return { pss: kb("Pss"), rss: kb("Rss") };
}

export function sampleTree(rootPid, { everyMs = 100 } = {}) {
  const procs = new Map();
  const threads = new Map();
  let first = true;
  const tick = () => {
    for (const pid of tree(rootPid)) {
      if (!procs.has(pid)) procs.set(pid, { kind: kind(pid), pss: 0, rss: 0, threads: 0 });
      const p = procs.get(pid);
      const m = memory(pid);
      p.pss = Math.max(p.pss, m.pss);
      p.rss = Math.max(p.rss, m.rss);
      let tids = [];
      try { tids = fs.readdirSync(`/proc/${pid}/task`); } catch { continue; }
      p.threads = Math.max(p.threads, tids.length);
      for (const tid of tids) {
        // schedstat: ns on a CPU, ns waiting for one, timeslices.
        const [run, wait] = read(`/proc/${pid}/task/${tid}/schedstat`).split(" ").map(Number);
        if (!Number.isFinite(run)) continue;
        // One that appears later was started later, so all of its time is inside the window.
        const t = threads.get(tid) ??
          { name: read(`/proc/${pid}/task/${tid}/comm`).trim(), kind: p.kind, run0: first ? run : 0, wait0: first ? wait : 0 };
        threads.set(tid, { ...t, run, wait });
      }
    }
    first = false;
  };
  tick();
  const timer = setInterval(tick, everyMs);
  return {
    stop() {
      clearInterval(timer);
      tick();
      const kinds = {};
      for (const p of procs.values()) {
        const k = (kinds[p.kind] ??= { processes: 0, pss_mb: 0, rss_mb: 0, threads: 0 });
        k.processes += 1;
        k.pss_mb += p.pss / 1024;
        k.rss_mb += p.rss / 1024;
        k.threads += p.threads;
      }
      const byName = {};
      for (const t of threads.values()) {
        const k = (byName[`${t.kind} ${t.name}`] ??= { threads: 0, cpu_ms: 0, wait_ms: 0 });
        k.threads += 1;
        k.cpu_ms += (t.run - t.run0) / 1e6;
        k.wait_ms += (t.wait - t.wait0) / 1e6;
      }
      return { kinds, threads: byName };
    },
  };
}
