//! `cargo xtask audit` — does the Rust behind a `PORTS:` claim resemble the
//! legacy file at all?
//!
//! ## Why a second instrument
//!
//! The ledger's depth gate (`coverage.rs`) asks "is this claim big enough to be
//! that file?" and catches a 49-line module banking 906 lines. It cannot catch
//! the other shape, measured on this tree 2026-08-16: a module that is big
//! enough and is about something else entirely. `constants/render.rs` declared
//! `PORTS: constants/render.ts` and shares **zero** of that file's 70 exported
//! names — it invents `DESIGN_VIEWPORT_W`, `RUNG_BACKGROUND`,
//! `LIGHT_FALLOFF_LINEAR`, `calculate_light_attenuation`, none of which exist in
//! the oracle. Fabricated content wearing a provenance tag reads, to a
//! size-based gate, exactly like a port.
//!
//! So this asks the complementary question: of the identifiers the legacy file
//! EXPORTS — its contract with the rest of the game — how many appear anywhere
//! in the Rust that claims it?
//!
//! ## What a score means, and what it does not
//!
//! Carryover is EVIDENCE, not proof, in both directions:
//!
//! - Low is a strong accusation. A port that renamed nothing scores near 1.0;
//!   the honest ports on this tree sit at 0.4–1.0. Zero, on a file with a real
//!   export list, means the two files are not about the same thing.
//! - High is NOT a clean bill of health. Copying the names and stubbing the
//!   bodies would score 1.0. That is what the depth gate and the parity fixtures
//!   are for. Three instruments, three different lies caught.
//!
//! Which is why this REPORTS and the ledger RATCHETS. A number that cannot be
//! wrong on its own does not get to fail a build by itself.
//!
//! PORTS-NOTHING — provenance tooling

use std::path::Path;

use crate::coverage;

/// Everything a legacy module offers the rest of the game, BY KIND.
///
/// Exports only. A private helper is an implementation detail the port is free
/// to organise differently; an export is a name something else calls, so it is
/// the part a 1:1 port has to answer for.
///
/// ## Why the kind matters — a false accusation, caught 2026-08-16
///
/// Scored over ALL exports, `entities/pinball-collide.ts` came out at 2 of 6 and
/// would have been downgraded. It is genuinely ported: `pinball.rs` is 1,032
/// lines against its 911, carrying `touch_pinball_parts` and `on_part_trigger`.
/// The four "missing" names were `PinballDeps` and `PartContact` — TypeScript
/// interfaces that become Rust function arguments and structs with other names —
/// and `PART_HANDLERS`, a `Record<Kind, Handler>` table that becomes a `match`.
/// Those shapes are SUPPOSED to change; a probe that demands they survive is
/// measuring the language, not the port.
///
/// Functions and constants are different. A ported function keeps its name
/// because the call sites are the same call sites, and a constant's name IS its
/// identity — `RENDER_W` renamed to `DESIGN_VIEWPORT_W` is not a translation,
/// it is a different value someone invented. So those two kinds are scored and
/// types/interfaces/classes are counted but not held against the port.
#[derive(PartialEq, Clone, Copy)]
enum Kind {
    /// Scored: a name the port has to answer for.
    Contract,
    /// Counted, not scored: shapes a port legitimately restructures.
    Shape,
}

fn exported_symbols(text: &str) -> Vec<(String, Kind)> {
    let mut out: Vec<(String, Kind)> = Vec::new();
    for raw in text.lines() {
        let t = raw.trim();
        let Some(rest) = t.strip_prefix("export ") else {
            continue;
        };
        let rest = rest.trim();
        let mut kind = Kind::Contract;
        let rest = [
            ("const ", Kind::Contract),
            ("function ", Kind::Contract),
            ("async function ", Kind::Contract),
            ("let ", Kind::Contract),
            ("var ", Kind::Contract),
            ("enum ", Kind::Shape),
            ("class ", Kind::Shape),
            ("abstract class ", Kind::Shape),
            ("interface ", Kind::Shape),
            ("type ", Kind::Shape),
        ]
        .iter()
        .find_map(|(kw, k)| {
            rest.strip_prefix(*kw).inspect(|_| {
                kind = *k;
            })
        })
        .unwrap_or(rest);
        let name: String = rest
            .trim_start_matches('*')
            .trim_start()
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$')
            .collect();
        if name.len() < 3 {
            continue;
        }
        // `export { a, b }` re-exports and `export default` name nothing new.
        if name == "default" || name == "from" {
            continue;
        }
        if !out.iter().any(|(n, _)| *n == name) {
            out.push((name, kind));
        }
    }
    out
}

/// Every spelling a Rust port might legitimately give a TS name.
///
/// `camelCase` → `camel_case`, `SCREAMING_SNAKE` unchanged, `PascalCase`
/// unchanged (Rust types keep it). Matching is case-insensitive on top of this,
/// so the list only has to cover WORD-BOUNDARY changes, not capitalisation.
/// A SECOND false accusation, caught 2026-08-16, and the rule it added.
///
/// `entities/marble.ts` scored 3 of 45 and looked fabricated. It is not: the
/// oracle's free functions `materialFrictionMult(m)` / `materialSteerMult(m)` are
/// METHODS on the material type in Rust — `mat.friction_mult()` — because a
/// method on `MarbleMaterial` does not need to repeat the word. Dropping a
/// redundant leading noun is the most ordinary move in a port, and a matcher that
/// cannot see it condemns the correct translation.
///
/// So a symbol of three or more snake segments also matches on its tail with the
/// first segment dropped. Two segments are left alone — `update_zombies` must
/// not match a bare `zombies`, which would be a substring dressed as a symbol.
fn candidates(sym: &str) -> Vec<String> {
    let mut snake = String::new();
    for (i, c) in sym.chars().enumerate() {
        if c.is_uppercase() && i > 0 && !snake.ends_with('_') {
            snake.push('_');
        }
        snake.push(c.to_ascii_lowercase());
    }
    let mut v = vec![sym.to_ascii_lowercase(), snake.clone()];
    if snake.matches('_').count() >= 2 {
        if let Some((_, tail)) = snake.split_once('_') {
            v.push(tail.to_string());
        }
    }
    v.sort();
    v.dedup();
    v
}

/// Which public functions of a port are called from anywhere but their own module.
///
/// ## The third shape of a lie, and the one that reaches the player
///
/// The depth gate catches a claim too small to be the file. Carryover catches a
/// claim about a different file. Neither catches the third, found on this tree
/// 2026-08-16: `crates/pk-core/src/marble.rs` is 448 lines, carries every one of
/// the oracle's per-material physics accessors — `friction_mult`, `steer_mult`,
/// `flat_restitution`, `lane_pull_mult`, `ram_damage_mult`, `max_speed`,
/// `bumper_scatter_mult` — and **not one of them is called anywhere outside that
/// file**. The six marble materials change the ball's tint and its label and
/// nothing else. A player picks up Lava and rolls exactly like Stone.
///
/// A port that is written but never wired passes every test written about the
/// port, because those tests call it directly. Only its ABSENCE from the game's
/// call graph gives it away.
///
/// Heuristic, and it says so: trait impls, generic dispatch and `pub use`
/// re-exports can call a function without naming it here. It reports; it does
/// not ratchet. A name it flags is a question to answer, not a verdict.
fn wiring_report(root: &Path, claims: &std::collections::BTreeMap<String, Vec<String>>) {
    let mut all_rs: Vec<std::path::PathBuf> = Vec::new();
    collect_rs_files(&root.join("crates"), &mut all_rs);
    let mut corpus: Vec<(String, String)> = Vec::new();
    for p in &all_rs {
        if let Ok(s) = std::fs::read_to_string(p) {
            corpus.push((p.to_string_lossy().to_string(), s));
        }
    }

    struct Dead {
        path: String,
        module: String,
        fns: Vec<String>,
        total: usize,
    }
    let mut dead: Vec<Dead> = Vec::new();

    for (path, modules) in claims {
        for m in modules {
            let Ok(src) = std::fs::read_to_string(root.join(m)) else {
                continue;
            };
            // Public functions this module offers. Methods included: `pub fn` in
            // an impl block is exactly the marble case.
            let mut fns: Vec<String> = Vec::new();
            for line in src.lines() {
                let t = line.trim();
                if let Some(rest) = t.strip_prefix("pub fn ").or_else(|| {
                    t.strip_prefix("pub(crate) fn ")
                        .or_else(|| t.strip_prefix("pub async fn "))
                }) {
                    let name: String = rest
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || *c == '_')
                        .collect();
                    // Constructors and trait-required names are called through
                    // shapes this cannot see; excluding them keeps the report
                    // about gameplay wiring rather than about Rust.
                    const AMBIENT: &[&str] = &[
                        "new", "default", "fmt", "clone", "from", "into", "drop", "eq", "hash",
                        "build", "run", "update", "as_str", "len", "is_empty", "iter", "next",
                    ];
                    if name.len() > 2 && !AMBIENT.contains(&name.as_str()) {
                        fns.push(name);
                    }
                }
            }
            if fns.len() < 3 {
                continue;
            }
            let called: Vec<&String> = fns
                .iter()
                .filter(|f| {
                    corpus.iter().any(|(file, text)| {
                        if file.ends_with(m.as_str()) {
                            return false;
                        }
                        // `tests/` are not the game calling the port.
                        if file.contains("/tests/") {
                            return false;
                        }
                        contains_word(text, f)
                    })
                })
                .collect();
            if called.is_empty() {
                dead.push(Dead {
                    path: path.clone(),
                    module: m.clone(),
                    fns: fns.iter().take(8).cloned().collect(),
                    total: fns.len(),
                });
            }
        }
    }

    println!("\n── INERT PORTS — implemented, and nothing in the game calls them ──");
    println!("   (heuristic: trait/generic/re-export call paths are invisible here.)");
    if dead.is_empty() {
        println!("   none");
        return;
    }
    dead.sort_by_key(|d| std::cmp::Reverse(d.total));
    for d in &dead {
        println!(
            "  {}  ({} public fns, 0 called outside it)\n      claims: {}\n      e.g. {}",
            d.module,
            d.total,
            d.path,
            d.fns.join(", ")
        );
    }
    println!("\n   {} inert module(s).", dead.len());
}

fn collect_rs_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            let n = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            if n == "target" {
                continue;
            }
            collect_rs_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

/// Does `hay` contain `needle` as a whole identifier (not inside a longer one)?
fn contains_word(hay: &str, needle: &str) -> bool {
    let bytes = hay.as_bytes();
    let mut from = 0;
    while let Some(i) = hay[from..].find(needle) {
        let s = from + i;
        let e = s + needle.len();
        let before_ok = s == 0 || !(bytes[s - 1].is_ascii_alphanumeric() || bytes[s - 1] == b'_');
        let after_ok =
            e >= bytes.len() || !(bytes[e].is_ascii_alphanumeric() || bytes[e] == b'_');
        if before_ok && after_ok {
            return true;
        }
        from = s + needle.len().max(1);
        if from >= hay.len() {
            break;
        }
    }
    false
}

struct Row {
    path: String,
    lines: usize,
    modules: Vec<String>,
    total: usize,
    matched: usize,
    missing: Vec<String>,
}

pub fn run(root: &Path, args: &[String]) -> std::process::ExitCode {
    // The SCORED view, not the declared view — see `coverage::credited`.
    let claims = coverage::credited(root);
    let mut rows: Vec<Row> = Vec::new();

    for (path, modules) in &claims {
        // Excluded painters and deferred subtrees are subtracted from the
        // target, so they carry no credit and cannot be "credited lines at
        // risk". Auditing them would inflate this report the same way the
        // ledger was inflated.
        if coverage::is_excluded(path).is_some() || coverage::is_deferred(path).is_some() {
            continue;
        }
        let Some(abs) = coverage::legacy_abs(root, path) else {
            continue;
        };
        let Ok(ts) = std::fs::read_to_string(&abs) else {
            continue;
        };
        let all = exported_symbols(&ts);
        // Only the CONTRACT kinds are scored — see `exported_symbols`.
        let syms: Vec<&String> = all
            .iter()
            .filter(|(_, k)| *k == Kind::Contract)
            .map(|(n, _)| n)
            .collect();
        if syms.is_empty() {
            continue;
        }
        let mut rust = String::new();
        for m in modules {
            if let Ok(s) = std::fs::read_to_string(root.join(m)) {
                rust.push_str(&s.to_ascii_lowercase());
                rust.push('\n');
            }
        }
        let mut matched = 0;
        let mut missing = Vec::new();
        for s in &syms {
            if candidates(s).iter().any(|c| contains_word(&rust, c)) {
                matched += 1;
            } else {
                missing.push((*s).clone());
            }
        }
        rows.push(Row {
            path: path.clone(),
            lines: ts.lines().count(),
            modules: modules.clone(),
            total: syms.len(),
            matched,
            missing,
        });
    }

    let json = args.iter().any(|a| a == "--json");
    let threshold: f64 = args
        .iter()
        .position(|a| a == "--min")
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.34);

    rows.sort_by(|a, b| {
        let fa = a.matched as f64 / a.total as f64;
        let fb = b.matched as f64 / b.total as f64;
        fa.partial_cmp(&fb)
            .unwrap()
            .then(b.lines.cmp(&a.lines))
    });

    if json {
        println!("{{\"claims\":[");
        for (i, r) in rows.iter().enumerate() {
            println!(
                "  {{\"path\":\"{}\",\"lines\":{},\"symbols\":{},\"matched\":{},\"carryover\":{:.4}}}{}",
                r.path,
                r.lines,
                r.total,
                r.matched,
                r.matched as f64 / r.total as f64,
                if i + 1 == rows.len() { "" } else { "," }
            );
        }
        println!("]}}");
        return std::process::ExitCode::SUCCESS;
    }

    println!("SYMBOL CARRYOVER — of each legacy file's exported names, how many appear");
    println!("in the Rust the ledger still CREDITS for it. Low = the claim is about another thing.");
    println!("High is not a pass: copied names over stubbed bodies also score high.\n");

    let zero: Vec<&Row> = rows.iter().filter(|r| r.matched == 0).collect();
    let zero_lines: usize = zero.iter().map(|r| r.lines).sum();
    println!(
        "ZERO CARRYOVER — {} file(s), {zero_lines} credited lines, not one exported name:",
        zero.len()
    );
    for r in &zero {
        println!(
            "  {:>6}  {}  ({} exports, none found)\n          claimed by: {}",
            r.lines,
            r.path,
            r.total,
            r.modules.join(", ")
        );
    }

    let low: Vec<&Row> = rows
        .iter()
        .filter(|r| r.matched > 0 && (r.matched as f64 / r.total as f64) < threshold)
        .collect();
    let low_lines: usize = low.iter().map(|r| r.lines).sum();
    println!(
        "\nTHIN — {} file(s), {low_lines} credited lines, under {:.0}% carryover:",
        low.len(),
        threshold * 100.0
    );
    for r in &low {
        println!(
            "  {:>6}  {:<48} {}/{} ({:.0}%)",
            r.lines,
            r.path,
            r.matched,
            r.total,
            100.0 * r.matched as f64 / r.total as f64
        );
        if args.iter().any(|a| a == "--verbose") {
            let show: Vec<&String> = r.missing.iter().take(12).collect();
            println!(
                "          missing: {}{}",
                show
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
                if r.missing.len() > 12 { ", …" } else { "" }
            );
        }
    }

    let ok = rows.len() - zero.len() - low.len();
    println!(
        "\n{} full-claim file(s) audited: {} zero, {} thin, {} at or above {:.0}%.",
        rows.len(),
        zero.len(),
        low.len(),
        ok,
        threshold * 100.0
    );
    println!("Total credited lines at risk: {}", zero_lines + low_lines);

    if args.iter().any(|a| a == "--wiring" || a == "--verbose") {
        wiring_report(root, &claims);
    }
    std::process::ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_are_read_in_every_shape_the_tree_uses() {
        let src = "export const RENDER_W = 640;\n\
                   export function stepTavernMovement(a) {}\n\
                   export type CameraZoom = 1 | 2;\n\
                   export interface Grid {}\n\
                   export class SpriteSheet {}\n\
                   const private_thing = 1;\n\
                   export default foo;\n";
        let got = exported_symbols(src);
        assert!(got.contains(&"RENDER_W".to_string()));
        assert!(got.contains(&"stepTavernMovement".to_string()));
        assert!(got.contains(&"CameraZoom".to_string()));
        assert!(got.contains(&"SpriteSheet".to_string()));
        assert!(
            !got.contains(&"private_thing".to_string()),
            "a non-exported binding is not part of the contract"
        );
        assert!(!got.contains(&"default".to_string()));
    }

    #[test]
    fn a_camel_case_export_is_found_in_its_snake_case_port() {
        let rust = "pub fn step_tavern_movement(s: &mut S) {}";
        assert!(candidates("stepTavernMovement")
            .iter()
            .any(|c| contains_word(rust, c)));
    }

    /// The live case this tool was built for: names that merely LOOK related
    /// must not count. `RENDER_W` is not carried by `DESIGN_VIEWPORT_W`.
    #[test]
    fn a_different_name_is_not_a_carryover() {
        let rust = "pub const DESIGN_VIEWPORT_W: f64 = 640.0;";
        assert!(!candidates("RENDER_W")
            .iter()
            .any(|c| contains_word(&rust.to_ascii_lowercase(), c)));
    }

    /// A word-boundary match, so `PPU` is not found inside `SUPPURATE`.
    #[test]
    fn a_substring_is_not_a_symbol() {
        assert!(!contains_word("let suppurate = 1;", "ppu"));
        assert!(contains_word("let ppu = 1;", "ppu"));
    }
}
