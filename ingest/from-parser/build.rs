//! The encoder shim against the pinned OpenJPH, and libdecode for the check: both from `ingest/tools.sh`'s `INGEST_BUILD`.
use std::path::PathBuf;

fn main() {
    let build = std::env::var("INGEST_BUILD")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.build"));
    let ojph = build.join("openjph");
    for (lib, path) in [("openjph", ojph.join("lib")), ("decode", build.join("payload"))] {
        assert!(
            path.join(format!("lib{lib}.so")).exists(),
            "no lib{lib}.so in {} — ingest/tools.sh",
            path.display()
        );
        println!("cargo:rustc-link-search=native={}", path.display());
        println!("cargo:rustc-link-lib=dylib={lib}");
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", path.display());
    }
    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .opt_level(2)
        .file("encode.cpp")
        .include(ojph.join("include"))
        .compile("encode");
    println!("cargo:rerun-if-changed=encode.cpp");
    println!("cargo:rerun-if-env-changed=INGEST_BUILD");
}
