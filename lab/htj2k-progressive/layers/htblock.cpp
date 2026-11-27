// One HT set for one code-block: OpenJPH 0.31.0's cleanup encoder at bit-plane P, and SigProp and
// MagRef encoders at P - 1 written as the exact inverse of ojph_decode_codeblock32 (ojph_block_decoder32.cpp).
// Lab only; layers/README.md says what calls it.
#include <cstdint>
#include <cstring>
#include <vector>
#include "ojph_mem.h"
#include "coding/ojph_block_encoder.h"

using ojph::ui8;
using ojph::ui32;

namespace {

// Forward bit-stuffed stream (SigProp): bits LSB first, 7 bits in the byte after a 0xFF.
struct Forward {
  std::vector<ui8> bytes;
  ui32 acc = 0, used = 0, room = 8;
  void put(ui32 bit) {
    acc |= bit << used;
    if (++used == room) flush_byte();
  }
  void flush_byte() {
    bytes.push_back((ui8)acc);
    room = acc == 0xFF ? 7 : 8;
    acc = 0; used = 0;
  }
  void finish() { if (used) flush_byte(); }
};

// Backward stream (MagRef), read from the segment's end: bits LSB first; after a byte > 0x8F, a byte whose
// low 7 bits are all 1 carries only those 7 (rev_read_mrp's unstuffing).
struct Backward {
  std::vector<ui8> bytes;  // in write order; the segment holds them reversed at its end
  ui32 acc = 0, used = 0;
  bool unstuff = true;  // rev_init_mrp starts with unstuff set
  void put(ui32 bit) {
    acc |= bit << used;
    ++used;
    if (unstuff && used == 7 && acc == 0x7F) { emit(); return; }
    if (used == 8) emit();
  }
  void emit() {
    bytes.push_back((ui8)acc);
    unstuff = acc > 0x8F;
    acc = 0; used = 0;
  }
  void finish() { if (used) emit(); }
};

inline ui32 bitat(ui32 v, int plane) { return (v >> plane) & 1u; }

}  // namespace

// coef: w*h magnitudes-with-sign as int32, row-major. P: the cleanup's bit-plane. refine: also code SigProp and
// MagRef at P - 1. out receives the cleanup bytes, then the refinement segment (SigProp forward, MagRef
// reversed at its end). Returns -1 on error, else 1 if every sample's magnitude at planes >= P - refine is
// what a decoder reconstructs, 0 if SigProp could not reach a sample that becomes significant at P - 1.
extern "C" int ht_encode(const int32_t* coef, int w, int h, int Kmax, int P, int refine,
                         ui8* out, int out_size, int* len_cup, int* len_ref) {
  if (w > 64 * 16 || h > 64 * 16 || P < 0 || (refine && P < 1) || Kmax - 1 - P < 0) return -1;
  const ui32 shift = 31 - Kmax;
  std::vector<ui32> buf(w * h);
  std::vector<ui32> mag(w * h);
  for (int i = 0; i < w * h; ++i) {
    int32_t v = coef[i];
    mag[i] = (ui32)(v < 0 ? -(int64_t)v : v);
    buf[i] = (v < 0 ? 0x80000000u : 0u) | (mag[i] << shift);
  }
  if (!ojph::local::initialize_block_encoder_tables()) return -1;
  ojph::mem_elastic_allocator elastic(1u << 20);
  ojph::coded_lists* coded = nullptr;
  ui32 lengths[2] = {0, 0};
  ojph::local::ojph_encode_codeblock32(buf.data(), (ui32)(Kmax - 1 - P), 1, w, h, w, lengths, &elastic, coded);
  int n = 0;
  for (ojph::coded_lists* c = coded; c; c = c->next_list) {
    ui32 k = c->buf_size - c->avail_size;
    if (n + (int)k > out_size) return -1;
    memcpy(out + n, c->buf, k);
    n += (int)k;
  }
  if ((ui32)n != lengths[0]) return -1;
  *len_cup = n;
  *len_ref = 0;
  if (!refine) return 1;

  // Significance after the cleanup: magnitude >> P nonzero. SigProp then visits, stripe by stripe and in groups of
  // four columns, every insignificant sample with a significant neighbour, as the decoder's mbr does.
  const int pl = P - 1;
  std::vector<uint8_t> sig(w * (h + 4), 0), cup(w * h, 0);
  for (int i = 0; i < w * h; ++i) cup[i] = sig[i] = (mag[i] >> P) != 0;
  auto S = [&](int x, int y) -> int {
    if (x < 0 || x >= w || y < 0 || y >= h) return 0;
    return sig[y * w + x];
  };
  Forward spp;
  bool exact = true;
  for (int y0 = 0; y0 < h; y0 += 4) {
    for (int x0 = 0; x0 < w; x0 += 4) {
      std::vector<int> fresh;  // samples made significant in this group, column-major, for the signs
      for (int x = x0; x < x0 + 4 && x < w; ++x) {
        for (int y = y0; y < y0 + 4 && y < h; ++y) {
          if (cup[y * w + x]) continue;
          // The decoder's 8-neighbourhood: what is already scanned counts as final; the stripe below, and the
          // next group within this stripe, only as the cleanup left them.
          int nb = 0;
          for (int dy = -1; dy <= 1 && !nb; ++dy)
            for (int dx = -1; dx <= 1 && !nb; ++dx) {
              if (!dx && !dy) continue;
              int xx = x + dx, yy = y + dy;
              if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
              bool later_group = xx >= x0 + 4 && yy >= y0;
              bool below_stripe = yy >= y0 + 4;
              if (later_group || below_stripe)
                nb = cup[yy * w + xx];
              else
                nb = S(xx, yy);
            }
          if (!nb) {
            if (bitat(mag[y * w + x], pl)) exact = false;
            continue;
          }
          ui32 b = bitat(mag[y * w + x], pl);
          spp.put(b);
          if (b) { sig[y * w + x] = 1; fresh.push_back(y * w + x); }
        }
      }
      for (int i : fresh) spp.put(coef[i] < 0 ? 1u : 0u);
    }
  }
  spp.finish();

  // MagRef: every sample significant after the cleanup, in stripes, columns, rows; its bit at P - 1.
  Backward mrp;
  for (int y0 = 0; y0 < h; y0 += 4)
    for (int x = 0; x < w; ++x)
      for (int y = y0; y < y0 + 4 && y < h; ++y)
        if (cup[y * w + x]) mrp.put(bitat(mag[y * w + x], pl));
  mrp.finish();

  int r = (int)(spp.bytes.size() + mrp.bytes.size());
  if (n + r > out_size) return -1;
  memcpy(out + n, spp.bytes.data(), spp.bytes.size());
  for (size_t i = 0; i < mrp.bytes.size(); ++i) out[n + r - 1 - (int)i] = mrp.bytes[i];
  *len_ref = r;
  return exact ? 1 : 0;
}
