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
    // A path outside the PK tree (e.g. `legacy/src/scenes/tavern/...`) is a TIER 2
    // citation — the game loads it, so it is part of the finish line, just not of
    // the 1:1 surface. Normalise the one other spelling it could take, so tier 2
    // is keyed as consistently as tier 1 is.
    if p.starts_with("src/") {
        return Some(format!("legacy/{p}"));
    }
    Some(p.to_string())
}

fn is_excluded(path: &str) -> Option<&'static str> {
    EXCLUSIONS
        .iter()
        .find(|(prefix, _)| path.starts_with(prefix))
        .map(|(_, why)| *why)
}

fn is_deferred(path: &str) -> Option<&'static str> {
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
) -> Tier<'a> {
    let mut t = Tier::default();
    for (path, lines) in legacy {
        if let Some(why) = subtract(path) {
            t.subtracted.push((path, *lines, why));
            continue;
        }
        match led.claims.get(path) {
            None => t.todo.push((path, *lines)),
            Some(claims) => {
                // A file is PARTIAL if any module says so and none says whole.
                let whole = claims.iter().any(|(_, c)| *c == Claim::Ports);
                if whole {
                    t.ported.push((path, *lines));
                } else {
                    let why = claims
                        .iter()
                        .filter_map(|(_, c)| match c {
                            Claim::Partial(w) => Some(w.clone()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("; ");
                    t.partial.push((path, *lines, why));
                }
            }
        }
    }
    t
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

    let t1 = classify(&legacy, &led, is_excluded);
    let t2 = classify(&siblings, &led, is_deferred);
    let dangling = dangling_in(&led, &legacy, &siblings);

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
        // `entities/player.ts` and `maze/build.ts` are partly ported and must be
        // declared PARTIAL by every claimant — never whole.
        for path in ["entities/player.ts", "maze/build.ts"] {
            let claims = led.claims.get(path).unwrap_or_else(|| panic!("{path} is claimed"));
            for (module, claim) in claims {
                assert!(
                    matches!(claim, Claim::Partial(_)),
                    "{module} claims {path} WHOLE; it is partially ported"
                );
            }
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
