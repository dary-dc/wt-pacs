#include "../dav1d-wasm/dav1d_wrap.c"

/* As av1_open, with the operating point and whether every spatial layer is output (dav1d's default
 * is 1, which returns a two-layer unit's base first). */
EMSCRIPTEN_KEEPALIVE int av1_open_op(int threads, int operating_point, int all_layers) {
    Dav1dSettings s;
    dav1d_default_settings(&s);
    s.n_threads = threads;
    s.max_frame_delay = 1;
    s.operating_point = operating_point;
    s.all_layers = all_layers;
    return dav1d_open(&ctx, &s);
}
