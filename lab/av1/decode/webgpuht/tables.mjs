// The cleanup pass's VLC and UVLC decoding tables, built as OpenJPH 0.31.0's ojph_block_common.cpp builds
// them, from its table0.h and table1.h (ITU-T T.814 Annex C's codewords). Entry layouts are that file's.

/** `{c_q, rho, u_off, e_k, e_1, cwd, cwd_len}` rows of a table0.h / table1.h text. */
const rows = (text) => [...text.matchAll(/\{([^}]*)\}/g)].map((m) => m[1].split(",").map((v) => Number(v.trim())));

function vlc(text) {
  const src = rows(text), out = new Uint32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const cwd = i & 0x7f, cq = i >> 7;
    for (const [c, rho, uoff, ek, e1, code, len] of src)
      if (c === cq && code === (cwd & ((1 << len) - 1))) out[i] = (rho << 4) | (uoff << 3) | (ek << 12) | (e1 << 8) | len;
  }
  return out;
}

// prefix length (2 bits), suffix length (3), prefix value (3), indexed by the next three VLC bits
const DEC = [3 | (5 << 2) | (5 << 5), 1 | (1 << 5), 2 | (2 << 5), 1 | (1 << 5), 3 | (1 << 2) | (3 << 5), 1 | (1 << 5), 2 | (2 << 5), 1 | (1 << 5)];
const entry = (prefix, suffix, suffix0, u0, u1) => prefix | (suffix << 3) | (suffix0 << 7) | (u0 << 10) | (u1 << 13);

function uvlc(initial) {
  const out = new Uint32Array(initial ? 320 : 256);
  for (let i = 0; i < out.length; i++) {
    const mode = i >> 6;
    let v = i & 0x3f;
    if (mode === 0) continue;
    if (mode <= 2) {
      const d = DEC[v & 7], s = (d >> 2) & 7;
      out[i] = entry(d & 3, s, mode === 1 ? s : 0, mode === 1 ? d >> 5 : 0, mode === 1 ? 0 : d >> 5);
      continue;
    }
    const d0 = DEC[v & 7];
    v >>= d0 & 3;
    const d1 = DEC[v & 7], s0 = (d0 >> 2) & 7;
    if (!initial || mode === 3) {
      out[i] = initial && (d0 & 3) === 3
        ? entry(4, s0, s0, d0 >> 5, (v & 1) + 1)
        : entry((d0 & 3) + (d1 & 3), s0 + ((d1 >> 2) & 7), s0, d0 >> 5, d1 >> 5);
    } else {
      out[i] = entry((d0 & 3) + (d1 & 3), s0 + ((d1 >> 2) & 7), s0, (d0 >> 5) + 2, (d1 >> 5) + 2);
    }
  }
  return out;
}

/** One Uint32Array: vlc0 [0, 1024), vlc1 [1024, 2048), uvlc0 [2048, 2368), uvlc1 [2368, 2624). */
export function tables(table0h, table1h) {
  const t = new Uint32Array(2624);
  t.set(vlc(table0h), 0);
  t.set(vlc(table1h), 1024);
  t.set(uvlc(true), 2048);
  t.set(uvlc(false), 2368);
  return t;
}
