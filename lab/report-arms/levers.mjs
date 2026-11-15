// The endings' levers that need no engine protocol (report-plan.md §7.6): a content process killed by its place in
// the spawned browser's process tree, the browser itself, and the relay's blackout.
import { readdirSync, readFileSync } from "node:fs";
import { createSocket } from "node:dgram";

function proc(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
    return { pid: Number(pid), ppid, cmd };
  } catch {
    return null;
  }
}

export function descendants(root) {
  const all = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(proc).filter(Boolean);
  const out = [];
  const walk = (pid) => all.filter((p) => p.ppid === pid).forEach((p) => (out.push(p), walk(p.pid)));
  walk(root);
  return out;
}

/** SIGKILL every descendant of `root` whose command line matches; the pids killed. */
export function killMatching(root, pattern) {
  const hit = descendants(root).filter((p) => pattern.test(p.cmd));
  for (const p of hit) process.kill(p.pid, "SIGKILL");
  return hit.map((p) => p.pid);
}

/** `blackout <ms>` to link_impair.py's --control-port. */
export function blackout(port, ms, host = "127.0.0.1") {
  const s = createSocket("udp4");
  return new Promise((ok, fail) => s.send(`blackout ${ms}`, port, host, (e) => (s.close(), e ? fail(e) : ok())));
}
