// A decoder with the same surface as the prebuilt package's, so one can stand in for the
// other, built from OpenJPH source with the heap size a link-time parameter.
// docs/decode/README.md §A build of our own says what it is for and what it costs.
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cstdint>
#include <string>
#include <vector>

#include <openjph/ojph_codestream.h>
#include <openjph/ojph_file.h>
#include <openjph/ojph_mem.h>
#include <openjph/ojph_message.h>
#include <openjph/ojph_params.h>
#include <openjph/ojph_version.h>

namespace {

struct Point {
  uint32_t x = 0, y = 0;
};
struct Size {
  uint32_t width = 0, height = 0;
};

struct FrameInfo {
  uint32_t width = 0, height = 0, bitsPerSample = 0, componentCount = 0;
  bool isSigned = false, isUsingColorTransform = false;
};

}  // namespace

class HTJ2KDecoder {
 public:
  emscripten::val getEncodedBuffer(size_t n) {
    encoded_.resize(n);
    return emscripten::val(emscripten::typed_memory_view(n, encoded_.data()));
  }

  emscripten::val getDecodedBuffer() {
    return emscripten::val(emscripten::typed_memory_view(decoded_.size(), decoded_.data()));
  }

  void readHeader() {
    in_.close();
    in_.open(encoded_.data(), encoded_.size());
    cs_.~codestream();
    new (&cs_) ojph::codestream();
    cs_.read_headers(&in_);
    cs_.set_planar(false);

    ojph::param_siz siz = cs_.access_siz();
    ojph::param_cod cod = cs_.access_cod();
    frame_.width = siz.get_recon_width(0);
    frame_.height = siz.get_recon_height(0);
    frame_.componentCount = siz.get_num_components();
    frame_.bitsPerSample = siz.get_bit_depth(0);
    frame_.isSigned = siz.is_signed(0);
    frame_.isUsingColorTransform = cod.is_using_color_transform();
    headerValid_ = true;
  }

  void decode() {
    if (!headerValid_) readHeader();
    cs_.create();

    const uint32_t comps = frame_.componentCount, w = frame_.width, h = frame_.height;
    const uint32_t wide = frame_.bitsPerSample > 8 ? 2 : 1;
    const int32_t top = (int32_t)((1u << frame_.bitsPerSample) - 1);
    decoded_.assign((size_t)w * h * comps * wide, 0);

    for (uint32_t y = 0; y < h; ++y) {
      for (uint32_t c = 0; c < comps; ++c) {
        uint32_t got = 0;
        ojph::line_buf* line = cs_.pull(got);
        const ojph::si32* src = line->i32;
        uint8_t* dst = decoded_.data() + (size_t)y * w * comps * wide + (size_t)got * wide;
        for (uint32_t x = 0; x < w; ++x, dst += (size_t)comps * wide) {
          int32_t v = src[x];
          v = v < 0 ? 0 : (v > top ? top : v);
          dst[0] = (uint8_t)(v & 0xff);
          if (wide == 2) dst[1] = (uint8_t)((v >> 8) & 0xff);
        }
      }
    }
    cs_.close();
    headerValid_ = false;
  }

  FrameInfo getFrameInfo() const { return frame_; }
  bool getIsHeaderValid() const { return headerValid_; }
  uint32_t getNumDecompositions() { return cs_.access_cod().get_num_decompositions(); }
  bool getIsReversible() { return cs_.access_cod().is_reversible(); }
  int getProgressionOrder() { return cs_.access_cod().get_progression_order(); }
  int getNumLayers() { return cs_.access_cod().get_num_layers(); }

  Point getDownSample(uint32_t c) {
    ojph::point p = cs_.access_siz().get_downsampling(c);
    return {(uint32_t)p.x, (uint32_t)p.y};
  }
  Point getImageOffset() {
    ojph::point p = cs_.access_siz().get_image_offset();
    return {(uint32_t)p.x, (uint32_t)p.y};
  }
  Point getTileOffset() {
    ojph::point p = cs_.access_siz().get_tile_offset();
    return {(uint32_t)p.x, (uint32_t)p.y};
  }
  Size getTileSize() {
    ojph::size s = cs_.access_siz().get_tile_size();
    return {(uint32_t)s.w, (uint32_t)s.h};
  }
  Size getBlockDimensions() {
    ojph::size s = cs_.access_cod().get_block_dims();
    return {(uint32_t)s.w, (uint32_t)s.h};
  }
  Size getPrecinct(uint32_t level) {
    ojph::size s = cs_.access_cod().get_precinct_size(level);
    return {(uint32_t)s.w, (uint32_t)s.h};
  }

 private:
  std::vector<uint8_t> encoded_, decoded_;
  ojph::mem_infile in_;
  ojph::codestream cs_;
  FrameInfo frame_;
  bool headerValid_ = false;
};

std::string getVersion() {
  return std::to_string(OPENJPH_VERSION_MAJOR) + "." + std::to_string(OPENJPH_VERSION_MINOR) +
         "." + std::to_string(OPENJPH_VERSION_PATCH);
}

// 1 is what OpenJPH reports from a WASM SIMD build; 0 would mean the -msimd128 path was lost.
int getSIMDLevel() {
#ifdef OJPH_ENABLE_WASM_SIMD
  return 1;
#else
  return 0;
#endif
}

EMSCRIPTEN_BINDINGS(htj2k_decoder) {
  emscripten::value_object<Point>("Point").field("x", &Point::x).field("y", &Point::y);
  emscripten::value_object<Size>("Size").field("width", &Size::width).field("height", &Size::height);
  emscripten::value_object<FrameInfo>("FrameInfo")
      .field("width", &FrameInfo::width)
      .field("height", &FrameInfo::height)
      .field("bitsPerSample", &FrameInfo::bitsPerSample)
      .field("componentCount", &FrameInfo::componentCount)
      .field("isSigned", &FrameInfo::isSigned)
      .field("isUsingColorTransform", &FrameInfo::isUsingColorTransform);

  emscripten::class_<HTJ2KDecoder>("HTJ2KDecoder")
      .constructor<>()
      .function("getEncodedBuffer", &HTJ2KDecoder::getEncodedBuffer)
      .function("getDecodedBuffer", &HTJ2KDecoder::getDecodedBuffer)
      .function("readHeader", &HTJ2KDecoder::readHeader)
      .function("decode", &HTJ2KDecoder::decode)
      .function("getFrameInfo", &HTJ2KDecoder::getFrameInfo)
      .function("getIsHeaderValid", &HTJ2KDecoder::getIsHeaderValid)
      .function("getNumDecompositions", &HTJ2KDecoder::getNumDecompositions)
      .function("getIsReversible", &HTJ2KDecoder::getIsReversible)
      .function("getProgressionOrder", &HTJ2KDecoder::getProgressionOrder)
      .function("getNumLayers", &HTJ2KDecoder::getNumLayers)
      .function("getDownSample", &HTJ2KDecoder::getDownSample)
      .function("getImageOffset", &HTJ2KDecoder::getImageOffset)
      .function("getTileOffset", &HTJ2KDecoder::getTileOffset)
      .function("getTileSize", &HTJ2KDecoder::getTileSize)
      .function("getBlockDimensions", &HTJ2KDecoder::getBlockDimensions)
      .function("getPrecinct", &HTJ2KDecoder::getPrecinct);

  emscripten::function("getVersion", &getVersion);
  emscripten::function("getSIMDLevel", &getSIMDLevel);
}
