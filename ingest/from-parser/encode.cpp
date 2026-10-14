// HTJ2K coding in-process, the calls ojph_compress makes for a PGM or PPM with ingest.py's arguments, so the
// codestream is byte-identical to the one ingest.py writes (OpenJPH 0.31.0, src/apps/ojph_compress/ojph_compress.cpp).
#include <cstdint>
#include <cstdlib>
#include <cstring>

#include <openjph/ojph_codestream.h>
#include <openjph/ojph_file.h>
#include <openjph/ojph_mem.h>
#include <openjph/ojph_params.h>
#include <openjph/ojph_version.h>

static_assert(OPENJPH_VERSION_MAJOR == 0 && OPENJPH_VERSION_MINOR == 31 && OPENJPH_VERSION_PATCH == 0,
              "ingest.py's codestreams are OpenJPH 0.31.0's");

// samples: h rows of w pixels of `comps` interleaved unsigned values of `bits` bits. *out is malloc'd, the caller frees.
extern "C" int htj2k_encode(const int32_t* samples, uint32_t w, uint32_t h, uint32_t comps, uint32_t bits,
                            uint8_t** out, size_t* len) {
  try {
    ojph::codestream cs;
    ojph::param_siz siz = cs.access_siz();
    siz.set_image_extent(ojph::point(w, h));
    siz.set_num_components(comps);
    for (uint32_t c = 0; c < comps; ++c) siz.set_component(c, ojph::point(1, 1), bits, false);
    siz.set_image_offset(ojph::point(0, 0));
    siz.set_tile_size(ojph::size(0, 0));
    siz.set_tile_offset(ojph::point(0, 0));
    ojph::param_cod cod = cs.access_cod();
    cod.set_num_decomposition(5);
    cod.set_block_dims(64, 64);
    cod.set_progression_order("RPCL");
    cod.set_color_transform(comps == 3);
    cod.set_reversible(true);
    if (comps == 3) cs.set_planar(false);
    cs.set_tilepart_divisions(false, false);
    cs.request_tlm_marker(false);

    ojph::mem_outfile file;
    file.open();
    ojph::comment_exchange com;
    cs.write_headers(&file, &com, 0);
    uint32_t next = 0;
    ojph::line_buf* line = cs.exchange(nullptr, next);
    for (uint32_t y = 0; y < h; ++y) {
      for (uint32_t c = 0; c < comps; ++c) {
        const int32_t* src = samples + (size_t)y * w * comps + c;
        for (uint32_t x = 0; x < w; ++x) line->i32[x] = src[(size_t)x * comps];
        line = cs.exchange(line, next);
      }
    }
    cs.flush();
    *len = (size_t)file.tell();
    *out = (uint8_t*)std::malloc(*len);
    if (!*out) return -2;
    std::memcpy(*out, file.get_data(), *len);
    cs.close();
    return 0;
  } catch (...) {
    return -1;
  }
}
