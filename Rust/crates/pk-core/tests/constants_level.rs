//! `constants/level.ts` — every value and formula, against the oracle's own export.
//!
//! Gated BOTH ways:
//! - every constant/budget/config the oracle exports must exist here with the same value;
//! - no oracle value is left untranscribed.

use std::collections::BTreeMap;
use std::path::Path;

use pk_core::constants::level as l;

fn fixture() -> BTreeMap<String, serde_json::Value> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root")
        .join("assets/fixtures/constants-level.json");
    let text = std::fs::read_to_string(&p).unwrap_or_else(|e| {
        panic!(
            "{} — regenerate with RUN_EXPORT=1 in legacy/: {e}",
            p.display()
        )
    });
    serde_json::from_str(&text).expect("fixture parses")
}

fn num_pairs() -> Vec<(&'static str, f64)> {
    vec![
        ("STYLE_KILL_BASE_GOLD", l::STYLE_KILL_BASE_GOLD as f64),
        ("STYLE_KILL_COMBO_GOLD", l::STYLE_KILL_COMBO_GOLD as f64),
        ("STYLE_KILL_GOLD_MAX", l::STYLE_KILL_GOLD_MAX as f64),
        ("GRADE_TIME_FAST", l::GRADE_TIME_FAST),
        ("GRADE_TIME_OK", l::GRADE_TIME_OK),
        ("GRADE_KILLS_FULL", l::GRADE_KILLS_FULL),
        ("GRADE_KILLS_OK", l::GRADE_KILLS_OK),
        ("GRADE_COMBO_FULL", l::GRADE_COMBO_FULL as f64),
        ("GRADE_COMBO_OK", l::GRADE_COMBO_OK as f64),
        ("GRADE_FLOW_FULL", l::GRADE_FLOW_FULL),
        ("GRADE_FLOW_OK", l::GRADE_FLOW_OK),
        ("GRADE_GOLD.S", l::GRADE_GOLD_S as f64),
        ("GRADE_GOLD.A", l::GRADE_GOLD_A as f64),
        ("GRADE_GOLD.B", l::GRADE_GOLD_B as f64),
        ("GRADE_GOLD.C", l::GRADE_GOLD_C as f64),
        ("GRADE_GOLD.D", l::GRADE_GOLD_D as f64),
        ("WINDINESS_CYCLE.0", l::WINDINESS_CYCLE[0]),
        ("WINDINESS_CYCLE.1", l::WINDINESS_CYCLE[1]),
        ("WINDINESS_CYCLE.2", l::WINDINESS_CYCLE[2]),
    ]
}

#[test]
fn every_transcribed_constant_equals_the_oracle() {
    let f = fixture();
    for (name, rust_val) in num_pairs() {
        let Some(json_val) = f.get(name) else {
            panic!("oracle fixture carries no entry named {name:?} — check legacy/src/game/pinball-knight/constants/level.ts");
        };
        let js_num = json_val
            .as_f64()
            .unwrap_or_else(|| panic!("{name} is not a numeric field in the fixture: {json_val:?}"));
        assert!(
            (rust_val - js_num).abs() < 1e-9,
            "{name}: rust ({rust_val}) != oracle ({js_num})"
        );
    }
}

#[test]
fn every_sampled_level_config_and_budget_equals_the_oracle() {
    let f = fixture();
    for depth in 1..=30 {
        let cfg = l::level_config(depth);
        let check = |key: &str, rust_val: f64| {
            let full_key = format!("levelConfig.{depth}.{key}");
            let js_val = f.get(&full_key).unwrap_or_else(|| panic!("missing {full_key}")).as_f64().unwrap();
            assert!(
                (rust_val - js_val).abs() < 1e-9,
                "{full_key}: rust ({rust_val}) != oracle ({js_val})"
            );
        };
        check("cellsW", cfg.cells_w as f64);
        check("cellsH", cfg.cells_h as f64);
        check("floorTiles", cfg.floor_tiles as f64);
        check("zombies", cfg.zombies as f64);
        check("zombieSpeed", cfg.zombie_speed);
        check("torches", cfg.torches as f64);
        check("braid", cfg.braid);
        check("windiness", cfg.windiness);
        check("rooms", cfg.rooms as f64);
        check("secrets", cfg.secrets as f64);
        check("launchBreaks", cfg.launch_breaks as f64);

        for &walkable in &[500.0, 3000.0] {
            let b = l::floor_budgets(depth, walkable);
            let w_key = walkable as i64;
            let check_b = |field: &str, r_val: i64| {
                let full_key = format!("floorBudgets.{depth}.{w_key}.{field}");
                let js_val = f.get(&full_key).unwrap_or_else(|| panic!("missing {full_key}")).as_f64().unwrap() as i64;
                assert_eq!(r_val, js_val, "{full_key}: rust ({r_val}) != oracle ({js_val})");
            };
            check_b("zombies", b.zombies);
            check_b("torches", b.torches);
            check_b("partsArea", b.parts_area);
        }
    }
}

#[test]
fn no_constant_in_the_oracle_is_left_untranscribed() {
    let f = fixture();
    let transcribed: std::collections::BTreeSet<&str> = num_pairs().into_iter().map(|(n, _)| n).collect();
    for (k, _) in &f {
        if k.starts_with("levelConfig.") || k.starts_with("floorBudgets.") {
            continue;
        }
        assert!(
            transcribed.contains(k.as_str()),
            "oracle exports constant {k:?}, but crates/pk-core/src/constants/level.rs does not transcribe it"
        );
    }
}
