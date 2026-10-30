//! With `decode`, the frame check's decoders: `ingest/tools.sh`'s libdecode over its pinned dav1d and OpenJPH.
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=INGEST_BUILD");
    if std::env::var_os("CARGO_FEATURE_DECODE").is_none() {
        return;
    }
    let build = std::env::var("INGEST_BUILD")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../ingest/.build"));
    let path = build.join("payload");
    assert!(path.join("libdecode.so").exists(), "no libdecode.so in {} — ingest/tools.sh", path.display());
    println!("cargo:rerun-if-changed={}", path.join("libdecode.so").display());
    println!("cargo:rustc-link-search=native={}", path.display());
    println!("cargo:rustc-link-lib=dylib=decode");
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", path.display());
}
