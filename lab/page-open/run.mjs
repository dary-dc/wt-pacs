/**
 * R2: navigation → config → session → first frame, on a real round trip, for the harness on both
 * clients and for the downloader. Cold and warm profile, through lab/scripts/link_impair.py.
 *
 * Each milestone is fitted against the link's round trip across 0 / 40 / 80 ms, so the slope is
 * the serial round trips the page spends and the intercept is everything that is not the network.
 * lab/page-open/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/page-open/run.mjs [rounds]
 *
 * SERVERS=a=BIN,b=BIN runs every arm against each server binary, interleaved inside each round,
 * and prints how often b beat a; ONLY=arm,… keeps those arms; PORT_BASE=N takes ports from N up;
 * NETLOG=DIR keeps Chrome's net log per visit; ROWS=FILE keeps every visit's milestones.
 * HOST=dns runs as root: it binds 443 and 53 and gives the browser its own resolv.conf.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { leadsByPredecessor, order } from "../order.mjs";
import { throttleTree } from "../scripts/cpu_throttle.mjs";
import { metadata } from "./metadata.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 3);
const RTTS = (process.env.RTTS || "0,40,80").split(",").map(Number);
const FRAMES = 12;
// THROTTLE=N slows the browser's every thread N× (lab/scripts/cpu_throttle.mjs); the relay and server run free.
const THROTTLE = Number(process.env.THROTTLE || 1);
// RELAY_ARGS="--rate-kbit N …" shapes the link of every relay beyond its delay.
const RELAY_ARGS = (process.env.RELAY_ARGS || "").split(" ").filter(Boolean);

// STAGES swaps the three clients for the first-byte ladder: one rung of README.md per arm, on a
// cold profile only, since a warm visit spends none of what the ladder cuts.
const STAGES = process.env.STAGES?.split(",");
// HOST=dns names each arm's page host and transport host; only h3.test has an HTTPS record.
const PLANES = {
  h2: { page: "static.test", wt: "static.test" },
  "h2+wt-ip": { page: "static.test", wt: "127.0.0.1" },
  "h2+wt-host": { page: "static.test", wt: "wt.test" },
  "h2+wt-hint": { page: "static.test", wt: "wt.test", hint: true },
  h3: { page: "h3.test", wt: "h3.test" },
  "h2+meta": { page: "static.test", wt: "static.test", meta: "downloader.html" },
  "h2+meta-first": { page: "static.test", wt: "static.test", meta: "meta-first.html" },
  "h3+meta": { page: "h3.test", wt: "h3.test", meta: "downloader.html" },
  "h3+meta-first": { page: "h3.test", wt: "h3.test", meta: "meta-first.html" },
};
// A study's metadata of ~120 KB gzipped. The page's `?meta=` preload is script-made, so it leaves after
// every parsed link; meta-first.html, written per run, parses one ahead of the config's.
const META = "lab/page-open/metadata.json";
const META_FIRST = "lab/page-open/meta-first.html";
const HOST = process.env.HOST || "dev";
const ARMS = STAGES
  ? Object.fromEntries(
      STAGES.map((s) => [s, (base, server) => `${base}/lab/page-open/first-byte.html?stage=${s}&frames=${FRAMES}` +
        `&wt=${encodeURIComponent(`https://127.0.0.1:${server.inn}/`)}&hash=${hash}`]),
    )
  : HOST === "dns"
  ? Object.fromEntries(Object.entries(PLANES).map(([arm, p]) => [arm, (_, s) => {
      const q = new URLSearchParams();
      if (p.hint) q.set("dns", `https://${p.wt}:${s.inn}`);
      if (p.meta) q.set("meta", `/${META}`);
      return `https://${p.page}/lab/page-open/${p.meta ?? "downloader.html"}?${q}`;
    }]))
  : {
      ts: (base) => `${base}/harness/ts.html?autorun=1&n=1&frames=${FRAMES}`,
      wasm: (base) => `${base}/harness/index.html?autorun=1&n=1&frames=${FRAMES}`,
      downloader: (base) => `${base}/lab/page-open/downloader.html`,
    };
for (const arm of Object.keys(ARMS)) if (process.env.ONLY && !process.env.ONLY.split(",").includes(arm)) delete ARMS[arm];
const PROFILES = STAGES || HOST === "dns" ? ["cold"] : ["cold", "warm"];

// HOST=dev (default) is server/dev-server.py, plaintext HTTP/1.1; h1 and h2 are nginx on the deploy
// template over TLS, without and with HTTP/2 — the handshakes a real host charges the page half.
// dns is h3-host on 443, HTTP/2 and HTTP/3, behind stub_dns.py one round trip away.
let nextPort = Number(process.env.PORT_BASE || 0);
const port = () => (nextPort ? nextPort++ : 30000 + ((Math.random() * 20000) | 0));
const TCP_SRV = port();
const TCP_IN = HOST === "dns" ? 443 : port();
const T = fs.mkdtempSync(path.join(os.tmpdir(), "r2-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];

function start(cmd, args, out) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", out, out] });
  kids.push(p);
  return p;
}

function stop() {
  for (const p of kids) p.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  if (HOST === "dns") for (const f of [META, META_FIRST]) fs.rmSync(path.join(ROOT, f), { force: true });
  fs.rmSync(T, { recursive: true, force: true });
}
process.on("exit", stop);

// A real study: the downloader arm decodes what it gets, so random bytes would not do.
execFileSync("cargo", ["build", "-q", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
const BIN = path.join(ROOT, process.env.CARGO_TARGET_DIR || "target", "debug");
const SERVERS = (process.env.SERVERS || `=${path.join(BIN, "exact-server")}`).split(",").map((s) => {
  const [name, bin] = s.split("=");
  return { name, bin, srv: port(), inn: port() };
});
const label = (arm, server) => (server.name ? `${arm}@${server.name}` : arm);
const CELLS = Object.keys(ARMS).flatMap((arm) => SERVERS.map((server) => ({ arm, server })));
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout ${T}/key.pem -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,DNS:static.test,DNS:h3.test,DNS:wt.test,IP:127.0.0.1' 2>/dev/null`]);
// A HOST page is served on this certificate, trusted through an NSS store of the browser's own:
// Chrome caches nothing whose certificate had an error, so ignoring the error would re-fetch every
// worker script on the page's path.
if (HOST !== "dev") {
  execFileSync("bash", ["-c", `mkdir -p ${T}/home/.pki/nssdb && certutil -N -d sql:${T}/home/.pki/nssdb --empty-password \
    && certutil -A -d sql:${T}/home/.pki/nssdb -n page -t P,, -i ${T}/cert.pem`]);
}
const hash = execFileSync("bash", [
  "-c",
  `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`,
]).toString().trim();

fs.mkdirSync(path.join(T, "frames"));
const src = path.join(ROOT, "lab/fixtures/decode_c512");
const codestreams = fs.readdirSync(src).filter((f) => f.endsWith(".j2c")).sort();
if (!codestreams.length) throw new Error(`no codestreams in ${src} — lab/scripts/gen_htj2k_fixtures.sh`);
for (let i = 0; i < FRAMES; i++) {
  fs.copyFileSync(
    path.join(src, codestreams[i % codestreams.length]),
    path.join(T, "frames", `${String(i).padStart(3, "0")}.htj2k`),
  );
}
fs.writeFileSync(path.join(T, "metadata.json"), JSON.stringify({ frameCount: FRAMES }));
execFileSync(path.join(BIN, "pack-study"), [
  "--metadata", path.join(T, "metadata.json"),
  "--frames", path.join(T, "frames"),
  "--output", path.join(T, "study.sbnd"),
]);

for (const s of SERVERS) {
  start(s.bin, [
    "--port", String(s.srv), "--study", path.join(T, "study.sbnd"),
    "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem"),
    // Inert for an arm that sends no `?ask=`, so every arm runs on one server. R1's arm needs it.
    "--open-ask",
  ], fs.openSync(path.join(T, `server${s.name}.log`), "a"));
}
if (HOST === "dev") {
  start("python3", ["server/dev-server.py", "--port", String(TCP_SRV)], fs.openSync(path.join(T, "static.log"), "a"));
} else if (HOST === "dns") {
  fs.writeFileSync(path.join(ROOT, META), metadata(2200));
  const page = fs.readFileSync(path.join(ROOT, "lab/page-open/downloader.html"), "utf8");
  const config = '  <link rel="preload" as="fetch" href="/wt/dev-transport.json" />';
  if (!page.includes(config)) throw new Error("downloader.html has no config preload to put the metadata ahead of");
  fs.writeFileSync(path.join(ROOT, META_FIRST),
    page.replace(config, `  <link rel="preload" as="fetch" href="/${META}" crossorigin="anonymous" />\n${config}`));
  execFileSync("go", ["build", "-o", path.join(T, "h3-host"), "."], { cwd: path.join(ROOT, "lab/page-open/h3-host") });
  start(path.join(T, "h3-host"), [ROOT, `127.0.0.1:${TCP_SRV}`, `${T}/cert.pem`, `${T}/key.pem`],
    fs.openSync(path.join(T, "static.log"), "a"));
  fs.writeFileSync(path.join(T, "resolv.conf"), "nameserver 127.0.0.1\n");
  fs.writeFileSync(path.join(T, "chrome"), `#!/bin/sh\nexec unshare -m sh -c 'mount --bind ${T}/resolv.conf ` +
    `/etc/resolv.conf && exec "$0" "$@"' ${process.env.CHROME_PATH || chromium.executablePath()} "$@"\n`, { mode: 0o755 });
} else {
  const site = fs.readFileSync(path.join(ROOT, "deploy/nginx/wt-pacs.conf.template"), "utf8")
    .replace(/\$\{STUDY\}/g, "us_cine_smoke")
    .replace(/\/srv\/wt-pacs/g, ROOT)
    .replace(/listen\s+8765;/, `listen 127.0.0.1:${TCP_SRV} ssl${HOST === "h2" ? " http2" : ""};\n` +
      `    ssl_certificate ${T}/cert.pem;\n    ssl_certificate_key ${T}/key.pem;`);
  fs.writeFileSync(path.join(T, "site.conf"), site);
  fs.mkdirSync(path.join(T, "ngx"));
  fs.writeFileSync(path.join(T, "nginx.conf"),
    `pid ${T}/nginx.pid;\nerror_log ${T}/nginx-error.log error;\nevents {}\nhttp {\n  access_log off;\n` +
    ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((d) => `  ${d}_temp_path ${T}/ngx;\n`).join("") +
    `  include ${T}/site.conf;\n}\n`);
  start("nginx", ["-c", path.join(T, "nginx.conf"), "-g", "daemon off;"], fs.openSync(path.join(T, "static.log"), "a"));
}
// Chrome takes QUIC only from a known root, except for hosts named here; port 9 is never visited,
// so it lifts that check for h3.test without forcing QUIC on it.
const DNS_ARGS = HOST === "dns" ? ["--origin-to-force-quic-on=h3.test:9"] : [];
const DNS_ENV = HOST === "dns" ? { no_proxy: `${process.env.no_proxy ?? ""},.test`, NO_PROXY: `${process.env.NO_PROXY ?? ""},.test` } : {};
// An hour old, as a deployed config would be: one written seconds ago is revalidated (rig-limits.md §6).
function pointAt(s, host = "127.0.0.1") {
  fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://${host}:${s.inn}/`, cert_sha256: hash }) + "\n");
  const then = new Date(Date.now() - 3600e3);
  fs.utimesSync(CFG, then, then);
}
await new Promise((r) => setTimeout(r, 2000));

const base = `${HOST === "dev" ? "http" : "https"}://127.0.0.1:${TCP_IN}`;
const rows = [];

function browserPid(profileDir) {
  for (const p of fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, "utf8");
      if (cmd.includes(`--user-data-dir=${profileDir}`) && !cmd.includes("--type=")) return Number(p);
    } catch { /* exited while listed */ }
  }
  throw new Error(`no browser on ${profileDir}`);
}

async function visit(ctx, arm, server) {
  const page = await ctx.newPage();
  let err = null;
  page.on("pageerror", (e) => (err = e.message));
  await page.goto(ARMS[arm](base, server), { waitUntil: "commit" });
  await page.waitForFunction(() => globalThis.__wtpacsDone || globalThis.__wtpacsError, null, {
    timeout: 120000 * THROTTLE,
  });
  // The document's own fetch: `page` when its last byte landed, `tls` what its TLS handshake took.
  const out = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const tls = n.secureConnectionStart > 0 ? n.connectEnd - n.secureConnectionStart : 0;
    return {
      open: {
        page: Math.round(n.responseEnd), tls: Math.round(tls), dns: Math.round(n.domainLookupEnd - n.domainLookupStart),
        proto: n.nextHopProtocol, ...globalThis.__wtpacsOpen,
      },
      // Each response: when it was asked for and when its last byte landed.
      landed: performance.getEntriesByType("resource").filter((r) => r.responseEnd > 0)
        .map((r) => [new URL(r.name).pathname, Math.round(r.requestStart), Math.round(r.responseEnd)]),
      error: globalThis.__wtpacsError ?? null,
    };
  });
  await page.close();
  if (out.error || err) throw new Error(out.error || err);
  return { ...out.open, landed: out.landed };
}

// A relay per visit: its self-timing tally is the visit's, and a visit it was late for is VOID.
async function relaysUp(rtt, tag) {
  const logs = [];
  // Real-time, so a fill's decoders on every core do not preempt the instrument.
  const relay = (args, name) => {
    logs.push(path.join(T, `${name}-${tag}.log`));
    return start("chrt", ["-f", "50", "python3", ...args], fs.openSync(logs.at(-1), "a"));
  };
  const procs = SERVERS.map((s, i) => relay([
    "lab/scripts/link_impair.py", "--self-timing",
    "--udp", `${s.inn}:${s.srv}`,
    ...(i || HOST === "dns" ? [] : ["--tcp", `${TCP_IN}:${TCP_SRV}`]),
    "--delay-ms", String(rtt / 2), ...RELAY_ARGS,
  ], `relay${i}`));
  if (HOST === "dns") {
    procs.push(relay([
      "lab/scripts/link_impair.py", "--self-timing", "--udp", `${TCP_IN}:${TCP_SRV}`, "--tcp", `${TCP_IN}:${TCP_SRV}`,
      "--delay-ms", String(rtt / 2),
    ], "relay-page"));
    procs.push(start("python3", ["lab/page-open/stub_dns.py", "--delay-ms", String(rtt), "--h3", "h3.test"],
      fs.openSync(path.join(T, `dns-${tag}.log`), "a")));
  }
  await new Promise((r) => setTimeout(r, 1000));
  return async () => {
    await Promise.all(procs.map((p) => new Promise((r) => (p.exitCode != null ? r() : (p.once("exit", r), p.kill())))));
    return logs.some((l) => fs.readFileSync(l, "utf8").includes("VOID"));
  };
}

let voided = 0;
for (const rtt of RTTS) {
  for (let round = 0; round < ROUNDS; round++) {
    let prev = null;
    for (const { arm, server } of order(CELLS, round)) {
      pointAt(server, HOST === "dns" ? PLANES[arm].wt : undefined);
      const name = label(arm, server);
      const relaysDown = await relaysUp(rtt, `${name}-${rtt}-${round}`);
      // A fresh profile is what makes the cold arm cold: no HTTP cache, no compiled-code cache.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2p-"));
      const netlog = process.env.NETLOG
        ? [`--log-net-log=${path.resolve(process.env.NETLOG, `${name}-${rtt}-${round}.json`)}`,
          "--net-log-capture-mode=Everything"]
        : [];
      const ctx = await chromium.launchPersistentContext(dir, {
        headless: true,
        executablePath: HOST === "dns" ? path.join(T, "chrome") : process.env.CHROME_PATH || chromium.executablePath(),
        args: ["--disable-background-networking", ...netlog, ...DNS_ARGS],
        ...(HOST === "dev" ? {} : { env: { ...process.env, HOME: `${T}/home`, ...DNS_ENV } }),
      });
      const unthrottle = THROTTLE > 1 ? throttleTree(browserPid(dir), THROTTLE) : () => {};
      const visits = [];
      try {
        for (const profile of PROFILES) visits.push({ rtt, round, arm: name, prev, profile, ...(await visit(ctx, arm, server)) });
      } catch (e) {
        process.stderr.write(`rtt=${rtt} ${name}: ${e.message.split("\n")[0]}\n`);
      }
      unthrottle();
      await ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
      if (await relaysDown()) {
        voided++;
        process.stderr.write(`rtt=${rtt} ${name} round ${round}: VOID, the relay was late\n`);
      } else rows.push(...visits);
      prev = name;
    }
  }
  process.stderr.write(`rtt ${rtt} done\n`);
}

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const MILESTONES = ["tls", ...(HOST === "dns" ? ["dns"] : []), "page", "script", "config", "session", "frame"];
function fit(arm, profile, key) {
  const xs = [];
  const ys = [];
  for (const rtt of RTTS) {
    const v = rows.filter((r) => r.arm === arm && r.profile === profile && r.rtt === rtt && r[key] != null);
    if (!v.length) return null;
    xs.push(rtt);
    ys.push(median(v.map((r) => r[key])));
  }
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  const slope =
    xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return { slope, fixed: my - slope * mx, at: Object.fromEntries(xs.map((x, i) => [x, ys[i]])) };
}

const LABELS = Object.keys(ARMS).flatMap((arm) => SERVERS.map((s) => label(arm, s)));
function byPredecessor(key, pairs) {
  console.log(`\n${key}, ms, each lead by the predecessor it ran after, rounds in brackets`);
  for (const rtt of RTTS) {
    for (const profile of PROFILES) {
      const at = rows.filter((r) => r.rtt === rtt && r.profile === profile);
      console.log(`${rtt} ms, ${profile}`);
      for (const line of leadsByPredecessor(at.map((r) => ({ round: r.round, unit: r.arm, prev: r.prev, v: r[key] })), LABELS, pairs)) console.log(line);
    }
  }
}
const W = Math.max(11, ...LABELS.map((l) => l.length));
console.log(
  `\nhost ${HOST}, cpu ${THROTTLE}x\n${"arm".padEnd(W)} ${"profile".padEnd(8)} ${"milestone".padEnd(10)} ` +
    `${"round trips".padStart(11)} ${"fixed ms".padStart(9)}  ` +
    RTTS.map((r) => `${r} ms`.padStart(8)).join(" "),
);
for (const arm of LABELS) {
  for (const profile of PROFILES) {
    for (const key of MILESTONES) {
      const f = fit(arm, profile, key);
      if (!f) continue;
      console.log(
        `${arm.padEnd(W)} ${profile.padEnd(8)} ${key.padEnd(10)} ` +
          `${f.slope.toFixed(2).padStart(11)} ${f.fixed.toFixed(0).padStart(9)}  ` +
          RTTS.map((r) => f.at[r].toFixed(0).padStart(8)).join(" "),
      );
    }
  }
}

if (SERVERS.length > 1) {
  console.log(`\nms at each round trip: median [min-max], and rounds each server beat ${SERVERS[0].name} in`);
  for (const arm of Object.keys(ARMS)) {
    for (const profile of PROFILES) {
      for (const key of MILESTONES) {
        for (const s of SERVERS) {
          const cells = RTTS.map((rtt) => {
            const of = (name) => rows.filter((r) => r.arm === name && r.profile === profile && r.rtt === rtt && r[key] != null);
            const mine = of(label(arm, s));
            if (!mine.length) return "-";
            const v = mine.map((r) => r[key]).sort((x, y) => x - y);
            const ref = new Map(of(label(arm, SERVERS[0])).map((r) => [r.round, r[key]]));
            const won = mine.filter((r) => ref.has(r.round) && r[key] < ref.get(r.round)).length;
            return `${median(v).toFixed(0)} [${v[0].toFixed(0)}-${v.at(-1).toFixed(0)}] ${won}/${mine.length}`;
          });
          console.log(`${label(arm, s).padEnd(W)} ${profile.padEnd(6)} ${key.padEnd(8)} ${cells.join("   ")}`);
        }
      }
    }
  }
}
if (SERVERS.length > 1) {
  byPredecessor("frame", Object.keys(ARMS).flatMap((arm) => SERVERS.slice(1).map((s) => [label(arm, s), label(arm, SERVERS[0])])));
}
if (STAGES) {
  const first = LABELS[0];
  console.log(`\nms at each round trip: median [min-max], and rounds each arm beat ${first} in; ${voided} visits VOID and dropped`);
  for (const key of ["config", "session", "frame"]) {
    for (const arm of LABELS) {
      const cells = RTTS.map((rtt) => {
        const mine = rows.filter((r) => r.arm === arm && r.rtt === rtt && r[key] != null);
        if (!mine.length) return "-";
        const v = mine.map((r) => r[key]).sort((x, y) => x - y);
        const ref = new Map(rows.filter((r) => r.arm === first && r.rtt === rtt).map((r) => [r.round, r[key]]));
        const won = mine.filter((r) => ref.get(r.round) != null && r[key] < ref.get(r.round)).length;
        return `${median(v).toFixed(0)} [${v[0].toFixed(0)}-${v.at(-1).toFixed(0)}] ${won}/${mine.length}`;
      });
      if (cells.some((c) => c !== "-")) console.log(`${arm.padEnd(W)} ${key.padEnd(8)} ${cells.join("   ")}`);
    }
  }
  byPredecessor("session", LABELS.slice(1).map((arm) => [arm, first]));
}
if (HOST === "dns") {
  const stage = { tls: (r) => r.tls, dial: (r) => r.session - r.config, session: (r) => r.session };
  const first = LABELS[0];
  console.log(`\nms at each round trip: median [min-max], and rounds each arm beat ${first} in`);
  for (const [key, of] of Object.entries(stage)) {
    for (const arm of LABELS) {
      const cells = RTTS.map((rtt) => {
        const mine = rows.filter((r) => r.arm === arm && r.rtt === rtt && r.session != null);
        if (!mine.length) return "-";
        const v = mine.map(of).sort((x, y) => x - y);
        const ref = new Map(rows.filter((r) => r.arm === first && r.rtt === rtt).map((r) => [r.round, of(r)]));
        const won = mine.filter((r) => ref.has(r.round) && of(r) < ref.get(r.round)).length;
        return `${median(v).toFixed(0)} [${v[0].toFixed(0)}-${v.at(-1).toFixed(0)}] ${won}/${mine.length}`;
      });
      console.log(`${arm.padEnd(W)} ${key.padEnd(8)} ${cells.join("   ")}`);
    }
  }
  console.log(`\nthe config's and the metadata's last byte, ms: median; visits the config was asked first in, and landed first in`);
  for (const arm of LABELS.filter((a) => PLANES[a]?.meta)) {
    const cells = RTTS.map((rtt) => {
      const at = (r, file) => r.landed.find(([p]) => p === file) ?? [];
      const mine = rows.filter((r) => r.arm === arm && r.rtt === rtt).map((r) => [at(r, "/wt/dev-transport.json"), at(r, `/${META}`)]);
      if (!mine.length) return "-";
      const first = (k) => mine.filter(([c, m]) => c[k] < m[k]).length;
      return `config ${median(mine.map(([c]) => c[2]))} meta ${median(mine.map(([, m]) => m[2]))} ` +
        `asked ${first(1)}/${mine.length} landed ${first(2)}/${mine.length}`;
    });
    console.log(`${arm.padEnd(W)} ${cells.join("   ")}`);
  }
  console.log("\nthe document's protocol, visits per arm");
  for (const arm of LABELS) {
    const n = {};
    for (const r of rows.filter((r) => r.arm === arm)) n[r.proto] = (n[r.proto] ?? 0) + 1;
    console.log(`${arm.padEnd(W)} ${JSON.stringify(n)}`);
  }
  byPredecessor("session", LABELS.slice(1).map((arm) => [arm, LABELS[0]]));
}
if (process.env.ROWS) fs.writeFileSync(process.env.ROWS, JSON.stringify(rows));

// The server, the static host and the browser all hold handles open; the report is the work.
process.exit(0);
