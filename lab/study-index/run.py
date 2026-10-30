#!/usr/bin/env python3
"""The study index rig: MySQL and PostgreSQL in their own network namespace, each reached through a local socket or a
TUN hop, an SQLite file on the host, and one API process per arm.

usage: run.py init|load|controls|setup|restart|stop-index ARM|start-index ARM|apis|warm-load|latency|sweep|check|sync|
              settings|sizes|teardown   as root
Paths and arms are README §Run's; results land in results/.
"""
import os
import shutil
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "target", "release", "study-index")
MYSQL = os.environ.get("MYSQL_HOME", "/opt/mysql")
PGBIN = os.environ.get("PG_HOME", "/usr/lib/postgresql/18/bin")
STATE = os.environ.get("SI_STATE", "/opt/si")
CNF = os.path.join(STATE, "my.cnf")
SOCK = os.path.join(STATE, "run", "mysql.sock")
PGDATA = os.path.join(STATE, "pgdata")
PGRUN = os.path.join(STATE, "pgrun")
LITE = os.path.join(STATE, "lite")
LOAD = os.path.join(STATE, "load")
PIDS = os.path.join(STATE, "pids")
RESULTS = os.path.join(HERE, "results", "engines")
NS = "idx"
# One TUN pair per hop: (hop, subnet octet, one-way delay in µs).
HOPS = [("hop_0.5ms", 2, 250), ("hop_2ms", 3, 1000)]
SIZE, SCHEMA, SEED = 1_000_000, "si_1e6", 106
TOKEN, KEY = "lab-token", "site-01"
SYNC_TOKEN = "sync-token"
ARMS = ["my_local", "my_local_aa", "my_hop_0.5ms", "my_hop_2ms", "pg_local", "pg_hop_0.5ms", "pg_hop_2ms", "lite_local"]

# README §Engines. MySQL: #165's settings, the buffer pool sized to share the host. PostgreSQL: what changed from 18's
# defaults. SQLite's pragmas are in src/lite.rs.
MY_CNF = f"""[mysqld]
datadir={STATE}/mysql
socket={SOCK}
pid-file={STATE}/run/mysqld.pid
bind-address=0.0.0.0
port=3306
user=root
innodb_buffer_pool_size={os.environ.get('MY_POOL', '4608M')}
innodb_flush_method=O_DIRECT
innodb_flush_log_at_trx_commit=1
innodb_buffer_pool_dump_at_shutdown=OFF
innodb_buffer_pool_load_at_startup=OFF
log_bin=binlog
sync_binlog=1
max_connections=600
local_infile=ON
secure_file_priv=
"""
PG_CONF = {
    "listen_addresses": "'*'",
    "unix_socket_directories": f"'{PGRUN}'",
    "max_connections": "400",
    "shared_buffers": os.environ.get("PG_SHARED", "'3GB'"),
    "effective_cache_size": "'8GB'",
    "random_page_cost": "1.1",
    "work_mem": "'16MB'",
    "maintenance_work_mem": "'1GB'",
    "jit": "off",
    "max_wal_size": "'8GB'",
    "checkpoint_timeout": "'15min'",
    "shared_preload_libraries": "'pg_prewarm'",
    "pg_prewarm.autoprewarm": "off",
}


def sh(*cmd, check=True, **kw):
    return subprocess.run(cmd, check=check, **kw)


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


def engine(arm):
    return arm.split("_", 1)[0]


def hop_ip(arm):
    return next(f"10.78.{o}.2" for h, o, _ in HOPS if arm.endswith(h))


def db_url(arm, schema=SCHEMA):
    local = "_local" in arm
    if engine(arm) == "my":
        if local:
            return f"mysql://root@localhost/{schema}?socket={SOCK}&pool_min=1&pool_max=80&reset_connection=false"
        return (f"mysql://si:si-lab@{hop_ip(arm)}:3306/{schema}?prefer_socket=false&pool_min=1&pool_max=80"
                f"&reset_connection=false")
    if engine(arm) == "pg":
        host = PGRUN.replace("/", "%2F") if local else hop_ip(arm)
        return f"postgresql://postgres@{host}/{schema}"
    return f"sqlite:{LITE}/{schema}.db"


def port(arm):
    return 18100 + ARMS.index(arm)


def psql(sql, db="postgres", capture=False):
    return sh(f"{PGBIN}/psql", "-h", PGRUN, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql,
              capture_output=capture, text=True)


def mysql(sql, capture=False):
    return sh(f"{MYSQL}/bin/mysql", "-S", SOCK, "-uroot", "-N", "-e", sql, capture_output=capture, text=True)


def setup_network():
    sh("ip", "netns", "add", NS, check=False)
    sh("ip", "-n", NS, "link", "set", "lo", "up")
    for _, octet, one_way in HOPS:
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


def init():
    """Empty data directories for both servers, with their settings; the network namespace."""
    for d in ("run", "mysql", "pids", "lite"):
        os.makedirs(os.path.join(STATE, d), exist_ok=True)
    with open(CNF, "w") as fh:
        fh.write(MY_CNF)
    if not os.listdir(os.path.join(STATE, "mysql")):
        sh(f"{MYSQL}/bin/mysqld", f"--defaults-file={CNF}", "--initialize-insecure")
    os.makedirs(PGRUN, exist_ok=True)
    shutil.chown(PGRUN, "postgres", "postgres")
    if not os.path.isdir(PGDATA):
        os.makedirs(PGDATA)
        shutil.chown(PGDATA, "postgres", "postgres")
        sh("runuser", "-u", "postgres", "--", f"{PGBIN}/initdb", "-D", PGDATA, "-U", "postgres", "-E", "UTF8",
           "--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--auth=trust")
        with open(os.path.join(PGDATA, "pg_hba.conf"), "a") as fh:
            fh.write("host all all 10.78.0.0/16 trust\n")
    with open(os.path.join(PGDATA, "postgresql.conf"), "a") as fh:
        fh.write("\n# run.py PG_CONF\n" + "".join(f"{k} = {v}\n" for k, v in PG_CONF.items()))
    setup_network()


def ping(eng):
    if eng == "my":
        cmd = [f"{MYSQL}/bin/mysqladmin", "-S", SOCK, "-uroot", "ping"]
    else:
        cmd = [f"{PGBIN}/pg_isready", "-h", PGRUN, "-q"]
    return subprocess.run(cmd, capture_output=True).returncode == 0


def start_index(eng):
    if eng == "my":
        detach("mysqld", "ip", "netns", "exec", NS, f"{MYSQL}/bin/mysqld", f"--defaults-file={CNF}")
    elif eng == "pg":
        detach("postgres", "ip", "netns", "exec", NS, "runuser", "-u", "postgres", "--", f"{PGBIN}/postgres", "-D", PGDATA)
    else:
        return
    for _ in range(2400):
        if ping(eng):
            return
        time.sleep(0.05)
    sys.exit(f"{eng} did not start")


def stop_index(eng):
    if eng == "my":
        subprocess.run([f"{MYSQL}/bin/mysqladmin", "-S", SOCK, "-uroot", "shutdown"], capture_output=True)
        proc = "mysqld"
    elif eng == "pg":
        subprocess.run(["runuser", "-u", "postgres", "--", f"{PGBIN}/pg_ctl", "-D", PGDATA, "-m", "fast", "-w", "stop"],
                       capture_output=True)
        proc = "postgres"
    else:
        return
    for _ in range(1200):
        if subprocess.run(["pgrep", "-x", proc], capture_output=True).returncode != 0:
            return
        time.sleep(0.05)
    sys.exit(f"{eng} did not stop")


def start_apis():
    grants = f"{TOKEN}={KEY},{SYNC_TOKEN}=site-sync"
    for arm in ARMS:
        detach(f"api-{port(arm)}", BIN, "api", "--listen", f"127.0.0.1:{port(arm)}", "--db", db_url(arm),
               "--grants", grants, "--shape", "tuned")
    for arm in ARMS:
        for _ in range(400):
            r = subprocess.run(["curl", "-sf", f"http://127.0.0.1:{port(arm)}/health"], capture_output=True)
            if r.returncode == 0:
                break
            time.sleep(0.05)
        else:
            sys.exit(f"api {arm} not ready")


def load():
    """`gen`'s TSV into each engine at its tuned shape; the times go to results/load.txt."""
    os.makedirs(LOAD, exist_ok=True)
    tsv = os.path.join(LOAD, SCHEMA)
    if not os.path.exists(tsv + ".study.tsv"):
        sh(BIN, "gen", "--n", str(SIZE), "--seed", str(SEED), "--out", tsv)
    out = open(os.path.join(RESULTS, "load.txt"), "a")

    def timed(what, f):
        t = time.time()
        f()
        out.write(f"{what}: {time.time() - t:.0f} s\n")
        out.flush()
    schema = open(os.path.join(HERE, "schema.sql")).read()
    tuned = ("ALTER TABLE study DROP INDEX newest, ADD INDEX newest (access_key, study_date, study_time, study_uid, "
             "patient_name, modalities_in_study), DROP INDEX by_name, ADD INDEX by_name (access_key, patient_name, "
             "study_date, study_time); ANALYZE TABLE study, series;")
    only = os.environ.get("ENGINES", "my,pg,lite").split(",")
    if "my" in only:
        timed("mysql", lambda: mysql(
            f"SET sql_log_bin = 0; DROP DATABASE IF EXISTS {SCHEMA}; CREATE DATABASE {SCHEMA}; USE {SCHEMA}; {schema}; "
            f"LOAD DATA INFILE '{tsv}.study.tsv' INTO TABLE study (study_uid, host, revision, access_key, patient_name, "
            "patient_id, issuer_of_patient_id, patient_birth_date, patient_sex, study_date, study_time, accession_number, "
            "study_id, referring_physician_name, modalities_in_study, study_description, number_of_series, "
            f"number_of_instances); LOAD DATA INFILE '{tsv}.series.tsv' INTO TABLE series; {tuned}"))
    mysql("CREATE USER IF NOT EXISTS si@'10.78.%' IDENTIFIED BY 'si-lab'; GRANT ALL ON *.* TO si@'10.78.%';")
    columns = ("study_uid, host, revision, access_key, patient_name, patient_id, issuer_of_patient_id, patient_birth_date, "
               "patient_sex, study_date, study_time, accession_number, study_id, referring_physician_name, "
               "modalities_in_study, study_description, number_of_series, number_of_instances")

    def pg():
        psql(f"DROP DATABASE IF EXISTS {SCHEMA} WITH (FORCE)")
        psql(f"CREATE DATABASE {SCHEMA}")
        sh(f"{PGBIN}/psql", "-h", PGRUN, "-U", "postgres", "-d", SCHEMA, "-v", "ON_ERROR_STOP=1", "-q",
           "-f", os.path.join(HERE, "pg.sql"))
        psql(f"COPY study ({columns}) FROM '{tsv}.study.tsv'; COPY series FROM '{tsv}.series.tsv'", SCHEMA)
        sh(f"{PGBIN}/psql", "-h", PGRUN, "-U", "postgres", "-d", SCHEMA, "-v", "ON_ERROR_STOP=1", "-q",
           "-f", os.path.join(HERE, "pg_indexes.sql"))
        for table in ("study", "series"):
            psql(f"VACUUM (ANALYZE, FREEZE) {table}", SCHEMA)
    if "pg" in only:
        timed("postgresql", pg)
    if "lite" in only:
        timed("sqlite", lambda: sh(BIN, "lite-load", "--tsv", tsv, "--out", os.path.join(LITE, f"{SCHEMA}.db")))


def controls():
    """README §Engines, name matching: each engine's 10⁴ copy as built and with its folding broken, behind its own API;
    `check`'s name cells must pass the first and fail the second."""
    tsv = os.path.join(LOAD, "si_1e4")
    if not os.path.exists(tsv + ".study.tsv"):
        sh(BIN, "gen", "--n", "10000", "--seed", "104", "--out", tsv)
    schema = open(os.path.join(HERE, "schema.sql")).read()
    columns = ("study_uid, host, revision, access_key, patient_name, patient_id, issuer_of_patient_id, patient_birth_date, "
               "patient_sex, study_date, study_time, accession_number, study_id, referring_physician_name, "
               "modalities_in_study, study_description, number_of_series, number_of_instances")
    arms = []
    for broken in (False, True):
        db = "si_1e4_broken" if broken else "si_1e4"
        alter = "ALTER TABLE study MODIFY patient_name VARCHAR(324) COLLATE utf8mb4_bin NOT NULL;" if broken else ""
        mysql(f"SET sql_log_bin = 0; DROP DATABASE IF EXISTS {db}; CREATE DATABASE {db}; USE {db}; {schema}; {alter} "
              f"LOAD DATA INFILE '{tsv}.study.tsv' INTO TABLE study ({columns}); "
              f"LOAD DATA INFILE '{tsv}.series.tsv' INTO TABLE series;")
        psql(f"DROP DATABASE IF EXISTS {db} WITH (FORCE)")
        psql(f"CREATE DATABASE {db}")
        sh(f"{PGBIN}/psql", "-h", PGRUN, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q",
           "-f", os.path.join(HERE, "pg.sql"))
        identity = "CREATE OR REPLACE FUNCTION pn_fold(text) RETURNS text LANGUAGE sql IMMUTABLE RETURN $1; " if broken else ""
        psql(f"{identity}COPY study ({columns}) FROM '{tsv}.study.tsv'; COPY series FROM '{tsv}.series.tsv'", db)
        sh(f"{PGBIN}/psql", "-h", PGRUN, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q",
           "-f", os.path.join(HERE, "pg_indexes.sql"))
        psql("ANALYZE", db)
        sh(BIN, "lite-load", "--tsv", tsv, "--out", os.path.join(LITE, f"{db}.db"), "--fold", "off" if broken else "on")
        for arm in ("my_local", "pg_local", "lite_local"):
            name = f"{engine(arm)}{'_broken' if broken else ''}"
            p = 18200 + len(arms)
            detach(f"api-{p}", BIN, "api", "--listen", f"127.0.0.1:{p}", "--db", db_url(arm, db),
                   "--grants", f"{TOKEN}={KEY}", "--shape", "tuned")
            arms.append(f"{name}=10000@127.0.0.1:{p}")
    time.sleep(2)
    with open(os.path.join(RESULTS, "collation.txt"), "w") as fh:
        for half in (arms[:3], arms[3:]):
            r = subprocess.run([BIN, "check", "--sizes", "10000:104", "--key", KEY, "--token", TOKEN, "--arms",
                                ",".join(half), "--cells", "name_accented,name_plain,name_family"],
                               capture_output=True, text=True)
            fh.write(r.stdout + r.stderr)
    kill("api-182")


def sizes():
    """Bytes on disk for each engine's 10⁶ index, tables and indexes together."""
    with open(os.path.join(RESULTS, "sizes.txt"), "w") as fh:
        fh.write(mysql(f"SELECT table_name, data_length, index_length FROM information_schema.tables "
                       f"WHERE table_schema = '{SCHEMA}'", capture=True).stdout)
        fh.write(psql("SELECT relname, pg_table_size(oid), pg_indexes_size(oid) FROM pg_class "
                      "WHERE relname IN ('study', 'series')", SCHEMA, capture=True).stdout)
        lite = os.path.join(LITE, f"{SCHEMA}.db")
        fh.write(f"sqlite file {os.path.getsize(lite)}\n")
        fh.write(subprocess.run([BIN, "lite-settings", "--db", lite], capture_output=True, text=True).stdout)


def warm_load():
    """Every index and table read once: InnoDB's into its pool, PostgreSQL's into shared buffers, SQLite's file
    into the page cache it maps."""
    stmts = []
    for table, indexes in (("study", ["PRIMARY", "newest", "by_name", "by_patient_id", "by_accession", "by_host"]),
                           ("series", ["PRIMARY", "of_study", "study_modality"])):
        stmts += [f"SELECT COUNT(*) FROM {SCHEMA}.{table} FORCE INDEX ({i});" for i in indexes]
    mysql("".join(stmts), capture=True)
    psql("CREATE EXTENSION IF NOT EXISTS pg_prewarm; SELECT pg_prewarm(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
         "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'i')", SCHEMA, capture=True)
    with open(os.path.join(LITE, f"{SCHEMA}.db"), "rb") as fh:
        while fh.read(1 << 24):
            pass


def restart():
    kill("api-")
    for eng in ("my", "pg"):
        stop_index(eng)
        start_index(eng)
    start_apis()


def arm_spec(names=ARMS):
    return ",".join(f"{a}={SIZE}@127.0.0.1:{port(a)}" for a in names)


def settings():
    os.makedirs(RESULTS, exist_ok=True)
    q = ("SELECT @@version, @@innodb_buffer_pool_size, @@innodb_flush_method, @@innodb_flush_log_at_trx_commit, "
         "@@log_bin, @@sync_binlog, @@collation_server, @@transaction_isolation, @@innodb_buffer_pool_load_at_startup, "
         "@@max_connections")
    with open(os.path.join(RESULTS, "settings.txt"), "w") as fh:
        fh.write("== MySQL\n")
        fh.write(subprocess.run([f"{MYSQL}/bin/mysql", "-S", SOCK, "-uroot", "-E", "-e", q], capture_output=True,
                                text=True, check=True).stdout)
        fh.write("== PostgreSQL: settings that differ from the built-in default (name | setting | unit | default)\n")
        fh.write(psql("SELECT version()", capture=True).stdout)
        fh.write(psql("SELECT name, setting, unit, boot_val FROM pg_settings WHERE setting IS DISTINCT FROM boot_val "
                      "AND source NOT IN ('override') ORDER BY name", capture=True).stdout)
        fh.write(psql(f"SELECT datname, datlocprovider, datlocale FROM pg_database WHERE datname = '{SCHEMA}'",
                      capture=True).stdout)
        fh.write("== SQLite\n")
        fh.write(subprocess.run([BIN, "lite-settings", "--db", os.path.join(LITE, f"{SCHEMA}.db")], capture_output=True,
                                text=True).stdout)
        fh.write(subprocess.run(["uname", "-r"], capture_output=True, text=True).stdout)
        fh.write(subprocess.run(["nproc"], capture_output=True, text=True).stdout)


def main():
    cmd = sys.argv[1]
    me = f"python3 {os.path.abspath(__file__)}"
    os.makedirs(RESULTS, exist_ok=True)
    if cmd == "init":
        init()
    elif cmd == "load":
        load()
    elif cmd == "sizes":
        sizes()
    elif cmd == "controls":
        controls()
    elif cmd == "setup":
        setup_network()
        for eng in ("my", "pg"):
            start_index(eng)
        start_apis()
    elif cmd == "restart":
        restart()
    elif cmd == "stop-index":
        stop_index(engine(sys.argv[2]))
    elif cmd == "start-index":
        start_index(engine(sys.argv[2]))
    elif cmd == "apis":
        kill("api-")
        start_apis()
    elif cmd == "warm-load":
        warm_load()
    elif cmd == "settings":
        settings()
    elif cmd == "latency":
        sh(BIN, "bench", "--sizes", f"{SIZE}:{SEED}", "--arms", arm_spec(), "--key", KEY, "--token", TOKEN,
           "--rounds", os.environ.get("ROUNDS", "12"), "--warm", os.environ.get("WARM", "20"),
           "--restart", f"{me} restart", "--warm-load", f"{me} warm-load",
           "--out", os.path.join(RESULTS, os.environ.get("OUT", "latency.jsonl")))
    elif cmd == "sweep":
        names = os.environ.get("SWEEP_ARMS", "my_local,pg_local,lite_local,my_hop_2ms,pg_hop_2ms").split(",")
        sh(BIN, "sweep", "--sizes", f"{SIZE}:{SEED}", "--arms", arm_spec(names), "--key", KEY,
           "--token", TOKEN, "--levels", os.environ.get("LEVELS", "1,2,4,8,16,32,64"),
           "--secs", os.environ.get("SECS", "5"), "--reps", os.environ.get("REPS", "2"),
           "--out", os.path.join(RESULTS, os.environ.get("OUT", "sweep.jsonl")))
    elif cmd == "check":
        sh(BIN, "check", "--sizes", os.environ.get("CHECK_SIZES", f"{SIZE}:{SEED}"), "--key", KEY, "--token", TOKEN,
           "--arms", os.environ.get("CHECK_ARMS", arm_spec(["my_local", "my_hop_2ms", "pg_local", "pg_hop_2ms",
                                                            "lite_local"])), *sys.argv[2:])
    elif cmd == "sync":
        names = os.environ.get("SYNC_ARMS", "my_local,my_hop_0.5ms,my_hop_2ms,pg_local,pg_hop_0.5ms,pg_hop_2ms,"
                               "lite_local").split(",")
        spec = ",".join(f"{a}={db_url(a)}|127.0.0.1:{port(a)}" for a in names)
        host_dir = os.environ.get("SYNC_DIR", os.path.join(STATE, "hosts", "pacs-sync"))
        sh(BIN, "sync", "--arms", spec, "--dir", host_dir, "--token", SYNC_TOKEN,
           "--rounds", os.environ.get("ROUNDS", "12"), "--recovery-rounds", os.environ.get("RECOVERY_ROUNDS", "6"),
           "--recovery-arms", "my_local,my_hop_2ms,pg_local,pg_hop_2ms",
           "--seed-studies", os.environ.get("SEED_STUDIES", "10000"),
           "--stop", f"{me} stop-index {{arm}}", "--start", f"{me} start-index {{arm}}", "--after-start", "true",
           "--out", os.path.join(RESULTS, os.environ.get("OUT", "sync.jsonl")))
    elif cmd == "teardown":
        kill("api-")
        for eng in ("my", "pg"):
            stop_index(eng)
        kill("forward-")
        sh("ip", "netns", "del", NS, check=False)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
