/**
 * The AV1 item: a 16-byte header, n frame lengths, n frames. Every case docs/av1/item-format.md
 * names is refused here, by name, before anything is decoded.
 */
const HEADER = 16;
const FLAG_SIGNED = 1;
const FLAG_RCT = 2;
/** The low stream is 8-bit; samples are at most 16 bits. */
const MAX_SPLIT = 8;
const MAX_BITS = 16;

const refuse = (why) => {
  throw new Error(`undecodable: av1 item: ${why}`);
};

const container = (bits) => (bits <= 8 ? 8 : bits <= 10 ? 10 : 12);

/** `{ bits, depth, split, signed, rct, offset, frames }`, each frame its bytes; `n` is the count expected. */
export function parseItem(bytes, n = 1) {
  if (bytes.length < HEADER) refuse(`${bytes.length} bytes, under the ${HEADER}-byte header`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [version, bits, depth, split, flags] = bytes;
  if (version !== 1) refuse(`version ${version}, not 1`);
  if (flags & ~(FLAG_SIGNED | FLAG_RCT)) refuse(`unknown flag bits 0x${flags.toString(16)}`);
  if (bytes[5] | bytes[6] | bytes[7]) refuse("pad bytes not zero");
  const signed = (flags & FLAG_SIGNED) !== 0;
  const rct = (flags & FLAG_RCT) !== 0;
  const offset = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  if (![8, 10, 12].includes(depth)) refuse(`depth ${depth}, not 8, 10 or 12`);
  if (split > MAX_SPLIT) refuse(`split ${split}, over ${MAX_SPLIT}`);
  if (bits > MAX_BITS) refuse(`bits ${bits}, over ${MAX_BITS}`);
  if (rct && split) refuse(`rct with split ${split}`);
  if (offset && !signed) refuse(`offset ${offset} without signed`);
  if (!rct && bits > depth + split) refuse(`bits ${bits} over depth ${depth} + split ${split}`);
  if (!rct && depth !== container(bits - split)) refuse(`depth ${depth} for a top of ${bits - split} bits, not ${container(bits - split)}`);
  if (count !== n) refuse(`${count} frames, ${n} expected`);
  let at = HEADER + 4 * count;
  if (at > bytes.length) refuse("frame lengths overrun the item");
  const frames = [];
  for (let j = 0; j < count; j++) {
    const len = view.getUint32(HEADER + 4 * j, true);
    if (at + len > bytes.length) refuse(`frame ${j} overruns the item`);
    frames.push(bytes.subarray(at, at + len));
    at += len;
  }
  if (at !== bytes.length) refuse(`${bytes.length - at} bytes past the last frame`);
  return { bits, depth, split, signed, rct, offset, frames };
}

/** A split frame is `[u32le top length][top unit][low unit]`. */
export function units(frame, split) {
  if (!split) return [frame, null];
  const n = frame.length >= 4 ? new DataView(frame.buffer, frame.byteOffset).getUint32(0, true) : -1;
  if (n < 1 || 4 + n >= frame.length) refuse(`not a split frame (${frame.length} bytes)`);
  return [frame.subarray(4, 4 + n), frame.subarray(4 + n)];
}

/** The payload of a unit's sequence header OBU, or null. */
function sequenceHeader(unit) {
  for (let at = 0; at < unit.length; ) {
    const header = unit[at];
    const type = (header >> 3) & 15;
    let p = at + 1 + ((header >> 2) & 1);
    if (!(header & 2)) return null;
    let size = 0;
    for (let shift = 0; p < unit.length; shift += 7) {
      const b = unit[p++];
      size += (b & 127) * 2 ** shift;
      if (!(b & 128)) break;
    }
    if (type === 1) return unit.subarray(p, p + size);
    at = p + size;
  }
  return null;
}

/**
 * The fields of a unit's sequence header the codecs parameter string carries, or null: AV1 §5.5,
 * read up to `color_config`'s end.
 */
export function sequence(unit) {
  const obu = sequenceHeader(unit);
  if (!obu) return null;
  let bit = 0;
  const f = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, bit++) {
      if (bit >> 3 >= obu.length) throw new Error("undecodable: av1 sequence header cut");
      v = v * 2 + ((obu[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    return v;
  };
  const uvlc = () => {
    let zeros = 0;
    while (!f(1)) zeros++;
    return zeros < 32 ? f(zeros) : 0;
  };
  const profile = f(3);
  f(1);
  const reduced = f(1);
  let level = 0;
  let tier = 0;
  if (reduced) level = f(5);
  else {
    const timing = f(1);
    if (timing && (f(64), f(1))) uvlc();
    const decoderModel = timing && f(1);
    let delayBits = 0;
    if (decoderModel) {
      delayBits = f(5) + 1;
      f(32 + 5 + 5);
    }
    const displayDelay = f(1);
    const points = f(5) + 1;
    for (let i = 0; i < points; i++) {
      f(12);
      const l = f(5);
      const t = l > 7 ? f(1) : 0;
      if (i === 0) [level, tier] = [l, t];
      if (decoderModel && f(1)) f(2 * delayBits + 1);
      if (displayDelay && f(1)) f(4);
    }
  }
  const wBits = f(4) + 1;
  const hBits = f(4) + 1;
  f(wBits + hBits);
  if (!reduced && f(1)) f(4 + 3);
  f(3);
  let orderHint = 0;
  if (!reduced) {
    f(4);
    orderHint = f(1);
    if (orderHint) f(2);
    const screen = f(1) ? 2 : f(1);
    if (screen && !f(1)) f(1);
    if (orderHint) f(3);
  }
  f(3);
  const high = f(1);
  const bits = profile === 2 && high ? (f(1) ? 12 : 10) : high ? 10 : 8;
  const mono = profile === 1 ? 0 : f(1);
  const [cp, tc, mc] = f(1) ? [f(8), f(8), f(8)] : [2, 2, 2];
  let range;
  let ss = [1, 1];
  let csp = 0;
  if (mono) range = f(1);
  else if (cp === 1 && tc === 13 && mc === 0) [range, ss] = [1, [0, 0]];
  else {
    range = f(1);
    if (profile === 1) ss = [0, 0];
    else if (profile === 2) ss = bits === 12 ? (f(1) ? [1, f(1)] : [0, 0]) : [1, 0];
    if (ss[0] && ss[1]) csp = f(2);
  }
  return { profile, level, tier, bits, mono, ss, csp, cp, tc, mc, range };
}

const two = (n) => String(n).padStart(2, "0");

/** The AV1 codecs parameter string, every optional field written: AV1-ISOBMFF §5 (Codecs Parameter String). */
export function codecString(s) {
  const tier = s.tier ? "H" : "M";
  const chroma = `${s.ss[0]}${s.ss[1]}${s.ss[0] && s.ss[1] ? s.csp : 0}`;
  return `av01.${s.profile}.${two(s.level)}${tier}.${two(s.bits)}.${s.mono}.${chroma}.${two(s.cp)}.${two(s.tc)}.${two(s.mc)}.${s.range}`;
}

/** The stream layouts an item's frame decodes as, before decoding: what a WebCodecs probe must pass. */
export function layouts(item, top) {
  if (item.rct) return ["c10"];
  const own = item.depth === 8 && sequence(top)?.profile === 1 ? "c8" : `g${item.depth}`;
  return item.split ? [own, "g8"] : [own];
}

/** A keyframe decodes alone; any other unit only right after its predecessor `last`, `{ gen, index }`, of the same request. */
export function continues(last, unit) {
  if (unit.key || (last && unit.gen === last.gen && unit.index === last.index + 1)) return;
  throw new Error(`undecodable: frame ${unit.index - 1} was not decoded before it here`);
}
