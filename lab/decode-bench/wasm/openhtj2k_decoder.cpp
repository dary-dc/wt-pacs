// OpenHTJ2K behind the same surface as htj2k_decoder.cpp, so one bench and one parity run
// drive both decoders. docs/decode/README.md §A second decoder says what it measures.
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include <open_htj2k_version.hpp>

#include "decoder.hpp"

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

// SIZ and COD, which OpenHTJ2K's public API does not report. Fields are named as in
// ISO/IEC 15444-1 Annex A; docs/decode/README.md §A second decoder says why they are read here.
struct Markers {
  uint32_t Xsiz = 0, Ysiz = 0, XOsiz = 0, YOsiz = 0, XTsiz = 0, YTsiz = 0, XTOsiz = 0, YTOsiz = 0;
  uint16_t Csiz = 0, layers = 0;
  uint8_t Ssiz0 = 0, XRsiz0 = 1, YRsiz0 = 1;
  uint8_t prog = 0, mct = 0, levels = 0, xcb = 0, ycb = 0, transform = 0, Scod = 0;
};

class Reader {
 public:
  Reader(const uint8_t* p, size_t n) : p_(p), end_(p + n) {}
  uint8_t u8() { return p_ < end_ ? *p_++ : 0; }
  uint16_t u16() { return (uint16_t)((uint32_t)u8() << 8 | u8()); }
  uint32_t u32() { return (uint32_t)u16() << 16 | u16(); }
  void skip(size_t n) { p_ += n < (size_t)(end_ - p_) ? n : (size_t)(end_ - p_); }
  bool done() const { return p_ >= end_; }

 private:
  const uint8_t* p_;
  const uint8_t* end_;
};

// SOC, then the main header's segments; SOT ends it. A JPH/JP2 wrapper is not handled —
// the lab's fixtures are raw codestreams.
Markers readMarkers(const std::vector<uint8_t>& cs) {
  Markers m;
  Reader r(cs.data(), cs.size());
  r.u16();
  while (!r.done()) {
    const uint16_t marker = r.u16();
    if (marker == 0xFF90 || marker == 0xFFD9) break;
    const uint16_t len = r.u16();
    if (marker == 0xFF51) {
      r.u16();
      m.Xsiz = r.u32();
      m.Ysiz = r.u32();
      m.XOsiz = r.u32();
      m.YOsiz = r.u32();
      m.XTsiz = r.u32();
      m.YTsiz = r.u32();
      m.XTOsiz = r.u32();
      m.YTOsiz = r.u32();
      m.Csiz = r.u16();
      m.Ssiz0 = r.u8();
      m.XRsiz0 = r.u8();
      m.YRsiz0 = r.u8();
      r.skip((size_t)(m.Csiz - 1) * 3);
    } else if (marker == 0xFF52) {
      m.Scod = r.u8();
      m.prog = r.u8();
      m.layers = r.u16();
      m.mct = r.u8();
      m.levels = r.u8();
      m.xcb = r.u8();
      m.ycb = r.u8();
      r.u8();
      m.transform = r.u8();
      if (m.Scod & 1) r.skip((size_t)m.levels + 1);
    } else {
      r.skip(len - 2u);
    }
  }
  return m;
}

// Clamp, narrow and interleave one decoded row into the frame, as htj2k_decoder.cpp does.
template <typename T>
void pack(const int32_t* src, uint8_t* dst, uint32_t w, uint32_t comps, int32_t lo, int32_t top) {
  if (comps == 1) {
    T* out = reinterpret_cast<T*>(dst);
    for (uint32_t x = 0; x < w; ++x) {
      const int32_t v = src[x];
      out[x] = (T)(v < lo ? lo : (v > top ? top : v));
    }
    return;
  }
  const size_t stride = (size_t)comps * sizeof(T);
  for (uint32_t x = 0; x < w; ++x, dst += stride) {
    const int32_t v = src[x];
    const T out = (T)(v < lo ? lo : (v > top ? top : v));
    std::memcpy(dst, &out, sizeof out);
  }
}

uint32_t ceilDiv(uint32_t a, uint32_t b) { return b ? (a + b - 1) / b : a; }

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
    m_ = readMarkers(encoded_);
    frame_.width = ceilDiv(m_.Xsiz, m_.XRsiz0) - ceilDiv(m_.XOsiz, m_.XRsiz0);
    frame_.height = ceilDiv(m_.Ysiz, m_.YRsiz0) - ceilDiv(m_.YOsiz, m_.YRsiz0);
    frame_.componentCount = m_.Csiz;
    frame_.bitsPerSample = (uint32_t)(m_.Ssiz0 & 0x7F) + 1;
    frame_.isSigned = (m_.Ssiz0 & 0x80) != 0;
    frame_.isUsingColorTransform = m_.mct == 1;
    headerValid_ = true;
  }

  void decode() {
    if (!headerValid_) readHeader();

    const uint32_t comps = frame_.componentCount, w = frame_.width, h = frame_.height;
    const uint32_t wide = frame_.bitsPerSample > 8 ? 2 : 1;
    // A signed component's range is centred on zero; the clamp must not saturate its negatives.
    const int32_t half = (int32_t)(1u << (frame_.bitsPerSample - 1));
    const int32_t lo = frame_.isSigned ? -half : 0;
    const int32_t top = frame_.isSigned ? half - 1 : 2 * half - 1;
    decoded_.resize((size_t)w * h * comps * wide);

    dec_.init(encoded_.data(), encoded_.size(), 0, 1);
    dec_.parse();
    std::vector<uint32_t> width, height;
    std::vector<uint8_t> depth;
    std::vector<bool> isSigned;
    uint8_t* const out = decoded_.data();
    dec_.invoke_line_based_stream(
        [=](uint32_t y, int32_t* const* rows, uint16_t nc) {
          for (uint16_t c = 0; c < nc; ++c) {
            uint8_t* dst = out + ((size_t)y * w * comps + c) * wide;
            if (wide == 2) pack<uint16_t>(rows[c], dst, w, comps, lo, top);
            else pack<uint8_t>(rows[c], dst, w, comps, lo, top);
          }
        },
        width, height, depth, isSigned);
    headerValid_ = false;
  }

  FrameInfo getFrameInfo() const { return frame_; }
  bool getIsHeaderValid() const { return headerValid_; }
  uint32_t getNumDecompositions() const { return m_.levels; }
  bool getIsReversible() const { return m_.transform == 1; }
  int getProgressionOrder() const { return m_.prog; }
  int getNumLayers() const { return m_.layers; }

  Point getDownSample(uint32_t) const { return {m_.XRsiz0, m_.YRsiz0}; }
  Point getImageOffset() const { return {m_.XOsiz, m_.YOsiz}; }
  Point getTileOffset() const { return {m_.XTOsiz, m_.YTOsiz}; }
  Size getTileSize() const { return {m_.XTsiz, m_.YTsiz}; }
  Size getBlockDimensions() const { return {1u << (m_.xcb + 2), 1u << (m_.ycb + 2)}; }
  // Without SPcod precincts the default is the whole subband, which is 2^15 per side.
  Size getPrecinct(uint32_t) const { return {1u << 15, 1u << 15}; }

 private:
  std::vector<uint8_t> encoded_, decoded_;
  open_htj2k::openhtj2k_decoder dec_;
  Markers m_;
  FrameInfo frame_;
  bool headerValid_ = false;
};

std::string getVersion() {
  return std::to_string(OPENHTJ2K_VERSION_MAJOR) + "." + std::to_string(OPENHTJ2K_VERSION_MINOR) +
         "." + std::to_string(OPENHTJ2K_VERSION_PATCH);
}

int getSIMDLevel() {
#ifdef __wasm_simd128__
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
