#!/usr/bin/env python3
"""What a browser receives from each server arm, and what every thread spends to receive it.

The TS harness cell in headless Chromium against several server binaries at once, arms
interleaved and their order reversed every repeat. Around each run: CPU per thread of the
server and of every Chromium process (`/proc/*/task/*/schedstat`, ns), and the datagrams the
client socket dropped (`Udp: RcvbufErrors`). Needs the static host (`server/dev-server.py
--port 8765`) and `client/transport-ts/dist`. `docs/rig-limits.md`.

usage: browser_receive.py <fixture> <cell> <n> <depth> <repeats> \\
         <label-a> <bin-a> [server args...] -- <label-b> <bin-b> [server args...] [-- ...]
<depth> is the shell's own loop, or `w:N` / `w:auto` for the library's window.
An arm arg `@rmem=<bytes>` sets `net.core.rmem_max` for that arm's runs (root), restored after.
One TSV row per run: label arm cell depth asked wall_ms mb_per_s delivered failed sock_drops
rcvbuf_drops in_datagrams srv_ms ns_main_ms ns_io_ms rend_main_ms rend_other_ms chrome_other_ms heap_peak_mb
"""
import hashlib, json, os, signal, socket, subprocess, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
HTTP = int(os.environ.get("HTTP_PORT", "8765"))
RMEM = Path("/proc/sys/net/core/rmem_max")

fixture, cell, n, depth, reps = sys.argv[1:6]
n, reps = int(n), int(reps)
ask = f"w={depth[2:]}" if depth.startswith("w:") else f"d={int(depth)}"
if os.environ.get("INTERVAL_MS"): ask += f"&interval_ms={int(os.environ['INTERVAL_MS'])}"
frame_bytes = json.loads((Path(fixture).parent / "metadata.json").read_text())["meanFrameBytes"]

arms = []
rest = sys.argv[6:]
while rest:
    cut = rest.index("--") if "--" in rest else len(rest)
    label, bin_, *args = rest[:cut]
    rmem = next((int(a[6:]) for a in args if a.startswith("@rmem=")), None)
    arms.append((label, bin_, [a for a in args if not a.startswith("@rmem=")], rmem))
    rest = rest[cut + 1:]


def free_udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def udp_counters():
    for line in Path("/proc/net/snmp").read_text().splitlines():
        if line.startswith("Udp:") and not line.split()[1].startswith("In"):
            v = line.split()
            return int(v[1]), int(v[5])  # InDatagrams, RcvbufErrors
    return 0, 0


def socket_drops(port):
    """Datagrams the kernel dropped on the one UDP socket connected to `port` (`/proc/net/udp`)."""
    total = 0
    for line in Path("/proc/net/udp").read_text().splitlines()[1:]:
        v = line.split()
        if v[2].endswith(f":{port:04X}"):
            total += int(v[-1])
    return total


def run_ns(pid):
    """Per-thread CPU time (ns) of one process, keyed by tid; missing threads read 0."""
    out = {}
    for t in Path(f"/proc/{pid}/task").glob("*"):
        try:
            out[(pid, int(t.name))] = (int((t / "schedstat").read_text().split()[0]), (t / "comm").read_text().strip())
        except (OSError, ValueError, IndexError):
            pass
    return out


def chrome_tree():
    """pid -> process kind for every Chromium process: browser, renderer, ns, other."""
    kinds = {}
    for p in Path("/proc").glob("[0-9]*"):
        try:
            argv = (p / "cmdline").read_bytes().split(b"\0")
        except OSError:
            continue
        if not argv or not argv[0].startswith(CHROME.encode()):
            continue
        line = b" ".join(argv)  # a zygote child carries its whole command line in argv[0]
        if b"--type=renderer" in line: kind = "renderer"
        elif b"network.mojom.NetworkService" in line: kind = "ns"
        elif b"--type=" not in line: kind = "browser"
        else: kind = "other"
        kinds[int(p.name)] = kind
    return kinds


def snapshot(srv_pid):
    snap = {"srv": run_ns(srv_pid)}
    for pid, kind in chrome_tree().items():
        snap.setdefault(kind, {}).update(run_ns(pid))
    return snap


def spent_ms(before, after, kind, which):
    """ms of CPU in `kind` processes' threads named by `which`: main, io, other."""
    total = 0
    for (pid, tid), (ns, comm) in after.get(kind, {}).items():
        name = "main" if tid == pid else ("io" if comm.startswith(("Chrome_ChildIOT", "Chrome_IOThread")) else "other")
        if name != which: continue
        total += ns - before.get(kind, {}).get((pid, tid), (0, ""))[0]
    return total / 1e6


def start_server(bin_, args):
    port = free_udp()
    env = dict(os.environ, NO_COLOR="1", RUST_LOG="exact_server=error")
    srv = subprocess.Popen([bin_, "--port", str(port), "--study", fixture, "--bind", "127.0.0.1",
                            "--cert-pem", str(cert), "--key-pem", str(ROOT / "server/dev-cert/key.pem"), *args],
                           cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    frames = None
    for line in srv.stdout:
        if line.startswith("frames="): frames = int(line.strip().split("=")[1])
        if line.startswith("telemetry="): break
    threading.Thread(target=lambda: [None for _ in srv.stdout], daemon=True).start()
    return srv, port, frames


cert = ROOT / "server/dev-cert/cert.pem"
pin = hashlib.sha256(subprocess.check_output(["openssl", "x509", "-in", str(cert), "-outform", "DER"])).hexdigest()
servers = [start_server(b, a) for (_, b, a, _) in arms]
frames = servers[0][2]
rmem_default = int(RMEM.read_text()) if RMEM.exists() else None


def one_run(browser, i, r):
    label, _, _, rmem = arms[i]
    srv, port, _ = servers[i]
    if rmem is not None: RMEM.write_text(str(rmem))
    (ROOT / "client/dev-transport.json").write_text(json.dumps({"wt_url": f"https://127.0.0.1:{port}/", "cert_sha256": pin}) + "\n")
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    url = f"http://127.0.0.1:{HTTP}/harness/ts.html?cell={cell}&stream_mode=shared&{ask}&n={n}&frames={frames}"
    page.goto(url, wait_until="networkidle", timeout=30_000)
    in0, drop0 = udp_counters()
    sock0 = socket_drops(port)
    before = snapshot(srv.pid)
    page.click("#run")
    page.wait_for_function("() => globalThis.__wtpacsShell != null || globalThis.__wtpacsError != null", timeout=180_000)
    after = snapshot(srv.pid)
    sock1 = socket_drops(port)
    in1, drop1 = udp_counters()
    err = page.evaluate("() => globalThis.__wtpacsError ?? null")
    s = page.evaluate("() => globalThis.__wtpacsShell ?? null")
    page.close()
    if rmem is not None and rmem_default is not None: RMEM.write_text(str(rmem_default))
    if err or errors:
        print("ERROR", label, err, errors, file=sys.stderr); sys.exit(1)
    if r == 0:
        return
    asked = s["asked"]
    mb_s = asked * frame_bytes / 1e6 / (s["wall_ms"] / 1e3)
    cols = [f"r{r}", label, cell, depth, asked, s["wall_ms"], f"{mb_s:.1f}", s["delivered"], s["failed"], sock1 - sock0, drop1 - drop0, in1 - in0,
            f"{spent_ms(before, after, 'srv', 'main') + spent_ms(before, after, 'srv', 'io') + spent_ms(before, after, 'srv', 'other'):.1f}",
            f"{spent_ms(before, after, 'ns', 'main'):.1f}", f"{spent_ms(before, after, 'ns', 'io'):.1f}",
            f"{spent_ms(before, after, 'renderer', 'main'):.1f}",
            f"{spent_ms(before, after, 'renderer', 'io') + spent_ms(before, after, 'renderer', 'other'):.1f}",
            f"{sum(spent_ms(before, after, k, w) for k in ('browser', 'other') for w in ('main', 'io', 'other')) + spent_ms(before, after, 'ns', 'other'):.1f}",
            f"{(s['js_heap_bytes']['peak'] or 0) / 1e6:.1f}"]
    print("\t".join(str(c) for c in cols), flush=True)


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, args=["--enable-features=WebTransport", "--no-sandbox"])
        print("label\tarm\tcell\tdepth\tasked\twall_ms\tmb_per_s\tdelivered\tfailed\tsock_drops\trcvbuf_drops\tin_datagrams\tsrv_ms\tns_main_ms\tns_io_ms\trend_main_ms\trend_other_ms\tchrome_other_ms\theap_peak_mb")
        for i in range(len(arms)):
            one_run(browser, i, 0)
        for r in range(1, reps + 1):
            order = range(len(arms)) if r % 2 else range(len(arms) - 1, -1, -1)
            for i in order:
                one_run(browser, i, r)
        browser.close()
finally:
    if rmem_default is not None and RMEM.exists(): RMEM.write_text(str(rmem_default))
    for srv, _, _ in servers:
        srv.send_signal(signal.SIGTERM)
    for srv, _, _ in servers:
        try: srv.wait(timeout=3)
        except subprocess.TimeoutExpired: srv.kill()
