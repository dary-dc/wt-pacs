// The HT cleanup pass as two kernels, the 5/3 synthesis and the pack: lab/av1/decode/webgpuht/README.md.
// Bitstream state and sample reconstruction follow OpenJPH 0.31.0's ojph_block_decoder32.cpp.

struct Block { offset: u32, lcup: u32, w: u32, h: u32, missing: u32, kmax: u32, dst: u32, stride: u32, quads: u32, ms: u32 }

@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read> tbl: array<u32>;
@group(0) @binding(2) var<storage, read> blocks: array<Block>;
@group(0) @binding(3) var<storage, read_write> quads: array<u32>;
@group(0) @binding(4) var<storage, read_write> ms: array<u32>;
@group(0) @binding(5) var<storage, read_write> ms_bits: array<u32>;
@group(0) @binding(6) var<storage, read_write> planes: array<i32>;
// [0] blocks whose MEL+VLC length is impossible, [1] workgroups whose subgroups are not contiguous
@group(0) @binding(7) var<storage, read_write> faults: array<atomic<u32>, 2>;

const VLC1 = 1024u;
const UVLC0 = 2048u;
const UVLC1 = 2368u;

var<private> base: u32;
var<private> mel_pos: u32;
var<private> mel_left: u32;
var<private> mel_tmp: u32;
var<private> mel_bits: u32;
var<private> mel_un: bool;
var<private> mel_k: u32;
var<private> run: i32;
var<private> vlc_pos: u32;
var<private> vlc_left: u32;
var<private> vlc_tmp: u32;
var<private> vlc_bits: u32;
var<private> vlc_un: bool;

fn byte_at(i: u32) -> u32 { return (src[i >> 2u] >> ((i & 3u) * 8u)) & 0xffu; }

// MEL: forward, MSB first; its last byte ORed with 0xF, 0xFF past the end; a byte after 0xFF gives 7 bits
fn mel_bit() -> u32 {
  if mel_bits == 0u {
    var v = 0xffu;
    if mel_left > 0u {
      v = byte_at(base + mel_pos);
      if mel_left == 1u { v |= 0xfu; }
      mel_pos += 1u;
      mel_left -= 1u;
    }
    mel_bits = select(8u, 7u, mel_un);
    mel_tmp = v;
    mel_un = v == 0xffu;
  }
  mel_bits -= 1u;
  return (mel_tmp >> mel_bits) & 1u;
}

/** A run of zero events: 2 × count, +1 when it ends in a one event. */
fn mel_run() -> i32 {
  let e = select(select(select(mel_k / 3u, 3u, mel_k >= 9u), 4u, mel_k == 11u), 5u, mel_k == 12u);
  if mel_bit() == 1u {
    mel_k = min(mel_k + 1u, 12u);
    return ((1i << e) - 1i) << 1u;
  }
  var r = 0u;
  for (var i = 0u; i < e; i++) { r = (r << 1u) | mel_bit(); }
  mel_k = max(mel_k, 1u) - 1u;
  return i32(r << 1u) + 1i;
}

fn mel_event() -> bool {
  run -= 2i;
  let one = run == -1i;
  if run < 0i { run = mel_run(); }
  return one;
}

// VLC: backward, LSB first; a 0x7F after a byte over 0x8F gives 7 bits; zeros past the end
fn vlc_peek() -> u32 {
  while vlc_bits <= 24u {
    var v = 0u;
    if vlc_left > 0u {
      v = byte_at(base + vlc_pos);
      vlc_pos -= 1u;
      vlc_left -= 1u;
    }
    vlc_tmp |= v << vlc_bits;
    vlc_bits += select(8u, 7u, vlc_un && (v & 0x7fu) == 0x7fu);
    vlc_un = v > 0x8fu;
  }
  return vlc_tmp;
}

fn vlc_skip(n: u32) {
  vlc_tmp = select(vlc_tmp >> n, 0u, n >= 32u);
  vlc_bits -= n;
}

/** KCUPS1: one thread a code-block decodes MEL and VLC to a word a quad, and unstuffs MagSgn. */
@compute @workgroup_size(64)
fn cleanup_vlc(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = g.x + g.y * nw.x * 64u;
  if i >= arrayLength(&blocks) { return; }
  let b = blocks[i];
  base = b.offset;
  let lcup = b.lcup;
  let scup = (byte_at(base + lcup - 1u) << 4u) + (byte_at(base + lcup - 2u) & 0xfu);
  if scup < 2u || scup > lcup || scup > 4079u {
    atomicAdd(&faults[0], 1u);
    return;
  }
  mel_pos = lcup - scup;
  mel_left = scup - 1u;
  mel_bits = 0u;
  mel_un = false;
  mel_k = 0u;
  let d = byte_at(base + lcup - 2u);
  vlc_pos = lcup - 3u;
  vlc_left = scup - 2u;
  vlc_tmp = d >> 4u;
  vlc_bits = select(4u, 3u, (vlc_tmp & 7u) == 7u);
  vlc_un = (d | 0xfu) > 0x8fu;
  run = mel_run();

  let qw = (b.w + 1u) >> 1u;
  let qh = (b.h + 1u) >> 1u;
  for (var qy = 0u; qy < qh; qy++) {
    let initial = qy == 0u;
    let row = b.quads + qy * qw;
    let tbl0 = select(VLC1, 0u, initial);
    var cq = 0u;
    for (var qx = 0u; qx < qw; qx += 2u) {
      var up0 = 0u; var up1 = 0u; var up2 = 0u;
      if !initial {
        up0 = quads[row - qw + qx];
        if qx + 1u < qw { up1 = quads[row - qw + qx + 1u]; }
        if qx + 2u < qw { up2 = quads[row - qw + qx + 2u]; }
        cq |= ((up0 & 0xa0u) << 2u) | ((up1 & 0x20u) << 4u);
      }
      var t0 = tbl[tbl0 + cq + (vlc_peek() & 0x7fu)];
      if cq == 0u && !mel_event() { t0 = 0u; }
      vlc_skip(t0 & 7u);
      if initial {
        cq = ((t0 & 0x10u) << 3u) | ((t0 & 0xe0u) << 2u);
      } else {
        cq = ((t0 & 0x40u) << 2u) | ((t0 & 0x80u) << 1u) | (up0 & 0x80u) | ((up1 & 0xa0u) << 2u) | ((up2 & 0x20u) << 4u);
      }
      var t1 = 0u;
      if qx + 1u < qw {
        t1 = tbl[tbl0 + cq + (vlc_peek() & 0x7fu)];
        if cq == 0u && !mel_event() { t1 = 0u; }
        vlc_skip(t1 & 7u);
      }
      if initial {
        cq = ((t1 & 0x10u) << 3u) | ((t1 & 0xe0u) << 2u);
      } else {
        cq = ((t1 & 0x40u) << 2u) | ((t1 & 0x80u) << 1u) | (up1 & 0x80u);
      }
      var mode = ((t0 & 8u) << 3u) | ((t1 & 8u) << 4u);
      var ue = 0u;
      if initial {
        if mode == 0xc0u && mel_event() { mode += 0x40u; }
        ue = tbl[UVLC0 + mode + (vlc_peek() & 0x3fu)];
      } else {
        ue = tbl[UVLC1 + mode + (vlc_peek() & 0x3fu)];
      }
      vlc_skip(ue & 7u);
      ue >>= 3u;
      let len = ue & 0xfu;
      let suffix = vlc_peek() & ((1u << len) - 1u);
      vlc_skip(len);
      ue >>= 4u;
      let len0 = ue & 7u;
      ue >>= 3u;
      let kappa = select(0u, 1u, initial);
      let u0 = kappa + (ue & 7u) + (suffix & ~(0xffu << len0));
      let u1 = kappa + (ue >> 3u) + (suffix >> len0);
      quads[row + qx] = (t0 & 0xffffu) | (u0 << 16u);
      if qx + 1u < qw { quads[row + qx + 1u] = (t1 & 0xffffu) | (u1 << 16u); }
    }
  }

  // MagSgn, forward and LSB first: a byte after 0xFF gives 7 bits
  let n = lcup - scup;
  var pos = 0u;
  var cur = 0u;
  var un = false;
  for (var k = 0u; k < n; k++) {
    let v = byte_at(base + k);
    let s = pos & 31u;
    cur |= v << s;
    let next = pos + select(8u, 7u, un);
    if (next >> 5u) != (pos >> 5u) {
      ms[b.ms + (pos >> 5u)] = cur;
      cur = select(v >> (32u - s), 0u, s == 0u);
    }
    pos = next;
    un = v == 0xffu;
  }
  ms[b.ms + (pos >> 5u)] = cur;
  ms_bits[i] = pos;
}

var<workgroup> wg_rows: u32;
var<workgroup> vtop: array<u32, 66>;  // v_n of the quad row above, column c at c + 1
var<workgroup> scan_buf: array<u32, 32>;

/** 32 MagSgn bits from bit o of a block's unstuffed stream; 1s past its end, as OpenJPH feeds 0xFF. */
fn magsgn_at(at: u32, nbits: u32, o: u32) -> u32 {
  let s = o & 31u;
  let lo = ms[at + (o >> 5u)];
  let hi = ms[at + (o >> 5u) + 1u];
  var v = select((lo >> s) | (hi << (32u - s)), lo, s == 0u);
  if o + 32u > nbits {
    let valid = select(nbits - o, 0u, o >= nbits);
    v |= ~((1u << valid) - 1u);
  }
  return v;
}

/** KCUPS2: a workgroup a code-block, a thread a quad column, quad rows in order. */
@compute @workgroup_size(32)
fn cleanup_magsgn(@builtin(workgroup_id) wid: vec3u, @builtin(num_workgroups) nw: vec3u,
                  @builtin(local_invocation_index) t: u32) {
  let i = wid.x + wid.y * nw.x;
  if i >= arrayLength(&blocks) { return; }
  let b = blocks[i];
  if t == 0u { wg_rows = (b.h + 1u) >> 1u; }
  for (var k = t; k < 66u; k += 32u) { vtop[k] = 0u; }
  let rows = workgroupUniformLoad(&wg_rows);
  let qw = (b.w + 1u) >> 1u;
  let p = 30u - b.missing;
  let shift = 31u - b.kmax;
  let nbits = ms_bits[i];
  var at = 0u;
  for (var qy = 0u; qy < rows; qy++) {
    var inf = 0u;
    var u = 0u;
    var count = 0u;
    if t < qw {
      let q = quads[b.quads + qy * qw + t];
      inf = q & 0xffffu;
      u = q >> 16u;
      if qy > 0u {
        var gamma = inf & 0xf0u;
        gamma &= gamma - 0x10u;
        let e = vtop[2u * t] | vtop[2u * t + 1u] | vtop[2u * t + 2u] | vtop[2u * t + 3u];
        u += select(1u, firstLeadingBit(e | 2u), gamma != 0u);
      }
      for (var n = 0u; n < 4u; n++) {
        if n >= 2u && 2u * t + 1u >= b.w { break; }
        if (inf & (1u << (4u + n))) != 0u { count += u - ((inf >> (12u + n)) & 1u); }
      }
    }
    let sc = scan(t, count);
    var o = at + sc.x;
    var v1 = 0u;
    var v3 = 0u;
    if t < qw {
      for (var n = 0u; n < 4u; n++) {
        let x = 2u * t + (n >> 1u);
        let y = 2u * qy + (n & 1u);
        if n >= 2u && x >= b.w { break; }
        var val = 0i;
        var vn = 0u;
        if (inf & (1u << (4u + n))) != 0u {
          let bits = magsgn_at(b.ms, nbits, o);
          let m = u - ((inf >> (12u + n)) & 1u);
          o += m;
          vn = bits & ((1u << m) - 1u);
          vn |= (((inf >> (8u + n)) & 1u) << m) | 1u;
          let full = (bits << 31u) | ((vn + 2u) << (p - 1u));
          let mag = i32((full & 0x7fffffffu) >> shift);
          val = select(mag, -mag, (full >> 31u) != 0u);
        }
        if y < b.h { planes[b.dst + y * b.stride + x] = val; }
        if n == 1u { v1 = vn; }
        if n == 3u { v3 = vn; }
      }
    }
    at += sc.y;
    workgroupBarrier();
    vtop[2u * t + 1u] = v1;
    vtop[2u * t + 2u] = v3;
    workgroupBarrier();
  }
}

struct Job { off: u32, stride: u32, w: u32, h: u32 }
struct Pass { first: u32, count: u32, cols: u32 }

@group(0) @binding(8) var<storage, read> lines_in: array<i32>;
@group(0) @binding(9) var<storage, read_write> lines_out: array<i32>;
@group(0) @binding(10) var<storage, read> jobs: array<Job>;
@group(0) @binding(11) var<uniform> pass_: Pass;

/** One level of the reversible 5/3 synthesis along rows or columns, a thread a line (ITU-T T.800 F.3.8.1). */
@compute @workgroup_size(64)
fn synth(@builtin(global_invocation_id) g: vec3u) {
  if g.y >= pass_.count { return; }
  let j = jobs[pass_.first + g.y];
  var n = j.w;
  var lines = j.h;
  var a = j.stride;
  var e = 1u;
  if pass_.cols == 1u { n = j.h; lines = j.w; a = 1u; e = j.stride; }
  if g.x >= lines { return; }
  let o = j.off + g.x * a;
  if n == 1u { lines_out[o] = lines_in[o]; return; }
  let nl = (n + 1u) >> 1u;
  let nh = n >> 1u;
  for (var k = 0u; k < nl; k++) {
    let h0 = lines_in[o + (nl + max(k, 1u) - 1u) * e];
    let h1 = lines_in[o + (nl + min(k, nh - 1u)) * e];
    lines_out[o + 2u * k * e] = lines_in[o + k * e] - ((h0 + h1 + 2i) >> 2u);
  }
  for (var k = 0u; k < nh; k++) {
    let next = lines_out[o + min(2u * k + 2u, 2u * nl - 2u) * e];
    lines_out[o + (2u * k + 1u) * e] = lines_in[o + (nl + k) * e] + ((lines_out[o + 2u * k * e] + next) >> 1u);
  }
}

struct Frame { planes: u32, n: u32, comps: u32, bits: u32, signed_: u32, rct: u32, out: u32, words: u32 }

@group(0) @binding(12) var<storage, read> coeffs: array<i32>;
@group(0) @binding(13) var<storage, read> frames: array<Frame>;
@group(0) @binding(14) var<storage, read_write> packed: array<u32>;

/** Sample j of a frame as the decoder emits it, components interleaved: RCT inverted, level shift added. */
fn sample(f: Frame, j: u32) -> i32 {
  let p = j / f.comps;
  let c = j % f.comps;
  var v = coeffs[f.planes + c * f.n + p];
  if f.rct == 1u {
    let cb = coeffs[f.planes + f.n + p];
    let cr = coeffs[f.planes + 2u * f.n + p];
    let g = coeffs[f.planes + p] - ((cb + cr) >> 2u);
    v = select(select(cb + g, g, c == 1u), cr + g, c == 0u);
  }
  return v + select(1i << (f.bits - 1u), 0i, f.signed_ == 1u);
}

/** A thread a 32-bit word of output: four 8-bit samples or two 16-bit little-endian ones. */
@compute @workgroup_size(64)
fn pack(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let f = frames[g.y];
  let i = g.x + g.z * nw.x * 64u;
  if i >= f.words { return; }
  let total = f.n * f.comps;
  let wide = f.bits > 8u;
  let per = select(4u, 2u, wide);
  var word = 0u;
  for (var k = 0u; k < per; k++) {
    let j = per * i + k;
    if j < total {
      let s = u32(sample(f, j));
      word |= select(s & 0xffu, s & 0xffffu, wide) << (32u / per * k);
    }
  }
  packed[f.out + i] = word;
}
