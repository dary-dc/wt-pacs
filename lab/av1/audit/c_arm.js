// One arm of protocol C (docs/av1/audit-protocols.md §C amendment 1) in its own module worker: opened and primed off
// the clock, then each of the frames timed, one in flight; every frame checked off the clock.
let tip;
let built;

const sha256 = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A picture's first plane, row by row, as its bytes (little-endian samples). */
function luma({ width, height, bits, planes: [{ heap, offset, stride }] }) {
  const out = new (bits > 8 ? Uint16Array : Uint8Array)(width * height);
  for (let y = 0; y < height; y++) out.set(heap.subarray(offset + y * stride, offset + y * stride + width), y * width);
  return new Uint8Array(out.buffer);
}

/** claude/av1-quality-profiles:lab/av1/profiles/decoders.js:95-104, on the tip's build. */
async function openjph() {
  const M = await (await import(`${tip}/client/decode/wasm-glue.js`)).instantiate(await built("openjph"), "OpenJPHModule");
  const d = new M.HTJ2KDecoder();
  return (u, wide) => {
    d.getEncodedBuffer(u.length).set(u);
    d.readHeader();
    d.decode();
    const b = d.getDecodedBuffer();
    return wide ? new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : b.slice();
  };
}

/** claude/av1-quality-profiles:lab/av1/profiles/shared.js:13-17. */
function back(lossy, shift) {
  const out = new Uint16Array(lossy.length);
  for (let k = 0; k < lossy.length; k++) out[k] = lossy[k] << shift;
  return out;
}

/** The known-cost mutation: a pass over every sample whose result is kept. */
function pass(samples) {
  let s = 0;
  for (let k = 0; k < samples.length; k++) s += samples[k];
  return s;
}

const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** `{ decode(i) → result, check(i, result) → bool }` for the arm; `m` as c.mjs posts it. */
async function open(m) {
  const glue = await import(`${tip}/client/decode/wasm-glue.js`);
  const xxh3 = await (await import(`${tip}/client/decode/xxh3.js`)).hasher();
  const hex = (bytes) => xxh3.init().update(bytes).digest("hex");
  const exact = (i, bytes) => hex(bytes) === m.digests[i];
  const native = async (i, pic) => (await sha256(luma(pic))) === m.sha256[i];
  if (m.arm === "Hp" || m.arm === "Hp2" || m.arm === "Hk") {
    const htj2k = await import(`${tip}/client/decode/htj2k.js`);
    const vendor = `${tip}/client/decode/wasm/vendor/openjph`;
    await htj2k.init(m.arm === "Hk" ? { glue: `${vendor}/openjphjs.js`, wasm: `${vendor}/openjphjs.wasm`, dir: vendor } : await glue.built("openjph"));
    if (m.arm === "Hk") return { decode: (i) => htj2k.decodeFrame(m.frames[i]), check: (i, r) => exact(i, new Uint8Array(r.sab)) };
    return {
      decode: (i) => {
        const r = htj2k.decodeFrame(m.frames[i]);
        return { r, ok: hex(new Uint8Array(r.sab)) === m.digests[i] };
      },
      check: (i, { ok }) => ok,
    };
  }
  if (m.arm === "Hb" || m.arm === "Hm") {
    const dec = await openjph();
    if (m.arm === "Hb") return { decode: (i) => dec(m.frames[i], true), check: (i, s) => exact(i, bytesOf(s)) };
    return {
      decode: (i) => {
        const s = dec(m.frames[i], true);
        const t = performance.now();
        const sum = pass(s);
        return { s, sum, pass: performance.now() - t };
      },
      check: (i, { s }) => exact(i, bytesOf(s)),
    };
  }
  const unit = (i) => ({ key: true, gen: 0, index: i });
  if (m.arm === "D") {
    const dav1d = await import(`${tip}/client/decode/av1-dav1d.js`);
    await dav1d.init({ ...(await glue.built("dav1d")), threads: 1 });
    return { decode: (i) => dav1d.picture(m.frames[i], unit(i)), check: native };
  }
  const wc = await import(`${tip}/client/decode/av1-webcodecs.js`);
  await wc.init({ groupLength: 1 });
  if (m.arm === "W") return { decode: (i) => wc.picture(m.frames[i], unit(i)), check: native };
  return {
    decode: async (i) => {
      const pic = await wc.picture(m.frames[i], unit(i));
      const { heap, offset, stride } = pic.planes[0];
      return { pic, back: back(heap.subarray(offset, offset + stride * pic.height), m.shift) };
    },
    check: (i, { pic }) => native(i, pic),
  };
}

onmessage = async ({ data: m }) => {
  tip = m.tip;
  try {
    built = (await import(`${tip}/client/decode/wasm-glue.js`)).built;
    const arm = await open(m);
    await arm.decode(0);
    const ms = [];
    const passMs = [];
    const ok = [];
    for (let i = 0; i < m.frames.length; i++) {
      const t = performance.now();
      const r = await arm.decode(i);
      ms.push(performance.now() - t);
      if (r?.pass !== undefined) passMs.push(r.pass);
      // dav1d's picture is a view of its heap, valid until the next decode.
      ok.push(await arm.check(i, r));
    }
    postMessage({ ms, ok, ...(passMs.length ? { pass: passMs } : {}) });
  } catch (e) {
    postMessage({ error: String(e?.stack ?? e) });
  }
};
