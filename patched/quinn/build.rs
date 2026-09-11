fn main() {
    // docs/transport/why-these-changes.md §9
    println!("cargo:rerun-if-changed=../../patches/quinn-0.11.11-mtu-gso.patch");
    println!("cargo:rerun-if-changed=../../scripts/patch_quinn.sh");
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out = std::env::var("OUT_DIR").unwrap();
    let status = std::process::Command::new("bash")
        .arg(manifest.join("../../scripts/patch_quinn.sh"))
        .arg("--out")
        .arg(&out)
        .arg("--copy-src")
        .arg(manifest.join("src"))
        .status()
        .expect("scripts/patch_quinn.sh");
    assert!(status.success(), "scripts/patch_quinn.sh failed");
    cfg_aliases::cfg_aliases! {
        wasm_browser: { all(target_family = "wasm", target_os = "unknown") },
    }
}
