// The smallest thing that decodes an HTJ2K frame in WASM, so the same source can be built
// twice with only the memory flags changed. docs/decode/README.md §Phase 2 says why.
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cstdint>
#include <vector>

#include <openjph/ojph_codestream.h>
#include <openjph/ojph_file.h>
#include <openjph/ojph_mem.h>
#include <openjph/ojph_params.h>

class DecodeProbe {
 public:
  emscripten::val getEncodedBuffer(size_t n) {
    encoded_.resize(n);
    return emscripten::val(emscripten::typed_memory_view(n, encoded_.data()));
  }

  emscripten::val getDecodedBuffer() {
    return emscripten::val(emscripten::typed_memory_view(decoded_.size(), decoded_.data()));
  }

  void decode() {
    ojph::mem_infile in;
    in.open(encoded_.data(), encoded_.size());
    ojph::codestream cs;
    cs.read_headers(&in);
    cs.set_planar(false);

    ojph::param_siz siz = cs.access_siz();
    const uint32_t comps = siz.get_num_components();
    const uint32_t w = siz.get_recon_width(0), h = siz.get_recon_height(0);
    const uint32_t depth = siz.get_bit_depth(0);
    const uint32_t wide = depth > 8 ? 2 : 1;
    const int32_t top = (int32_t)((1u << depth) - 1);

    cs.create();
    decoded_.assign((size_t)w * h * comps * wide, 0);

    uint8_t* out = decoded_.data();
    for (uint32_t y = 0; y < h; ++y) {
      for (uint32_t c = 0; c < comps; ++c) {
        uint32_t got = 0;
        ojph::line_buf* line = cs.pull(got);
        const ojph::si32* src = line->i32;
        uint8_t* dst = out + (size_t)y * w * comps * wide + (size_t)got * wide;
        for (uint32_t x = 0; x < w; ++x, dst += (size_t)comps * wide) {
          int32_t v = src[x];
          v = v < 0 ? 0 : (v > top ? top : v);
          dst[0] = (uint8_t)(v & 0xff);
          if (wide == 2) dst[1] = (uint8_t)((v >> 8) & 0xff);
        }
      }
    }
    cs.close();
  }

 private:
  std::vector<uint8_t> encoded_, decoded_;
};

EMSCRIPTEN_BINDINGS(decode_probe) {
  emscripten::class_<DecodeProbe>("DecodeProbe")
      .constructor<>()
      .function("getEncodedBuffer", &DecodeProbe::getEncodedBuffer)
      .function("getDecodedBuffer", &DecodeProbe::getDecodedBuffer)
      .function("decode", &DecodeProbe::decode);
}
