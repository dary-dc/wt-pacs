// node client/decode/av1.test.mjs — the AV1 payload reader: golden payloads through dav1d-WASM (when
// client/decode/wasm/dav1d/build.sh has run), every refusal payload-format.md names, and the decoder choice.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PAYLOADS = `${ROOT}client/contract/av1/payloads`;
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
const golden = (rep, name) => new Uint8Array(readFileSync(`${PAYLOADS}/${rep}/${name}.av1`));
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

const { parsePayload } = await import("./av1-payload.js");

/** Every header case payload-format.md lists is refused by name before anything decodes. */
{
  const g12 = golden("optimized", "g12");
  const c8 = golden("optimized", "c8");
  const parse = async (b, n = 1) => parsePayload(b, n);
  const cases = [
    [g12.subarray(0, 15), /under the 16-byte header/, "a short payload"],
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
    [u32(g12, 16, 1e6), /frame 0 overruns the payload/, "a length past the payload"],
    [u32(g12, 12, 1e6), /frame lengths overrun the payload/, "a frame count whose lengths overrun", 1e6],
    [Uint8Array.of(...g12, 0), /1 bytes past the last frame/, "bytes after the last frame"],
  ];
  for (const [bytes, want, what, n] of cases) {
    const got = await refusal((b) => parse(b, n), bytes);
    check(want.test(got), `header: ${what} is refused by name (${got})`);
  }
  check((await refusal(parse, c8)) === "decoded", "header: the optimized colour payload parses");
  check((await refusal((b) => parse(b, 1), golden("plain", "g14"))) === "decoded", "header: the plain 14-bit payload parses");
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
        const payload = { bits, depth, split, signed, rct: false, offset };
        const got = end(begin(pic(top, depth), payload), split ? pic(low, 8) : null);
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

/**
 * The codecs string is the one ffmpeg 6.1.1's trace_headers and ffprobe read from the same sequence header
 * (lab/av1/exact/codec-string): reduced still-picture headers as ingest writes them, and full ones with timing info, a
 * decoder model, frame ids, High tier and nine operating points, the first point's level taken.
 */
{
  const { codecString, sequence } = await import("./av1-payload.js");
  const hex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
  const cases = [
    ["0a05180cfffb44", "av01.0.00M.08.1.110.02.02.02.0", "8-bit grey, reduced"],
    ["0a05180cfffbc4", "av01.0.00M.10.1.110.02.02.02.0", "10-bit grey, reduced"],
    ["0a08380cfffb40434008", "av01.1.00M.08.0.000.01.13.00.1", "8-bit 4:4:4 sRGB identity, reduced"],
    ["0a08380cfffbc0434008", "av01.1.00M.10.0.000.01.13.00.1", "10-bit 4:4:4 sRGB identity, reduced"],
    ["0a0a00000002aff79b5f3c40", "av01.0.00M.10.1.110.02.02.02.0", "10-bit grey, a group's full header"],
    ["0a1d040000000400000065780000000a5300004dafc8afc85d57fbcdaf9e20", "av01.0.19M.10.1.110.02.02.02.0", "timing info and a decoder model, level 6.3"],
    ["0a1d040000000400000065780000000a5300004fafc8afc85d57fbcdaf9e20", "av01.0.19H.10.1.110.02.02.02.0", "the same at High tier"],
    ["0a1a008707038181c04060e030301808041c0206010102aff78a3401", "av01.0.00M.08.0.110.02.02.02.0", "4:2:0, nine operating points"],
    ["0a1a0087072b8181c04060e030301808041c0206010102aff78a3401", "av01.0.05M.08.0.110.02.02.02.0", "the same, the first point's level edited to 3.1"],
    ["0a0a0000004557fbcdaf9e20", "av01.0.08H.10.1.110.02.02.02.0", "High tier at level 4.0, the lowest that codes a tier"],
    ["0a0b00000002aff7f036be7880", "av01.0.00M.10.1.110.02.02.02.0", "frame ids present (error resilient)"],
  ];
  for (const [h, want, what] of cases) {
    const got = codecString(sequence(hex(h)));
    check(got === want, `codec string: ${what} is ${want} (${got})`);
  }
  const golden12 = golden("plain", "g12").subarray(20);
  check(codecString(sequence(golden12)) === "av01.2.00M.12.1.110.02.02.02.0", "codec string: 12-bit grey is Professional profile");
  const cut = (() => {
    try {
      return sequence(hex("12000a0a0000"));
    } catch (e) {
      return e.message;
    }
  })();
  check(/sequence header cut/.test(cut), `codec string: a cut sequence header is refused by name (${cut})`);
  check(sequence(hex("12003200")) === null, "codec string: a unit with no sequence header has none");
}

/** The decoder chosen per payload: WebCodecs only where every stream is ≤ 10 bits and its probe passed. */
{
  const calls = [];
  let [depth, planes] = [8, 1];
  const pic = (bits, n) => ({ width: 1, height: 1, bits, planes: Array.from({ length: n }, () => ({ heap: Uint16Array.of(7), offset: 0, stride: 1 })) });
  let probeOk = true;
  let wcFails = false;
  // The first failure is init's own load, which no payload waits on.
  let importFails = 2;
  const stubs = {
    "./av1-webcodecs.js": {
      init: async () => {},
      probe: async (layout) => (calls.push(`probe ${layout}`), probeOk),
      picture: async (bytes, unit, which) => {
        calls.push("webcodecs");
        if (wcFails) throw new Error("undecodable: closed");
        return which === "low" ? pic(8, 1) : pic(depth, planes);
      },
    },
    // A low unit is asked with two arguments, a top with three.
    "./av1-dav1d.js": { init: async () => {}, picture: (...a) => (calls.push("dav1d"), a.length === 2 ? pic(8, 1) : pic(depth, planes)) },
  };
  const load = async (path) => {
    if (path === "./av1-dav1d.js" && importFails-- > 0) throw new Error("import failed");
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
  await take("a 10-bit grey payload goes to WebCodecs", "plain", "g10", 10, 1, "probe g10,webcodecs");
  probeOk = false;
  await take("a failed probe sends the payload to dav1d, whose failed import fails it", "plain", "g8", 8, 1, "probe g8", "import failed");
  await take("and the import is tried again on the next payload", "plain", "g8", 8, 1, "probe g8,dav1d");
  probeOk = true;
  wcFails = true;
  await take("WebCodecs failing falls back to dav1d", "plain", "g8", 8, 1, "probe g8,webcodecs,dav1d");
  wcFails = false;
  await take("a 12-bit payload never reaches WebCodecs", "plain", "g12", 12, 1, "dav1d");
  await take("a split payload's two streams are both probed", "optimized", "g12", 10, 1, "probe g10,probe g8,webcodecs,webcodecs");
  await take("an rct payload probes 4:4:4 10-bit", "optimized", "c8", 10, 3, "probe c10,webcodecs");
  await take("a plain colour payload is told from grey by its profile", "plain", "c8", 8, 3, "probe c8,webcodecs");
  await take("8-bit grey coded 4:2:0 probes its own layout", "grey420", "g8", 8, 1, "probe g8f,webcodecs");
  // The second decode after a digest mismatch takes another path, or none: docs/adr/exactness-in-production.md §2
  const again = async (what, name, d, avoid, want, outcome, unit = { key: true }) => {
    [depth, planes] = [d, 1];
    calls.length = 0;
    const got = await av1.decodeFrame(golden("plain", name), unit, null, avoid).then((r) => r.path, (e) => String(e.message));
    check(calls.join() === want && got.startsWith(outcome), `second decode: ${what} (${calls.join()}; ${got.slice(0, 40)})`);
  };
  await again("a first decode names WebCodecs as its path", "g10", 10, undefined, "probe g10,webcodecs", "av1-webcodecs");
  await again("a first decode names dav1d as its path", "g12", 12, undefined, "dav1d", "av1-dav1d");
  await again("after WebCodecs, dav1d", "g10", 10, "av1-webcodecs", "dav1d", "av1-dav1d");
  await again("after dav1d, WebCodecs", "g10", 10, "av1-dav1d", "probe g10,webcodecs", "av1-webcodecs");
  await again("after dav1d over 10 bits, none", "g12", 12, "av1-dav1d", "", "no WebCodecs decoder");
  wcFails = true;
  await again("after dav1d, a failing WebCodecs is not dav1d again", "g10", 10, "av1-dav1d", "probe g10,webcodecs", "undecodable");
  wcFails = false;
  await again("inside a group, none", "g10", 10, "av1-webcodecs", "", "a frame inside a group", { key: false });
  const mixed = await import("./av1.js?mixed");
  await mixed.init({ mixed: true }, load);
  const split = (avoid) => mixed.decodeFrame(golden("optimized", "g14"), { key: true }, null, avoid).then((r) => r.path, (e) => String(e.message));
  [depth, planes] = [12, 1];
  calls.length = 0;
  let path = await split();
  check(calls.join() === "probe g8,webcodecs,dav1d" && path === "av1-mixed", `second decode: a mixed decode names its path (${calls.join()}; ${path})`);
  calls.length = 0;
  path = await split("av1-mixed");
  check(calls.join() === "dav1d,dav1d" && path === "av1-dav1d", `second decode: after a mixed decode, dav1d alone (${calls.join()}; ${path})`);
  delete globalThis.VideoDecoder;
  await take("no VideoDecoder, no WebCodecs", "plain", "g10", 10, 1, "dav1d");
}

/** Init starts fetching every decoder the payload could need, so none waits for the first payload to land; a failure there costs no payload. */
{
  const asked = [];
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (fetched.push(url), new Response(new Uint8Array(1)));
  let fail = true;
  const load = async (path) => {
    asked.push(path);
    if (fail) throw new Error("import failed");
    return { init: async () => {}, probe: async () => true, picture: async () => ({ width: 1, height: 1, bits: 8, planes: [{ heap: Uint8Array.of(7), offset: 0, stride: 1 }] }) };
  };
  globalThis.VideoDecoder = class {};
  const av1 = await import("./av1.js?warm");
  await av1.init({ glue: "/g.js", wasm: "/g.wasm" }, load);
  check(asked.join() === "./av1-dav1d.js,./av1-webcodecs.js", `warm: init imports both decoders before any payload (${asked.join()})`);
  check(fetched.join() === "/g.js,/g.wasm", `warm: init fetches dav1d's glue and WASM before any payload (${fetched.join()})`);
  globalThis.fetch = realFetch;
  await new Promise((r) => setTimeout(r));
  fail = false;
  const got = await refusal(av1.decodeFrame, golden("plain", "g8"));
  check(got === "decoded" && asked.length === 3, `warm: a load that failed at init is tried again by the payload (${got}, ${asked.length} loads)`);
  delete globalThis.VideoDecoder;
  const none = await import("./av1.js?warm-none");
  asked.length = 0;
  await none.init({}, load);
  check(asked.join() === "./av1-dav1d.js", `warm: without VideoDecoder only dav1d is imported (${asked.join()})`);
}

/** With `mixed`, a top over 10 bits goes to dav1d and its low to WebCodecs, each payload's own low merged, dav1d the fallback. */
{
  const calls = [];
  const one = (bits, v) => ({ width: 1, height: 1, bits, planes: [{ heap: Uint16Array.of(v), offset: 0, stride: 1 }] });
  // WebCodecs' lows alternate 1, 2: a payload merged with the last one's low is off by one.
  let lows = 0;
  let probeOk = true;
  let wcFails = false;
  let topFails = false;
  const stubs = {
    "./av1-webcodecs.js": {
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
    "./av1-dav1d.js": {
      init: async () => {},
      picture: (bytes) => {
        calls.push("dav1d");
        if (topFails) throw new Error("undecodable: dav1d -1");
        // A top is 12 bits of 7 (golden plain g14 is 14 bits, split 2), a low 8 bits of 3.
        return isTop(bytes) ? one(12, 7) : one(8, 3);
      },
    },
  };
  const { units } = await import("./av1-payload.js");
  const tops = ["plain/g14", "plain/g12", "optimized/g12"].map((n) => {
    const payload = parsePayload(golden(...n.split("/")));
    return units(payload.frames[0], payload.split)[0].length;
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
  await take(on, "the next payload merges its own low, not the last one's", g14, "probe g8,webcodecs low,dav1d", (7 << 2) | 2);
  wcFails = true;
  await take(on, "a failed WebCodecs low is decoded by dav1d", g14, "probe g8,webcodecs low,dav1d,dav1d", (7 << 2) | 3);
  wcFails = false;
  topFails = true;
  await take(on, "a failed top fails the payload once its low has settled", g14, "probe g8,webcodecs low,dav1d", "undecodable: dav1d -1");
  check(lows === 3, `mixed: the failed top's low settled before the payload failed (${lows} lows)`);
  topFails = false;
  await take(on, "and the payload after it merges its own low", g14, "probe g8,webcodecs low,dav1d", (7 << 2) | 2);
  probeOk = false;
  await take(on, "a failed g8 probe leaves both streams to dav1d", g14, "probe g8,dav1d,dav1d", (7 << 2) | 3);
  probeOk = true;
  await take(on, "a 12-bit payload with no low stream is dav1d's alone", golden("plain", "g12"), "dav1d", 7);
  await take(on, "a split payload whose top is ≤ 10 bits keeps today's choice", golden("optimized", "g12"),
    "probe g10,probe g8,webcodecs top,webcodecs low", (7 << 2) | 1);
  await take(await make(undefined, "off"), "without the flag both streams go to dav1d", g14, "dav1d,dav1d", (7 << 2) | 3);
  delete globalThis.VideoDecoder;
  await take(on, "no VideoDecoder, both streams to dav1d", g14, "dav1d,dav1d", (7 << 2) | 3);
}

/** Golden payloads from the writer decode to their sources' samples; decoded-stream refusals by name. */
if (!existsSync(`${OUT}/simd.js`)) console.log(`SKIPPED: golden payloads — no ${OUT} (client/decode/wasm/dav1d/build.sh)`);
else {
  const av1 = await import("./av1.js?golden");
  await av1.init({ glue: `${OUT}/simd.js`, wasm: `${OUT}/simd.wasm`, dir: OUT });
  for (const rep of ["plain", "optimized", "grey420"]) {
    for (const file of readdirSync(`${PAYLOADS}/${rep}`).filter((f) => f.endsWith(".av1"))) {
      const name = file.slice(0, -4);
      const want = readFileSync(`${PAYLOADS}/${rep}/${name}.sha256`, "utf8").trim();
      const f = await av1.decodeFrame(golden(rep, name)).catch((e) => ({ error: e.message }));
      check(f.sab && sha(f.sab) === want, `golden: ${rep} ${name} decodes to its source (${f.error ?? sha(f.sab).slice(0, 12)})`);
      const shape = f.info && `${f.info.componentCount}x${f.info.bitsPerSample}${f.info.isSigned ? "s" : ""}`;
      const bits = { g8: 8, g9: 9, g10: 10, g12: 12, s11: 11, s13: 13, g14: 14, c8: 8 }[name];
      const expect = `${name === "c8" ? 3 : 1}x${bits}${name.startsWith("s") ? "s" : ""}`;
      check(shape === expect, `golden: ${rep} ${name} says what it is (${shape}, want ${expect})`);
    }
  }
  const matrix = readdirSync(`${PAYLOADS}/matrix`).filter((f) => f.endsWith(".av1"));
  let exact = 0;
  for (const file of matrix) {
    const [, bits, split, sign] = file.match(/^b(\d+)k(\d)([us])\.av1$/);
    const payload = new Uint8Array(readFileSync(`${PAYLOADS}/matrix/${file}`));
    const f = await av1.decodeFrame(payload).catch((e) => ({ error: e.message }));
    const said = `${payload[1]}/${payload[3]}/${payload[4] & 1 ? "s" : "u"}`;
    const ok = f.sab && sha(f.sab) === readFileSync(`${PAYLOADS}/matrix/${file.replace(".av1", ".sha256")}`, "utf8").trim()
      && said === `${bits}/${split}/${sign}` && f.info.bitsPerSample === Number(bits) && f.info.isSigned === (sign === "s");
    exact += ok;
    check(ok, `golden: matrix ${file} decodes to its source as ${bits} bits, split ${split} (${f.error ?? said})`);
  }
  check(matrix.length === 90 && exact === 90, `golden: the matrix's 90 payloads, ${exact} exact`);
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
  check(sha((await av1.decodeFrame(g12)).sab) === readFileSync(`${PAYLOADS}/optimized/g12.sha256`, "utf8").trim(),
    "stream: the decoder that refused them still decodes the next payload exactly");
}

/**
 * An 8-bit RGB frame, as Firefox returns an identity stream, is read back as the G, B, R planes it was coded in; a
 * full-range 4:2:0 grey stream returned as RGB is read back as its grey only where R = G = B; limited-range grey never.
 */
{
  const { PROBES } = await import("./av1-probe.js");
  const unit = (layout) => Uint8Array.from(atob(PROBES[layout].unit), (c) => c.charCodeAt(0));
  const [w, h, pad] = [3, 2, 2];
  const plane = (k) => Uint8Array.from({ length: w * h }, (_, i) => (i * 37 + k * 91) & 255);
  let [g, b, r] = [plane(0), plane(1), plane(2)];
  let format = "BGRX";
  globalThis.EncodedVideoChunk = class { constructor(c) { Object.assign(this, c); } };
  globalThis.VideoDecoder = class {
    constructor({ output }) { this.output = output; this.state = "unconfigured"; }
    configure() { this.state = "configured"; }
    async flush() {}
    close() { this.state = "closed"; }
    decode(chunk) {
      const order = format === "BGRX" ? [b, g, r] : [r, g, b];
      const stride = 4 * w + pad;
      this.output({ format, timestamp: chunk.timestamp, visibleRect: { width: w, height: h }, close() {},
        allocationSize: () => stride * h,
        copyTo: async (px) => {
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) px[y * stride + 4 * x + c] = order[c][y * w + x];
          return [{ offset: 0, stride }];
        } });
    }
  };
  const wc = await import("./av1-webcodecs.js?rgb");
  for (const f of ["BGRX", "RGBX"]) {
    format = f;
    const pic = await wc.picture(unit("c8"), { key: true, gen: 0, index: 0 });
    const same = (p, want) => want.every((v, i) => p.heap[p.offset + Math.floor(i / w) * p.stride + (i % w)] === v);
    check(pic.bits === 8 && pic.planes.length === 3 && same(pic.planes[0], g) && same(pic.planes[1], b) && same(pic.planes[2], r),
      `rgb: ${f} read back as the G, B, R planes`);
  }
  const got = await wc.picture(unit("g8"), { key: true, gen: 1, index: 0 }).then(() => "decoded", (e) => e.message);
  check(/limited range/.test(got), `rgb: a limited-range grey stream returned as RGB is refused (${got})`);
  [b, r] = [g, g];
  const grey = await wc.picture(unit("g8f"), { key: true, gen: 2, index: 0 });
  check(grey.planes.length === 1 && g.every((v, i) => grey.planes[0].heap[i] === v), "rgb: full-range 4:2:0 grey with R = G = B read back as its grey");
  r = plane(2);
  const tinted = await wc.picture(unit("g8f"), { key: true, gen: 3, index: 0 }).then(() => "decoded", (e) => e.message);
  check(/chroma/.test(tinted), `rgb: and refused where R, G and B differ (${tinted})`);
  delete globalThis.VideoDecoder;
  delete globalThis.EncodedVideoChunk;
}

console.log(failed ? `${failed} of ${failed + passed} failed` : `av1 payload reader: ${passed} ok`);
process.exit(failed ? 1 : 0);
