// The decode worker: no decoder, just buffers of the decoded sizes. docs/thread-hops.md
let toPage = null;
const held = [];

const abs = () => performance.timeOrigin + performance.now();

function produce(size, shared, seq) {
  const buf = shared ? new SharedArrayBuffer(size) : new ArrayBuffer(size);
  const v = new Uint8Array(buf);
  for (let i = 0; i < size; i += 4096) v[i] = (i + seq) & 0xff;
  v[size - 1] = 0xa5;
  return buf;
}

function stamp(seq, buf, tReady) {
  const t = abs();
  return { kind: "frame", seq, buf, tReady, tPost0: t, tPost: t };
}

function emit(m, seq, buf, tReady) {
  const msg = stamp(seq, buf, tReady);
  // mutant: route a direct arm through the receive worker and its numbers should become relay's.
  if (m.arm.startsWith("relay") || m.mutateDirectIsRelay) {
    postMessage(msg, [buf]);
  } else if (m.arm === "shared") {
    // A SharedArrayBuffer in a transfer list is a DataCloneError; the mutant proves the arm is real.
    if (m.mutateTransferShared) toPage.postMessage(msg, [buf]);
    else toPage.postMessage(msg);
  } else if (m.arm === "cloned") {
    toPage.postMessage(msg);
  } else {
    toPage.postMessage(msg, [buf]);
  }
}

function run(m) {
  held.length = 0;
  const shared = m.arm === "shared";
  for (let seq = 0; seq < m.count; seq++) {
    const buf = produce(m.size, shared, seq);
    const tReady = abs();
    if (m.arm === "direct-pull") held.push({ seq, buf, tReady });
    else emit(m, seq, buf, tReady);
  }
  postMessage({ kind: "produced", count: m.count });
}

function onAsk(e) {
  if (e.data.kind !== "ask") return;
  const h = held[e.data.seq];
  if (!h) return;
  held[e.data.seq] = null;
  toPage.postMessage(stamp(h.seq, h.buf, h.tReady), [h.buf]);
}

onmessage = (e) => {
  const m = e.data;
  if (m.kind === "ports") {
    toPage = m.direct;
    toPage.onmessage = onAsk;
    postMessage({ kind: "decode-ready" });
    return;
  }
  if (m.kind === "run") run(m);
};
