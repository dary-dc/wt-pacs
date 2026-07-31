function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function wtConnect(url, hashHex) {
  const bytes = hexToBytes(hashHex);
  const transport = new WebTransport(url, {
    serverCertificateHashes: [{ algorithm: "sha-256", value: bytes }],
  });
  await transport.ready;
  const stream = await transport.createBidirectionalStream();
  return {
    readable: stream.readable,
    writable: stream.writable,
    transport,
  };
}

export async function wtWrite(writer, bytes) {
  const w = writer.getWriter();
  await w.write(bytes);
  w.releaseLock();
}

export async function wtReadAll(reader) {
  const r = reader.getReader();
  const chunks = [];
  while (true) {
    const { value, done } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function wtAcceptUni(transport) {
  const reader = transport.incomingUnidirectionalStreams.getReader();
  const { value, done } = await reader.read();
  if (done) return null;
  return value;
}
