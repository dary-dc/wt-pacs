"""Busy cores of the host, every 0.25 s, as `epoch_ms busy` lines: /proc/stat's all-CPU line. python3 busy.py OUT"""
import sys, time
def read():
    v = list(map(int, open("/proc/stat").readline().split()[1:]))
    return sum(v), v[3] + v[4]
with open(sys.argv[1], "w") as out:
    t0, i0 = read()
    while True:
        time.sleep(0.25)
        t, i = read()
        out.write(f"{time.time()*1000:.0f} {4 * (1 - (i - i0) / max(t - t0, 1)):.2f}\n"); out.flush()
        t0, i0 = t, i
