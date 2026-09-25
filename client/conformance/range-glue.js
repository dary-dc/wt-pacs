// A decoder glue for dispatch-rig.ts: the package decoder, whose objects also answer `getRange()`
// with a range no frame has. A frame carrying it proves decoder.js took the decoder's range rather
// than running its own pass. docs/decode/README.md §The range in the pack
var OpenJPHModule = async (opts) => {
  const dir = "/lab/decode-bench/vendor/openjph";
  const src = await (await fetch(`${dir}/openjphjs.js`)).text();
  const factory = new Function(`${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`).call(self);
  const M = await factory(opts);
  const Real = M.HTJ2KDecoder;
  M.HTJ2KDecoder = function HTJ2KDecoder() {
    const d = new Real();
    d.getRange = () => ({ min: -7, max: 7 });
    return d;
  };
  return M;
};
