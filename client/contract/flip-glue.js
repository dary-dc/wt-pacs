// A decoder glue for dispatch-rig.ts: the package decoder, one sample flipped in what it decodes. `?first`
// flips in the first decoder object only, the one reused; `?all` in every object, a second decode's too.
var OpenJPHModule = async (opts) => {
  const dir = "/client/decode/wasm/vendor/openjph";
  const src = await (await fetch(`${dir}/openjphjs.js`)).text();
  const factory = new Function(`${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`).call(self);
  const M = await factory(opts);
  const every = String(opts.mainScriptUrlOrBlob).endsWith("?all");
  const Real = M.HTJ2KDecoder;
  let made = 0;
  M.HTJ2KDecoder = function HTJ2KDecoder() {
    const d = new Real();
    if (made++ > 0 && !every) return d;
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
