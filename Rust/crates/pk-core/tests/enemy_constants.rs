//! `enemies.rs` is GENERATED, and this is what stops it drifting from the
//! oracle it was generated from.
//!
//! A generated file is a CACHE, and a cache with no invalidation is a lie
//! waiting to happen: the day someone tunes `REAPER_SPEED_MAX` in the TS and
//! nothing re-runs the exporter, every Rust test still passes and the reaper is
//! quietly the wrong speed. So this re-runs the exporter and demands the output
//! match the committed file byte for byte.
//!
//! It needs `node` and `legacy/node_modules`. Where neither exists — a fresh
//! checkout, or CI before `npm ci` — it SKIPS rather than fails, and says so.
//! A skip that prints nothing is how a gate quietly stops being a gate.

use std::path::PathBuf;
use std::process::Command;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root")
        .to_path_buf()
}

#[test]
fn the_generated_enemy_table_still_matches_the_oracle() {
    let root = root();
    let legacy = root.join("legacy");
    let script = legacy.join("scripts/export-enemy-constants.mjs");
    if !script.exists() || !legacy.join("node_modules").exists() {
        eprintln!(
            "SKIP the_generated_enemy_table_still_matches_the_oracle: \
             needs `node` + legacy/node_modules (run `npm ci` in legacy/). \
             The committed enemies.rs was NOT verified against the oracle in this run."
        );
        return;
    }

    let out = Command::new("node")
        .arg("scripts/export-enemy-constants.mjs")
        .current_dir(&legacy)
        .output()
        .expect("node runs");
    assert!(
        out.status.success(),
        "the exporter failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let fresh = String::from_utf8(out.stdout).expect("utf8");
    let committed = std::fs::read_to_string(root.join("crates/pk-core/src/enemies.rs"))
        .expect("enemies.rs is committed");

    if fresh != committed {
        // Print the FIRST differing constant rather than a whole-file diff —
        // the useful fact is which number moved, not that 276 lines exist.
        let mut first = None;
        for (a, b) in committed.lines().zip(fresh.lines()) {
            if a != b {
                first = Some((a.to_string(), b.to_string()));
                break;
            }
        }
        panic!(
            "enemies.rs has drifted from `constants/enemies.ts`.\n\
             Re-run: cd legacy && node scripts/export-enemy-constants.mjs > \
             ../crates/pk-core/src/enemies.rs\n\
             first difference:\n  committed: {}\n  oracle:    {}",
            // When every SHARED line matches, the difference is length or
            // trailing whitespace — and "(length differs)" printed on both
            // sides names neither, which is how one byte of trailing newline
            // read as "the enemy table drifted". Say which, in bytes and lines.
            first.as_ref().map(|(a, _)| a.clone()).unwrap_or_else(|| {
                format!(
                    "(no line differs — {} bytes / {} lines)",
                    committed.len(),
                    committed.lines().count()
                )
            }),
            first.as_ref().map(|(_, b)| b.clone()).unwrap_or_else(|| {
                format!(
                    "(no line differs — {} bytes / {} lines)",
                    fresh.len(),
                    fresh.lines().count()
                )
            }),
        );
    }
}

/// Spot-checks with the values written out, so a reader can see the table is
/// real without running node — and so a corrupt regeneration that still parses
/// cannot pass silently.
#[test]
fn the_numbers_are_the_oracles_numbers() {
    use pk_core::enemies as e;
    // The floor timer, quoted in the oracle's own comments.
    assert_eq!(e::REAPER_AFTER, 110.0);
    assert_eq!(e::REAPER_WARNING, 15.0);
    assert_eq!(e::REAPER_SPEED_BASE, 2.4);
    assert_eq!(e::REAPER_SPEED_MAX, 6.2);
    // DERIVED in the oracle (`REAPER_AFTER - TIDE_GRACE - 10`) and therefore the
    // one constant a hand-transcription would most likely get wrong or freeze.
    assert_eq!(e::TIDE_RAMP, e::REAPER_AFTER - e::TIDE_GRACE - 10.0);
    assert_eq!(e::TIDE_RAMP, 82.0);
    // The reaper is capped above the walk (4.2) and under a full sprint
    // (4.2 * 1.85 = 7.77) — the oracle's own comment, checked against the two
    // constants it is a claim about. A const assert, because that relationship
    // is fixed at compile time and clippy is right that a runtime one is not a
    // test: it is a fact the build can prove.
    const _: () = assert!(e_max_above_walk());
    const fn e_max_above_walk() -> bool {
        pk_core::enemies::REAPER_SPEED_MAX > pk_core::state::PLAYER_SPEED
            && pk_core::enemies::REAPER_SPEED_MAX
                < pk_core::state::PLAYER_SPEED * pk_core::state::SPRINT_SPEED_MULT
    }
    assert_eq!(e::BESTIARY_MILESTONES, [10, 30, 75, 150]);
}
