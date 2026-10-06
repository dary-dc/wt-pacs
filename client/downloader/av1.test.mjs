// node client/downloader/av1.test.mjs — the AV1 item reader: golden items through dav1d-WASM (when
// lab/av1/dav1d-wasm/build.sh has run), every refusal item-format.md names, and the decoder choice.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ITEMS = `${ROOT}client/conformance/av1/items`;
const OUT = `${ROOT}lab/.av1-build/out`;
// The glue is evaluated as a classic script, which in node reaches for require and for fetch on paths.
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = OUT;
const netFetch = globalThis.fetch;
globalThis.fetch = async (url) => (String(url).startsWith("/") ? new Response(readFileSync(url)) : netFetch(url));

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const sha = (sab) => createHash("sha256").update(new Uint8Array(sab)).digest("hex");
const golden = (rep, name) => new Uint8Array(readFileSync(`${ITEMS}/${rep}/${name}.av1`));
const edit = (bytes, at, value) => {
  const b = Uint8Array.from(bytes);
  b[at] = value;
  return b;
};
const u32 = (bytes, at, value) => {
  const b = Uint8Array.from(bytes);
  new DataView(b.buffer).setUint32(at, value, true);
  return b;
};
const refusal = async (decode, bytes) => decode(bytes).then(() => "decoded", (e) => String(e.message));

const { parseItem } = await import("./av1-item.js");

/** Every header case item-format.md lists is refused by name before anything decodes. */
{
  const g12 = golden("optimized", "g12");
  const c8 = golden("optimized", "c8");
  const parse = async (b, n = 1) => parseItem(b, n);
  const cases = [
    [g12.subarray(0, 15), /under the 16-byte header/, "a short item"],
    [edit(g12, 0, 2), /version 2, not 1/, "version ≠ 1"],
    [edit(g12, 4, 4), /unknown flag bits 0x4/, "an unknown flag bit"],
    [edit(g12, 6, 1), /pad bytes not zero/, "a pad byte set"],
    [edit(g12, 2, 9), /depth 9, not 8, 10 or 12/, "a depth no stream has"],
    [edit(g12, 3, 9), /split 9, over 8/, "split over 8, the low stream's depth"],
    [edit(g12, 1, 17), /bits 17, over 16/, "bits over 16"],
    [edit(g12, 4, 2), /rct with split 2/, "rct with split > 0"],
    [u32(g12, 8, 5), /offset 5 without signed/, "an offset without signed"],
    [edit(g12, 1, 13), /bits 13 over depth 10 \+ split 2/, "bits > depth + split"],
    [edit(edit(g12, 1, 8), 3, 0), /depth 10 for a top of 8 bits, not 8/, "a depth not the smallest holding the top"],
    [u32(g12, 12, 2), /2 frames, 1 expected/, "n ≠ the count expected"],
    [u32(g12, 16, 1e6), /frame 0 overruns the item/, "a length past the item"],
    [u32(g12, 12, 1e6), /frame lengths overrun the item/, "a frame count whose lengths overrun", 1e6],
    [Uint8Array.of(...g12, 0), /1 bytes past the last frame/, "bytes after the last frame"],
  ];
  for (const [bytes, want, what, n] of cases) {
    const got = await refusal((b) => parse(b, n), bytes);
    check(want.test(got), `header: ${what} is refused by name (${got})`);
  }
  check((await refusal(parse, c8)) === "decoded", "header: the optimized colour item parses");
  check((await refusal((b) => parse(b, 1), golden("plain", "g14"))) === "decoded", "header: the plain 14-bit item parses");
}

/** Every sample of 8–16 bits, unsigned and signed, split at every k of 0–8 and merged by av1-frame.js, is itself. */
{
  const { begin, end } = await import("./av1-frame.js");
  let wrong = 0;
  for (let bits = 8; bits <= 16; bits++) {
    for (const signed of [false, true]) {
      const offset = signed ? 2 ** (bits - 1) : 0;
      const n = 2 ** bits;
      for (let split = 0; split <= 8; split++) {
        const top = new Uint16Array(n);
        const low = new Uint16Array(n);
        for (let u = 0; u < n; u++) [top[u], low[u]] = [u >> split, u & (2 ** split - 1)];
        // As the writer codes it: the smallest of 8, 10, 12 holding the top, and wider only in this test.
        const depth = [8, 10, 12].find((d) => bits - split <= d) ?? bits - split;
        const pic = (heap, b) => ({ width: n, height: 1, bits: b, planes: [{ heap, offset: 0, stride: n }] });
        const item = { bits, depth, split, signed, rct: false, offset };
        const got = end(begin(pic(top, depth), item), split ? pic(low, 8) : null);
        const out = bits > 8 ? (signed ? new Int16Array(got.sab) : new Uint16Array(got.sab)) : signed ? new Int8Array(got.sab) : new Uint8Array(got.sab);
        let bad = got.range.min !== -offset || got.range.max !== n - 1 - offset;
        for (let u = 0; u < n && !bad; u++) bad = out[u] !== u - offset;
        if (bad) wrong++;
        check(!bad, `merge: ${bits}-bit ${signed ? "signed" : "unsigned"} at split ${split} is every sample back`);
      }
    }
  }
  check(wrong === 0, `merge: ${wrong} of 162 (bits, sign, split) cells wrong`);
}

/** The decoder chosen per item: WebCodecs only where every stream is ≤ 10 bits and its probe passed. */
{
  const calls = [];
  let [depth, planes] = [8, 1];
  const pic = (bits, n) => ({ width: 1, height: 1, bits, planes: Array.from({ length: n }, () => ({ heap: Uint16Array.of(7), offset: 0, stride: 1 })) });
  let probeOk = true;
  let wcFails = false;
  let importFails = 1;
  const stubs = {
    "./decode-av1-webcodecs.js": {
      init: async () => {},
      probe: async (layout) => (calls.push(`probe ${layout}`), probeOk),
      picture: async (bytes, unit, which) => {
        calls.push("webcodecs");
        if (wcFails) throw new Error("undecodable: closed");
        return which === "low" ? pic(8, 1) : pic(depth, planes);
      },
    },
    "./decode-av1.js": { init: async () => {}, picture: () => (calls.push("dav1d"), pic(depth, planes)) },
  };
  const load = async (path) => {
    if (path === "./decode-av1.js" && importFails-- > 0) throw new Error("import failed");
    return stubs[path];
  };
  const av1 = await import("./av1.js?choice");
  await av1.init({}, load);
  const take = async (what, rep, name, d, p, want, outcome = "decoded") => {
    [depth, planes] = [d, p];
    calls.length = 0;
    const got = await refusal(av1.decodeFrame, golden(rep, name));
    check(calls.join() === want && got.startsWith(outcome), `choice: ${what} (${calls.join()}; ${got.slice(0, 40)})`);
  };
  globalThis.VideoDecoder = class {};
  await take("a 10-bit grey item goes to WebCodecs", "plain", "g10", 10, 1, "probe g10,webcodecs");
  probeOk = false;
  await take("a failed probe sends the item to dav1d, whose failed import fails it", "plain", "g8", 8, 1, "probe g8", "import failed");
  await take("and the import is tried again on the next item", "plain", "g8", 8, 1, "probe g8,dav1d");
  probeOk = true;
  wcFails = true;
  await take("WebCodecs failing falls back to dav1d", "plain", "g8", 8, 1, "probe g8,webcodecs,dav1d");
  wcFails = false;
  await take("a 12-bit item never reaches WebCodecs", "plain", "g12", 12, 1, "dav1d");
  await take("a split item's two streams are both probed", "optimized", "g12", 10, 1, "probe g10,probe g8,webcodecs,webcodecs");
  await take("an rct item probes 4:4:4 10-bit", "optimized", "c8", 10, 3, "probe c10,webcodecs");
  await take("a plain colour item is told from grey by its profile", "plain", "c8", 8, 3, "probe c8,webcodecs");
  delete globalThis.VideoDecoder;
  await take("no VideoDecoder, no WebCodecs", "plain", "g10", 10, 1, "dav1d");
}

/** With `mixed`, a top over 10 bits goes to dav1d and its low to WebCodecs, each item's own low merged, dav1d the fallback. */
{
  const calls = [];
  const one = (bits, v) => ({ width: 1, height: 1, bits, planes: [{ heap: Uint16Array.of(v), offset: 0, stride: 1 }] });
  // WebCodecs' lows alternate 1, 2: an item merged with the last one's low is off by one.
  let lows = 0;
  let probeOk = true;
  let wcFails = false;
  let topFails = false;
  const stubs = {
    "./decode-av1-webcodecs.js": {
      init: async () => {},
      probe: async (layout) => (calls.push(`probe ${layout}`), probeOk),
      picture: async (bytes, unit, which = "top") => {
        calls.push(`webcodecs ${which}`);
        await new Promise((r) => setTimeout(r, 5));
        if (wcFails) throw new Error("undecodable: closed");
        if ((which === "top") !== isTop(bytes)) throw new Error(`undecodable: a ${which} stream given the other unit`);
        return which === "top" ? one(10, 7) : one(8, (lows++ % 2) + 1);
      },
    },
    "./decode-av1.js": {
      init: async () => {},
      picture: (bytes) => {
        calls.push("dav1d");
        if (topFails) throw new Error("undecodable: dav1d -1");
        // A top is 12 bits of 7 (golden plain g14 is 14 bits, split 2), a low 8 bits of 3.
        return isTop(bytes) ? one(12, 7) : one(8, 3);
      },
    },
  };
  const { units } = await import("./av1-item.js");
  const tops = ["plain/g14", "plain/g12", "optimized/g12"].map((n) => {
    const item = parseItem(golden(...n.split("/")));
    return units(item.frames[0], item.split)[0].length;
  });
  const isTop = (bytes) => tops.includes(bytes.length);
  const make = async (mixed, tag) => {
    const av1 = await import(`./av1.js?mixed-${tag}`);
    await av1.init({ mixed }, async (path) => stubs[path]);
    return av1;
  };
  const g14 = golden("plain", "g14");
  const take = async (av1, what, bytes, want, sample) => {
    calls.length = 0;
    const f = await av1.decodeFrame(bytes).catch((e) => ({ error: e.message }));
    const got = f.sab ? new Uint16Array(f.sab)[0] : f.error;
    check(calls.join() === want && got === sample, `mixed: ${what} (${calls.join()}; ${got}, want ${sample})`);
  };
  globalThis.VideoDecoder = class {};
  const on = await make(true, "on");
  await take(on, "a 12-bit top to dav1d, its low to WebCodecs, started first", g14, "probe g8,webcodecs low,dav1d", (7 << 2) | 1);
  await take(on, "the next item merges its own low, not the last one's", g14, "probe g8,webcodecs low,dav1d", (7 << 2) | 2);
  wcFails = true;
  await take(on, "a failed WebCodecs low is decoded by dav1d", g14, "probe g8,webcodecs low,dav1d,dav1d", (7 << 2) | 3);
  wcFails = false;
  topFails = true;
  await take(on, "a failed top fails the item once its low has settled", g14, "probe g8,webcodecs low,dav1d", "undecodable: dav1d -1");
  check(lows === 3, `mixed: the failed top's low settled before the item failed (${lows} lows)`);
  topFails = false;
  await take(on, "and the item after it merges its own low", g14, "probe g8,webcodecs low,dav1d", (7 << 2) | 2);
  probeOk = false;
  await take(on, "a failed g8 probe leaves both streams to dav1d", g14, "probe g8,dav1d,dav1d", (7 << 2) | 3);
  probeOk = true;
  await take(on, "a 12-bit item with no low stream is dav1d's alone", golden("plain", "g12"), "dav1d", 7);
  await take(on, "a split item whose top is ≤ 10 bits keeps today's choice", golden("optimized", "g12"),
    "probe g10,probe g8,webcodecs top,webcodecs low", (7 << 2) | 1);
  await take(await make(undefined, "off"), "without the flag both streams go to dav1d", g14, "dav1d,dav1d", (7 << 2) | 3);
  delete globalThis.VideoDecoder;
  await take(on, "no VideoDecoder, both streams to dav1d", g14, "dav1d,dav1d", (7 << 2) | 3);
}

/** Golden items from the writer decode to their sources' samples; decoded-stream refusals by name. */
if (!existsSync(`${OUT}/simd.js`)) console.log(`SKIPPED: golden items — no ${OUT} (lab/av1/dav1d-wasm/build.sh)`);
else {
  const av1 = await import("./av1.js?golden");
  await av1.init({ glue: `${OUT}/simd.js`, wasm: `${OUT}/simd.wasm`, dir: OUT });
  for (const rep of ["plain", "optimized"]) {
    for (const file of readdirSync(`${ITEMS}/${rep}`).filter((f) => f.endsWith(".av1"))) {
      const name = file.slice(0, -4);
      const want = readFileSync(`${ITEMS}/${rep}/${name}.sha256`, "utf8").trim();
      const f = await av1.decodeFrame(golden(rep, name)).catch((e) => ({ error: e.message }));
      check(f.sab && sha(f.sab) === want, `golden: ${rep} ${name} decodes to its source (${f.error ?? sha(f.sab).slice(0, 12)})`);
      const shape = f.info && `${f.info.componentCount}x${f.info.bitsPerSample}${f.info.isSigned ? "s" : ""}`;
      const bits = { g8: 8, g10: 10, g12: 12, s11: 11, s13: 13, g14: 14, c8: 8 }[name];
      const expect = `${name === "c8" ? 3 : 1}x${bits}${name.startsWith("s") ? "s" : ""}`;
      check(shape === expect, `golden: ${rep} ${name} says what it is (${shape}, want ${expect})`);
    }
  }
  const matrix = readdirSync(`${ITEMS}/matrix`).filter((f) => f.endsWith(".av1"));
  let exact = 0;
  for (const file of matrix) {
    const [, bits, split, sign] = file.match(/^b(\d+)k(\d)([us])\.av1$/);
    const item = new Uint8Array(readFileSync(`${ITEMS}/matrix/${file}`));
    const f = await av1.decodeFrame(item).catch((e) => ({ error: e.message }));
    const said = `${item[1]}/${item[3]}/${item[4] & 1 ? "s" : "u"}`;
    const ok = f.sab && sha(f.sab) === readFileSync(`${ITEMS}/matrix/${file.replace(".av1", ".sha256")}`, "utf8").trim()
      && said === `${bits}/${split}/${sign}` && f.info.bitsPerSample === Number(bits) && f.info.isSigned === (sign === "s");
    exact += ok;
    check(ok, `golden: matrix ${file} decodes to its source as ${bits} bits, split ${split} (${f.error ?? said})`);
  }
  check(matrix.length === 90 && exact === 90, `golden: the matrix's 90 items, ${exact} exact`);
  const decode = (b) => av1.decodeFrame(b);
  const streamCases = [
    [edit(edit(golden("plain", "g8"), 1, 10), 2, 10), /top stream 8-bit, header says 10/, "a top stream of another depth"],
    [edit(edit(golden("plain", "g12"), 3, 1), 2, 12), /not a split frame|low stream/, "split said, not coded"],
    [edit(golden("plain", "g10"), 4, 2), /top stream of 1 planes under rct, not three/, "rct on a grey stream"],
    [edit(golden("plain", "c8"), 4, 1), /three planes without rct/, "three planes, signed, without rct"],
    [edit(edit(golden("optimized", "c8"), 4, 0), 1, 10), /three planes without rct/, "10-bit colour without rct"],
  ];
  for (const [bytes, want, what] of streamCases) {
    const got = await refusal(decode, bytes);
    check(want.test(got), `stream: ${what} is refused by name (${got})`);
  }
  const g12 = golden("optimized", "g12");
  const low16 = Uint8Array.from(g12);
  // The low unit replaced by a 10-bit unit: the low stream must be 8-bit.
  const top = new DataView(g12.buffer, g12.byteOffset).getUint32(20, true);
  const lowAt = 24 + top;
  const ten = golden("plain", "g10").subarray(20);
  const swapped = new Uint8Array(lowAt + ten.length);
  swapped.set(low16.subarray(0, lowAt));
  swapped.set(ten, lowAt);
  new DataView(swapped.buffer).setUint32(16, swapped.length - 20, true);
  const got = await refusal(decode, swapped);
  check(/low stream 10-bit, not 8/.test(got), `stream: a low stream not 8-bit is refused by name (${got})`);
  check(sha((await av1.decodeFrame(g12)).sab) === readFileSync(`${ITEMS}/optimized/g12.sha256`, "utf8").trim(),
    "stream: the decoder that refused them still decodes the next item exactly");
}

console.log(failed ? `${failed} of ${failed + passed} failed` : `av1 item reader: ${passed} ok`);
process.exit(failed ? 1 : 0);
