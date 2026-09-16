// Stands in for the transport read loop: a steady stream of small chunks into the receive worker.
let port = null;
let timer = null;

onmessage = (e) => {
  const m = e.data;
  if (m.kind === "port") { port = m.port; return; }
  if (m.kind === "start") {
    clearInterval(timer);
    timer = setInterval(() => {
      for (let i = 0; i < m.perTick; i++) {
        const buf = new ArrayBuffer(m.chunk);
        new Uint8Array(buf)[0] = i & 0xff;
        port.postMessage(buf, [buf]);
      }
    }, m.everyMs);
    return;
  }
  if (m.kind === "stop") { clearInterval(timer); timer = null; postMessage({ kind: "stopped" }); }
};
