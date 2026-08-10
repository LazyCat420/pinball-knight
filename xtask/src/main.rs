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
            eprintln!("  docs           build + serve the mdbook at docs/");
            eprintln!("  bake           run the legacy painter/crush export into assets/sprites/ (M0+)");
            eprintln!("  bake --tavern  export the tavern keepers + ENTER MAZE sign to assets/tavern/");
            eprintln!("  dist           release wasm build: wasm-bindgen + wasm-opt + brotli (M0+)");
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
    let args: Vec<String> = env::args().skip(2).collect();
    match args.first().map(String::as_str) {
        // The first slice of the bake to land. The full per-rung atlas bake is
        // still the bare `bake` below; this is deliberately a separate flag
        // rather than a partial implementation of it, so nobody reads a
        // successful tavern export as "the sprite pipeline works now".
        Some("--tavern") => bake_tavern(&args[1..]),
        _ => {
            // M0 exit criterion: this drives a legacy/ script (headless Chromium
            // runs the TS painters + crush per rung) and writes
            // assets/sprites/rung-*/.
            eprintln!("xtask bake: not implemented yet — see docs 'Sprite bake pipeline'");
            eprintln!("            `cargo xtask bake --tavern` does the tavern art today.");
            ExitCode::FAILURE
        }
    }
}

/// Export the tavern's canvas-painted art (five keepers + the ENTER MAZE sign).
///
/// The painters are TypeScript and stay that way — see docs/src/art/bake.md.
/// All this does is run them where they work, in `legacy/`, which is also where
/// `node_modules` and the esbuild `resolveDir` live; the script itself rejects
/// any other cwd by chdir-ing back. Extra flags (e.g. `--sheet <png>` for a
/// review contact sheet) pass straight through.
fn bake_tavern(extra: &[String]) -> ExitCode {
    let root = workspace_root();
    let out = root.join("assets").join("tavern");
    let status = Command::new("node")
        .arg("scripts/bake-tavern.mjs")
        .arg("--out")
        .arg(&out)
        .args(extra)
        .current_dir(root.join("legacy"))
        .status();
    match status {
        Ok(s) if s.success() => ExitCode::SUCCESS,
        Ok(_) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("node not found ({e}). The bake runs the legacy painters in headless");
            eprintln!("Chromium via Playwright; install Node and run `npm i` in legacy/.");
            ExitCode::FAILURE
        }
    }
}

fn dist() -> ExitCode {
    eprintln!("xtask dist: not implemented yet — see docs 'Web build & deploy'");
    ExitCode::FAILURE
}
