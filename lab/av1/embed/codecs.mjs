/**
 * The two WASM decoders behind one shape: a codestream or a prefix of one in, packed interleaved
 * samples out (a copy). `opj(bytes, layers)`: 0 layers decodes all present; `jxl(bytes)`: status
 * JXL_DONE for the whole image, 0 for what a prefix holds.
 */
export const JXL_DONE = 1000;

async function load(factory, moduleOptions, prefix) {
  const M = await factory(moduleOptions);
  let ptr = 0;
  let cap = 0;
  return (bytes, arg = 0) => {
    if (bytes.length > cap) {
      if (ptr) M._free(ptr);
      cap = bytes.length;
      ptr = M._malloc(cap);
    }
    M.HEAPU8.set(bytes, ptr);
    const status = M[`_${prefix}_dec`](ptr, bytes.length, arg);
    if (status < 0) return { status };
    const at = M[`_${prefix}_dec_out`]();
    return {
      status,
      width: M[`_${prefix}_dec_width`](),
      height: M[`_${prefix}_dec_height`](),
      samples: M.HEAPU8.slice(at, at + M[`_${prefix}_dec_out_bytes`]()),
    };
  };
}

export const createOpj = (factory, o = {}) => load(factory, o, "opj");
export const createJxl = (factory, o = {}) => load(factory, o, "jxl");
