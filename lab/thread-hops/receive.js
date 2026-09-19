// The receive worker: owns the decoder, relays or holds frames, and runs a read loop under load.
let decode = null;
let arm = "";
const held = [];
let linkBytes = 0;
let linkSink = 0;
let linkBusyMs = 0;

const abs = () => performance.timeOrigin + performance.now();

function forward(msg) {
  msg.tPost = abs();
  postMessage(msg, msg.buf instanceof SharedArrayBuffer ? undefined : [msg.buf]);
}

function onDecode(e) {
  const m = e.data;
  if (m.kind === "decode-ready" || m.kind === "produced") { postMessage(m); return; }
  if (m.kind !== "frame") return;
  if (arm === "relay-pull") { held[m.seq] = m; return; }
  forward(m);
}

const reasm = new Uint8Array(1 << 20);
let reasmAt = 0;

function onLink(e) {
  // Stands in for the transport read loop: copy each chunk into the reassembly buffer, as the
  // real read path does, so the work is real and scales with bytes.
  const t = performance.now();
  const v = new Uint8Array(e.data);
  if (reasmAt + v.length > reasm.length) reasmAt = 0;
  reasm.set(v, reasmAt);
  reasmAt += v.length;
  linkSink ^= reasm[reasmAt - 1];
  linkBytes += v.length;
  linkBusyMs += performance.now() - t;
}

onmessage = (e) => {
  const m = e.data;
  if (m.kind === "setup") {
    decode = new Worker("./decode.js", { type: "module" });
    decode.onmessage = onDecode;
    const ch = new MessageChannel();
    decode.postMessage({ kind: "ports", direct: ch.port1 }, [ch.port1]);
    postMessage({ kind: "direct", port: ch.port2 }, [ch.port2]);
    return;
  }
  if (m.kind === "link-port") { m.port.onmessage = onLink; return; }
  if (m.kind === "run") {
    arm = m.arm;
    held.length = 0;
    linkBytes = 0;
    linkBusyMs = 0;
    decode.postMessage({ ...m, kind: "run" });
    return;
  }
  if (m.kind === "ask") {
    const h = held[m.seq];
    if (!h) return;
    held[m.seq] = null;
    forward(h);
    return;
  }
  if (m.kind === "link-stats") postMessage({ kind: "link-stats", bytes: linkBytes, busyMs: linkBusyMs, sink: linkSink });
};
