// The kernel against the product's merge() on random pictures; needs s/build.sh's output in $KERNEL.
//   KERNEL=lab/.av1-work/merge-free/kernel node --test lab/av1/decode/merge-free/s/merge.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { merge } from "../../../../../client/decode/av1-frame.js";

const DIR = process.env.KERNEL ?? "lab/.av1-work/merge-free/kernel";

async function kernel(file) {
  const module = await WebAssembly.compile(readFileSync(file));
  const imports = {};
  for (const { module: m, name } of WebAssembly.Module.imports(module)) (imports[m] ??= {})[name] = () => 0;
  return (await WebAssembly.instantiate(module, imports)).exports;
}

/** A top of `bits` and an 8-bit low, each in a padded stride, written into the kernel's memory and as pictures. */
function pictures(x, width, height, bits, seed) {
  let s = seed;
  const rand = (n) => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) % n;
  const ts = width + 5;
  const ls = width + 3;
  const pages = Math.ceil((1 << 20) + ts * height * 2 + ls * height + width * height * 2 + 65536) / 65536 - x.memory.buffer.byteLength / 65536;
  if (pages > 0) x.memory.grow(Math.ceil(pages));
  const tAt = 1 << 20;
  const lAt = tAt + ts * height * 2;
  const oAt = (lAt + ls * height + 1) & ~1;
  const top = bits > 8 ? new Uint16Array(x.memory.buffer, tAt, ts * height) : new Uint8Array(x.memory.buffer, tAt, ts * height);
  const low = new Uint8Array(x.memory.buffer, lAt, ls * height);
  for (let i = 0; i < top.length; i++) top[i] = rand(1 << bits);
  for (let i = 0; i < low.length; i++) low[i] = rand(4);
  const pic = { width, height, bits, planes: [{ heap: top, offset: 0, stride: ts }] };
  const lowPic = { width, height, bits: 8, planes: [{ heap: low, offset: 0, stride: ls }] };
  return { pic, lowPic, tAt, lAt, oAt, ts, ls };
}

async function check(file, { width, height, bits, k = 2, offset = 0, signed = false }) {
  const x = await kernel(file);
  const p = pictures(x, width, height, bits, width * 7 + height);
  const want = merge(p.pic, p.lowPic, { depth: bits, bits: bits + k, split: k, offset, signed, rct: false });
  (bits > 8 ? x.merge16 : x.merge8)(p.tAt, p.ts, p.lAt, p.ls, p.oAt, width, height, k, offset);
  const got = new Uint16Array(x.memory.buffer, p.oAt, width * height);
  return { same: Buffer.compare(Buffer.from(got.buffer, got.byteOffset, got.byteLength), Buffer.from(want.sab)) === 0, range: [x.range_min(), x.range_max()], want: [want.range.min, want.range.max] };
}

const CASES = [
  { width: 64, height: 9, bits: 10 },
  { width: 61, height: 7, bits: 10 },
  { width: 37, height: 5, bits: 8 },
  { width: 512, height: 3, bits: 10, offset: 1024, signed: true },
  { width: 7, height: 4, bits: 10 },
];

/** Every sample and the range are merge()'s, through a vector body, a scalar tail, an 8-bit top and a signed offset. */
test("the kernel is merge()", async () => {
  for (const c of CASES) {
    const r = await check(`${DIR}/merge.wasm`, c);
    assert.ok(r.same, JSON.stringify(c));
    assert.deepEqual(r.range, r.want, JSON.stringify(c));
  }
});

/** The copy with its shift one short differs from merge() on every case: the broken arm cannot read exact by chance. */
test("the broken kernel is not", async () => {
  for (const c of CASES) assert.ok(!(await check(`${DIR}/broken/merge.wasm`, c)).same, JSON.stringify(c));
});
