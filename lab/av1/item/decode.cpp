// The ingest check's decoders in-process: one AV1 temporal unit through dav1d, one HTJ2K
// codestream through OpenJPH, each decoded alone into h × w × planes int32 samples.
#include <cstddef>
#include <cstdint>
#include <cstring>

#include <dav1d/dav1d.h>
#include <openjph/ojph_codestream.h>
#include <openjph/ojph_file.h>
#include <openjph/ojph_mem.h>
#include <openjph/ojph_params.h>

namespace {

struct Shape {
  int32_t w, h, planes, bits, is_signed;
};

int too_small(const Shape& s, size_t cap) { return (size_t)s.w * s.h * s.planes > cap ? -2 : 0; }

}  // namespace

// 0, -1 if dav1d gave no picture, -2 if `out` holds fewer than its samples, -3 for a layout that
// is neither 4:0:0 nor 4:4:4.
extern "C" int av1_decode(const uint8_t* unit, size_t len, int32_t* out, size_t cap, Shape* shape) {
  Dav1dSettings settings;
  dav1d_default_settings(&settings);
  settings.n_threads = 1;
  settings.max_frame_delay = 1;
  Dav1dContext* ctx = nullptr;
  if (dav1d_open(&ctx, &settings)) return -1;
  Dav1dData data = {};
  std::memcpy(dav1d_data_create(&data, len), unit, len);
  Dav1dPicture pic = {};
  int r;
  do {
    r = dav1d_send_data(ctx, &data);
    if (r < 0 && r != DAV1D_ERR(EAGAIN)) break;
    r = dav1d_get_picture(ctx, &pic);
  } while (r == DAV1D_ERR(EAGAIN) && data.sz > 0);
  if (r == DAV1D_ERR(EAGAIN)) r = dav1d_get_picture(ctx, &pic);
  if (data.sz > 0) dav1d_data_unref(&data);
  if (r == 0) {
    const int planes = pic.p.layout == DAV1D_PIXEL_LAYOUT_I400 ? 1 : 3;
    *shape = {pic.p.w, pic.p.h, planes, pic.p.bpc, 0};
    if (pic.p.layout != DAV1D_PIXEL_LAYOUT_I400 && pic.p.layout != DAV1D_PIXEL_LAYOUT_I444) r = -3;
    else r = too_small(*shape, cap);
    for (int c = 0; r == 0 && c < planes; ++c) {
      const auto* row = static_cast<const uint8_t*>(pic.data[c]);
      const ptrdiff_t stride = pic.stride[c ? 1 : 0];
      for (int y = 0; y < pic.p.h; ++y, row += stride) {
        int32_t* dst = out + ((size_t)y * pic.p.w) * planes + c;
        if (pic.p.bpc == 8)
          for (int x = 0; x < pic.p.w; ++x) dst[(size_t)x * planes] = row[x];
        else
          for (int x = 0; x < pic.p.w; ++x) dst[(size_t)x * planes] = reinterpret_cast<const uint16_t*>(row)[x];
      }
    }
    dav1d_picture_unref(&pic);
  } else {
    r = -1;
  }
  dav1d_close(&ctx);
  return r;
}

// 0, or -2 if `out` holds fewer than its samples. Samples carry their sign; OpenJPH throws on a
// malformed codestream, reported as -1.
extern "C" int htj2k_decode(const uint8_t* bytes, size_t len, int32_t* out, size_t cap, Shape* shape) {
  try {
    ojph::mem_infile in;
    in.open(bytes, len);
    ojph::codestream cs;
    cs.read_headers(&in);
    cs.set_planar(false);
    ojph::param_siz siz = cs.access_siz();
    const uint32_t comps = siz.get_num_components();
    *shape = {(int32_t)siz.get_recon_width(0), (int32_t)siz.get_recon_height(0), (int32_t)comps,
              (int32_t)siz.get_bit_depth(0), siz.is_signed(0) ? 1 : 0};
    if (too_small(*shape, cap)) return -2;
    cs.create();
    for (int32_t y = 0; y < shape->h; ++y) {
      for (uint32_t c = 0; c < comps; ++c) {
        uint32_t got = 0;
        const ojph::si32* src = cs.pull(got)->i32;
        int32_t* dst = out + (size_t)y * shape->w * comps + got;
        for (int32_t x = 0; x < shape->w; ++x) dst[(size_t)x * comps] = src[x];
      }
    }
    cs.close();
    return 0;
  } catch (...) {
    return -1;
  }
}
