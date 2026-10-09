// libjxl's decoder for a worker: a JPEG XL codestream, or a prefix of one, in; samples out at the
// codestream's own bit depth, interleaved, 1 byte a sample up to 8 bits and 2 (little-endian) above.
// lab/av1/bytes/embedded/README.md
#include <stdint.h>
#include <stdlib.h>
#include <jxl/decode.h>

static JxlDecoder *dec;
static uint8_t *out;
static size_t out_cap, out_len;
static int width, height, comps, bits;

int jxl_dec_width(void) { return width; }
int jxl_dec_height(void) { return height; }
int jxl_dec_comps(void) { return comps; }
int jxl_dec_bits(void) { return bits; }
uint8_t *jxl_dec_out(void) { return out; }
int jxl_dec_out_bytes(void) { return (int)out_len; }

// Decodes the whole image (returns JXL_DONE) or, from a prefix, flushes what it holds (returns 0);
// negative on failure. libjxl pauses at no progression step in a lossless (modular) frame.
#define JXL_DONE 1000
int jxl_dec(const uint8_t *buf, int len) {
  if (!dec) dec = JxlDecoderCreate(NULL);
  JxlDecoderReset(dec);
  out_len = 0;
  if (JxlDecoderSubscribeEvents(dec, JXL_DEC_BASIC_INFO | JXL_DEC_FULL_IMAGE) ||
      JxlDecoderSetInput(dec, buf, (size_t)len))
    return -1;
  JxlPixelFormat fmt = {1, JXL_TYPE_UINT8, JXL_LITTLE_ENDIAN, 0};
  for (;;) {
    JxlDecoderStatus s = JxlDecoderProcessInput(dec);
    if (s == JXL_DEC_BASIC_INFO) {
      JxlBasicInfo info;
      if (JxlDecoderGetBasicInfo(dec, &info)) return -2;
      width = (int)info.xsize;
      height = (int)info.ysize;
      comps = (int)info.num_color_channels;
      bits = (int)info.bits_per_sample;
      fmt.num_channels = (uint32_t)comps;
      fmt.data_type = bits > 8 ? JXL_TYPE_UINT16 : JXL_TYPE_UINT8;
    } else if (s == JXL_DEC_NEED_IMAGE_OUT_BUFFER) {
      JxlBitDepth depth = {JXL_BIT_DEPTH_FROM_CODESTREAM, 0, 0};
      if (JxlDecoderImageOutBufferSize(dec, &fmt, &out_len)) return -3;
      if (out_len > out_cap) {
        free(out);
        out = malloc(out_cap = out_len);
      }
      if (JxlDecoderSetImageOutBuffer(dec, &fmt, out, out_len) || JxlDecoderSetImageOutBitDepth(dec, &depth))
        return -4;
    } else if (s == JXL_DEC_NEED_MORE_INPUT) {
      return out_len && JxlDecoderFlushImage(dec) == JXL_DEC_SUCCESS ? 0 : -6;
    } else if (s == JXL_DEC_FULL_IMAGE) {
      return JXL_DONE;
    } else {
      return -7;
    }
  }
}
