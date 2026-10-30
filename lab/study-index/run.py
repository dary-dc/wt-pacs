#!/usr/bin/env python3
"""The study index rig: MySQL in its own network namespace, reached through a local socket or a TUN hop, and one API
process per (size, arm).

usage: run.py setup|restart|stop-index|start-index|apis|warm-load|latency|sweep|check|sync|settings|teardown   as root
Paths and arms are README §Run's; results land in results/.
"""
import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "target", "release", "study-index")
MYSQL = os.environ.get("MYSQL_HOME", "/opt/mysql")
STATE = os.environ.get("SI_STATE", "/opt/si")
CNF = os.path.join(STATE, "my.cnf")
SOCK = os.path.join(STATE, "run", "mysql.sock")
PIDS = os.path.join(STATE, "pids")
RESULTS = os.path.join(HERE, "results")
NS = "idx"
# One TUN pair per hop: (arm, subnet octet, one-way delay in µs).
HOPS = [("hop_floor", 1, 0), ("hop_0.5ms", 2, 250), ("hop_2ms", 3, 1000)]
SIZES = [(100_000, "si_1e5", 105), (1_000_000, "si_1e6", 106)]
TOKEN, KEY = "lab-token", "site-01"
SYNC_TOKEN = "sync-token"


def sh(*cmd, check=True):
    return subprocess.run(cmd, check=check)


def detach(name, *cmd):
    os.makedirs(PIDS, exist_ok=True)
    log = open(os.path.join(PIDS, f"{name}.log"), "w")
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    with open(os.path.join(PIDS, f"{name}.pid"), "w") as fh:
        fh.write(str(proc.pid))
    return proc


def kill(prefix):
    for f in os.listdir(PIDS) if os.path.isdir(PIDS) else []:
        if f.startswith(prefix) and f.endswith(".pid"):
            try:
                os.kill(int(open(os.path.join(PIDS, f)).read()), signal.SIGTERM)
            except (ProcessLookupError, ValueError):
                pass
            os.unlink(os.path.join(PIDS, f))


def db_url(arm, schema):
    if arm.startswith("tuned_"):
        return db_url(arm[len("tuned_"):], schema + "t")
    if arm.startswith("local"):
        return f"mysql://root@localhost/{schema}?socket={SOCK}&pool_min=1&pool_max=80&reset_connection=false"
    octet = next(o for a, o, _ in HOPS if a == arm)
    return f"mysql://si:si-lab@10.78.{octet}.2:3306/{schema}?prefer_socket=false&pool_min=1&pool_max=80&reset_connection=false"


def arms():
    """(arm, size, schema, port): the A/A pair, each hop, and the tuned shape locally and at 2 ms, per size."""
    names = ["local", "local_aa"] + [a for a, _, _ in HOPS] + ["tuned_local", "tuned_hop_2ms"]
    out = []
    for si, (size, schema, _) in enumerate(SIZES):
        for ai, arm in enumerate(names):
            out.append((arm, size, schema, 18000 + si * 10 + ai))
    return out


def setup_network():
    sh("ip", "netns", "add", NS, check=False)
    sh("ip", "-n", NS, "link", "set", "lo", "up")
    for arm, octet, one_way in HOPS:
        root_dev, ns_dev = f"sir{octet}", f"sin{octet}"
        proc = detach(f"forward-{octet}", BIN, "forward", "--a", root_dev, "--b", ns_dev, "--one-way-us", str(one_way))
        for _ in range(100):
            if open(os.path.join(PIDS, f"forward-{octet}.log")).read().startswith("ready"):
                break
            time.sleep(0.05)
        assert proc.poll() is None, "forwarder died"
        sh("ip", "link", "set", ns_dev, "netns", NS)
        sh("ip", "addr", "add", f"10.78.{octet}.1", "peer", f"10.78.{octet}.2", "dev", root_dev)
        sh("ip", "link", "set", root_dev, "mtu", "1500", "up")
        sh("ip", "-n", NS, "addr", "add", f"10.78.{octet}.2", "peer", f"10.78.{octet}.1", "dev", ns_dev)
        sh("ip", "-n", NS, "link", "set", ns_dev, "mtu", "1500", "up")


def ping_index():
    return subprocess.run([f"{MYSQL}/bin/mysqladmin", "-S", SOCK, "-uroot", "ping"], capture_output=True).returncode == 0


def start_index():
    detach("mysqld", "ip", "netns", "exec", NS, f"{MYSQL}/bin/mysqld", f"--defaults-file={CNF}")
    for _ in range(1200):
        if ping_index():
            return
        time.sleep(0.05)
    sys.exit("mysqld did not start")


def stop_index():
    subprocess.run([f"{MYSQL}/bin/mysqladmin", "-S", SOCK, "-uroot", "shutdown"], capture_output=True)
    for _ in range(1200):
        if subprocess.run(["pgrep", "-x", "mysqld"], capture_output=True).returncode != 0:
            return
        time.sleep(0.05)
    sys.exit("mysqld did not stop")


def start_apis():
    grants = f"{TOKEN}={KEY},{SYNC_TOKEN}=site-sync"
    for arm, size, schema, port in arms():
        shape = "tuned" if arm.startswith("tuned_") else "designed"
        detach(f"api-{port}", BIN, "api", "--listen", f"127.0.0.1:{port}", "--db", db_url(arm, schema), "--grants", grants,
               "--shape", shape)
    for _, _, _, port in arms():
        for _ in range(200):
            r = subprocess.run(["curl", "-sf", f"http://127.0.0.1:{port}/health"], capture_output=True)
            if r.returncode == 0:
                break
            time.sleep(0.05)
        else:
            sys.exit(f"api {port} not ready")


def warm_load():
    """Every index of both sizes read once, so a warm pass finds the whole index in the buffer pool."""
    stmts = []
    for _, schema, _ in SIZES:
        for table, indexes in (("study", ["PRIMARY", "newest", "by_name", "by_patient_id", "by_accession", "by_host"]),
                               ("series", ["PRIMARY", "of_study", "study_modality"])):
            stmts += [f"SELECT COUNT(*) FROM {schema}.{table} FORCE INDEX ({i});" for i in indexes]
        stmts += [f"SELECT COUNT(*) FROM {schema}t.study FORCE INDEX ({i});"
                  for i in ["PRIMARY", "newest", "by_name", "by_patient_id", "by_accession"]]
    subprocess.run([f"{MYSQL}/bin/mysql", "-S", SOCK, "-uroot", "-N", "-e", "".join(stmts)], check=True,
                   capture_output=True)


def restart():
    kill("api-")
    stop_index()
    start_index()
    start_apis()


def arm_spec(sizes=None, names=None):
    return ",".join(f"{a}={s}@127.0.0.1:{p}" for a, s, _, p in arms()
                    if (sizes is None or s in sizes) and (names is None or a in names))


def sizes_spec():
    return ",".join(f"{n}:{seed}" for n, _, seed in SIZES)


def settings():
    os.makedirs(RESULTS, exist_ok=True)
    q = ("SELECT @@version, @@innodb_buffer_pool_size, @@innodb_flush_method, @@innodb_flush_log_at_trx_commit, "
         "@@log_bin, @@sync_binlog, @@collation_server, @@transaction_isolation, @@innodb_buffer_pool_load_at_startup")
    with open(os.path.join(RESULTS, "settings.txt"), "w") as fh:
        subprocess.run([f"{MYSQL}/bin/mysql", "-S", SOCK, "-uroot", "-E", "-e", q], stdout=fh, check=True)
        fh.write(subprocess.run(["uname", "-r"], capture_output=True, text=True).stdout)
        fh.write(subprocess.run(["nproc"], capture_output=True, text=True).stdout)


def main():
    cmd = sys.argv[1]
    me = f"python3 {os.path.abspath(__file__)}"
    os.makedirs(RESULTS, exist_ok=True)
    if cmd == "setup":
        setup_network()
        start_index()
        start_apis()
    elif cmd == "restart":
        restart()
    elif cmd == "stop-index":
        stop_index()
    elif cmd == "start-index":
        start_index()
    elif cmd == "apis":
        kill("api-")
        start_apis()
    elif cmd == "warm-load":
        warm_load()
    elif cmd == "settings":
        settings()
    elif cmd == "latency":
        sh(BIN, "bench", "--sizes", sizes_spec(), "--arms", arm_spec(), "--key", KEY, "--token", TOKEN,
           "--rounds", os.environ.get("ROUNDS", "12"), "--warm", os.environ.get("WARM", "20"),
           "--restart", f"{me} restart", "--warm-load", f"{me} warm-load", "--out", os.path.join(RESULTS, "latency.jsonl"))
    elif cmd == "sweep":
        names = os.environ.get("SWEEP_ARMS", "local,hop_2ms,tuned_local").split(",")
        sh(BIN, "sweep", "--sizes", "1000000:106", "--arms", arm_spec([1_000_000], names), "--key", KEY,
           "--token", TOKEN, "--levels", os.environ.get("LEVELS", "1,2,4,8,16,32,64"),
           "--secs", os.environ.get("SECS", "5"), "--reps", os.environ.get("REPS", "2"),
           "--out", os.path.join(RESULTS, "sweep.jsonl"))
    elif cmd == "check":
        extra = sys.argv[2:]
        sh(BIN, "check", "--sizes", os.environ.get("CHECK_SIZES", sizes_spec()), "--key", KEY, "--token", TOKEN,
           "--arms", os.environ.get("CHECK_ARMS", arm_spec(names=["local", "hop_2ms", "tuned_local"])), *extra)
    elif cmd == "sync":
        spec = ",".join(f"{a}={db_url(a, 'si_1e6')}|127.0.0.1:{p}" for a, s, _, p in arms()
                        if s == 1_000_000 and a in ("local", "hop_0.5ms", "hop_2ms"))
        sh(BIN, "sync", "--arms", spec, "--dir", os.path.join(STATE, "hosts", "pacs-sync"), "--token", SYNC_TOKEN,
           "--rounds", os.environ.get("ROUNDS", "12"), "--recovery-rounds", os.environ.get("RECOVERY_ROUNDS", "6"),
           "--recovery-arms", "local,hop_2ms", "--seed-studies", os.environ.get("SEED_STUDIES", "10000"),
           "--stop", f"{me} stop-index", "--start", f"{me} start-index", "--after-start", "true",
           "--out", os.path.join(RESULTS, "sync.jsonl"))
    elif cmd == "teardown":
        kill("api-")
        stop_index()
        kill("forward-")
        sh("ip", "netns", "del", NS, check=False)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
