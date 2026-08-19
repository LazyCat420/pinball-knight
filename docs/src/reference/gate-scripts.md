# The gate scripts (`scripts/ops/`)

Landed 2026-08-19. Two entry points over one vendored library:

```bash
scripts/ops/scoped-gate.sh   # exactly the gates covering THIS tree's changes
scripts/ops/full-suite.sh    # everything, in sequence
```

Both take `--self-test` and `--no-lease`; `scoped-gate.sh` also takes
`--base <ref>`, `--allow-empty` and `--dry-run`.

## What the scoped gate selects

Changed set (committed vs the merge-base with `main`, **plus** staged,
unstaged and untracked) → `crate-map.py` maps files to workspace members via
one `cargo metadata --no-deps` → a BFS along **reversed** member dependency
edges gives the closure. Touch `pk-core` and you gate `pk-core`, `pk-game` and
`pk-jsmath-probe`, because those are what depend on it.

Legs, in order: `fmt` → `clippy` → one `cargo test -p <closure…>
--no-fail-fast` → `cargo check --target <t>` for **every** configured target →
the jsmath pair when the closure touches the math.

## Why the cross-target legs are unconditional

This is the `CFG = NO GATE` incident made mechanical. `publish_stats` was
`cfg(wasm32)`, so 877 native tests, clippy and fmt all passed over a tree that
**could not build wasm** — and that tree reached `main`.

The gate now runs `cargo check` for `wasm32-unknown-unknown` and
`x86_64-pc-windows-gnullvm` whenever the closure is non-empty. Not when the
diff "looks wasm-related": the entire failure mode is that the defect looks
like nothing at all from the native side.

**Proved, not assumed.** A `#[cfg(target_arch = "wasm32")] compile_error!` was
injected into `pk-core`, and the OLD world's verdict was confirmed first —
native tests PASS, clippy PASS, fmt PASS, all green over the defect. The scoped
gate then returned `FAIL check-wasm32-unknown-unknown (rc=101)`, overall exit
1, with every native leg still green. That is exactly the shape it exists for.

Package set per target is (closure ∩ the target's buildable list) ∪ the **entry
package**, always. Feature unification happens at the leaf, so checking
`pk-core` alone with default features is not the build that ships. All seven
members were probed against both targets on 2026-08-19 and all seven build;
`xtask` is excluded as dev-only tooling that never ships cross-target.

## The exit code is the product

Every leg's command runs **bare** — never `cmd | grep`, never `cmd | tail`. A
trailing pipe makes `$?` the filter's, and a sibling workspace's suite once
reported four real reds as exit 0 in precisely that way. Output is captured to
a log and filtered *after* the status is recorded.

`--self-test` proves this in one command, any day: it re-execs with three
synthetic legs (green, `exit 42`, and a red **behind a pipe**) and asserts the
child failed while naming both reds. `plumbing PROVEN` means the machinery that
reports failure is itself working.

Exit codes: `0` green · `1` a leg failed · `3` a **structural** change (add,
delete, rename) selected no gate — the dangerous shape; `--allow-empty`
downgrades it · `10` setup failure, because a broken manifest is a red gate and
never a skip · `75` the box was full and **nothing ran**, which is not a red
suite. A docs-only diff selecting nothing prints a NOTE and exits 0, by design.

## fmt and clippy are ADVISORY here, deliberately

Measured on `main@411c1aa6` before choosing: `cargo fmt --check -p pk-core` is
RED (drift in `camera.rs`, `combat/`, `dev/circuit_census.rs`) and `cargo
clippy -p pk-core --all-targets` is RED (rc=101, a deny-level "right-hand side
of `&&` operator has no effect", plus 36 warnings).

A gate that is red on `main` the day it ships trains everyone to ignore its
reds. So these two report and do not vote (`run_leg_advisory` records them
without counting them). Flip `GATE_FMT_ENFORCE` / `GATE_CLIPPY_ENFORCE` to `1`
in the same change that lands each cleanup — that is the whole job, and it is
small.

## The target-dir lease

`CARGO_TARGET_DIR` pointed at the primary's `target/` turns a cold worktree
build from ~141.5s into ~13.5s — and it is safe for **exactly one worktree at a
time**. Two worktrees are two checkouts of the same package, so their workspace
artifacts land on the same paths and overwrite each other. Measured 2026-08-10:
a digest test in worktree A failed with the exact signature of a deliberate
sabotage being compiled in worktree B, then passed on re-run.

`lease_target_dir` turns that rule into a mechanism — an flock on
`~/.cache/bdb-cpu-slots/cargo-target-pinball-knight.lock`. The winner shares the
warm dir; the loser falls back to its own `target/`, cold but safe. **The choice
always prints before any cargo runs**, because a silently confounded timing is
the failure this exists to prevent. Gates never bare-execute a binary out of the
shared dir: a stale artifact there may carry another worktree's paths.

## Metering

The library takes thread locks from the same machine-global pool as
`pk-run.sh` — same lock files, same fds, same label format — so `pk-run.sh
--status` reports these gates alongside everything else. Class `test`, elastic,
asks half the budget. It caps `--jobs` **and** `--test-threads`: libtest sizes
its pool from all 24 CPUs and is the real box-eater.

## Vendoring

`gate-lib.sh`, `crate-map.py`, `scoped-gate.sh` and `full-suite.sh` are
**identical copies** in `pinball-knight`, `drift-king`, `video-editor` and
`spritefusion-pixel-snapper`; only `gate-config.sh` differs per repo. Sun's root
is not a repo and each repo pushes independently, so a shared path would break
the moment one was cloned alone. `GATE_LIB_VERSION` (currently **3**) is the
drift tripwire: **fix the library, carry it to all four, bump the version.**

## Open items

- The fmt and clippy cleanups are unscheduled. Until they land, two of the six
  legs here do not vote.
- The per-target buildable lists are frozen truth and can rot when a crate
  gains a platform dependency. Always including the entry package limits the
  damage; it does not remove it.
- `cargo check` catches the type/cfg class but not link errors. If that proves
  insufficient, the windows leg can move to `cargo build` at 2–3× the cost.
- The lease only binds processes that cooperate. A bare `cargo build` in
  another worktree still collides with a lease holder.
