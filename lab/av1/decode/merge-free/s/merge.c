// S's merge of a split frame: out = ((top << k) | low) − offset in 16-bit lanes, and the merged samples' range.
// lab/av1/decode/merge-free/README.md
#include <stdint.h>
#include <wasm_simd128.h>

static int lo, hi;

int range_min(void) { return lo; }
int range_max(void) { return hi; }

// Strides are in samples. The offset is subtracted after the range is taken, so the range is of the signed values.
#define MERGE(name, T, LOAD)                                                                                \
  void name(const T *top, int ts, const uint8_t *low, int ls, uint16_t *out, int w, int h, int k, int offset) { \
    v128_t vmin = wasm_u16x8_splat(0xffff), vmax = wasm_u16x8_splat(0), off = wasm_i16x8_splat(offset);    \
    unsigned smin = 0xffff, smax = 0;                                                                      \
    for (int y = 0; y < h; y++) {                                                                          \
      const T *t = top + y * ts;                                                                           \
      const uint8_t *b = low + y * ls;                                                                     \
      uint16_t *o = out + y * w;                                                                           \
      int x = 0;                                                                                           \
      for (; x + 8 <= w; x += 8) {                                                                         \
        v128_t v = wasm_v128_or(wasm_i16x8_shl(LOAD(t + x), k), wasm_u16x8_load8x8(b + x));                \
        vmin = wasm_u16x8_min(vmin, v);                                                                    \
        vmax = wasm_u16x8_max(vmax, v);                                                                    \
        wasm_v128_store(o + x, wasm_i16x8_sub(v, off));                                                    \
      }                                                                                                    \
      for (; x < w; x++) {                                                                                 \
        unsigned v = (uint16_t)(t[x] << k) | b[x];                                                         \
        if (v < smin) smin = v;                                                                            \
        if (v > smax) smax = v;                                                                            \
        o[x] = (uint16_t)(v - offset);                                                                     \
      }                                                                                                    \
    }                                                                                                      \
    uint16_t a[8], z[8];                                                                                   \
    wasm_v128_store(a, vmin);                                                                              \
    wasm_v128_store(z, vmax);                                                                              \
    for (int i = 0; i < 8; i++) {                                                                          \
      if (a[i] < smin) smin = a[i];                                                                        \
      if (z[i] > smax) smax = z[i];                                                                        \
    }                                                                                                      \
    lo = (int)smin - offset;                                                                               \
    hi = (int)smax - offset;                                                                               \
  }

MERGE(merge16, uint16_t, wasm_v128_load)
MERGE(merge8, uint8_t, wasm_u16x8_load8x8)
