// OpenHTJ2K decoding a rectangle of an unsigned one-component frame into 16-bit samples.
#include <emscripten/emscripten.h>

#include <cstdint>
#include <vector>

#include "decoder.hpp"

extern uint64_t lab_decoded_bytes;

extern "C" {

// Rows [y0, y1) and columns [x0, x1) of the frame land row-major in `out`; the whole frame when the
// rectangle is the frame, which sets no range. Returns the code-block bytes the decoder decoded.
EMSCRIPTEN_KEEPALIVE double region_decode(const uint8_t *cs, uint32_t n, uint32_t x0, uint32_t y0,
                                          uint32_t x1, uint32_t y1, uint16_t *out) {
  open_htj2k::openhtj2k_decoder d(cs, n, 0, 1);
  d.parse();
  if (x0 != 0 || y0 != 0 || x1 != d.get_component_width(0) || y1 != d.get_component_height(0)) {
    d.set_row_range(y0, y1);
    d.set_col_range(x0, x1);
  }
  lab_decoded_bytes = 0;
  const uint32_t w = x1 - x0;
  std::vector<uint32_t> width, height;
  std::vector<uint8_t> depth;
  std::vector<bool> is_signed;
  d.invoke_line_based_stream(
      [&](uint32_t y, int32_t *const *rows, uint16_t) {
        if (y < y0 || y >= y1) return;
        const int32_t *src = rows[0] + x0;
        uint16_t *dst = out + static_cast<size_t>(y - y0) * w;
        for (uint32_t x = 0; x < w; ++x) dst[x] = static_cast<uint16_t>(src[x]);
      },
      width, height, depth, is_signed);
  return static_cast<double>(lab_decoded_bytes);
}
}
