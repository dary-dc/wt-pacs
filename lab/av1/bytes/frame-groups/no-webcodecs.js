// The dav1d-WASM arm: with no VideoDecoder the product's av1.js takes every payload to dav1d.
delete globalThis.VideoDecoder;
