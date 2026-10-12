//! The encoder shim against the pinned OpenJPH, and `ingest/coded-frames/build.sh`'s libdecode for the check.
use std::path::PathBuf;

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = |var: &str, default: &str| std::env::var(var).map(PathBuf::from).unwrap_or_else(|_| root.join(default));
    let ojph = dir("OPENJPH", "lab/.openjph-build/install");
    let payload = dir("INGEST_BUILD", "lab/.av1-build").join("payload");
    for (lib, path) in [("openjph", ojph.join("lib")), ("decode", payload.clone())] {
        assert!(
            path.join(format!("lib{lib}.so")).exists(),
            "no lib{lib}.so in {} — README.md §Prerequisites, ingest/coded-frames/build.sh",
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
    println!("cargo:rerun-if-env-changed=OPENJPH");
    println!("cargo:rerun-if-env-changed=INGEST_BUILD");
}
