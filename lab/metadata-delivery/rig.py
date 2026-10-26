"""What the link cells and the host cells share: the certificate, the web root, nginx and the serving process.

The link is #156's (lab/metadata-store/update-link/link.py on claude/update-compression): the kernel has no netem, so
a forwarder between two TUN devices delays, rate-limits and drops each packet.
"""
import fcntl
import hashlib
import heapq
import json
import os
import random
import select
import shutil
import struct
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TUNSETIFF, IFF_TUN, IFF_NO_PI = 0x400454CA, 0x0001, 0x1000
VIEWER, PACS = ("viewer", "10.77.0.1", "tviewer"), ("pacs", "10.77.0.2", "tpacs")
QUEUE_PACKETS = 100
LINKS = {
    "floor": {"rtt": 0.0, "up_mbit": None, "down_mbit": None, "loss": 0.0},
    "fiber": {"rtt": 0.010, "up_mbit": 100, "down_mbit": 100, "loss": 0.0},
    "4g5g": {"rtt": 0.060, "up_mbit": 19, "down_mbit": 100, "loss": 0.01},
    "geo": {"rtt": 0.600, "up_mbit": 2, "down_mbit": 10, "loss": 0.001},
}


def sh(*cmd: str) -> None:
    subprocess.run(cmd, check=True)


AN_HOUR_AGO = int(time.time()) - 3600


def aged(path: str) -> None:
    """An hour old, as a deployed file is: one written seconds ago gets no heuristic freshness (rig-limits.md §6).
    One time for every file, so copies of a file carry one nginx ETag."""
    os.utime(path, (AN_HOUR_AGO, AN_HOUR_AGO), follow_symlinks=False)


def certificate(run: str) -> str:
    """One ECDSA P-256 certificate for nginx and WebTransport, trusted through an NSS store; its SHA-256 in hex."""
    cert, key, nss = (os.path.join(run, n) for n in ("cert.pem", "key.pem", "home/.pki/nssdb"))
    sh("openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", key,
       "-out", cert, "-days", "2", "-nodes", "-subj", "/CN=pacs", "-addext", "basicConstraints=critical,CA:FALSE",
       "-addext", "keyUsage=critical,digitalSignature", "-addext", "extendedKeyUsage=serverAuth",
       "-addext", f"subjectAltName=IP:{PACS[1]},IP:127.0.0.1")
    os.makedirs(nss)
    sh("certutil", "-N", "-d", f"sql:{nss}", "--empty-password")
    sh("certutil", "-A", "-d", f"sql:{nss}", "-n", "pacs", "-t", "P,,", "-i", cert)
    der = subprocess.run(["openssl", "x509", "-in", cert, "-outform", "DER"], check=True, capture_output=True).stdout
    return hashlib.sha256(der).hexdigest()


def web(run: str, root: str, host: str, cert_sha256: str) -> str:
    out = os.path.join(run, "web")
    os.makedirs(os.path.join(out, "wt"))
    shutil.copy(os.path.join(HERE, "web", "page.html"), out)
    with open(os.path.join(out, "wt", "transport.json"), "w") as fh:
        json.dump({"url": f"https://{host}:4433/", "cert_sha256": cert_sha256}, fh)
    os.symlink(os.path.join(os.path.abspath(root), "studies"), os.path.join(out, "files"))
    for top in (out, os.path.join(root, "studies")):
        for folder, _, names in os.walk(top):
            for name in names:
                aged(os.path.join(folder, name))
    return out


def netns_prefix(ns) -> list:
    return ["ip", "netns", "exec", ns] if ns else []


def nginx(run: str, listen: str, workers: int, ns=None) -> subprocess.Popen:
    with open(os.path.join(HERE, "web", "nginx.conf")) as fh:
        conf = fh.read()
    for k, v in {"workers": workers, "run": run, "listen": listen, "cert": os.path.join(run, "cert.pem"),
                 "key": os.path.join(run, "key.pem"), "web": os.path.join(run, "web")}.items():
        conf = conf.replace("{" + k + "}", str(v))
    path = os.path.join(run, "nginx.conf")
    with open(path, "w") as fh:
        fh.write(conf)
    return subprocess.Popen(netns_prefix(ns) + ["nginx", "-c", path, "-g", "daemon off;"])


def serve(run: str, root: str, binary: str, wt: str, ns=None) -> subprocess.Popen:
    log = open(os.path.join(run, "serve.log"), "a")
    return subprocess.Popen(netns_prefix(ns) + [binary, "serve", root, "--wt", wt, "--cert",
                                                os.path.join(run, "cert.pem"), "--key", os.path.join(run, "key.pem")],
                            stderr=log)


def tun(name: str) -> int:
    fd = os.open("/dev/net/tun", os.O_RDWR)
    fcntl.ioctl(fd, TUNSETIFF, struct.pack("16sH", name.encode(), IFF_TUN | IFF_NO_PI))
    return fd


def namespaces() -> tuple:
    """Two namespaces, a TUN each, Cubic and no cached path metrics in both; the TUN fds stay with this process."""
    sh("sysctl", "-q", "-w", "net.ipv4.tcp_allowed_congestion_control=reno bbr cubic")
    fds = []
    for (ns, addr, dev), (_, peer, _) in ((VIEWER, PACS), (PACS, VIEWER)):
        subprocess.run(["ip", "netns", "del", ns], stderr=subprocess.DEVNULL)
        sh("ip", "netns", "add", ns)
        fds.append(tun(dev))
        sh("ip", "link", "set", dev, "netns", ns)
        sh("ip", "-n", ns, "link", "set", "lo", "up")
        sh("ip", "-n", ns, "addr", "add", addr, "peer", peer, "dev", dev)
        sh("ip", "-n", ns, "link", "set", dev, "mtu", "1500", "up")
        sh("ip", "netns", "exec", ns, "sysctl", "-q", "-w", "net.ipv4.tcp_congestion_control=cubic",
           "net.ipv4.tcp_no_metrics_save=1")
    return fds[0], fds[1]


class Direction:
    """One way of the link: a FIFO drained at `mbit` (None: no limit), then `delay` seconds, each packet lost at `loss`."""

    def __init__(self, mbit, delay: float, loss: float, rng: random.Random):
        self.rate = mbit * 1e6 / 8 if mbit else None
        self.delay, self.loss, self.rng = delay, loss, rng
        self.free = 0.0
        self.departures = []

    def admit(self, now: float, size: int):
        """The packet's arrival time at the far end, or None when dropped by loss or a full queue."""
        while self.departures and self.departures[0] <= now:
            heapq.heappop(self.departures)
        if len(self.departures) >= QUEUE_PACKETS or self.rng.random() < self.loss:
            return None
        start = max(now, self.free)
        self.free = start + (size / self.rate if self.rate else 0.0)
        heapq.heappush(self.departures, self.free)
        return self.free + self.delay


def forward(up_fd: int, down_fd: int, link: dict, seed: int) -> None:
    rng = random.Random(seed)
    ways = {up_fd: (Direction(link["up_mbit"], link["rtt"] / 2, link["loss"], rng), down_fd),
            down_fd: (Direction(link["down_mbit"], link["rtt"] / 2, link["loss"], rng), up_fd)}
    pending, seq = [], 0
    poll = select.epoll()
    for fd in ways:
        poll.register(fd, select.EPOLLIN)
    while True:
        timeout = max(0.0, pending[0][0] - time.monotonic()) if pending else 1.0
        for fd, _ in poll.poll(timeout):
            packet = os.read(fd, 65536)
            direction, out = ways[fd]
            at = direction.admit(time.monotonic(), len(packet))
            if at is not None:
                heapq.heappush(pending, (at, seq, out, packet))
                seq += 1
        now = time.monotonic()
        while pending and pending[0][0] <= now:
            _, _, out, packet = heapq.heappop(pending)
            os.write(out, packet)
