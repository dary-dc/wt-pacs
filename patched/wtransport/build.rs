fn main() {
    println!("cargo:rerun-if-changed=../../patches/wtransport-0.7.2-settings-early.patch");
    println!("cargo:rerun-if-changed=../../scripts/patch_wtransport.sh");
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let status = std::process::Command::new("bash")
        .arg(manifest.join("../../scripts/patch_wtransport.sh"))
        .arg(std::env::var("OUT_DIR").unwrap())
        .status()
        .expect("scripts/patch_wtransport.sh");
    assert!(status.success(), "scripts/patch_wtransport.sh failed");
}
