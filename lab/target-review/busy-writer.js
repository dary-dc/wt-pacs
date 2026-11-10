importScripts("busy-io.js");
onmessage = (e) => (e.data.kind === "io" ? startIo(e.data) : stopIo());
