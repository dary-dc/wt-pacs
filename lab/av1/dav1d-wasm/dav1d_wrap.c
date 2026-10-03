#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <dav1d/dav1d.h>
#include <emscripten/emscripten.h>

static Dav1dContext *ctx;
static Dav1dPicture pic;
static int have_pic;

EMSCRIPTEN_KEEPALIVE int av1_open(int threads) {
    Dav1dSettings s;
    dav1d_default_settings(&s);
    s.n_threads = threads;
    s.max_frame_delay = 1;
    return dav1d_open(&ctx, &s);
}

EMSCRIPTEN_KEEPALIVE void av1_close(void) {
    if (have_pic) dav1d_picture_unref(&pic);
    have_pic = 0;
    dav1d_close(&ctx);
}

/* Drops every reference and the sequence header: what decodes next must decode alone. */
EMSCRIPTEN_KEEPALIVE void av1_flush(void) { dav1d_flush(ctx); }

/* One temporal unit in; 0 with a picture held, or a negative errno. The bytes are copied. */
EMSCRIPTEN_KEEPALIVE int av1_decode(const uint8_t *bytes, size_t len) {
    if (have_pic) dav1d_picture_unref(&pic);
    have_pic = 0;
    Dav1dData data = { 0 };
    uint8_t *buf = dav1d_data_create(&data, len);
    if (!buf) return DAV1D_ERR(ENOMEM);
    memcpy(buf, bytes, len);
    int r;
    do {
        r = dav1d_send_data(ctx, &data);
        if (r < 0 && r != DAV1D_ERR(EAGAIN)) break;
        int g = dav1d_get_picture(ctx, &pic);
        if (g == 0) { have_pic = 1; break; }
        if (g != DAV1D_ERR(EAGAIN)) { r = g; break; }
    } while (data.sz > 0);
    if (data.sz > 0) dav1d_data_unref(&data);
    if (!have_pic && r >= 0) {
        int g = dav1d_get_picture(ctx, &pic);
        if (g == 0) have_pic = 1; else r = g;
    }
    return have_pic ? 0 : r;
}

EMSCRIPTEN_KEEPALIVE int av1_width(void) { return pic.p.w; }
EMSCRIPTEN_KEEPALIVE int av1_height(void) { return pic.p.h; }
EMSCRIPTEN_KEEPALIVE int av1_bits(void) { return pic.p.bpc; }
/* Dav1dPixelLayout: 0 = 4:0:0, 1 = 4:2:0, 2 = 4:2:2, 3 = 4:4:4. */
EMSCRIPTEN_KEEPALIVE int av1_layout(void) { return pic.p.layout; }
EMSCRIPTEN_KEEPALIVE int av1_matrix(void) { return pic.seq_hdr->mtrx; }
EMSCRIPTEN_KEEPALIVE const void *av1_plane(int i) { return pic.data[i]; }
/* In bytes; plane 0 uses stride[0], planes 1 and 2 share stride[1]. */
EMSCRIPTEN_KEEPALIVE ptrdiff_t av1_stride(int i) { return pic.stride[i ? 1 : 0]; }
