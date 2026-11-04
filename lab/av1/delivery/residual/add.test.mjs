// node --test lab/av1/delivery/residual/add.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { exact, shown } from "./add.js";

/** A deterministic generator, so a failure names the same samples every run. */
function lcg(seed) {
  let s = seed >>> 0;
  return (n) => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) % n);
}

/** A width × height picture inside a larger heap, at `offset` with `stride`, its samples below 2^bits. */
function plane(width, height, bits, rand, { offset = 7, pad = 5, Heap = Uint16Array } = {}) {
  const stride = width + pad;
  const heap = new Heap(offset + stride * height + pad);
  for (let i = 0; i < heap.length; i++) heap[i] = 0xffff & 0x5a5a;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) heap[offset + y * stride + x] = rand(1 << bits);
  return { heap, offset, stride };
}

const at = (p, width, i) => p.heap[p.offset + Math.floor(i / width) * p.stride + (i % width)];

/** The stored frame and its range, sample by sample, with no loop shared with add.js. */
function expected(p, residual, f) {
  const n = f.width * f.height;
  const out = (f.signed ? Int16Array : Uint16Array).from({ length: n }, (_, i) => (at(p, f.width, i) << f.shift) + (residual ? residual[i] : 0) - f.bias);
  return { out, range: { min: Math.min(...out), max: Math.max(...out) } };
}

const view = (sab, signed) => (signed ? new Int16Array(sab) : new Uint16Array(sab));

const CASES = [
  { name: "a 12-bit series from a 10-bit preview, 16-bit residual", width: 33, height: 9, bits: 12, signed: false, shift: 2, previewBits: 10, residBits: 10, offset: 0 },
  { name: "a 10-bit series at s = 0, 8-bit residual", width: 8, height: 4, bits: 10, signed: false, shift: 0, previewBits: 10, residBits: 8, offset: 0 },
  { name: "an 11-bit series, odd width, s = 1", width: 17, height: 3, bits: 11, signed: false, shift: 1, previewBits: 10, residBits: 9, offset: 0 },
  { name: "a signed 13-bit series, values below zero", width: 9, height: 5, bits: 13, signed: true, shift: 3, previewBits: 10, residBits: 10, offset: 4096 },
];

for (const c of CASES) {
  /** The exact frame is the source again from a preview near it and its residual, read through the plane's offset and stride, in both forms. */
  test(`exact: ${c.name}`, () => {
    const rand = lcg(c.width * 131 + c.bits);
    const n = c.width * c.height;
    const lo = c.signed ? -(1 << (c.bits - 1)) : 0;
    const source = Int32Array.from({ length: n }, () => lo + rand(1 << c.bits));
    const p = plane(c.width, c.height, c.previewBits, rand);
    const residOffset = 1 << (c.residBits - 1);
    const residual = new (c.residBits > 8 ? Uint16Array : Uint8Array)(n);
    for (let i = 0; i < n; i++) {
      const v = source[i] + c.offset;
      const q = Math.min((1 << c.previewBits) - 1, Math.max(0, (v >> c.shift) + rand(7) - 3));
      p.heap[p.offset + Math.floor(i / c.width) * p.stride + (i % c.width)] = q;
      residual[i] = v - (q << c.shift) + residOffset;
    }
    const f = { width: c.width, height: c.height, bits: c.bits, signed: c.signed, shift: c.shift, bias: residOffset + c.offset };
    const want = expected(p, residual, f);
    assert.deepEqual(Array.from(want.out), Array.from(source), "the fixture itself");
    for (const onePass of [false, true]) {
      const got = exact(p, residual, f, onePass);
      assert.equal(got.sab.byteLength, n * 2);
      assert.deepEqual(view(got.sab, c.signed), want.out, `onePass ${onePass}`);
      assert.deepEqual(got.range, want.range, `onePass ${onePass}`);
    }
  });

  /** The preview shown is (p << s) − offset at every sample, with the range of what is stored. */
  test(`shown: ${c.name}`, () => {
    const rand = lcg(c.height * 977 + c.bits);
    const p = plane(c.width, c.height, c.previewBits, rand);
    const f = { width: c.width, height: c.height, bits: c.bits, signed: c.signed, shift: c.shift, bias: c.offset };
    const want = expected(p, null, f);
    const got = shown(p, f);
    assert.deepEqual(view(got.sab, c.signed), want.out);
    assert.deepEqual(got.range, want.range);
  });
}

/** The add reads a preview that is itself a shown frame (shift 0), as the protocol's design 2 does. */
test("exact on a shown preview gives the frame shown + r − residual offset", () => {
  const rand = lcg(5);
  const f = { width: 12, height: 6, bits: 12, signed: false, shift: 2, bias: 0 };
  const shownFrame = shown(plane(12, 6, 10, rand), f);
  const residual = Uint16Array.from({ length: 72 }, () => rand(1024));
  const p = { heap: new Uint16Array(shownFrame.sab), offset: 0, stride: 12 };
  const g = { ...f, shift: 0, bias: 512 };
  for (const onePass of [false, true]) {
    const got = exact(p, residual, g, onePass);
    assert.deepEqual(new Uint16Array(got.sab), Uint16Array.from(residual, (r, i) => p.heap[i] + r - 512));
  }
});

/** Every call writes a buffer of its own: nothing handed on is written again. */
test("each frame gets a fresh SharedArrayBuffer", () => {
  const rand = lcg(9);
  const p = plane(4, 4, 10, rand);
  const r = new Uint16Array(16);
  const f = { width: 4, height: 4, bits: 12, signed: false, shift: 2, bias: 0 };
  const a = exact(p, r, f, true);
  const b = exact(p, r, f, true);
  assert.notEqual(a.sab, b.sab);
  assert.ok(a.sab instanceof SharedArrayBuffer);
});

/** Frames of 8 bits or fewer, and a residual shorter than the frame, are refused. */
test("refusals", () => {
  const p = plane(4, 4, 8, lcg(1));
  assert.throws(() => exact(p, new Uint8Array(16), { width: 4, height: 4, bits: 8, signed: false, shift: 0, bias: 0 }), /8-bit/);
  assert.throws(() => shown(p, { width: 4, height: 4, bits: 8, signed: false, shift: 0, bias: 0 }), /8-bit/);
  assert.throws(() => exact(p, new Uint16Array(15), { width: 4, height: 4, bits: 12, signed: false, shift: 2, bias: 0 }), /residual of 15/);
});
