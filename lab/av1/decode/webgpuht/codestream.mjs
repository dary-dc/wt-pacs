// An HTJ2K codestream's code-blocks, as the kernels take them; the subset parsed is in README.md §Scope.
// Packet-header parsing follows OpenJPH 0.31.0's precinct::parse (src/core/codestream/ojph_precinct.cpp).

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const refuse = (what) => { throw new Error(`webgpuht: ${what} is outside the parsed subset`); };

/** The J2K packet-header bit reader: MSB first, a byte after 0xFF carries 7 bits. */
function bitReader(b, pos) {
  let tmp = 0, avail = 0, unstuff = false;
  const r = {
    get pos() { return pos; },
    bit() {
      if (avail === 0) { tmp = b[pos++]; avail = 8 - unstuff; unstuff = tmp === 0xff; }
      return (tmp >> --avail) & 1;
    },
    bits(n) { let v = 0; while (n--) v = v * 2 + r.bit(); return v; },
    end() { if (unstuff) pos++; avail = 0; unstuff = false; },
  };
  return r;
}

/** Tag tree nodes over a w × h grid of code-blocks, level 0 the leaves, `levels` the root's parent. */
function tagTree(w, h, levels) {
  const lv = [];
  for (let l = 0; l <= levels; l++) {
    const lw = Math.max(1, Math.ceil(w / 2 ** l)), lh = Math.max(1, Math.ceil(h / 2 ** l));
    lv.push({ w: lw, v: new Int32Array(lw * lh), seen: new Uint8Array(lw * lh) });
  }
  const at = (x, y, l) => (y >> l) * lv[l].w + (x >> l);
  return { lv, at };
}

const log2ceil = (n) => Math.ceil(Math.log2(n));

/** Subband rectangles of one component in Mallat layout, resolution 0 first; b: 0 LL, 1 HL, 2 LH, 3 HH. */
export function subbands(W, H, L) {
  const dim = (n, r) => Math.ceil(n / 2 ** (L - r));
  const out = [[{ b: 0, x: 0, y: 0, w: dim(W, 0), h: dim(H, 0) }]];
  for (let r = 1; r <= L; r++) {
    const wl = dim(W, r - 1), hl = dim(H, r - 1), wr = dim(W, r), hr = dim(H, r);
    out.push([
      { b: 1, x: wl, y: 0, w: wr - wl, h: hl },
      { b: 2, x: 0, y: hl, w: wl, h: hr - hl },
      { b: 3, x: wl, y: hl, w: wr - wl, h: hr - hl },
    ]);
  }
  return out;
}

export function parse(bytes) {
  const b = bytes;
  if (u16(b, 0) !== 0xff4f) refuse("a stream without SOC");
  let pos = 2, siz, cod, qcd;
  const body = [];
  while (pos < b.length) {
    const m = u16(b, pos);
    if (m === 0xffd9) break;
    const len = u16(b, pos + 2), seg = pos + 4;
    if (m === 0xff51) {
      const C = u16(b, seg + 34);
      siz = { W: u32(b, seg + 2), H: u32(b, seg + 6), x0: u32(b, seg + 10), y0: u32(b, seg + 14),
        tw: u32(b, seg + 18), th: u32(b, seg + 22), comps: [] };
      for (let c = 0; c < C; c++) {
        const s = b[seg + 36 + 3 * c];
        if (b[seg + 37 + 3 * c] !== 1 || b[seg + 38 + 3 * c] !== 1) refuse("component subsampling");
        siz.comps.push({ signed: !!(s & 0x80), bits: (s & 0x7f) + 1 });
      }
    } else if (m === 0xff52) {
      cod = { scod: b[seg], order: b[seg + 1], layers: u16(b, seg + 2), mct: b[seg + 4], L: b[seg + 5],
        xcb: b[seg + 6] + 2, ycb: b[seg + 7] + 2, style: b[seg + 8], wavelet: b[seg + 9] };
    } else if (m === 0xff5c) {
      qcd = { guard: b[seg] >> 5, style: b[seg] & 0x1f, sp: [...b.subarray(seg + 1, seg + len - 2)] };
    } else if (m === 0xff53 || m === 0xff5d) {
      refuse("COC or QCC");
    } else if (m === 0xff90) {
      const psot = u32(b, seg + 4), start = pos;
      pos = seg + 8;
      while (u16(b, pos) !== 0xff93) pos += 2 + u16(b, pos + 2);
      pos += 2;
      const end = psot ? start + psot : b.length - 2;
      body.push([pos, end]);
      pos = end;
      continue;
    }
    pos = seg + len - 2;
  }
  const { W, H } = siz;
  if (siz.x0 || siz.y0 || siz.tw < W || siz.th < H) refuse("an image offset or more than one tile");
  if (cod.layers !== 1 || cod.scod !== 0 || !(cod.style & 0x40) || cod.wavelet !== 1 || qcd.style !== 0)
    refuse("not one layer, default precincts without SOP/EPH, HT code-blocks, reversible 5/3");
  if (cod.xcb > 6 || cod.ycb > 6) refuse("code-blocks over 64");
  if (body.length !== 1) refuse("more than one tile-part");
  const C = siz.comps.length, L = cod.L;
  const bands = subbands(W, H, L);
  const packets = [];
  const rFirst = cod.order <= 2;
  for (let i = 0; i < C * (L + 1); i++)
    packets.push(rFirst ? { r: Math.floor(i / C), c: i % C } : { r: i % (L + 1), c: Math.floor(i / (L + 1)) });

  const blocks = [];
  let at = body[0][0];
  for (const { r, c } of packets) {
    const bits = bitReader(b, at);
    const coded = [];
    let empty = true, zeroLength = false;
    for (const sb of bands[r]) {
      if (!sb.w || !sb.h) continue;
      if (empty) {
        if (!bits.bit()) { zeroLength = true; break; }
        empty = false;
      }
      const nw = Math.ceil(sb.w / (1 << cod.xcb)), nh = Math.ceil(sb.h / (1 << cod.ycb));
      const levels = 1 + Math.max(log2ceil(nw), log2ceil(nh));
      const inc = tagTree(nw, nh, levels), msb = tagTree(nw, nh, levels);
      const kmax = (qcd.sp[r ? 3 * (r - 1) + sb.b : 0] >> 3) - 1 + qcd.guard;
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        let skip = false;
        for (let l = levels - 1; l >= 0 && !skip; l--) {
          const t = inc.lv[l], k = inc.at(x, y, l);
          if (t.v[k] === 1) { skip = true; break; }
          if (!t.seen[k]) { const bit = bits.bit(); t.v[k] = 1 - bit; t.seen[k] = 1; skip = bit === 0; }
        }
        if (skip) continue;
        let missing = 0;
        for (let l = levels; l > 0; l--) {
          missing = msb.lv[l].v[msb.at(x, y, l)];
          const t = msb.lv[l - 1], k = msb.at(x, y, l - 1);
          if (!t.seen[k]) {
            while (!bits.bit()) missing++;
            t.v[k] = missing; t.seen[k] = 1;
          }
        }
        let passes = 1;
        if (bits.bit()) {
          passes = 2;
          if (bits.bit()) {
            const v2 = bits.bits(2); passes = 3 + v2;
            if (v2 === 3) { const v5 = bits.bits(5); passes = 6 + v5; if (v5 === 31) passes = 37 + bits.bits(7); }
          }
        }
        const placeholders = Math.floor((passes - 1) / 3);
        missing += placeholders;
        passes -= 3 * placeholders;
        let lblock = 3;
        while (bits.bit()) lblock++;
        const lcup = bits.bits(lblock + Math.floor(Math.log2(3 * placeholders + 1)));
        const lref = passes > 1 ? bits.bits(lblock + (passes > 2 ? 1 : 0)) : 0;
        const x0 = x << cod.xcb, y0 = y << cod.ycb;
        coded.push({ comp: c, x: sb.x + x0, y: sb.y + y0, w: Math.min(1 << cod.xcb, sb.w - x0),
          h: Math.min(1 << cod.ycb, sb.h - y0), lcup, lref, passes, missing, kmax });
      }
    }
    if (empty && !zeroLength) bits.bit();
    bits.end();
    at = bits.pos;
    for (const cb of coded) { cb.offset = at; at += cb.lcup + cb.lref; blocks.push(cb); }
  }
  return { W, H, L, comps: siz.comps, rct: C === 3 && cod.mct === 1, blocks };
}
