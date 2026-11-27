// ADD_WASM=OUT/add.wasm node --test lab/av1/delivery/residual/add-simd.test.mjs   (OUT from add-build.sh)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { exact, shown } from "./add.js";
import { simd } from "./add-simd.js";

const wasm = readFileSync(process.env.ADD_WASM ?? assert.fail("ADD_WASM is the kernel to test"));

function lcg(seed) {
  let s = seed >>> 0;
  return (n) => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) % n);
}

/** A valid frame: a preview within ±3 of source >> shift, inside a padded heap, and the residual that makes it exact. */
function frame(width, height, bits, shift, residBits, seed) {
  const rand = lcg(seed);
  const stride = width + 3;
  const offset = 5;
  const heap = new Uint16Array(offset + stride * height + 3).fill(0x5a5a);
  const n = width * height;
  const residual = new (residBits > 8 ? Uint16Array : Uint8Array)(n);
  const residOffset = 1 << (residBits - 1);
  for (let i = 0; i < n; i++) {
    const v = rand(1 << bits);
    const q = Math.min(1023, Math.max(0, (v >> shift) + rand(7) - 3));
    heap[offset + Math.floor(i / width) * stride + (i % width)] = q;
    residual[i] = v - (q << shift) + residOffset;
  }
  const f = { width, height, bits, signed: false, shift, bias: residOffset };
  return { plane: { heap, offset, stride }, residual, f };
}

const SHAPES = [
  [33, 9, 12, 2, 10],
  [17, 3, 11, 1, 8],
  [8, 4, 10, 0, 8],
  [1142, 7, 12, 2, 9],
  [64, 300, 12, 2, 10],
];

/** The kernel's exact frame and range are add.js's, sample for sample, over 8- and 16-bit residuals, tails and growing frames. */
test("exact: the kernel equals add.js", async () => {
  const k = await simd(wasm);
  for (const [w, h, bits, shift, rb] of SHAPES) {
    const { plane, residual, f } = frame(w, h, bits, shift, rb, w * h);
    const want = exact(plane, residual, f, true);
    const got = k.exact(plane, residual, f);
    assert.ok(got.sab instanceof SharedArrayBuffer);
    assert.deepEqual(new Uint16Array(got.sab), new Uint16Array(want.sab), `${w}x${h}`);
    assert.deepEqual(got.range, want.range, `${w}x${h}`);
  }
});

/** The kernel's shown preview and range are add.js's. */
test("shown: the kernel equals add.js", async () => {
  const k = await simd(wasm);
  for (const [w, h, bits, shift] of SHAPES) {
    const { plane, f } = frame(w, h, bits, shift, 8, w + h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) plane.heap[plane.offset + y * plane.stride + x] += 8;
    const g = { ...f, bias: 3 };
    const want = shown(plane, g);
    const got = k.shown(plane, g);
    assert.deepEqual(new Uint16Array(got.sab), new Uint16Array(want.sab), `${w}x${h}`);
    assert.deepEqual(got.range, want.range, `${w}x${h}`);
  }
});

/** A preview written straight into kernel memory through target(), as copyTo would, is read there and not copied. */
test("a preview already in kernel memory", async () => {
  const k = await simd(wasm);
  const { plane, f } = frame(40, 20, 12, 2, 8, 77);
  const bytes = plane.heap.byteLength;
  const t = k.target(bytes);
  t.set(new Uint8Array(plane.heap.buffer));
  const inPlace = { heap: new Uint16Array(t.buffer, t.byteOffset, plane.heap.length), offset: plane.offset, stride: plane.stride };
  assert.deepEqual(new Uint16Array(k.shown(inPlace, f).sab), new Uint16Array(shown(plane, f).sab));
});

/** Signed or narrow frames are refused, not written wrongly. */
test("refusals", async () => {
  const k = await simd(wasm);
  const { plane, residual, f } = frame(8, 2, 12, 2, 8, 1);
  assert.throws(() => k.exact(plane, residual, { ...f, signed: true }), /unsigned/);
  assert.throws(() => k.shown(plane, { ...f, bits: 8 }), /unsigned/);
});
