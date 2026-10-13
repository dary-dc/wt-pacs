// xxHash's XXH3-64 behind hash-wasm's shape: the caller copies each chunk into `chunk`, then calls update.
// lab/av1/exact/hashfast/README.md
#define XXH_INLINE_ALL
#include "xxhash.h"

#define CHUNK 16384
static XXH3_state_t state;
static unsigned char chunk[CHUNK];

unsigned char *buffer(void) { return chunk; }
int vector(void) { return XXH_VECTOR; }
void init(void) { XXH3_64bits_reset(&state); }
void update(unsigned n) { XXH3_64bits_update(&state, chunk, n); }
unsigned long long digest(void) { return XXH3_64bits_digest(&state); }
