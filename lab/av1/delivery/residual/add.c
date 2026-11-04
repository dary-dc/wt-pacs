// S for the lossy designs: add.js's shown() and exact() in 16-bit lanes, unsigned output only.
// lab/av1/delivery/residual/README.md §Lossy pixel work protocol, pre-registered
#include <stdint.h>
#include <wasm_simd128.h>

static unsigned lo, hi;

unsigned range_min(void) { return lo; }
unsigned range_max(void) { return hi; }

static void ranged(v128_t vmin, v128_t vmax, unsigned smin, unsigned smax) {
  uint16_t a[8], z[8];
  wasm_v128_store(a, vmin);
  wasm_v128_store(z, vmax);
  for (int i = 0; i < 8; i++) {
    if (a[i] < smin) smin = a[i];
    if (z[i] > smax) smax = z[i];
  }
  lo = smin;
  hi = smax;
}

// Strides are in samples; `out` is dense. Lanes wrap as the stored Uint16Array does.
#define ADD(name, R, LOADR, SCALARR)                                                                           \
  void name(const uint16_t *p, int ps, const R *r, uint16_t *out, int w, int h, int shift, int bias) {         \
    v128_t vmin = wasm_u16x8_splat(0xffff), vmax = wasm_u16x8_splat(0), b = wasm_i16x8_splat(bias);           \
    unsigned smin = 0xffff, smax = 0;                                                                          \
    for (int y = 0; y < h; y++) {                                                                              \
      const uint16_t *t = p + y * ps;                                                                          \
      const R *q = r + y * w;                                                                                  \
      uint16_t *o = out + y * w;                                                                               \
      int x = 0;                                                                                               \
      for (; x + 8 <= w; x += 8) {                                                                             \
        v128_t v = wasm_i16x8_sub(wasm_i16x8_add(wasm_i16x8_shl(wasm_v128_load(t + x), shift), LOADR(q + x)), b); \
        vmin = wasm_u16x8_min(vmin, v);                                                                        \
        vmax = wasm_u16x8_max(vmax, v);                                                                        \
        wasm_v128_store(o + x, v);                                                                             \
      }                                                                                                        \
      for (; x < w; x++) {                                                                                     \
        unsigned v = (uint16_t)((t[x] << shift) + SCALARR(q[x]) - bias);                                       \
        if (v < smin) smin = v;                                                                                \
        if (v > smax) smax = v;                                                                                \
        o[x] = (uint16_t)v;                                                                                    \
      }                                                                                                        \
    }                                                                                                          \
    ranged(vmin, vmax, smin, smax);                                                                            \
  }

#define NONE(q) wasm_i16x8_splat(0)
#define ZERO(q) 0
#define SAME(q) (q)

ADD(exact16, uint16_t, wasm_v128_load, SAME)
ADD(exact8, uint8_t, wasm_u16x8_load8x8, SAME)
ADD(shown16, uint16_t, NONE, ZERO)
