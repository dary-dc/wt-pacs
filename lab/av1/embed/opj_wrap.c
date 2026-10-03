// OpenJPEG's decoder for a worker: a J2K codestream (or a prefix of one) in, samples out packed
// and interleaved, 1 byte a sample up to 8 bits and 2 (little-endian) above. lab/av1/embed/README.md
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <openjpeg.h>

typedef struct { const uint8_t *buf; OPJ_SIZE_T len, at; } Src;

static OPJ_SIZE_T src_read(void *dst, OPJ_SIZE_T n, void *user) {
  Src *s = user;
  if (s->at >= s->len) return (OPJ_SIZE_T)-1;
  if (n > s->len - s->at) n = s->len - s->at;
  memcpy(dst, s->buf + s->at, n);
  s->at += n;
  return n;
}
static OPJ_OFF_T src_skip(OPJ_OFF_T n, void *user) {
  Src *s = user;
  if (n < 0 || (OPJ_SIZE_T)n > s->len - s->at) n = (OPJ_OFF_T)(s->len - s->at);
  s->at += (OPJ_SIZE_T)n;
  return n;
}
static OPJ_BOOL src_seek(OPJ_OFF_T n, void *user) {
  Src *s = user;
  if (n < 0 || (OPJ_SIZE_T)n > s->len) return OPJ_FALSE;
  s->at = (OPJ_SIZE_T)n;
  return OPJ_TRUE;
}

static uint8_t *out;
static size_t out_cap, out_len;
static int width, height, comps, prec;

int opj_dec_width(void) { return width; }
int opj_dec_height(void) { return height; }
int opj_dec_comps(void) { return comps; }
int opj_dec_prec(void) { return prec; }
uint8_t *opj_dec_out(void) { return out; }
int opj_dec_out_bytes(void) { return (int)out_len; }

// layers: how many quality layers to decode, 0 for all. Returns 0, or a negative step that failed.
int opj_dec(const uint8_t *buf, int len, int layers) {
  Src s = {buf, (OPJ_SIZE_T)len, 0};
  opj_stream_t *st = opj_stream_create((OPJ_SIZE_T)len, OPJ_TRUE);
  opj_stream_set_user_data(st, &s, NULL);
  opj_stream_set_user_data_length(st, (OPJ_UINT64)len);
  opj_stream_set_read_function(st, src_read);
  opj_stream_set_skip_function(st, src_skip);
  opj_stream_set_seek_function(st, src_seek);
  opj_codec_t *c = opj_create_decompress(OPJ_CODEC_J2K);
  opj_dparameters_t p;
  opj_set_default_decoder_parameters(&p);
  p.cp_layer = (OPJ_UINT32)layers;
  opj_image_t *img = NULL;
  int r = 0;
  if (!opj_setup_decoder(c, &p)) r = -1;
  else if (!opj_decoder_set_strict_mode(c, OPJ_FALSE)) r = -2;
  else if (!opj_read_header(st, c, &img)) r = -3;
  else if (!opj_decode(c, st, img)) r = -4;
  else if (!opj_end_decompress(c, st)) r = -5;
  if (r == 0) {
    width = (int)img->comps[0].w;
    height = (int)img->comps[0].h;
    comps = (int)img->numcomps;
    prec = (int)img->comps[0].prec;
    size_t n = (size_t)width * height, bps = prec > 8 ? 2 : 1;
    out_len = n * comps * bps;
    if (out_len > out_cap) {
      free(out);
      out = malloc(out_cap = out_len);
    }
    for (int k = 0; k < comps; k++) {
      const OPJ_INT32 *d = img->comps[k].data;
      if (bps == 1)
        for (size_t i = 0; i < n; i++) out[i * comps + k] = (uint8_t)d[i];
      else
        for (size_t i = 0; i < n; i++) {
          uint16_t v = (uint16_t)d[i];
          out[(i * comps + k) * 2] = (uint8_t)v;
          out[(i * comps + k) * 2 + 1] = (uint8_t)(v >> 8);
        }
    }
  }
  if (img) opj_image_destroy(img);
  opj_destroy_codec(c);
  opj_stream_destroy(st);
  return r;
}
