//! Stamps the build time into the binary so the running app can say how old
//! it is (the readout lives bottom-right, next to the frame-time number).
//!
//! Scope caveat, deliberately not papered over: cargo re-runs this script when
//! THIS crate's tracked inputs change, so a pk-core-only edit relinks the exe
//! without refreshing the stamp. The number therefore reads "when pk-game was
//! last compiled", which is what the readout exists to answer — am I looking
//! at the build I just made, or a stale window I forgot to close.
//!
//! PORTS-NOTHING — Cargo build script

fn main() {
    println!("cargo::rerun-if-changed=src");
    println!("cargo::rerun-if-changed=build.rs");
    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    println!("cargo::rustc-env=PK_BUILD_EPOCH={epoch}");
}
