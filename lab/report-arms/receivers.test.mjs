// node lab/report-arms/receivers.test.mjs — cell R's readings (report-plan.md §7.3): a burst sends `rate` reports a
// second, evenly spaced, for its seconds; a process's CPU is its user and system ticks; its peak RSS is VmHWM; the
// cost is per 1 000 reports sent; the rotation over rounds puts each receiver first once in turn; each source address
// sends under NGINX's per-address limit; only a line that was appended counts as written.
import { ticks, cpuSeconds, peakKb, perThousand, rotation, sources, appended } from "./receivers.mjs";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

{
  const t = ticks(10, 2);
  check(t.length === 20 && t[0] === 0 && t[1] === 100 && t[19] === 1900, `ticks: 10 a second for 2 s (${t.slice(0, 3)}…${t.at(-1)})`);
  check(ticks(1000, 1).length === 1000 && ticks(1000, 1)[999] === 999, "ticks: 1 000 a second");
}
{
  const stat = "4242 (nginx: worker (x)) S 1 2 3 4 5 6 7 8 9 10 150 50 7 9 20 0 1 0 100 2000 300";
  check(cpuSeconds(stat, 100) === 2, `cpu: utime and stime, not the children's, in seconds (${cpuSeconds(stat, 100)})`);
}
{
  const status = "Name:\tnginx\nVmPeak:\t  9000 kB\nVmHWM:\t    5120 kB\nVmRSS:\t    4000 kB\n";
  check(peakKb(status) === 5120, `rss: VmHWM (${peakKb(status)})`);
}
{
  check(perThousand(0.5, 2000) === 0.25, "per 1 000: CPU seconds over the reports sent");
  check(perThousand(0.5, 0) === null, "per 1 000: none sent, no cost");
}
{
  const r = [0, 1, 2].map((k) => rotation(["nginx", "receiver", "server"], k));
  check(JSON.stringify(r) === JSON.stringify([["nginx", "receiver", "server"], ["receiver", "server", "nginx"], ["server", "nginx", "receiver"]]),
    `rotation: each first in turn (${JSON.stringify(r)})`);
}

{
  for (const rate of [10, 12, 100, 1000, 2000]) {
    const t = ticks(rate, 2);
    const from = sources(rate);
    const per = new Map();
    t.forEach((at, k) => { const a = from[k % from.length]; per.set(a, [...(per.get(a) ?? []), at]); });
    const fastest = Math.max(...[...per.values()].map((ats) => Math.max(...ats.map((at) => ats.filter((x) => x >= at && x < at + 1000).length))));
    check(fastest <= 5 && from.every((a) => /^127\.\d+\.\d+\.\d+$/.test(a)) && new Set(from).size === from.length,
          `sources at ${rate}/s: each address under 5 a second, all in 127/8, none twice (${from.length} addresses, ${fastest} in a second)`);
  }
}
{
  const log = ['{"t":"x","s":"204","r":"{}"}', '{"t":"x","s":"429","r":"{}"}', '{"t":"x","s":"403","r":"{}"}', '{"t":1,"r":{}}', ""].join("\n");
  check(appended(log) === 2, `lines: NGINX's 2xx lines and RECEIVER's lines, not the refused (${appended(log)})`);
}

if (failed) process.exit(1);
console.log("report-arms: cell R's readings hold");
