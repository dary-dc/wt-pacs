/**
 * A frame decoded at a resolution level through the shipped OpenJPH package, made exact: the package leaves the 5/3
 * low band unclamped above the declared depth, where OpenJPEG and the standard's range stop. lab/av1/decode/resolution-level/README.md
 */
export function decodeLevel(dec, bytes, level) {
  dec.getEncodedBuffer(bytes.length).set(bytes);
  dec.readHeader();
  const info = dec.getFrameInfo();
  dec.decodeSubResolution(level);
  const out = dec.getDecodedBuffer();
  if (info.bitsPerSample <= 8 || info.isSigned) throw new Error(`undecodable: grey unsigned over 8 bits only`);
  const px = new Uint16Array(out.buffer, out.byteOffset, out.length >> 1);
  const top = (1 << info.bitsPerSample) - 1;
  let clamped = 0;
  for (let i = 0; i < px.length; i++) if (px[i] > top) { px[i] = top; clamped++; }
  return { info, out, clamped };
}
