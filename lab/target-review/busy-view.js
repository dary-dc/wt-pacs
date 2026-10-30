importScripts("busy-io.js");
const delays = [];
onmessage = (e) => {
  const m = e.data;
  if (m.kind === "show") delays.push(performance.timeOrigin + performance.now() - m.t);
  else if (m.kind === "io") startIo(m);
  else if (m.kind === "stop") stopIo();
  else if (m.kind === "report") postMessage({ delays });
};
