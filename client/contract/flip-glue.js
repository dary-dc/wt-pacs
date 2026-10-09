// A decoder glue for dispatch-rig.ts: the package decoder, whose first object changes one sample of
// every frame it decodes and whose later ones do not — a reused decoder gone wrong, a fresh one sound.
var OpenJPHModule = async (opts) => {
  const dir = "/client/decode/wasm/vendor/openjph";
  const src = await (await fetch(`${dir}/openjphjs.js`)).text();
  const factory = new Function(`${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`).call(self);
  const M = await factory(opts);
  const Real = M.HTJ2KDecoder;
  let made = 0;
  M.HTJ2KDecoder = function HTJ2KDecoder() {
    const d = new Real();
    if (made++ > 0) return d;
    const decoded = d.getDecodedBuffer.bind(d);
    d.getDecodedBuffer = () => {
      const out = decoded();
      out[0] ^= 1;
      return out;
    };
    return d;
  };
  return M;
};
