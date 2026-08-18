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

/// Tier-2 subtrees whose port is DEFERRED past cutover, and the decision behind
/// each.
///
/// Deliberately a separate list from `EXCLUSIONS`, because the two say different
/// things and printing them the same way is how a gap hides. An exclusion is
/// "this will never be ported, and here is why". A deferral is "this WILL be
/// ported, after parity, and until then it is subtracted from the target and
/// named on screen". Neither is "nobody has looked at it" — that is what NOT
/// STARTED is for, and the whole point of tier 2 is that ~7.5k lines of the
/// running game used to be in none of the three.
const DEFERRED: &[(&str, &str)] = &[
    (
        "legacy/src/net/",
        "multiplayer/co-op is P8, post-parity — a cutover decision point, not a parity blocker",
    ),
    (
        "legacy/src/services/",
        "leaderboard/backend services are P8, post-parity (they need the deploy target, which cutover provides)",
    ),
];

/// A citation found in a Rust module's header.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Claim {
    /// Fully ported here.
    Ports,
    /// Partly ported here, with the stated remainder.
    Partial(String),
    /// This module INVENTED content and attributed it to that legacy file.
    ///
    /// A third kind, added 2026-08-16, because the other two both lie about
    /// this case. `PORTS-PARTIAL` says "some of it is done"; nothing is done —
    /// `constants/level.rs` invented `BOSS_FLOORS = [5,10,15]` where the oracle
    /// boss-gates EVERY floor, and `run/death.rs` invented a "souls" currency
    /// and "tombstones" for a game that has gold and corpse piles.
    /// `PORTS-NOTHING` says "deliberately original", which is what honest Bevy
    /// glue is and this is not.
    ///
    /// It claims NOTHING, so the legacy file reads NOT STARTED — the true
    /// statement, and the one that puts it back on the work list — while the
    /// module stays declared, greppable, and carrying what it made up.
    Fabricated(String),
}

#[derive(Debug, Default)]
struct Ledger {
    /// legacy path -> (rust file, claim)
    claims: BTreeMap<String, Vec<(String, Claim)>>,
    /// Rust files declaring themselves original.
    nothing: Vec<String>,
    /// Rust files with no declaration at all — the work list for this tool.
    undeclared: Vec<String>,
    /// rust file -> its CODE lines (no comments, no blanks).
    ///
    /// The ledger's credit is denominated in the legacy file's size and never
    /// looked at the claiming module at all, so a one-line module could bank a
    /// three-thousand-line file. This is the other half of the comparison.
    rust_code: BTreeMap<String, usize>,
}

/// A full claim's DEPTH: how much Rust actually stands behind the credit.
#[derive(Debug, Clone, Copy, Default)]
struct Depth {
    /// Rust code lines attributed to this legacy file (see `depth_of`).
    rust: usize,
    /// The legacy file's own code lines — code compared with code.
    legacy: usize,
}

impl Depth {
    fn ratio(&self) -> f64 {
        if self.legacy == 0 {
            return 1.0;
        }
        self.rust as f64 / self.legacy as f64
    }
}

/// A full claim below this ratio is not a port; it is a placeholder wearing a
/// provenance tag.
///
/// Rust is normally LONGER than the TypeScript it replaces (explicit types,
/// no closures over ambient state), so a genuine port lands near or above 1.0.
/// Measured on this tree 2026-08-16: the honest pre-08-13 ports sit at 0.6–2.4,
/// and every module in the 08-14 declaration burst that this catches is under
/// 0.15. The threshold is deliberately far below the honest floor — it is a
/// fraud detector, not a style rule.
const DEPTH_MIN_RATIO: f64 = 0.30;

/// Lines of actual code — comments and blanks removed.
///
/// Both languages, one function: `//`, `/* */` and `*` continuation lines cover
/// TS and Rust alike, and `//!`/`///` are just `//`. Crude on purpose — it is a
/// size comparison, not a parser, and it must not disagree with itself between
/// the two sides of the ratio.
fn code_lines(text: &str) -> usize {
    let mut n = 0;
    let mut in_block = false;
    for raw in text.lines() {
        let t = raw.trim();
        if in_block {
            if t.contains("*/") {
                in_block = false;
            }
            continue;
        }
        if t.is_empty() || t.starts_with("//") || t.starts_with('*') {
            continue;
        }
        if t.starts_with("/*") {
            if !t.contains("*/") {
                in_block = true;
            }
            continue;
        }
        n += 1;
    }
    n
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
    // A path outside the PK tree (e.g. `legacy/src/scenes/tavern/...`) is a TIER 2
    // citation — the game loads it, so it is part of the finish line, just not of
    // the 1:1 surface. Normalise the one other spelling it could take, so tier 2
    // is keyed as consistently as tier 1 is.
    if p.starts_with("src/") {
        return Some(format!("legacy/{p}"));
    }
    Some(p.to_string())
}

pub fn is_excluded(path: &str) -> Option<&'static str> {
    EXCLUSIONS
        .iter()
        .find(|(prefix, _)| path.starts_with(prefix))
        .map(|(_, why)| *why)
}

pub fn is_deferred(path: &str) -> Option<&'static str> {
    DEFERRED
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
        led.rust_code.insert(rel.clone(), code_lines(&text));
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
            if let Some(rest) = body.strip_prefix("PORTS-FABRICATED:") {
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
                        .push((rel.clone(), Claim::Fabricated(why.clone())));
                }
            } else if let Some(rest) = body.strip_prefix("PORTS-PARTIAL:") {
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

/// Every non-test `.ts` in `legacy/src` OUTSIDE the PK tree, with its line count.
///
/// ## Why this exists
///
/// `scan_legacy` walks `legacy/src/game/pinball-knight` and nothing else, so for
/// the tool's whole life the denominator has been the PK tree alone. But the
/// cutover condition is *"the ledger reads 100%"*, and the game does not boot on
/// the PK tree alone: it loads `utils/audio-manager.ts`, `pixel/`, the tavern
/// scene glue and the gambler's art and audio out of `legacy/src/` siblings.
/// Measured 2026-08-12: **15,430 non-test lines**, of which ~7,500 were cited by
/// no Rust module and counted by no bucket. A blind spot in the denominator is a
/// finish line in the wrong place.
///
/// Kept as a SEPARATE tier rather than merged into one percentage, because
/// merging would silently move the headline number and make every figure
/// recorded before today incomparable with every figure after it.
fn scan_siblings(root: &Path) -> BTreeMap<String, usize> {
    let base = root.join("legacy/src");
    let pk = base.join("game");
    let mut out = BTreeMap::new();
    let mut files = Vec::new();
    collect_ts(&base, &mut files);
    for f in files {
        if f.starts_with(&pk) {
            continue;
        }
        let rel = f
            .strip_prefix(root)
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

/// Every legacy file's CODE lines, keyed exactly as the two scanners key them.
///
/// Separate from `scan_legacy`/`scan_siblings` on purpose: those return TOTAL
/// lines and the headline denominators (104,309 / 88,312 / 15,430) are recorded
/// against them. Changing what they count would move every number ever recorded
/// and make the ratchet incomparable with its own history — a different ruler.
/// The depth ratio needs code-to-code, so it gets its own map and the credit
/// accounting is left alone.
fn legacy_code_lines(root: &Path) -> BTreeMap<String, usize> {
    let mut out = BTreeMap::new();
    let pk_base = root.join("legacy/src/game/pinball-knight");
    let mut files = Vec::new();
    collect_ts(&pk_base, &mut files);
    for f in &files {
        let rel = f
            .strip_prefix(&pk_base)
            .unwrap_or(f)
            .to_string_lossy()
            .to_string();
        if rel.ends_with(".test.ts") || rel.ends_with(".d.ts") {
            continue;
        }
        if let Ok(s) = std::fs::read_to_string(f) {
            out.insert(rel, code_lines(&s));
        }
    }
    let base = root.join("legacy/src");
    let pk = base.join("game");
    let mut sibs = Vec::new();
    collect_ts(&base, &mut sibs);
    for f in &sibs {
        if f.starts_with(&pk) {
            continue;
        }
        let rel = f
            .strip_prefix(root)
            .unwrap_or(f)
            .to_string_lossy()
            .to_string();
        if rel.ends_with(".test.ts") || rel.ends_with(".d.ts") {
            continue;
        }
        if let Ok(s) = std::fs::read_to_string(f) {
            out.insert(rel, code_lines(&s));
        }
    }
    out
}

/// How much Rust stands behind every FULL claim, apportioned honestly.
///
/// A module that claims three legacy files does not port all three with the same
/// lines, so its code is split across the files it claims IN PROPORTION to their
/// sizes — the neutral assumption when the module does not say. Several modules
/// claiming one file SUM, which is the common and legitimate shape
/// (`economy/tavern-shop.ts` is split across five modules by design).
///
/// PARTIAL claims are deliberately excluded from the numerator: a partial file
/// is already scored as not-done, so its depth is not a question anyone asks.
fn depth_map(led: &Ledger, code: &BTreeMap<String, usize>) -> BTreeMap<String, Depth> {
    // rust module -> the full claims it makes, so a multi-file claim can split.
    let mut by_module: BTreeMap<&String, Vec<&String>> = BTreeMap::new();
    for (path, claims) in &led.claims {
        for (module, claim) in claims {
            if *claim == Claim::Ports {
                by_module.entry(module).or_default().push(path);
            }
        }
    }
    let mut out: BTreeMap<String, Depth> = BTreeMap::new();
    for (module, paths) in &by_module {
        let rust = *led.rust_code.get(*module).unwrap_or(&0);
        let total: usize = paths.iter().map(|p| *code.get(*p).unwrap_or(&0)).sum();
        for p in paths {
            let share = if total == 0 {
                rust as f64 / paths.len() as f64
            } else {
                rust as f64 * (*code.get(*p).unwrap_or(&0) as f64 / total as f64)
            };
            let e = out.entry((*p).clone()).or_default();
            e.rust += share.round() as usize;
            e.legacy = *code.get(*p).unwrap_or(&0);
        }
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

/// One tier's files, sorted into the four buckets.
#[derive(Default)]
struct Tier<'a> {
    ported: Vec<(&'a String, usize)>,
    partial: Vec<(&'a String, usize, String)>,
    todo: Vec<(&'a String, usize)>,
    /// Subtracted from the target, with the decision that subtracted it.
    subtracted: Vec<(&'a String, usize, &'static str)>,
    /// Full claims demoted by the depth gate: (path, lines, rust, legacy code).
    ///
    /// Reported as its own section rather than folded into `partial`, because
    /// "somebody wrote down what is missing" and "the tool caught a claim that
    /// nothing stands behind" are different facts and must not print the same.
    shallow: Vec<(&'a String, usize, usize, usize)>,
    /// Files carrying BOTH a full and a partial claim — two modules disagree.
    conflicted: Vec<(&'a String, usize)>,
    /// Files whose only claimants declared themselves fabrications.
    fabricated: Vec<(&'a String, usize)>,
}

impl Tier<'_> {
    fn total(&self) -> usize {
        self.ported_lines() + self.partial_lines() + self.todo_lines() + self.subtracted_lines()
    }
    fn ported_lines(&self) -> usize {
        self.ported.iter().map(|(_, n)| n).sum()
    }
    fn partial_lines(&self) -> usize {
        self.partial.iter().map(|(_, n, _)| n).sum()
    }
    fn todo_lines(&self) -> usize {
        self.todo.iter().map(|(_, n)| n).sum()
    }
    fn subtracted_lines(&self) -> usize {
        self.subtracted.iter().map(|(_, n, _)| n).sum()
    }
    fn target(&self) -> usize {
        self.total() - self.subtracted_lines()
    }
    fn pct(&self) -> f64 {
        if self.target() == 0 {
            return 100.0;
        }
        100.0 * self.ported_lines() as f64 / self.target() as f64
    }
}

/// Sort one legacy tree into buckets against the claims.
///
/// `subtract` is the tier's own reason a file is not part of its target —
/// `is_excluded` for tier 1 (never ported, by decision), `is_deferred` for
/// tier 2 (ported after cutover, by decision).
fn classify<'a>(
    legacy: &'a BTreeMap<String, usize>,
    led: &Ledger,
    subtract: fn(&str) -> Option<&'static str>,
    depth: &BTreeMap<String, Depth>,
) -> Tier<'a> {
    let mut t = Tier::default();
    for (path, lines) in legacy {
        if let Some(why) = subtract(path) {
            t.subtracted.push((path, *lines, why));
            continue;
        }
        let Some(claims) = led.claims.get(path) else {
            t.todo.push((path, *lines));
            continue;
        };
        // A fabrication contributes nothing in either direction. If EVERY
        // claimant invented, the file has not been started.
        let real: Vec<&(String, Claim)> = claims
            .iter()
            .filter(|(_, c)| !matches!(c, Claim::Fabricated(_)))
            .collect();
        if real.is_empty() {
            t.fabricated.push((path, *lines));
            t.todo.push((path, *lines));
            continue;
        }
        let any_whole = claims.iter().any(|(_, c)| *c == Claim::Ports);
        let any_partial = claims.iter().any(|(_, c)| matches!(c, Claim::Partial(_)));
        let reasons = |claims: &Vec<(String, Claim)>| {
            claims
                .iter()
                .filter_map(|(_, c)| match c {
                    Claim::Partial(w) => Some(w.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("; ")
        };

        // ⚠️ THE HOLE THIS USED TO HAVE — measured 2026-08-16.
        //
        // The rule was `whole = claims.iter().any(is Ports)`: ONE full claim
        // outvoted every honest `PORTS-PARTIAL` on the same file. So a module
        // that ported ten lines of a 3,169-line file and said so was silently
        // overruled by a sibling that claimed the file whole, and the file was
        // credited in full. A remainder someone took the trouble to write down
        // is evidence; a claim is an assertion. Evidence wins: ALL claimants
        // must say whole, or the file is partial.
        if any_partial {
            if any_whole {
                t.conflicted.push((path, *lines));
            }
            t.partial.push((path, *lines, reasons(claims)));
            continue;
        }

        // THE DEPTH GATE. Credit is denominated in the LEGACY file's size, and
        // until today nothing looked at the module doing the claiming — so a
        // 49-line stub banked a 906-line file, and 67,370 lines were credited
        // to modules that do not implement them. A claim now has to be big
        // enough to plausibly BE the thing it claims.
        let d = depth.get(path).copied().unwrap_or_default();
        if d.ratio() < DEPTH_MIN_RATIO {
            t.shallow.push((path, *lines, d.rust, d.legacy));
            t.partial.push((
                path,
                *lines,
                format!(
                    "shallow claim: {} rust code lines against {} legacy code lines \
                     ({:.0}% — the gate is {:.0}%); nothing this small ports that file",
                    d.rust,
                    d.legacy,
                    d.ratio() * 100.0,
                    DEPTH_MIN_RATIO * 100.0
                ),
            ));
            continue;
        }
        t.ported.push((path, *lines));
    }
    t
}

/// The files the ledger STILL CREDITS after the depth gate, and who claims them.
///
/// `full_claims` is the declaration view — what modules assert. This is the
/// scored view — what the ledger actually pays for. The audit reads this one, so
/// the two instruments compose instead of double-counting: a file the depth gate
/// already demoted is already scored as not-done, and reporting it a second time
/// as "credit at risk" would inflate the alarm the same way the credit was
/// inflated.
pub fn credited(root: &Path) -> BTreeMap<String, Vec<String>> {
    let led = scan_rust(root);
    let legacy = scan_legacy(root);
    let siblings = scan_siblings(root);
    let code = legacy_code_lines(root);
    let depth = depth_map(&led, &code);
    let t1 = classify(&legacy, &led, is_excluded, &depth);
    let t2 = classify(&siblings, &led, is_deferred, &depth);
    let mut out = BTreeMap::new();
    for (path, _) in t1.ported.iter().chain(t2.ported.iter()) {
        let mods: Vec<String> = led
            .claims
            .get(*path)
            .map(|cs| cs.iter().map(|(m, _)| m.clone()).collect())
            .unwrap_or_default();
        out.insert((*path).clone(), mods);
    }
    out
}

/// Resolve a normalised citation back to a file on disk.
///
/// Tier-1 paths are PK-tree-relative (`constants/render.ts`); tier-2 paths carry
/// their `legacy/src/` prefix. `normalise` produced both spellings, so undoing
/// it needs both.
pub fn legacy_abs(root: &Path, path: &str) -> Option<PathBuf> {
    let direct = root.join(path);
    if direct.is_file() {
        return Some(direct);
    }
    let pk = root.join("legacy/src/game/pinball-knight").join(path);
    if pk.is_file() {
        return Some(pk);
    }
    None
}

/// Every citation that resolves to no legacy file, in any tier.
///
/// Computed once and shared, so the `--json` leg and the human leg cannot
/// disagree about whether a run was clean.
fn dangling_in<'a>(
    led: &'a Ledger,
    legacy: &BTreeMap<String, usize>,
    siblings: &BTreeMap<String, usize>,
) -> Vec<&'a String> {
    let mut out: Vec<&String> = led
        .claims
        .keys()
        .filter(|p| {
            !legacy.contains_key(*p)
                && !siblings.contains_key(*p)
                && is_excluded(p).is_none()
                && is_deferred(p).is_none()
        })
        .collect();
    out.sort();
    out
}

/// The `--json` leg: metrics only, for `scripts/pk-baseline.mjs` to wrap.
///
/// Deliberately NOT a whole envelope. xtask has **zero dependencies** and that
/// is worth keeping, so it does not hash its own source or read git;
/// `pk-baseline.mjs` adds `producerSha256`, `commit` and `env` around this. The
/// split is the honest one anyway: this half is the measurement, that half is
/// the provenance of the measurement.
///
/// The ledger is the project's ONE hard ratchet. Every other instrument reads a
/// GPU, a browser or a shared box and has to reason about noise; this one is
/// deterministic, so `converted_pct` may never decrease and no tolerance band is
/// warranted. `dir` says which way is better; the band is zero on purpose.
fn emit_json(t1: &Tier, t2: &Tier, dangling: &[&String]) {
    fn metric(id: &str, unit: &str, dir: &str, value: f64, last: bool) {
        println!(
            "    {{ \"id\": \"{id}\", \"unit\": \"{unit}\", \"dir\": \"{dir}\", \
             \"value\": {value}, \"n\": 1, \"noise\": {{ \"kind\": \"none\", \"value\": 0 }}, \
             \"quality\": \"ok\" }}{}",
            if last { "" } else { "," }
        );
    }
    let pct = |p: f64| (p * 10.0).round() / 10.0;
    println!("{{");
    println!("  \"schema\": 1,");
    println!("  \"instrument\": \"ledger\",");
    println!("  \"producer\": \"xtask/src/coverage.rs\",");
    println!("  \"deterministic\": true,");
    println!("  \"metrics\": [");
    metric(
        "ledger.tier1.converted_pct",
        "%",
        "higher-better",
        pct(t1.pct()),
        false,
    );
    metric(
        "ledger.tier1.ported_lines",
        "lines",
        "higher-better",
        t1.ported_lines() as f64,
        false,
    );
    metric(
        "ledger.tier1.not_started_lines",
        "lines",
        "lower-better",
        t1.todo_lines() as f64,
        false,
    );
    metric(
        "ledger.tier2.converted_pct",
        "%",
        "higher-better",
        pct(t2.pct()),
        false,
    );
    metric(
        "ledger.tier2.ported_lines",
        "lines",
        "higher-better",
        t2.ported_lines() as f64,
        false,
    );
    metric(
        "ledger.tier2.not_started_lines",
        "lines",
        "lower-better",
        t2.todo_lines() as f64,
        false,
    );
    metric(
        "ledger.remaining_lines",
        "lines",
        "lower-better",
        (t1.todo_lines() + t1.partial_lines() + t2.todo_lines() + t2.partial_lines()) as f64,
        false,
    );
    // Must be zero. A metric rather than only an exit code, so a baseline check
    // reports WHICH invariant broke rather than only that one did.
    metric(
        "ledger.dangling_citations",
        "count",
        "lower-better",
        dangling.len() as f64,
        true,
    );
    println!("  ]");
    println!("}}");
}

pub fn run(root: &Path, args: &[String]) -> std::process::ExitCode {
    let led = scan_rust(root);
    let legacy = scan_legacy(root);
    let siblings = scan_siblings(root);
    let code = legacy_code_lines(root);
    let depth = depth_map(&led, &code);

    let t1 = classify(&legacy, &led, is_excluded, &depth);
    let t2 = classify(&siblings, &led, is_deferred, &depth);
    let dangling = dangling_in(&led, &legacy, &siblings);

    // The shallow list as data, for the declaration sweep to act on. Kept apart
    // from `--json` because that one is the RATCHET's artifact and its shape is
    // a contract with `pk-baseline.mjs`; this is a work list.
    if args.iter().any(|a| a == "--shallow-json") {
        let mut all: Vec<(&String, usize, usize, usize)> = t1
            .shallow
            .iter()
            .chain(t2.shallow.iter())
            .copied()
            .collect();
        all.sort_by_key(|(_, n, _, _)| std::cmp::Reverse(*n));
        println!("[");
        for (i, (p, n, rust, legacy_code)) in all.iter().enumerate() {
            println!(
                "  {{\"path\":\"{p}\",\"lines\":{n},\"rust\":{rust},\"legacy\":{legacy_code}}}{}",
                if i + 1 == all.len() { "" } else { "," }
            );
        }
        println!("]");
        return std::process::ExitCode::SUCCESS;
    }

    if args.iter().any(|a| a == "--json") {
        // stdout is the artifact here, so the human report must not share it.
        emit_json(&t1, &t2, &dangling);
        return if dangling.is_empty() {
            std::process::ExitCode::SUCCESS
        } else {
            std::process::ExitCode::FAILURE
        };
    }

    println!("PROVENANCE LEDGER — declared ports, not substring matches\n");

    println!("TIER 1 — legacy/src/game/pinball-knight (the 1:1 surface)");
    println!(
        "  legacy PK tree   {:>7} lines, {} files",
        t1.total(),
        legacy.len()
    );
    println!(
        "  excluded         {:>7} lines, {} files  (decisions, see EXCLUSIONS)",
        t1.subtracted_lines(),
        t1.subtracted.len()
    );
    println!("  1:1 TARGET       {:>7} lines", t1.target());
    println!(
        "    ported         {:>7} lines, {} files",
        t1.ported_lines(),
        t1.ported.len()
    );
    println!(
        "    partial        {:>7} lines, {} files",
        t1.partial_lines(),
        t1.partial.len()
    );
    println!(
        "    NOT STARTED    {:>7} lines, {} files",
        t1.todo_lines(),
        t1.todo.len()
    );
    println!(
        "    converted      {:>6.1}%  (ported / target; partial counts as NOT done)",
        t1.pct()
    );

    println!("\nTIER 2 — the rest of legacy/src (the game loads it too)");
    println!(
        "  sibling tree     {:>7} lines, {} files",
        t2.total(),
        siblings.len()
    );
    println!(
        "  deferred         {:>7} lines, {} files  (decisions, see DEFERRED)",
        t2.subtracted_lines(),
        t2.subtracted.len()
    );
    let mut deferred_dirs: BTreeMap<&str, (usize, usize, &str)> = BTreeMap::new();
    for (p, n, why) in &t2.subtracted {
        let key = DEFERRED
            .iter()
            .find(|(prefix, _)| p.starts_with(prefix))
            .map(|(prefix, _)| *prefix)
            .unwrap_or("?");
        let e = deferred_dirs.entry(key).or_insert((0, 0, why));
        e.0 += n;
        e.1 += 1;
    }
    for (prefix, (n, files, why)) in &deferred_dirs {
        println!("    {prefix:<24} {n:>5} lines, {files} files — {why}");
    }
    println!("  TIER 2 TARGET    {:>7} lines", t2.target());
    println!(
        "    ported         {:>7} lines, {} files",
        t2.ported_lines(),
        t2.ported.len()
    );
    println!(
        "    partial        {:>7} lines, {} files",
        t2.partial_lines(),
        t2.partial.len()
    );
    println!(
        "    NOT STARTED    {:>7} lines, {} files",
        t2.todo_lines(),
        t2.todo.len()
    );
    println!("    converted      {:>6.1}%", t2.pct());

    println!(
        "\nCUTOVER CONDITION: tier 1 = 100.0% AND tier 2 = 100.0% (of target − deferred),\n\
         with the deferred list above reviewed. Today: {:.1}% / {:.1}%, {} lines to write.",
        t1.pct(),
        t2.pct(),
        t1.todo_lines() + t1.partial_lines() + t2.todo_lines() + t2.partial_lines()
    );

    // ── What this number still cannot see ──────────────────────────────────
    //
    // The percentage above is an UPPER BOUND and always was. It counts a file
    // as converted when a deep-enough module declares it, which is evidence
    // that someone WROTE the port — not that the port is right, and not that
    // the game ever calls it. `cargo xtask audit` measures those separately,
    // and a headline that does not carry its own error bar is how 97.9% came
    // to be believed. Printed every run, deliberately un-suppressable.
    println!(
        "\n  ⓘ  UPPER BOUND. A file counts as converted when a deep-enough module\n\
           declares it. Two things that reads as done and is not:\n\
           · a port the game never calls  → `cargo xtask audit --wiring`\n\
           · a port that carries none of the oracle's names → `cargo xtask audit`\n\
           Run both before quoting the number."
    );

    // From here the detail sections report the two tiers together: the work list
    // is one work list, whichever tree a file happens to live in.
    let mut todo: Vec<(&String, usize)> = t1.todo.iter().chain(t2.todo.iter()).copied().collect();
    let mut partial: Vec<(&String, usize, String)> = t1
        .partial
        .iter()
        .chain(t2.partial.iter())
        .cloned()
        .collect();

    if args.iter().any(|a| a == "--by-dir" || a == "--verbose") {
        // Per-DIRECTORY remainder. The plan pages decompose the work by legacy
        // directory (`render/`, `entities/`, …) and until now that table was
        // re-derived by hand from `pk-coverage.sh` — the heuristic this tool
        // exists to replace. A track table sourced from the upper bound and a
        // total sourced from the ledger cannot reconcile, and the difference
        // reads as an arithmetic error rather than as two different instruments.
        let mut by_dir: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
        for (p, n) in &todo {
            // Tier 2 is keyed `legacy/src/<dir>/…`, so its first segment is
            // always `legacy` and grouping on it would collapse fifty-seven files
            // into one meaningless row. Group on the segment that actually names
            // the subsystem, in both tiers.
            let dir = match p.strip_prefix("legacy/src/") {
                Some(rest) => match rest.find('/') {
                    Some(i) => &rest[..i],
                    None => "(src root)",
                },
                None => match p.find('/') {
                    Some(i) => &p[..i],
                    None => "(root)",
                },
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
    //
    // ⚠️ THE HOLE THIS USED TO HAVE. The filter below used to end with
    //   `.filter(|p| !p.starts_with("legacy/") && !p.starts_with("src/"))`
    // — an exemption for "a real citation outside the PK tree", written when
    // there was no tier 2 to resolve such a citation against. But a TYPO inside
    // a real prefix also starts with `legacy/`, so the check built to catch
    // typos exempted an entire class of them. Measured 2026-08-12: two modules
    // cite `legacy/.../engine/{surfaces,tile-shape}.ts` with a literal `...`
    // ellipsis; both are genuinely ported and tested, and 847 lines sat in NOT
    // STARTED for as long as the ledger has existed, with no warning printed.
    //
    // Now that tier 2 is scanned, a path can be resolved rather than exempted:
    // it must appear in SOME tier, or be excluded, or be deferred. Nothing gets
    // a pass for its prefix. Computed by `dangling_in` so this leg and `--json`
    // cannot disagree about whether the run was clean.
    // SHALLOW CLAIMS — a full claim with nothing behind it. Always printed (it
    // is never noise: a shallow claim is either fraud or an unfinished module
    // that forgot to say PARTIAL), and fatal under `--strict-depth`, which CI
    // always passes.
    let mut shallow: Vec<(&String, usize, usize, usize)> = t1
        .shallow
        .iter()
        .chain(t2.shallow.iter())
        .copied()
        .collect();
    if !shallow.is_empty() {
        shallow.sort_by_key(|(_, n, _, _)| std::cmp::Reverse(*n));
        let credit: usize = shallow.iter().map(|(_, n, _, _)| n).sum();
        println!(
            "\n⚠️  SHALLOW CLAIMS — {} file(s), {credit} lines that a full `PORTS:` claimed and\n\
             the depth gate refused (rust code vs legacy code, gate {:.0}%):",
            shallow.len(),
            DEPTH_MIN_RATIO * 100.0
        );
        for (p, n, rust, legacy_code) in shallow.iter().take(40) {
            let pct = if *legacy_code == 0 {
                0.0
            } else {
                100.0 * *rust as f64 / *legacy_code as f64
            };
            println!("  {n:>6}  {p}\n          {rust} rust vs {legacy_code} legacy code lines ({pct:.0}%)");
        }
        if shallow.len() > 40 {
            println!("  … and {} more", shallow.len() - 40);
        }
    }

    let mut fab: Vec<(&String, usize)> = t1
        .fabricated
        .iter()
        .chain(t2.fabricated.iter())
        .copied()
        .collect();
    if !fab.is_empty() {
        fab.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        let n: usize = fab.iter().map(|(_, l)| l).sum();
        println!(
            "\n⚠️  FABRICATED — {} file(s), {n} lines whose only Rust claimant declares it\n\
             INVENTED the content rather than porting it. Scored NOT STARTED:",
            fab.len()
        );
        for (p, l) in &fab {
            println!("  {l:>6}  {p}");
        }
    }

    let mut conflicted: Vec<(&String, usize)> = t1
        .conflicted
        .iter()
        .chain(t2.conflicted.iter())
        .copied()
        .collect();
    if !conflicted.is_empty() {
        conflicted.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        println!(
            "\n⚠️  CONFLICTED — {} file(s) carry BOTH a full and a partial claim.\n\
             Two modules disagree about whether it is done; scored PARTIAL until they agree:",
            conflicted.len()
        );
        for (p, n) in &conflicted {
            println!("  {n:>6}  {p}");
        }
    }

    if !dangling.is_empty() {
        println!("\n⚠️  {} citation(s) name no legacy file:", dangling.len());
        for d in &dangling {
            println!("  {d}");
        }
        return std::process::ExitCode::FAILURE;
    }

    if !shallow.is_empty() && args.iter().any(|a| a == "--strict-depth") {
        eprintln!(
            "\n--strict-depth: {} shallow claim(s) above. Either finish the port or\n\
             downgrade the declaration to `PORTS-PARTIAL: <path> — <what is missing>`.",
            shallow.len()
        );
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

    /// THE FILES NOBODY MAY DECLARE FINISHED YET, pinned against the real tree.
    ///
    /// ## Why this list exists, and why deleting a row is the sign-off
    ///
    /// This test was built with three rows and the docstring *"it fails the day
    /// someone writes a `PORTS:` claim for a file that is not really ported"*.
    /// Between 2026-08-13 and 08-14 its rows were deleted one at a time —
    /// `maze/decorate.ts` in 5b8a9c6, `entities/player.ts` in 6fad5ae, whose
    /// commit message read *"completing 100% of Tier 1 files"* — and with the
    /// guard gone, 67,370 legacy lines were credited to modules that do not
    /// implement them. Only `maze/build.ts` survived, which is the entire reason
    /// it was the last remaining "partial" on a ledger reading 97.9%.
    ///
    /// So the rule is now explicit: **a row leaves this list only in the commit
    /// that finishes that file, and the stage gate proving it must be named in
    /// the commit message.** Deleting a row IS the sign-off artifact. If that
    /// feels like an obstacle, it is working.
    ///
    /// The assertion is "no claimant may say WHOLE", not "no claim may exist" —
    /// several of these now have genuine partial ports, and an honest
    /// `PORTS-PARTIAL` with its remainder written down is exactly what we want
    /// to encourage.
    #[test]
    fn the_biggest_gaps_are_reported_as_gaps() {
        // (legacy path, its line count when pinned, what is still missing)
        const UNFINISHED: &[(&str, usize, &str)] = &[
            (
                "maze/build.ts",
                1898,
                "arches, banners, stairs marker, cracked bands",
            ),
            (
                "maze/decorate.ts",
                3169,
                "the whole decoration pass — 21 exports, 5 carried",
            ),
            (
                "entities/player.ts",
                2445,
                "every verb; 79 rust lines against 1,560",
            ),
            ("state.ts", 1556, "the mutable spine the whole game reads"),
            (
                "engine/render/pixel-pass.ts",
                1993,
                "the post chain: SSAO, bloom, outline, dither, palette",
            ),
            ("render/pinball-parts.ts", 1611, "23 part-kind visuals"),
            ("hud-face.ts", 1330, "the animated portrait"),
            (
                "entities/zombie.ts",
                1217,
                "0 of 5 exports; STATS/updateZombies/movementOf absent",
            ),
            ("entities/combat.ts", 1204, "0 of 22 exports carried"),
            (
                "gui/im.ts",
                1052,
                "the immediate-mode kit every screen stands on",
            ),
            ("dev/window-hooks.ts", 1054, "the __dungeon* dev surface"),
            (
                "entities/marble.ts",
                1005,
                "12 of 45 exports; the physics accessors are UNWIRED",
            ),
            ("abilities.ts", 916, "6 abilities, ranks, mana, Blood Price"),
            (
                "legacy/src/scenes/tavern/core.ts",
                906,
                "46 rust lines against 536",
            ),
            (
                "cards.ts",
                885,
                "rarities, levels, shiny, aggregation — blocks two vendors",
            ),
            (
                "boss.ts",
                772,
                "the KING: slam, bone throw, home tiles, bar",
            ),
            ("gui/screens/debug.ts", 717, "the backtick console"),
            // ── maze/arc-sweeps.ts: ROW REMOVED 2026-08-18 ──
            // Ported in full in `crates/pk-core/src/maze/arc_sweeps.rs` and verified
            // bit-exact across all 10 corpus floors at passes 10, 11, 12, 20, 22
            // by `crates/pk-core/tests/maze_pass_digests.rs`.
            // ── constants/render.ts: ROW REMOVED 2026-08-16 ──
            // All 77 exported values transcribed and gated both ways by
            // `crates/pk-core/tests/constants_render.rs` against
            // `assets/fixtures/constants-render.json`, which the oracle writes
            // from its own module. Sabotage-verified: changing PPU 56→57 fails
            // `every_transcribed_constant_equals_the_oracle`, and dropping one
            // name fails `no_constant_in_the_oracle_is_left_untranscribed`.
            // The invented `DESIGN_VIEWPORT_W`/`RUNG_*`/`LIGHT_FALLOFF_*` and
            // the test that asserted them back are deleted.
            ("boot/sheets.ts", 586, "27 rust lines against 234"),
        ];
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root");
        let led = scan_rust(root);
        let legacy = scan_legacy(root);
        let siblings = scan_siblings(root);
        for (path, pinned, missing) in UNFINISHED {
            let size = legacy.get(*path).or_else(|| siblings.get(*path));
            assert!(
                size.is_some(),
                "{path} is on the unfinished list but is not in the legacy tree — \
                 if the oracle moved it, move this row, do not delete it"
            );
            // The pin is a courtesy to the reader, not an assertion: legacy is
            // frozen, but a rounding of what counts as a line must not turn this
            // guard red for the wrong reason.
            let _ = pinned;
            let Some(claims) = led.claims.get(*path) else {
                continue;
            };
            for (module, claim) in claims {
                assert!(
                    matches!(claim, Claim::Partial(_)),
                    "{module} declares `PORTS: {path}` — WHOLE. Still missing: {missing}.\n\
                     If it is genuinely finished, delete its row from UNFINISHED in the \
                     same commit, and name the gate that proved it."
                );
            }
        }
    }

    /// A remainder someone wrote down outranks a claim someone asserted.
    ///
    /// The live defect this pins: `classify` used `any(Ports)`, so ONE module
    /// claiming a file whole silently overruled every honest `PORTS-PARTIAL` on
    /// the same file, and the file was credited in full.
    #[test]
    fn a_partial_claim_is_never_overridden_by_a_full_claim() {
        let legacy = BTreeMap::from([("x.ts".to_string(), 1000usize)]);
        let mut led = Ledger::default();
        led.claims.insert(
            "x.ts".to_string(),
            vec![
                ("a.rs".into(), Claim::Ports),
                ("b.rs".into(), Claim::Partial("the other half".into())),
            ],
        );
        // Deep enough that only the partial rule can demote it.
        led.rust_code.insert("a.rs".to_string(), 5000);
        let code = BTreeMap::from([("x.ts".to_string(), 900usize)]);
        let depth = depth_map(&led, &code);
        let t = classify(&legacy, &led, |_| None, &depth);
        assert_eq!(t.ported_lines(), 0, "a contested file is not ported");
        assert_eq!(t.partial_lines(), 1000);
        assert_eq!(t.conflicted.len(), 1, "and the disagreement is reported");
    }

    /// A claim too small to be the file it names cannot bank the file's lines.
    ///
    /// The live case: a 49-line `tavern/core.rs` credited all 906 lines of
    /// `scenes/tavern/core.ts`.
    #[test]
    fn a_shallow_full_claim_is_scored_partial() {
        let legacy = BTreeMap::from([("big.ts".to_string(), 906usize)]);
        let code = BTreeMap::from([("big.ts".to_string(), 536usize)]);
        let mut led = Ledger::default();
        led.claims
            .insert("big.ts".to_string(), vec![("stub.rs".into(), Claim::Ports)]);
        led.rust_code.insert("stub.rs".to_string(), 46);
        let depth = depth_map(&led, &code);
        let t = classify(&legacy, &led, |_| None, &depth);
        assert_eq!(t.ported_lines(), 0, "46 rust lines do not port 536");
        assert_eq!(t.shallow.len(), 1);

        // The positive control: the SAME claim, deep enough, is credited. A gate
        // that refuses everything is not a gate.
        led.rust_code.insert("stub.rs".to_string(), 600);
        let depth = depth_map(&led, &code);
        let t = classify(&legacy, &led, |_| None, &depth);
        assert_eq!(t.ported_lines(), 906, "a real port still passes");
        assert!(t.shallow.is_empty());
    }

    /// Several modules splitting one file SUM — the legitimate shape.
    ///
    /// `economy/tavern-shop.ts` is deliberately split across five Rust modules;
    /// if depth were per-module rather than per-file, the depth gate would
    /// condemn the project's own recommended decomposition.
    #[test]
    fn modules_that_split_one_file_are_measured_together() {
        let legacy = BTreeMap::from([("split.ts".to_string(), 500usize)]);
        let code = BTreeMap::from([("split.ts".to_string(), 400usize)]);
        let mut led = Ledger::default();
        led.claims.insert(
            "split.ts".to_string(),
            vec![
                ("one.rs".into(), Claim::Ports),
                ("two.rs".into(), Claim::Ports),
                ("three.rs".into(), Claim::Ports),
            ],
        );
        for m in ["one.rs", "two.rs", "three.rs"] {
            led.rust_code.insert(m.to_string(), 90);
        }
        let depth = depth_map(&led, &code);
        let t = classify(&legacy, &led, |_| None, &depth);
        assert_eq!(
            t.ported_lines(),
            500,
            "270 rust lines across three modules port a 400-line file"
        );
    }

    /// A module claiming several files splits its lines across them, so one big
    /// module cannot certify a shelf of files it merely mentions.
    #[test]
    fn one_module_cannot_bank_many_files_at_once() {
        let legacy = BTreeMap::from([
            ("a.ts".to_string(), 900usize),
            ("b.ts".to_string(), 900usize),
            ("c.ts".to_string(), 900usize),
        ]);
        let code = BTreeMap::from([
            ("a.ts".to_string(), 800usize),
            ("b.ts".to_string(), 800usize),
            ("c.ts".to_string(), 800usize),
        ]);
        let mut led = Ledger::default();
        for f in ["a.ts", "b.ts", "c.ts"] {
            led.claims
                .insert(f.to_string(), vec![("greedy.rs".into(), Claim::Ports)]);
        }
        // 600 lines is a credible port of ONE 800-line file (75%). Spread over
        // three, it is 200 each (25%) and the gate refuses all three — which is
        // the property: claiming more files DILUTES the evidence rather than
        // multiplying the credit.
        led.rust_code.insert("greedy.rs".to_string(), 600);
        let depth = depth_map(&led, &code);
        let t = classify(&legacy, &led, |_| None, &depth);
        assert_eq!(t.ported_lines(), 0, "200 lines each is not a port of 800");
        assert_eq!(t.shallow.len(), 3);

        // The contrast that makes it a measurement: the same module, claiming
        // only one file, IS credited for it.
        led.claims.remove("b.ts");
        led.claims.remove("c.ts");
        let depth = depth_map(&led, &code);
        let t = classify(&legacy, &led, |_| None, &depth);
        assert_eq!(
            t.ported_lines(),
            900,
            "600 rust lines do port one 800-line file"
        );
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

    /// THE HOLE THE DANGLING CHECK USED TO HAVE.
    ///
    /// The filter exempted every path starting with `legacy/` or `src/`, on the
    /// grounds that such a path is "a real citation outside the PK tree". But a
    /// TYPO inside a real prefix starts with `legacy/` too, so the check built
    /// to catch typos was blind to a whole class of them. Three live defects hid
    /// there — two ellipsis paths worth 847 lines, and a `camera.ts` that has
    /// never existed.
    ///
    /// A path now resolves or it fails. This test asserts the shapes, and
    /// `no_citation_in_the_tree_is_dangling` asserts the live tree.
    #[test]
    fn a_typo_inside_a_real_prefix_is_still_a_typo() {
        let legacy = scan_legacy_stub(&["engine/surfaces.ts"]);
        let siblings = scan_legacy_stub(&["legacy/src/utils/rng.ts"]);
        let resolves = |p: &str| {
            legacy.contains_key(p)
                || siblings.contains_key(p)
                || is_excluded(p).is_some()
                || is_deferred(p).is_some()
        };

        // The two shapes that actually shipped, both of which the old filter waved through.
        assert!(
            !resolves("legacy/.../engine/surfaces.ts"),
            "an ellipsis path must be dangling — it was live for the ledger's whole existence"
        );
        assert!(
            !resolves("legacy/src/scenes/tavern/camera.ts"),
            "a citation naming a file that does not exist must be dangling"
        );
        // And the things that must still resolve, or the fix is a false alarm generator.
        assert!(resolves("engine/surfaces.ts"), "tier 1 resolves");
        assert!(resolves("legacy/src/utils/rng.ts"), "tier 2 resolves");
        assert!(
            resolves("tools/sprite-forge/commit.ts"),
            "excluded resolves"
        );
        assert!(resolves("legacy/src/net/socket.ts"), "deferred resolves");
    }

    /// The live tree has no dangling citation. This is the test that would have
    /// gone red on 2026-08-12 and did not, because the check exempted the
    /// prefix. It reads the real workspace, so it fails the day a typo lands.
    #[test]
    fn no_citation_in_the_tree_is_dangling() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root");
        let led = scan_rust(root);
        let legacy = scan_legacy(root);
        let siblings = scan_siblings(root);
        let dangling: Vec<&String> = led
            .claims
            .keys()
            .filter(|p| {
                !legacy.contains_key(*p)
                    && !siblings.contains_key(*p)
                    && is_excluded(p).is_none()
                    && is_deferred(p).is_none()
            })
            .collect();
        assert!(
            dangling.is_empty(),
            "citations naming no legacy file: {dangling:?}"
        );
    }

    /// A sibling citation is normalised to ONE spelling, so tier 2 is keyed as
    /// consistently as tier 1. Without this, `src/utils/rng.ts` and
    /// `legacy/src/utils/rng.ts` are two different files to the ledger.
    #[test]
    fn a_sibling_citation_normalises_to_one_spelling() {
        for line in [
            " `legacy/src/utils/rng.ts`",
            " `src/utils/rng.ts`",
            " `legacy/src/utils/rng.ts:12-40`",
        ] {
            assert_eq!(
                paths_in(line),
                vec!["legacy/src/utils/rng.ts".to_string()],
                "line: {line}"
            );
        }
    }

    /// TIER 2 EXISTS AND IS NOT EMPTY.
    ///
    /// `scan_legacy` walked the PK tree alone, so ~15.4k lines the game loads at
    /// runtime were in no bucket at all — not ported, not excluded, not even
    /// NOT STARTED. "The ledger reads 100%" is the cutover condition, so a file
    /// in no bucket is a hole in the finish line.
    #[test]
    fn the_siblings_the_game_loads_are_counted() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root");
        let siblings = scan_siblings(root);
        for must in [
            "legacy/src/utils/audio-manager.ts",
            "legacy/src/scenes/tavern/core.ts",
            "legacy/src/net/socket.ts",
        ] {
            assert!(
                siblings.contains_key(must),
                "{must} is loaded by the game and must be in tier 2"
            );
        }
        // No PK-tree file may leak into tier 2, or the two tiers double-count.
        assert!(
            !siblings.keys().any(|k| k.contains("game/pinball-knight")),
            "tier 2 must exclude the PK tree — the tiers must not overlap"
        );
        let total: usize = siblings.values().sum();
        assert!(total > 14_000, "tier 2 measured 15,430 lines; got {total}");
    }

    /// A deferral is not an exclusion and must not print as one.
    #[test]
    fn deferrals_are_a_separate_list_with_their_own_reasons() {
        assert!(is_deferred("legacy/src/net/socket.ts").is_some());
        assert!(is_deferred("legacy/src/services/score-service.ts").is_some());
        assert!(
            is_deferred("legacy/src/utils/audio-manager.ts").is_none(),
            "audio-manager is in scope — deferring it would hide 845 lines"
        );
        // The two lists must not overlap, or a file's disposition depends on
        // which check runs first.
        for (prefix, _) in DEFERRED {
            assert!(
                is_excluded(prefix).is_none(),
                "{prefix} is both excluded and deferred — pick one"
            );
        }
        for (_, why) in DEFERRED {
            assert!(why.len() > 20, "every deferral states its decision");
        }
    }

    fn scan_legacy_stub(paths: &[&str]) -> BTreeMap<String, usize> {
        paths.iter().map(|p| (p.to_string(), 1)).collect()
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
