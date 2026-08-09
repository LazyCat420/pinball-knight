//! `cargo xtask <task>` — deterministic workspace chores, no shell scripts.
//!
//! Wire an alias in .cargo/config.toml: `xtask = "run -p xtask --"`.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    let task = env::args().nth(1).unwrap_or_default();
    match task.as_str() {
        "docs" => docs(),
        "bake" => bake(),
        "dist" => dist(),
        _ => {
            eprintln!("usage: cargo xtask <docs|bake|dist>");
            eprintln!("  docs  build + serve the mdbook at docs/");
            eprintln!("  bake  run the legacy painter/crush export into assets/sprites/ (M0+)");
            eprintln!("  dist  release wasm build: wasm-bindgen + wasm-opt + brotli (M0+)");
            ExitCode::FAILURE
        }
    }
}

fn workspace_root() -> PathBuf {
    // xtask always runs from the workspace via `cargo xtask`; CARGO_MANIFEST_DIR
    // is <root>/xtask.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf()
}

fn docs() -> ExitCode {
    let root = workspace_root();
    let status = Command::new("mdbook")
        .arg("serve")
        .arg(root.join("docs"))
        .arg("--open")
        .status();
    match status {
        Ok(s) if s.success() => ExitCode::SUCCESS,
        Ok(_) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("mdbook not found ({e}). Install: https://rust-lang.github.io/mdBook/");
            ExitCode::FAILURE
        }
    }
}

fn bake() -> ExitCode {
    // M0 exit criterion: this drives a legacy/ script (headless Chromium runs
    // the TS painters + crush per rung) and writes assets/sprites/rung-*/.
    eprintln!("xtask bake: not implemented yet — see docs 'Sprite bake pipeline'");
    ExitCode::FAILURE
}

fn dist() -> ExitCode {
    eprintln!("xtask dist: not implemented yet — see docs 'Web build & deploy'");
    ExitCode::FAILURE
}
