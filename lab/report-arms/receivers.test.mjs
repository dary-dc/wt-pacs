// node lab/report-arms/receivers.test.mjs — cell R's readings (report-plan.md §7.3): a burst sends `rate` reports a
// second, evenly spaced, for its seconds; a process's CPU is its user and system ticks; its peak RSS is VmHWM; the
// cost is per 1 000 reports sent; the rotation over rounds puts each receiver first once in turn.
import { ticks, cpuSeconds, peakKb, perThousand, rotation } from "./receivers.mjs";

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

if (failed) process.exit(1);
console.log("report-arms: cell R's readings hold");
