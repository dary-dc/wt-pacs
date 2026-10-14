// In the page: WebCodecs' AV1 decoder against lossless streams. Driven by probe.mjs.

const PREFS = ["no-preference", "prefer-software", "prefer-hardware"];

window.configGrid = async () => {
  const rows = [];
  for (const profile of [0, 1, 2])
    for (const bits of ["08", "10", "12"])
      for (const [layout, mono, ccc, colour] of [
        ["mono", 1, "110", "01.01.01.0"],
        ["420", 0, "110", "01.01.01.0"],
        ["444", 0, "000", "01.13.00.0"], // identity matrix (GBR)
      ])
        for (const hardwareAcceleration of PREFS) {
          const codec = `av01.${profile}.00M.${bits}.${mono}.${ccc}.${colour}`;
          let supported;
          try {
            ({ supported } = await VideoDecoder.isConfigSupported({ codec, hardwareAcceleration }));
          } catch (e) {
            supported = `throws ${e.name}`;
          }
          rows.push({ profile, bits: +bits, layout, hardwareAcceleration, codec, supported });
        }
  return rows;
};

// IVF: 32-byte file header, then per frame a 12-byte header (u32 size, u64 pts) and one temporal unit.
function temporalUnits(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units = [];
  for (let at = view.getUint16(6, true); at < bytes.length; ) {
    const size = view.getUint32(at, true);
    units.push(bytes.subarray(at + 12, at + 12 + size));
    at += 12 + size;
  }
  return units;
}

function leb128(bytes, at) {
  let value = 0, len = 0;
  for (;;) {
    const b = bytes[at + len];
    value += (b & 0x7f) * 2 ** (7 * len);
    len++;
    if (!(b & 0x80)) return [value, len];
  }
}

// Every OBU libaom writes into IVF carries obu_has_size_field, so a unit walks without the container.
function withoutTemporalDelimiters(unit) {
  const kept = [];
  for (let at = 0; at < unit.length; ) {
    const header = unit[at];
    const ext = (header >> 2) & 1;
    const [size, len] = leb128(unit, at + 1 + ext);
    const end = at + 1 + ext + len + size;
    if (((header >> 3) & 0xf) !== 2) kept.push(unit.subarray(at, end));
    at = end;
  }
  const out = new Uint8Array(kept.reduce((n, k) => n + k.length, 0));
  let at = 0;
  for (const k of kept) out.set(k, at), (at += k.length);
  return out;
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function frameRecord(frame, mutate) {
  const size = frame.allocationSize();
  const buf = new Uint8Array(size);
  const layout = await frame.copyTo(buf);
  if (mutate) buf[layout[0].offset] ^= 1;
  const planes = [];
  for (let p = 0; p < layout.length; p++) {
    const end = p + 1 < layout.length ? layout[p + 1].offset : size;
    const bytes = buf.subarray(layout[p].offset, end);
    const record = { stride: layout[p].stride, bytes: bytes.length, sha256: await sha256(bytes) };
    if (p > 0) {
      const wide = frame.format.includes("P1");
      const samples = wide ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2) : bytes;
      let min = Infinity, max = -Infinity;
      for (const s of samples) (min = Math.min(min, s)), (max = Math.max(max, s));
      Object.assign(record, { min, max });
    }
    planes.push(record);
  }
  const cs = frame.colorSpace;
  const record = {
    timestamp: frame.timestamp, format: frame.format,
    codedWidth: frame.codedWidth, codedHeight: frame.codedHeight,
    visible: [frame.visibleRect.width, frame.visibleRect.height],
    colorSpace: { matrix: cs.matrix, primaries: cs.primaries, transfer: cs.transfer, fullRange: cs.fullRange },
    planes,
  };
  frame.close();
  return record;
}

// variant: "tu" (a chunk per temporal unit, flushed), "noflush" (the same, never flushed; "noflush:N"
// sends only the first N units), "nodelim" (temporal delimiters stripped).
window.decodeStream = async ({ url, codec, mode, gop, variant, hardwareAcceleration, mutate }) => {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const frames = [];
  const errors = [];
  const pending = [];
  const decoder = new VideoDecoder({
    output: (f) => pending.push(frameRecord(f, mutate).then((r) => frames.push(r))),
    error: (e) => errors.push(`${e.name}: ${e.message}`),
  });
  try {
    decoder.configure({ codec, hardwareAcceleration });
    const limit = variant.startsWith("noflush:") ? +variant.split(":")[1] : Infinity;
    temporalUnits(bytes).slice(0, limit).forEach((unit, i) => {
      const data = variant === "nodelim" ? withoutTemporalDelimiters(unit) : unit;
      const type = mode === "intra" || i % gop === 0 ? "key" : "delta";
      decoder.decode(new EncodedVideoChunk({ type, timestamp: i * 40000, data }));
    });
    if (variant.startsWith("noflush")) await new Promise((r) => setTimeout(r, 1000));
    else await decoder.flush();
  } catch (e) {
    errors.push(`${e.name}: ${e.message}`);
  }
  await Promise.all(pending);
  frames.sort((a, b) => a.timestamp - b.timestamp);
  if (decoder.state !== "closed") decoder.close();
  return { frames, errors };
};
