fn main() {
    println!("cargo:rerun-if-changed=../../patches/quinn-0.11.11-mtu-gso.patch");
    println!("cargo:rerun-if-changed=../../scripts/patch_crate.sh");
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let status = std::process::Command::new("bash")
        .arg(manifest.join("../../scripts/patch_crate.sh"))
        .arg("quinn")
        .arg(std::env::var("OUT_DIR").unwrap())
        .arg("--copy-src")
        .arg(manifest.join("src"))
        .status()
        .expect("scripts/patch_crate.sh");
    assert!(status.success(), "scripts/patch_crate.sh quinn failed");
    cfg_aliases::cfg_aliases! {
        wasm_browser: { all(target_family = "wasm", target_os = "unknown") },
    }
}
