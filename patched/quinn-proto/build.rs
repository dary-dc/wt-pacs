fn main() {
    println!("cargo:rerun-if-changed=../../patches/quinn-proto-0.11.18-probe-every-space.patch");
    println!("cargo:rerun-if-changed=../../scripts/patch_crate.sh");
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let status = std::process::Command::new("bash")
        .arg(manifest.join("../../scripts/patch_crate.sh"))
        .arg("quinn-proto")
        .arg(std::env::var("OUT_DIR").unwrap())
        .status()
        .expect("scripts/patch_crate.sh");
    assert!(status.success(), "scripts/patch_crate.sh quinn-proto failed");
}
