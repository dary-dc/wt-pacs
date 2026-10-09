// The dav1d-WASM variant: with no VideoDecoder the product's av1.js takes every payload to dav1d.
delete globalThis.VideoDecoder;
