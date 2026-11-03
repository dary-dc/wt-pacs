// A PNG screenshot's samples: 8-bit RGB or RGBA, not interlaced, which is what Chromium's screenshots are.
import { inflateSync } from "node:zlib";

export function decodePng(buf) {
  let at = 8, width, height, channels;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), type = buf.toString("latin1", at + 4, at + 8), body = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit, non-interlaced PNG");
      channels = { 2: 3, 6: 4 }[body[9]];
    }
    if (type === "IDAT") idat.push(body);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0, b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? out[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  return { width, height, channels, at: (x, y) => out.subarray((y * width + x) * channels, (y * width + x) * channels + 3) };
}
