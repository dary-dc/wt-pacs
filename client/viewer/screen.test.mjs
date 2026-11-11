// node client/viewer/screen.test.mjs — what the page writes of a shown frame says one thing of it.
import assert from "node:assert/strict";
import { lastError, markOf, overlayText } from "./screen.js";

const lossy = { q: 8, g: 16, depth: 10, bitsStored: 12 };
const about = { path: "htj2k", wireBytes: 2048, decodeMs: 3 };

/** A frame of a series without a label is marked by its check: none when exact, NOT EXACT, or unchecked. */
assert.deepEqual(markOf({ exact: true, quality: null }), { className: "", text: "" });
assert.deepEqual(markOf({ exact: false, reason: "digest", quality: null }), { className: "inexact", text: "NOT EXACT — digest" });
assert.deepEqual(markOf({ exact: "unchecked", quality: null }), { className: "unchecked", text: "unchecked" });

/** An optimal-quality frame carries no digest: its label says what it is, and no `unchecked` mark beside it reads as a failure (REVIEW-BLIND C1). */
assert.deepEqual(markOf({ exact: "unchecked", quality: "optimal" }), { className: "", text: "" });
assert.deepEqual(markOf({ exact: undefined, quality: "asking" }), { className: "", text: "" });
assert.deepEqual(markOf({ exact: false, reason: "decode", quality: "optimal" }), { className: "inexact", text: "NOT EXACT — decode" });

/** The overlay gives an optimal-quality frame its series' Q, G and depth cut, and the exact frame none of them (REVIEW-BLIND C3). */
assert.equal(overlayText({ path: "av1-webcodecs", wireBytes: 1024, decodeMs: 1.25 }, "optimal", lossy), "av1-webcodecs · 1.0 KB · decode 1.3 ms · Q 8 · G 16 · 10-bit depth cut of 12");
assert.equal(overlayText(about, "lossless", lossy), "htj2k · 2.0 KB · decode 3.0 ms");
assert.equal(overlayText({ path: "av1-dav1d", refusal: "config" }, null, undefined), "av1-dav1d after WebCodecs refused: config · ? KB · decode ? ms");

/** A lossless check that failed and then passed on its frame leaves no error on the status line; any other error stays (REVIEW-BLIND C2). */
const failed = "frame 2: lossless: not exact: digest";
assert.equal(lastError(["frame 1: refused", failed], { i: 2, quality: "lossless" }), "frame 1: refused");
assert.equal(lastError([failed], { i: 2, quality: "lossless" }), undefined);
assert.equal(lastError([failed], { i: 2, quality: "failed" }), failed);
assert.equal(lastError([failed], { i: 3, quality: "optimal" }), failed);
assert.equal(lastError(["frame 2: refused"], { i: 2, quality: "lossless" }), "frame 2: refused");

console.log("screen: ok");
