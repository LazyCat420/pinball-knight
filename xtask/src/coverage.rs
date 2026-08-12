//! THE PROVENANCE LEDGER — which legacy files are converted, and which are not.
//!
//! `scripts/pk-coverage.sh` answers the same question with two greps and is an
//! UPPER BOUND by construction (it says so). This is the exact version, and the
//! difference between them is not academic — measured 2026-08-12, the heuristic
//! scored the three largest unported gameplay files in the project as *covered*:
//!
//! | legacy file | lines | why the heuristic said "covered" |
//! |---|---:|---|
//! | `maze/decorate.ts` | 3,169 | the word `decorate` appears in a PROSE COMMENT at `track_floor.rs:77` |
//! | `entities/player.ts` | 2,445 | matched `tavern/player.rs` — a different player entirely |
//! | `maze/build.ts` | 1,834 | matched `pk-game/build.rs` and `pk-gui/build.rs`, Cargo BUILD SCRIPTS |
//!
//! A ledger that scores its biggest gap as done cannot be the thing that says
//! the port is finished. So this one reads DECLARATIONS, never substrings:
//!
//! - `//! PORTS: <path>` — this module is (part of) that legacy file's port.
//! - `//! PORTS-PARTIAL: <path> — <what is missing>` — some of it. The reason is
//!   REQUIRED, because "partial" without a remainder is just an unfinished
//!   claim, and the remainder is what the next person needs.
//! - `//! PORTS-NOTHING` — deliberately original (Bevy glue, shaders, xtask).
//!   Declared rather than inferred so a genuinely uncited port cannot hide in
//!   the same silence.
//!
//! Multiple paths per line are allowed, comma-separated and backtick-quoted;
//! several modules may cite the same legacy file (that IS the common case —
//! `economy/tavern-shop.ts` is split across five Rust modules).
//!
//! ## Exclusions are decisions, and they live in `EXCLUSIONS`
//!
//! Three sets of legacy files are never going to be ported and each was decided
//! on the record, not by an agent's judgement. Without an explicit exclusion
//! list the ledger's ceiling sits below 100% forever, and a ratchet against an
//! unreachable ceiling eventually blocks a legitimate merge. Every entry here
//! names the decision that made it.
//!
//! PORTS: `maze/decorate.ts`, `entities/player.ts`, `maze/build.ts`, `economy/tavern-shop.ts`
//!
//! PORTS-NOTHING — this ledger

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Legacy subtrees that are never ported, and the decision behind each.
///
/// A prefix match against the legacy-relative path. Keep the reason attached to
/// the rule: the whole point is that a reader can check the decision rather
/// than trust the list.
const EXCLUSIONS: &[(&str, &str)] = &[
    (
        "tools/",
        "the permanent art toolchain — runs in Node against ComfyUI and always will (docs/src/art/pipelines.md)",
    ),
    (
        "render/cel-painter.ts",
        "painters are RUN and their pixels shipped as PNGs, never re-implemented (docs/src/art/bake.md)",
    ),
    (
        "render/monsters/",
        "the same painter decision as cel-painter: FramePaint canvas code consumed by the bake, not transcribed",
    ),
    (
        "render/imported-paints.ts",
        "painter — consumed by the bake (see render/monsters/)",
    ),
    (
        "testkit/",
        "test-only harness over cel-painter; `testkit-boundary.test.ts` enforces it is unreachable from client code",
    ),
];

/// A citation found in a Rust module's header.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Claim {
    /// Fully ported here.
    Ports,
    /// Partly ported here, with the stated remainder.
    Partial(String),
}

#[derive(Debug, Default)]
struct Ledger {
    /// legacy path -> (rust file, claim)
    claims: BTreeMap<String, Vec<(String, Claim)>>,
    /// Rust files declaring themselves original.
    nothing: Vec<String>,
    /// Rust files with no declaration at all — the work list for this tool.
    undeclared: Vec<String>,
}

/// Pull every backtick-quoted `*.ts` path out of a `PORTS`/`PORTS-PARTIAL` line.
///
/// Paths are normalised to be relative to the PK tree, so
/// `legacy/src/game/pinball-knight/engine/collision.ts`, `engine/collision.ts`
/// and `src/game/pinball-knight/engine/collision.ts` are one file — the headers
/// use all three spellings today.
fn paths_in(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(a) = rest.find('`') {
        let after = &rest[a + 1..];
        let Some(b) = after.find('`') else { break };
        let inner = &after[..b];
        // A citation may carry a symbol after the path (`items.ts` gear block).
        let first = inner.split_whitespace().next().unwrap_or(inner);
        if let Some(p) = normalise(first) {
            out.push(p);
        }
        rest = &after[b + 1..];
    }
    out
}

/// Normalise one cited path to PK-tree-relative, or `None` if it is not a `.ts`.
fn normalise(raw: &str) -> Option<String> {
    let mut p = raw.trim().trim_matches(|c| c == ',' || c == ':');
    // A citation may pin a line range — `core.ts:467-476`. The file is the
    // claim; the range is a courtesy to the reader.
    if let Some(colon) = p.rfind(':') {
        let tail = &p[colon + 1..];
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit() || c == '-') {
            p = &p[..colon];
        }
    }
    if !p.ends_with(".ts") {
        return None;
    }
    for prefix in [
        "legacy/src/game/pinball-knight/",
        "src/game/pinball-knight/",
        "game/pinball-knight/",
    ] {
        if let Some(stripped) = p.strip_prefix(prefix) {
            return Some(stripped.to_string());
        }
    }
    // A path outside the PK tree (e.g. `legacy/src/scenes/tavern/...`) is a real
    // citation but not part of the 1:1 surface — keep it, flagged by its prefix.
    Some(p.to_string())
}

fn is_excluded(path: &str) -> Option<&'static str> {
    EXCLUSIONS
        .iter()
        .find(|(prefix, _)| path.starts_with(prefix))
        .map(|(_, why)| *why)
}

/// Join a wrapped `PORTS`/`PORTS-PARTIAL` declaration onto one line.
///
/// A continuation is a `//!` line whose content starts with a backtick — i.e.
/// it carries only more paths. Anything else ends the declaration, so ordinary
/// prose beneath it is never swallowed into the claim.
fn join_wrapped(text: &str) -> String {
    let mut out = String::new();
    let mut open = false;
    for line in text.lines() {
        let t = line.trim();
        let body = t
            .strip_prefix("//!")
            .or_else(|| t.strip_prefix("//"))
            .map(str::trim)
            .unwrap_or("");
        let is_decl = body.starts_with("PORTS:") || body.starts_with("PORTS-PARTIAL:");
        if open && t.starts_with("//") && body.starts_with('`') {
            out.push(' ');
            out.push_str(body);
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(line);
        open = is_decl;
    }
    out
}

/// Walk `crates/*/src` and `xtask/src`, reading each file's header block.
fn scan_rust(root: &Path) -> Ledger {
    let mut led = Ledger::default();
    let mut files = Vec::new();
    for dir in ["crates", "xtask"] {
        collect_rs(&root.join(dir), &mut files);
    }
    files.sort();
    for f in files {
        let rel = f
            .strip_prefix(root)
            .unwrap_or(&f)
            .to_string_lossy()
            .to_string();
        // The ledger's OWN source documents the bug it exists to catch, and that
        // documentation names `maze/decorate.ts` in backticks. Reading itself,
        // it would file that as a port — the precise failure it is built to
        // prevent, one level up. Skipped by path, and `PORTS-NOTHING` in its
        // header keeps it out of the undeclared list.
        if rel.ends_with("xtask/src/coverage.rs") {
            led.nothing.push(rel);
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&f) else {
            continue;
        };
        let mut declared = false;
        // A declaration may WRAP: the continuation lines are `//!` comments that
        // carry only more backticked paths. Joining the header into one blob per
        // declaration is what makes `//! PORTS: `a.ts`,\n//! `b.ts`` read as two
        // paths instead of one — the shape three modules already use.
        let text = join_wrapped(&text);
        for line in text.lines() {
            let t = line.trim();
            // Header block only: `//!`. A `//` comment deep in the file is prose
            // about a legacy file, not a claim to have ported it — which is
            // exactly the confusion that scored `decorate.ts` as covered.
            // `//!` normally, but a file pulled in with `include!` (e.g.
            // `cards_catalogue.rs` into `cards.rs`) CANNOT carry an inner doc
            // comment at all — rustc rejects it. Those headers are `//`, so a
            // declaration is read from either form.
            if !t.starts_with("//") {
                // Stop at the first non-comment, non-blank line: past the header.
                if !t.is_empty() && !t.starts_with("#!") {
                    break;
                }
                continue;
            }
            let body = t.trim_start_matches("//!").trim_start_matches("//").trim();
            if let Some(rest) = body.strip_prefix("PORTS-PARTIAL:") {
                declared = true;
                let why = rest
                    .split('—')
                    .nth(1)
                    .or_else(|| rest.split(" - ").nth(1))
                    .unwrap_or("")
                    .trim()
                    .to_string();
                for p in paths_in(rest) {
                    led.claims
                        .entry(p)
                        .or_default()
                        .push((rel.clone(), Claim::Partial(why.clone())));
                }
            } else if let Some(rest) = body.strip_prefix("PORTS:") {
                declared = true;
                for p in paths_in(rest) {
                    led.claims
                        .entry(p)
                        .or_default()
                        .push((rel.clone(), Claim::Ports));
                }
            } else if body.starts_with("PORTS-NOTHING") {
                declared = true;
                led.nothing.push(rel.clone());
            }
        }
        if !declared {
            led.undeclared.push(rel);
        }
    }
    led
}

fn collect_rs(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            // `tests/` and `examples/` are gates and demos, not ports.
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            if name == "target" || name == "tests" || name == "examples" {
                continue;
            }
            collect_rs(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

/// Every non-test `.ts` in the PK tree, with its line count.
fn scan_legacy(root: &Path) -> BTreeMap<String, usize> {
    let base = root.join("legacy/src/game/pinball-knight");
    let mut out = BTreeMap::new();
    let mut files = Vec::new();
    collect_ts(&base, &mut files);
    for f in files {
        let rel = f
            .strip_prefix(&base)
            .unwrap_or(&f)
            .to_string_lossy()
            .to_string();
        if rel.ends_with(".test.ts") || rel.ends_with(".d.ts") {
            continue;
        }
        let n = std::fs::read_to_string(&f)
            .map(|s| s.lines().count())
            .unwrap_or(0);
        out.insert(rel, n);
    }
    out
}

fn collect_ts(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            if name == "node_modules" {
                continue;
            }
            collect_ts(&p, out);
        } else if p.extension().is_some_and(|x| x == "ts") {
            out.push(p);
        }
    }
}

pub fn run(root: &Path, args: &[String]) -> std::process::ExitCode {
    let led = scan_rust(root);
    let legacy = scan_legacy(root);

    let mut ported: Vec<(&String, usize)> = Vec::new();
    let mut partial: Vec<(&String, usize, String)> = Vec::new();
    let mut todo: Vec<(&String, usize)> = Vec::new();
    let mut excluded: Vec<(&String, usize, &str)> = Vec::new();

    for (path, lines) in &legacy {
        if let Some(why) = is_excluded(path) {
            excluded.push((path, *lines, why));
            continue;
        }
        match led.claims.get(path) {
            None => todo.push((path, *lines)),
            Some(claims) => {
                // A file is PARTIAL if any module says so and none says whole.
                let whole = claims.iter().any(|(_, c)| *c == Claim::Ports);
                if whole {
                    ported.push((path, *lines));
                } else {
                    let why = claims
                        .iter()
                        .filter_map(|(_, c)| match c {
                            Claim::Partial(w) => Some(w.clone()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("; ");
                    partial.push((path, *lines, why));
                }
            }
        }
    }

    let sum = |v: &Vec<(&String, usize)>| v.iter().map(|(_, n)| n).sum::<usize>();
    let total: usize = legacy.values().sum();
    let ex_lines: usize = excluded.iter().map(|(_, n, _)| n).sum();
    let part_lines: usize = partial.iter().map(|(_, n, _)| n).sum();
    let target = total - ex_lines;

    println!("PROVENANCE LEDGER — declared ports, not substring matches\n");
    println!(
        "legacy PK tree     {total:>7} lines, {} files",
        legacy.len()
    );
    println!(
        "excluded           {ex_lines:>7} lines, {} files  (decisions, see EXCLUSIONS)",
        excluded.len()
    );
    println!("1:1 TARGET         {target:>7} lines\n");
    println!(
        "  ported           {:>7} lines, {} files",
        sum(&ported),
        ported.len()
    );
    println!(
        "  partial          {part_lines:>7} lines, {} files",
        partial.len()
    );
    println!(
        "  NOT STARTED      {:>7} lines, {} files",
        sum(&todo),
        todo.len()
    );
    let done = sum(&ported);
    println!(
        "\n  converted        {:.1}%  (ported / target; partial counts as NOT done)",
        100.0 * done as f64 / target as f64
    );

    if args.iter().any(|a| a == "--by-dir" || a == "--verbose") {
        // Per-DIRECTORY remainder. The plan pages decompose the work by legacy
        // directory (`render/`, `entities/`, …) and until now that table was
        // re-derived by hand from `pk-coverage.sh` — the heuristic this tool
        // exists to replace. A track table sourced from the upper bound and a
        // total sourced from the ledger cannot reconcile, and the difference
        // reads as an arithmetic error rather than as two different instruments.
        let mut by_dir: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
        for (p, n) in &todo {
            let dir = match p.find('/') {
                Some(i) => &p[..i],
                None => "(root)",
            };
            let e = by_dir.entry(dir).or_insert((0, 0));
            e.0 += n;
            e.1 += 1;
        }
        let mut rows: Vec<_> = by_dir.into_iter().collect();
        rows.sort_by_key(|(_, (n, _))| std::cmp::Reverse(*n));
        println!("\n── NOT STARTED by legacy directory ──");
        for (dir, (n, files)) in &rows {
            println!("  {n:>6}  {dir:<12} ({files} files)");
        }
    }

    if args.iter().any(|a| a == "--todo" || a == "--verbose") {
        todo.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        // `--todo` used to print the top 40 of 210 with no note, which reads as
        // a complete work list. The cap stays (the tail is one-liners) but it
        // now says what it withheld and how to see the rest.
        let cap = if args.iter().any(|a| a == "--all") {
            todo.len()
        } else {
            40
        };
        println!("\n── NOT STARTED, largest first ──");
        for (p, n) in todo.iter().take(cap) {
            println!("  {n:>6}  {p}");
        }
        if todo.len() > cap {
            let rest: usize = todo.iter().skip(cap).map(|(_, n)| n).sum();
            println!(
                "  … and {} more files, {rest} lines (`--all` for every one)",
                todo.len() - cap
            );
        }
        if !partial.is_empty() {
            println!("\n── PARTIAL — what is missing ──");
            partial.sort_by_key(|(_, n, _)| std::cmp::Reverse(*n));
            for (p, n, why) in &partial {
                println!("  {n:>6}  {p}\n          missing: {why}");
            }
        }
    }

    if args.iter().any(|a| a == "--undeclared" || a == "--verbose") {
        println!(
            "\n── Rust modules with NO provenance declaration ({}) ──",
            led.undeclared.len()
        );
        println!("  Each needs `//! PORTS:`, `//! PORTS-PARTIAL:` or `//! PORTS-NOTHING`.");
        for f in &led.undeclared {
            println!("  {f}");
        }
    }

    // A citation that resolves to no legacy file is a typo or a stale path, and
    // it silently inflates the ported count — so it is an ERROR, not a note.
    let mut dangling: Vec<&String> = led
        .claims
        .keys()
        .filter(|p| !legacy.contains_key(*p) && is_excluded(p).is_none())
        .filter(|p| !p.starts_with("legacy/") && !p.starts_with("src/"))
        .collect();
    dangling.sort();
    if !dangling.is_empty() {
        println!("\n⚠️  {} citation(s) name no legacy file:", dangling.len());
        for d in &dangling {
            println!("  {d}");
        }
        return std::process::ExitCode::FAILURE;
    }

    std::process::ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The parser reads a path out of every citation shape the tree uses today.
    #[test]
    fn every_citation_spelling_resolves_to_one_path() {
        let want = "engine/collision.ts";
        for line in [
            " `legacy/src/game/pinball-knight/engine/collision.ts`",
            " `src/game/pinball-knight/engine/collision.ts`",
            " `engine/collision.ts`",
            " `engine/collision.ts` (the whole file)",
        ] {
            assert_eq!(paths_in(line), vec![want.to_string()], "line: {line}");
        }
    }

    /// A citation may carry a symbol after the path, and several may share a line.
    #[test]
    fn a_citation_may_name_symbols_and_share_its_line() {
        let got = paths_in(" `economy/tavern-shop.ts` (`POTION_STOCK`), `items.ts` gear block");
        assert_eq!(got, vec!["economy/tavern-shop.ts", "items.ts"]);
    }

    /// Non-`.ts` backticks are prose, not provenance.
    /// A citation may pin a line range; the FILE is the claim.
    #[test]
    fn a_line_range_suffix_still_resolves_to_the_file() {
        assert_eq!(
            paths_in(" `legacy/src/scenes/tavern/core.ts:467-476`"),
            vec!["legacy/src/scenes/tavern/core.ts".to_string()]
        );
        assert_eq!(
            paths_in(" `gui/screens/tavern.ts:372`"),
            vec!["gui/screens/tavern.ts"]
        );
    }

    #[test]
    fn backticked_prose_is_not_a_citation() {
        assert!(paths_in(" the `onPass` seam and `PASSES_LANDED`").is_empty());
        assert!(paths_in(" no `T_CRACKED` tile exists before `decorate`").is_empty());
    }

    /// THE REGRESSION THIS TOOL EXISTS FOR.
    ///
    /// `track_floor.rs:77` says "no `T_CRACKED` tile exists before `decorate`".
    /// The shell heuristic reads that as a port of `maze/decorate.ts` — 3,169
    /// lines, none of them written. A declaration-based ledger cannot.
    #[test]
    fn a_prose_mention_of_decorate_is_not_a_port_of_decorate() {
        let prose = "//! `reach = 0`, and no `T_CRACKED` tile exists before `decorate`. Four more";
        assert!(
            paths_in(prose).is_empty(),
            "prose about decorate must not claim maze/decorate.ts"
        );
    }

    /// A wrapped declaration is ONE claim over every path it names.
    #[test]
    fn a_wrapped_declaration_keeps_all_its_paths() {
        let src = "//! PORTS: `a/one.ts`, `a/two.ts`,\n//! `a/three.ts`\n//! and then prose about `b/four.ts`.\n";
        let joined = join_wrapped(src);
        let decl = joined
            .lines()
            .find(|l| l.contains("PORTS:"))
            .expect("declaration survives");
        let got = paths_in(decl);
        assert_eq!(got, vec!["a/one.ts", "a/two.ts", "a/three.ts"]);
        assert!(
            !got.contains(&"b/four.ts".to_string()),
            "prose under a declaration is not part of the claim"
        );
    }

    /// THE THREE FILES THE HEURISTIC GOT WRONG, pinned against the real tree.
    ///
    /// `scripts/pk-coverage.sh` scores all three as covered. This asserts the
    /// ledger does not — and it reads the actual workspace, so it fails the day
    /// someone writes a `PORTS:` claim for a file that is not really ported.
    #[test]
    fn the_biggest_gaps_are_reported_as_gaps() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root");
        let led = scan_rust(root);
        for (path, lines) in [("maze/decorate.ts", 3169), ("entities/player.ts", 2445)] {
            let claims = led.claims.get(path);
            assert!(
                claims.is_none(),
                "{path} ({lines} lines) is claimed by {claims:?} — if that port is \
                 real, delete this row; if it is not, the claim is false"
            );
        }
        // `maze/build.ts` IS partly ported (textures + geometry) and must be
        // declared PARTIAL by every claimant — never whole.
        let build = led
            .claims
            .get("maze/build.ts")
            .expect("build.ts is claimed");
        for (module, claim) in build {
            assert!(
                matches!(claim, Claim::Partial(_)),
                "{module} claims maze/build.ts WHOLE; ~700 of its 1,834 lines are \
                 excluded painters and the architecture pass is unported"
            );
        }
    }

    /// An `include!`d file cannot carry `//!` — rustc rejects it outright — so
    /// its header is `//` and a declaration must still be read from it.
    /// `cards_catalogue.rs` is include!d into `cards.rs` and is the live case.
    #[test]
    fn a_plain_comment_header_still_declares() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root");
        let led = scan_rust(root);
        assert!(
            !led.undeclared
                .iter()
                .any(|f| f.ends_with("cards_catalogue.rs")),
            "cards_catalogue.rs declares `// PORTS: `cards.ts`` and must be seen"
        );
    }

    #[test]
    fn exclusions_match_by_prefix_and_carry_a_reason() {
        assert!(is_excluded("render/cel-painter.ts").is_some());
        assert!(is_excluded("render/monsters/stiltneck.ts").is_some());
        assert!(is_excluded("tools/sprite-forge/commit.ts").is_some());
        assert!(is_excluded("maze/decorate.ts").is_none());
        for (_, why) in EXCLUSIONS {
            assert!(why.len() > 20, "every exclusion states its decision");
        }
    }
}
