// Prices the thread hops a decoded frame crosses. docs/thread-hops.md
const SIZES = [51200, 524288, 786432, 2097152, 8388608];
const ARMS = ["relay-push", "relay-pull", "direct-push", "direct-pull", "shared", "cloned"];
const BURST = 237;

const abs = () => performance.timeOrigin + performance.now();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const fmt = (x) => (x === undefined || Number.isNaN(x) ? "—" : x.toFixed(3));

let receive = null;
let direct = null;
let link = null;
let onFrame = null;
let onSignal = null;

function boot() {
  return new Promise((resolve) => {
    receive = new Worker("./receive.js", { type: "module" });
    link = new Worker("./link.js", { type: "module" });
    let gotDirect = false;
    let gotDecode = false;
    receive.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "direct") {
        direct = m.port;
        direct.onmessage = (ev) => route(ev);
        gotDirect = true;
      } else if (m.kind === "decode-ready") {
        gotDecode = true;
      } else { route(e); return; }
      if (gotDirect && gotDecode) resolve();
    };
    receive.postMessage({ kind: "setup" });
    const ch = new MessageChannel();
    receive.postMessage({ kind: "link-port", port: ch.port1 }, [ch.port1]);
    link.postMessage({ kind: "port", port: ch.port2 }, [ch.port2]);
  });
}

function route(e) {
  const t = abs();
  const m = e.data;
  if (m.kind === "frame") { if (onFrame) onFrame(m, t); return; }
  if (onSignal) onSignal(m);
}

function cell({ arm, size, count, loaded, mutate }) {
  return new Promise((resolve, reject) => {
    const pull = arm.endsWith("-pull");
    const rows = [];
    const handlers = [];
    let handlerMs = 0;
    let asked = null;
    let produced = false;
    const t0 = abs();

    onFrame = (m, tReceipt) => {
      const enter = tReceipt;
      const v = new Uint8Array(m.buf);
      if (v[m.buf.byteLength - 1] !== 0xa5) { reject(new Error(`frame ${m.seq} arrived unfilled`)); return; }
      rows.push({
        lastLeg: tReceipt - m.tPost,
        fullPath: pull ? undefined : tReceipt - m.tPost0,
        askToReceipt: pull ? tReceipt - asked : undefined,
        hold: m.tPost - m.tPost0,
      });
      if (pull && rows.length < count) { asked = abs(); askFor(arm, rows.length); }
      const h = abs() - enter;
      handlers.push(h);
      handlerMs += h;
      if (rows.length === count) finish();
    };

    onSignal = (m) => {
      if (m.kind !== "produced") return;
      produced = true;
      if (pull) { asked = abs(); askFor(arm, 0); }
    };

    const finish = () => {
      onFrame = null;
      onSignal = (m) => {
        if (m.kind !== "link-stats") return;
        onSignal = null;
        done(m);
      };
      receive.postMessage({ kind: "link-stats" });
    };

    const done = (stats) => resolve({
        arm, size, count, loaded,
        wallMs: abs() - t0,
        handlerMs,
        lastLeg: med(rows.map((r) => r.lastLeg)),
        head: med(rows.map((r) => (pull ? r.askToReceipt : r.fullPath))),
        hold: med(rows.map((r) => r.hold)),
        n: rows.length,
        linkBytes: stats.bytes,
        linkBusyMs: stats.busyMs,
        handlerMed: med(handlers),
        handlerMax: Math.max(...handlers),
      });

    receive.postMessage({ kind: "run", arm, size, count, ...mutate });
    setTimeout(() => { if (rows.length !== count) reject(new Error(`${arm} ${size}: ${rows.length}/${count} frames, produced=${produced}`)); }, 120000);
  });
}

function askFor(arm, seq) {
  if (arm === "direct-pull") direct.postMessage({ kind: "ask", seq });
  else receive.postMessage({ kind: "ask", seq });
}

const log = (s) => { document.getElementById("log").textContent += s + "\n"; };

function rotate(a, by) { return a.map((_, i) => a[(i + by) % a.length]); }

async function main() {
  const q = new URLSearchParams(location.search);
  const rounds = Number(q.get("rounds") || 7);
  const burstRounds = Number(q.get("burstRounds") || 5);
  const only = q.get("arm");
  const linkLoad = {
    chunk: Number(q.get("linkChunk") || 4096),
    perTick: Number(q.get("linkPerTick") || 24),
    everyMs: Number(q.get("linkEveryMs") || 1),
  };
  const mutate = {};
  if (q.get("mutate") === "shared-transfer") mutate.mutateTransferShared = true;
  if (q.get("mutate") === "b-relay") mutate.mutateDirectIsRelay = true;

  log(`crossOriginIsolated=${globalThis.crossOriginIsolated} cores=${navigator.hardwareConcurrency} ua=${navigator.userAgent.split(") ")[1] || ""}`);
  if (!globalThis.crossOriginIsolated) { log("FATAL: not cross-origin isolated; the shared arm would silently copy"); globalThis.__wtpacsDone = true; return; }

  await boot();
  log(`workers up — link load ${linkLoad.perTick} x ${linkLoad.chunk}B every ${linkLoad.everyMs}ms\n`);

  const arms = only ? [only] : ARMS;
  const out = [];
  for (const [regime, count, nRounds] of [["idle", 1, rounds], ["burst", BURST, burstRounds]]) {
    for (let r = 0; r < nRounds; r++) {
      if (regime === "burst") link.postMessage({ kind: "start", ...linkLoad });
      for (const arm of rotate(arms, r)) {
        for (const size of SIZES) {
          const s = await cell({ arm, size, count, loaded: regime === "burst", mutate });
          s.round = r; s.regime = regime;
          out.push(s);
        }
      }
      if (regime === "burst") link.postMessage({ kind: "stop" });
      log(`${regime} round ${r + 1}/${nRounds} done`);
    }
  }
  report(out, arms);
  globalThis.__wtpacsResult = out;
  log("\n--JSON--\n" + JSON.stringify(out));
  globalThis.__wtpacsDone = true;
}

function report(out, arms) {
  for (const regime of ["idle", "burst"]) {
    log(`\n=== ${regime} ===  head = post0->receipt (push) or ask->receipt (pull); last = last leg; ms`);
    log(["size".padEnd(8), ...arms.map((a) => a.padStart(13))].join(""));
    for (const size of SIZES) {
      const cells = arms.map((a) => {
        const rs = out.filter((o) => o.regime === regime && o.arm === a && o.size === size);
        return rs.length ? med(rs.map((r) => r.head)) : undefined;
      });
      log([((size / 1024).toFixed(0) + "K").padEnd(8), ...cells.map((c) => fmt(c).padStart(13))].join(""));
    }
  }
}

main().catch((e) => { log("FAILED: " + e.message); globalThis.__wtpacsDone = true; });
