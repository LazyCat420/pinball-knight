# Incidents

Diagnoses that outlive their patches. Write the reasoning, not just the fix.

## 2026-08-27 — The gambler's art was function signatures with empty bodies,
## and the test that guarded it could not fail

**Status: roulette repaired and shipped. Darts, blackjack and `draw_card` are
STILL stubs — see Open items. `tavern-one-to-one.md` corrected.**

**What was claimed.** `tavern-one-to-one.md` recorded Risk Gold as
**✅ DONE — `pk_core::gambler` + `gambler::drive` + `screens::gambler` + the
`Cabinet` shell; all four playable, wired to the station**. Every word of that
was true. It was also not the claim a reader takes from it.

**What was there.** `pk_gui::gambler::roulette_art` carried the oracle's
constants, its six colour ramps, `tone`, `edge_of` and `project` — 172 lines
that look like a port. `draw_wheel`, `draw_panel` and `clear_table` had EMPTY
BODIES. `build_wheel_layers` returned `WheelLayers { baked_width: 222,
baked_height: 160 }` — two integers and no pixels. `paint_disc`, the scanline
rasteriser that IS the wheel, was never written. **Nothing in the crate
imported the module.** The same shape held in `darts_art`, `blackjack_art` and
`cards_art`: every pure-math helper real, every `draw_*` `{}`.

What actually painted was `paint_roulette` in `pk-game`, drawing a flat 19-cell
horizontal bar with a gold blob sliding along it. Correct outcomes, correct
payouts, a progress bar for a wheel.

**Why nothing caught it.** `roulette_art_sim.rs` asserted that
`project_isometric` followed by `unproject_isometric` returns its input:

```rust
let (sx, sy) = metrics.project_isometric(angle, norm_r, lift);
let (r, a)   = metrics.unproject_isometric(sx, sy, lift);
assert!((r - norm_r).abs() < 1e-4);
```

That holds for **any invertible map** — at `FLAT = 0.46`, at `FLAT = 7.0`, with
the axes swapped. It measures the inverse, not the wheel, and **it cannot fail
when nothing is drawn**. `RouletteWheelMetrics` does not exist in the oracle at
all; it was invented by the port, and the only thing that ever used it was the
test that proved it consistent with itself.

The general rule this is an instance of: *a test for procedural art must be
able to fail if the function body is deleted.* Ask it of any green art test
before believing the art exists.

**What the repair proved.** Rendered the ported wheel and the oracle's at the
same view (theta 1.15, rotor −0.4, seated, pocket 7 flashing) and diffed,
correcting for the `CY` shift:

| | |
| --- | --- |
| Non-transparent pixels compared | 15 592 |
| Identical | 15 560 — **99.79%** |
| Differing | 32, all one cluster |

**The 32 differing pixels are the ORACLE anti-aliasing itself.** Its callout
plate is `w = label.length * 4 + 5`, so a one-character label gives `w = 9` and
JS `w / 2` is **4.5** — `fillRect` lands on a half-pixel boundary and Canvas 2D
feathers the edge. Its pixels there read (133,126,97), a 50% blend of
`C_WIN_HI` over the ink halo to within one unit. That is exactly the soft
fringe `roulette-art.ts`'s own first paragraph exists to forbid, reached by
accident through an odd width. Rust's `w / 2` is integer division, so the port
is crisp — and stays crisp deliberately. Matching byte-for-byte would port a
defect the source file's stated design rule rejects.

**Two claims in the oracle's own header that do not survive measurement.**

1. *"the far half of the rim and lip are repainted as annuli on top — which is
   what makes the ball genuinely disappear behind the far rim."* It does not.
   The far annuli cover art radius 0.925..1.0, the ball never exceeds
   `BALL_TRACK_R` = 0.9, and on screen the rim band sits 7–10px ABOVE the ball
   at every far angle (theta = −PI/2: ball y = 13.1, rim band y = 3.8..6.1). A
   track-radius ball is never occluded. What the three-layer split genuinely
   buys is the ORDERING.
2. The winner callout is composited after `far` but does not overlap it either.
   **Code order is not screen overlap**, and only the second one is visible.

Two drafts of the replacement test asserted each of those and **failed against
correct art**. Both are now recorded next to the code, with the measurements,
so the next reader does not re-derive them from a red suite.

**What replaced the guard.** Every check is now anchored to something computed a
different way from the code under test — the ellipse equation, the pocket
count, a rotation the art must respond to, a digest that moves when one pixel
does. `pk-game` carries `roulette_art_constants_match_physics`, because
`pk-gui` cannot depend on `pk-core` and the art therefore RESTATES six physical
constants; `DEFL_OFFSET` was made `pub` in `pk_core` rather than skipped, since
a drift guard with a hole at the deflector phase has it precisely where the
oracle's own warning points ("a diamond drawn somewhere the ball never scatters
is a picture of a different wheel").

**The one number the port moves.** `CY` 102 → 58, and nothing else. The wheel's
own vertical extent is 112.5px against a 130px game area; what did not fit was
the empty space above the rim in the oracle's 200px cabinet. Scaling `R` would
have moved every pocket boundary off the integer grid the hand-rasterisation
exists to hit.

### A trap this work walked into, twice over

**An indented block in a Rust doc comment is a compiled doctest.** The oracle's
header carries its formulas as indented prose; ported verbatim into `//!` and
`///` comments, rustdoc turned four of them into Rust source and the `test` leg
went red on `main`:

```text
x = CX + R*r*cos(a)                     -> expected one of `!` or `::`
15 592 pixels compared - 15 560 ...     -> unknown start of token: \u{2014}
BAKE_W = ceil(CX + R) + 4               -> expected one of `!` or `::`
```

The workspace has **zero** doctests otherwise, so nothing had ever exercised
this path and no existing file demonstrates the hazard. Fence any indented
block as ` ```text `.

**And the reason it reached `main`:** `cargo check -p pk-game` does not compile
that crate's tests, so a `match` left non-exhaustive by the new `GamePrim::Blit`
variant said nothing. It lived in the BIN target, which `--lib` also misses.
Use `--all-targets`, and remember that the suite's own `test` leg is the only
thing that reaches doctests at all.

Both were masked one step further by running the suite as
`full-suite.sh | tail -40`: a pipeline's exit status is the LAST command's, so
`tail`'s success was reported while the suite printed `2 LEG(S) FAILED`. The
pipe also discarded the diagnostics. `full-suite.sh`'s own header says the exit
code is sacred — piping it is how you desecrate it.

### Open items

- **`darts_art`** — `draw_number`, `draw_dart`, `build_board`, `box_rect`,
  `frame_rect` are all `{}`. The board renders as nested `Stroke` rectangles.
- **`blackjack_art`** — `draw_chip`, `draw_chip_stack`, `draw_betting_circle`
  are `{}`.
- **`cards_art`** — `draw_card` is `{}`.
- The plumbing is no longer the blocker: `GamePrim::Blit` carries an
  `Arc<Pixmap>`, `im::blit_pixmap` does the integer upscale, and
  `gambler::pixmap` is the surface. Each remaining module is a rasteriser to
  write.
- Audit the three modules the way this one needed auditing: check that each
  test would fail if the function body it covers were deleted.


## 2026-08-16 — The ledger was gamed, and the guard test built to catch it
## was deleted one row at a time

**Status: repaired, with three instruments and a restored guard. The port is
NOT at 100%; it is at 45.5% / 56.1% with 54,490 lines still to write.**

**What was claimed.** `cargo xtask coverage` read **97.9% Tier 1 / 100.0%
Tier 2, 1,898 lines to write**, and commit `fa3a64d` (08-14 21:36) announced
*"100.0% Tier 1 and Tier 2 conversion parity"*. Every status document in the
repo still said 24–25%, and the committed ratchet baseline
(`assets/baselines/ledger.json`, `47d3cb2`) still says 25.0% — nobody
re-recorded it, and because the ratchet is `higher-better` with a zero band,
a jump to 97.9% **passed CI silently**.

**What actually happened.** Between 08-13 and 08-14, a 122-commit burst
(`c2ed072..4595a84`) added ~254 `//! PORTS:` declarations crediting **67,370
legacy lines across 234 files**. The credit arithmetic is denominated entirely
in the LEGACY file's size — `coverage.rs` never read the claiming module at
all — so a one-line Rust file could bank a three-thousand-line TypeScript
file, and many did:

| legacy file | lines | the Rust that claimed it | exported names carried |
|---|---:|---|---|
| `constants/render.ts` | 671 | `constants/render.rs`, 37 lines | **0 of 69** |
| `scenes/tavern/core.ts` | 906 | `tavern/core.rs`, 49 lines | 0 of 4 |
| `entities/player.ts` | 2,445 | `entities/player.rs`, 90 lines | 0 of 5 |
| `entities/zombie.ts` | 1,217 | five `monsters/*.rs` | 0 of 5 |
| `entities/combat.ts` | 1,204 | ten modules | 0 of 22 |

`constants/render.rs` is the clearest case and the worst: it is not a thin
port, it is **invented**. It declares `DESIGN_VIEWPORT_W`, `RUNG_BACKGROUND`,
`LIGHT_FALLOFF_LINEAR`, `calculate_light_attenuation` — not one of which
exists in the oracle — while the oracle's actual contents (`RENDER_W`,
`CAMERA_ZOOMS`, `PPU`, `CEL_STEPS`, `AMBIENT_INTENSITY`…) are absent. Content
fabricated to satisfy a checker reads, to a size-based checker, as a port.

**Why nothing stopped it.** Two holes, and one deliberate act.

1. `classify()` computed `whole = claims.iter().any(|c| c == Ports)`. **One
   full claim outvoted every honest `PORTS-PARTIAL` on the same file.** A
   module that ported ten lines of `decorate.ts` and said so was overruled by
   a sibling asserting the file whole.
2. Nothing compared the claim to the claimant. Size was never checked.
3. **The guard test `the_biggest_gaps_are_reported_as_gaps` had its rows
   deleted, one per obstacle.** Its own docstring said it existed so that it
   *"fails the day someone writes a `PORTS:` claim for a file that is not
   really ported"*. `5b8a9c6` deleted the `maze/decorate.ts` row; `6fad5ae`
   deleted the `entities/player.ts` row under the message *"completing 100% of
   Tier 1 files"*. Only the `maze/build.ts` row survived — which is the entire
   reason `build.ts` was the last remaining "partial" on a 97.9% ledger, and
   why `fa3a64d`'s flip to 100% was reverted 13 minutes later by `fe935dc`:
   it was the one file still guarded.

**The repair — three instruments, because there are three different lies.**

- **Depth gate** (`coverage.rs`): a full claim whose Rust code lines are under
  30% of the legacy file's code lines is scored PARTIAL and printed under
  SHALLOW CLAIMS. `--strict-depth` makes it fatal; CI passes it always. Caught
  46 files / 23,478 lines.
- **Symbol carryover** (`cargo xtask audit`): of the names a legacy file
  EXPORTS, how many appear in the Rust claiming it. Caught the fabrications
  the depth gate cannot see, e.g. `constants/render.ts` at 0 of 69.
- **Inert-port report** (`cargo xtask audit --wiring`): public functions of a
  port that **nothing in the game calls**. See the finding below — this is the
  one that reaches the player.

`classify()` now demands that ALL claimants say whole, and reports
CONFLICTED when they disagree. The guard test is restored with **20 rows**,
and the rule is written into it: *a row leaves the list only in the commit
that finishes that file, naming the gate that proved it.* Deleting a row IS
the sign-off artifact.

**Two false accusations, caught before they did damage.** Both are why the
instruments report with reasons instead of just failing:

- Scored over ALL exports, `entities/pinball-collide.ts` came out at 2 of 6
  and would have been downgraded. It is genuinely ported — `pinball.rs` is
  1,032 lines against its 911. The "missing" names were TS *interfaces* and a
  `Record<Kind,Handler>` table, shapes a Rust port is supposed to restructure.
  Fix: score functions and constants; count types but do not hold them against
  the port.
- `entities/marble.ts` scored 3 of 45. The oracle's free function
  `materialFrictionMult(m)` is `mat.friction_mult()` in Rust — a method does
  not repeat its receiver's name. Fix: a symbol of 3+ snake segments also
  matches on its tail.

A probe that condemns correct code is not a strict probe, it is a broken one,
and both of these were found by hand-checking an accusation before acting on
it. The positive controls (`collision.ts`, `combo-curve.ts`, `rail.ts`,
`track-grow.ts`, `surfaces.ts` — all fixture-verified) score 86–100%.

**The finding that matters most to a player.** `crates/pk-core/src/marble.rs`
is 448 real lines and implements every per-material physics accessor the
oracle has — `friction_mult`, `steer_mult`, `flat_restitution`,
`lane_pull_mult`, `ram_damage_mult`, `max_speed`, `bumper_scatter_mult` — and
**not one of them is called anywhere outside that file**. The six marble
materials change the ball's tint and its label and nothing else. Likewise
`crates/pk-core/src/player/verbs.rs`: `trigger_melee_slash`, `trigger_dash`,
`step_plunger` are referenced only by `crates/pk-core/tests/player_verbs_sim.rs`
— **a test**. The attack, the dodge and the plunger are implemented, tested,
green, and unreachable from the running game.

**The lesson, and it is not "someone cheated".** Every one of these passed the
checks that existed. A ledger denominated in the size of the thing you are
*replacing*, with no reference to the thing you are *writing*, measures
intent. A guard whose rows can be deleted by the commit they obstruct is a
guard with a door in it. And a function called only by its own test is not
shipped, however green the suite — the suite defines its own subject.

## 2026-08-11 — A partial transform restore lets the pixel snap move the
## knight's Y — real, bounded, and NOT the disappearance it was hunted for

**Status: the defect below is fixed and measured. The player-reported bug it
was chased for is still OPEN — see the correction at the end.** This entry is
kept in full because the wrong turn in it is more instructive than the fix.

The report was *"my sprite for pinball knight will just disappear sometimes"*,
narrowed by the player to: **tavern only, only while WALKING, permanent** —
gone until a restart or a trip to the maze.

**What was found.** `post/snap.rs::snap_sprites` rounds a `PixelSnapped`
entity onto the render lattice along the *camera's* right/up basis, not world
axes — the whole point of the module, since under a 45° yaw a world-axis snap
misses the lattice (`snapping_world_axes_would_not_land_on_the_lattice`).
Under the 38°/45° iso rig the camera's up vector is `(-0.435, 0.788, -0.435)`,
so **rounding the "up" component moves the entity in world Y.**

`snap.rs`'s header already stated the contract: this is idempotent only
because every driver ASSIGNS the translation rather than accumulating into it,
so the correction has a fixed point. `sync_tavern_knight` wrote `.x` and `.z`
and never `.y` — not accumulation, but it defeats the fixed point just the
same, because each frame hands the snap a fresh x/z carrying last frame's
already-corrected y.

**Fixed** by assigning all three components (and likewise the contact blob,
which is independently `PixelSnapped`). The keepers at `tavern.rs:1723`/`:1749`
already assigned all three; the knight was the only violator.

**Measured in real Chrome, both ways.** Twice, because the first measurement
was wrong — see "the second correction" below.

| | worst \|y − 0.575\| | of a 1.15 quad |
|---|---|---|
| partial restore (the defect) | **0.1606** | 14.0% |
| full assignment (the fix) | **0.0090** | 0.8% |

Over ~90 s of scripted reversing (every key pair, a 120 ms flutter, and
diagonals), 1,634 and 1,484 frames watched respectively. The fix cuts the
wobble **18×**. It does not eliminate it — a snapped sprite is allowed to move
a sub-texel as the camera eases, which is the tradeoff the module documents.

### The SECOND correction: a sampled probe is not a maximum

The table above replaces an earlier one reading **0.0217** for the defect,
which I used to argue the drift was "1.9% of a quad, far too small to be the
reported disappearance" and to file the player's bug as still open.

That 0.0217 came from a Playwright loop polling `__pk` every ~50 ms — **one
frame in three at 60 fps**. It reported a *sample*, not a peak, and the true
per-frame maximum is 7.4× larger. The fix is now measured by `SnapPeak`, a
resource updated in `PostUpdate` immediately after `snap_sprites`, which only
ever widens its min/max. Instrument the engine, not the poll: an external
sampler cannot see an excursion narrower than its own interval.

Whether 14% of a quad is what the player was seeing is still not proven —
0.16 world units against a frustum half-height of 5.6 does not put the knight
off screen, and the mechanism for a full disappearance remains unidentified.
The player reports it has stopped since this shipped. That is evidence, not
proof, and the two other commits in the same window touched neither the tavern
nor the knight, so this is the only candidate.

### The FIRST correction, which is the point of this entry

The diagnosis originally claimed a RUNAWAY: y climbing 0.575 → 1.394 over 600
walking frames, off the top of the frustum. That came from a simulation with
**the camera parked at the origin**, so the knight's offset from it grew
without bound and the rounding residual grew with it.

The tavern camera does not do that. `tavern_camera` eases toward the player
every frame (`ease_camera`, `tavern.rs:2355`), so `d = knight − camera` stays
roughly constant while walking. Re-simulated with a following camera the drift
is **bounded** — it wanders to ~0.13 and comes back — and the live browser
measurement agrees at 0.0217. A ratcheting model produced a ratcheting answer;
the code has a servo in it.

The symptom match that made the story so convincing (tavern-only, walking-only,
permanent) is genuinely a property of this defect — `PixelSnapped` is attached
nowhere outside `tavern.rs`, identical x/z reaches the fixed point at rest, and
only a scene rebuild resets y. **A mechanism can explain every qualitative
symptom and still be the wrong magnitude.** The check that caught it was
restoring the bug and measuring, rather than treating the fix's green run as
proof; a one-sided pass would have shipped a false diagnosis with a real patch
stapled to it.

**Status of the player's bug: reported gone since this shipped, cause not
proven.** The player's repro was "walk one direction then the opposite", which
is what the 90 s A/B above scripts, and the defect is 18× smaller now. But
0.16 world units is not a disappearance on a frustum 11.25 tall, so either the
wobble was compounding with something unidentified, or the cure is
coincidental. Do not close this as understood.

Ruled out with evidence, so nobody re-hunts them: NaN (every division in
`step_tavern_movement` guards its denominator; `move_in_room` is pure clamps),
a teleport out of the room (clamped twice), a missing animation frame (all
three sheets carry idle *and* walk cells, and the empty-clip path early-returns
*before* touching the material, so it would freeze a frame, not blank it), and
`facing_from_velocity` (total, every branch returns, no gap at the reversal).
If it returns, look at: the masked material clones and their
`AlphaMode::Mask(0.5)` cutoff, the billboard's `scale.x = -1.0` mirror for
facing W (the keepers carry an explicit `|scale_x| >= 0.06` clamp with a
comment that a zero-determinant matrix "NaNs the normals and the sprite
disappears for good" — the knight has no such guard, though its scale is a
hard ±1.0), and anything that can leave `MeshMaterial3d` pointing at a handle
whose image was dropped.

### What this proved about the harness

`pk-check` passed identically with and without the defect — verified by
restoring it and running the whole gate to a green `ALL GATES PASSED`. Its
longest key-hold is 1.1 s. A screenshot gate cannot see a sub-quad positional
error at all, and cannot see a disappearance until the subject is already
missing from the photograph.

So the probe gained `__pk.tavern.spriteY`: the knight's RENDERED y, after the
snap. It is not derivable from `TavernRes` — the sim pose has no y — and that
gap is exactly why this went unmeasured. Emitted as `null` rather than `NaN`
when the entity is absent, since `NaN` is not JSON and would break the parse
for every other field in the probe.

**The general shape worth keeping:** a per-frame correction is idempotent only
against a FULL assignment. "Don't use `+=`" is the wrong rule; the rule is
*assign every component you do not want the corrector to own*. The dungeon's
`sync_knight` (`main.rs:1153`) has the identical partial write and is harmless
only because nothing there is snapped — latent, not live.

## 2026-08-10 — A pass boundary that pinned a COUNT, on the one pass whose
## draw counter cannot say anything

Pass 2 of the maze pipeline, `track-path`, was gated by a fixture that could
not have failed for the mistakes a port of it makes.

Every boundary in `maze-pass-digests.json` pins seven grid digests, six counts,
the cumulative rng draw count and the pass's own scalars — and at `track-path`
all seven grid digests are the all-wall grid (the first two passes write
nothing to tiles), the graph digests are pass 1's output unchanged, and the
scalars are `{ legs: 28 }`. So the entire claim the fixture made about pass 2's
output was a leg count.

Normally the draw counter covers that gap: it is what splits "this pass drew a
different number of values" from "it drew the same ones and did different
arithmetic". `build_track_path` draws NOTHING. It is pure geometry over pass
1's graph, so its boundary count equals `grow-track`'s on both sides *by
construction*, on a correct port and a broken one alike.

Concretely, all of these passed the old gate: every leg pulled back by the
wrong setback, every leg emitted in a different order, every fillet centred on
the wrong side, `arcHalf` off by the lane scale. Only the number of surviving
legs was checked, and the leg count is a coarse function of the geometry — it
changes only when a leg crosses the `sa + sb >= len − 0.5` threshold.

Fixed by widening the exporter: `pathLegs` (endpoints, node ids and lane width,
in emission order), `pathArcs` (the same fold `grid.arcs` uses) and
`pathArcHalf`. Both sides now assert the digests exist at exactly one boundary,
so deleting them fails loudly rather than silently restoring the old gate.

**The general shape, which is the part worth keeping:** a probe that reports
`{ thing: things.length }` reads like instrumentation and is a *count*. Ask
what a wrong implementation would have to do to change it — if the answer is
"cross a threshold", the boundary is not gated. And when a pass consumes no
rng, the harness's cheapest localiser is silent there, so that pass needs MORE
pinned state than its neighbours, not the same amount.

**Also measured, on the same pass:** two primitives it calls are provably
invisible to the ten-floor corpus. `js_hypot` differs from `libm::hypot` on
34% of the calls this pass makes and changes no digest, because hypot only
feeds inequalities here. `js_cos`/`js_sin` differ from `libm`'s on 8 of 790
leg bearings and the swap survives five corpus floors before one catches it —
a 1-ulp error scaled by a ≤7-tile setback rounds away against the ulp of the
30-tile coordinate it is added to. Green floors are evidence about the inputs
the floors reach, never about the call being right.

## 2026-08-09 — V8's math library is a third implementation, and the port's
## determinism rule pointed at the wrong one

The maze harness's first real use found this on its first run. `grow_track`
came out with the LAYOUT bit-identical — same 43 nodes, same positions, same
draw count — and the conductivities wrong in the last two digits. Same node
count, same edge count, same topology; different roads.

The cause was `Math.pow`. `track_grow`'s physarum step raises a normalised
flow to a fixed 1.35 power, 140 times per floor, and the result decides lane
WIDTH. Measured over 200,001 values of x^1.35:

| implementation | differs from the JS runtime |
|---|---|
| Rust `libm` crate (`e_pow.c`, Sun/fdlibm) | 19,904 of 200,001, always 1 ulp |
| Rust std `f64::powf` (the platform pow) | 0 |

The workspace determinism rule says transcendentals go through `libm`, never
std — written for `sin`/`cos`, where std differs across platforms. For `pow`
it points at the implementation that is *wrong for this oracle*.

**Then the next one.** With `js_pow` in, pass 1 diverged again three levels
later: one node of L3's 44, one ulp of x, out of the `hub` layout's
`Math.cos`. Sweeping the whole family against the runtime:

| fn | `libm` | std | verdict |
|---|---|---|---|
| `sqrt` | ✅ | ✅ | IEEE-exact, no twin needed |
| `atan` | ✅ | ❌ | `libm` |
| `pow` | ❌ | ✅ | std, plus V8's ±0.5→`sqrt` fast path |
| `cos` `sin` `exp` `log` | ❌ | ❌ | **neither** |

`cos(0.1)` is `0x3fefd712f9a817c0` in the runtime and `…c1` in both Rust
candidates — they agree with each other and disagree with the oracle. The
reason is evaluation ORDER, not constants: V8 keeps the original Sun
`__kernel_cos`/`__kernel_sin` (the `qx` trick, Horner all the way down) while
musl and glibc both took FreeBSD's rewritten split-polynomial form. C1..C6 and
S1..S6 are identical in all three.

**Rules.**

1. There is no blanket answer for "which math library". Every primitive the
   port touches gets swept against the runtime BEFORE it is used, and the
   sweep is a digest of a whole curve — 1 ulp on one input in ten is invisible
   in spot values, which is exactly how it was nearly missed.
   `assets/fixtures/jsmath-oracle.json` is that gate.
2. A twin's rationale must be re-testable. `jsmath_oracle.rs` asserts that
   `libm::pow` still DISAGREES, so if a future `libm` fixes its pow the test
   fails and says the comment is stale, rather than quietly agreeing.
3. This is per-target. `wasm32-unknown-unknown` has no system libm, so std's
   `powf` lowers back to the `libm` crate — the wasm build is expected to
   diverge here and has not been measured. Tracked in the checklist.
   → **Measured, and it was worse than rule 3 predicted. See below.**

### `js_pow` was three different functions (2026-08-10)

Rule 3 above said the wasm build "is expected to diverge". It did — and so did
the Windows build, for an entirely different reason, which is the part rule 3
got wrong. Both non-native targets were generating floors no fixture describes:

| target | `f64::powf` vs the runtime, x^1.35 over 200,001 | what it actually is |
|---|---:|---|
| `x86_64-unknown-linux-gnu` (the gated one) | 0 | glibc ≥2.28 = ARM optimized-routines |
| `wasm32-unknown-unknown` | 19,904 | `compiler_builtins` → the `libm` crate → Sun's `e_pow.c` |
| `x86_64-pc-windows-gnullvm` (**the play target**) | 201 | mingw's own — not fdlibm either |

The Windows row is the one to remember. "wasm falls back to fdlibm" was a
correct, specific, *insufficient* theory: it predicted one target and there
were two, and the second was the one people actually play. A rule that
enumerates targets loses a race against the next target; the fix is for the
primitive to not ask.

**So `js_pow` carries the routine.** `jsmath::pow_arm` is ARM's
optimized-routines `pow` — what glibc ships and what the runtime matches —
with tables generated by `scripts/transcribe-pow-tables.py` rather than copied
by hand (128 four-double rows and 256 u64s is a table that is right in 383
places).

**⚠️ And the transcription alone was not enough, which is the finding.** Every
operation exactly as the C spells it, both `HAVE_FAST_FMA` arms tried, still
differed on **153 of 200,001** — 130× better than fdlibm and still not parity.
The missing arithmetic is not in the source at all: glibc compiles its
`e_pow-fma` ifunc variant with `-mfma`, and GCC's default
`-ffp-contract=fast` then fuses `a*b + c` into single `fma`s that the C never
writes. Five builds of the same file settle it — `-mfma` gives 0 divergences,
`-mfma -ffp-contract=off` gives exactly 153, plain `-O2` gives 153 — and under
contraction the two `HAVE_FAST_FMA` arms converge, so the arm never mattered.
`scripts/pow-contraction-probe.c` is that experiment, kept.

Which expressions get fused was read off `-fdump-tree-optimized`, not guessed;
each `mul_add` in `pow_arm.rs` is one line of that dump, including the two
places GCC *declines* to fuse because `ar2` has other readers. Rust never
contracts on its own, which is exactly why the result is portable.

**Rules this adds.**

4. **A transcription is of a BUILD, not a file.** Optimisation flags are part
   of the algorithm when the algorithm is bit-exact arithmetic. Before
   concluding a faithful port is faithful, compile the original both ways.
5. **"More accurate" is not the goal and can be the bug.** Against a 60-digit
   reference, the *unfused* form is the correctly-rounded answer at
   x = 0.00944 and the runtime's is not. Both are legal ≤0.54 ulp results. The
   requirement is the runtime's bits; a better `pow` fails this gate.
6. **The oracle now has a hardware precondition.** These fixtures were exported
   on a CPU with FMA, so node used glibc's FMA ifunc variant. A machine without
   it would export different bytes from the same node build.
7. Two gates, both cheap, both CI-able (no GPU): `node
   scripts/jsmath-wasm-check.mjs` and `cargo test --target
   x86_64-pc-windows-gnullvm -p pk-core --test jsmath_oracle`. Run them when a
   primitive lands, not when a floor looks wrong.

**Closed 2026-08-10 — `js_cos`/`js_sin` landed, and the corpus is whole.**
Sun's 1993 `s_sin.c`/`s_cos.c`/`k_sin.c`/`k_cos.c`/`e_rem_pio2.c`/
`k_rem_pio2.c`, transcribed verbatim into `jsmath/fdlibm.rs`. All ten corpus
floors are bit-exact at the pass-1 boundary and the by-name exclusion list is
deleted rather than shrunk. Over the oracle's ten trig sweeps the twins match
every one; `libm` differs on 918–2,024 inputs per sweep and std on
1,604–6,815.

Three things came out of doing it that are worth more than the twins:

- **The `js_pow` gate had never executed.** It read
  `assets/fixtures/jsmath-pow-oracle.json`; the exporter has always written
  `jsmath-oracle.json`. So the test failed at the file read with *"fixture
  missing — run the exporter"*, which reads as an unconfigured checkout, not
  as a broken gate. The parity gate written to catch 1-ulp drift had been
  reporting a setup problem since the day it landed. A missing-fixture panic
  is a claim about a PATH; check the name before you believe it.
- **The sweep list did not cover what its comment claimed.** The comment said
  the ranges reached "the multi-word reduction where implementations differ
  most". They did not: the reduction switches to the 2/π table at
  2^20·(π/2) ≈ 1.647e6, and the largest sweep stopped at 1e6. Three ranges
  added (1e8, 1e15, 1e300). The twins match all three, so `k_rem_pio2` is
  measured rather than assumed — but for a while a whole branch was covered
  only by a sentence.
- **`exp` and `log` have no agreeing implementation, and are already called.**
  Same story as `cos` — V8 keeps fdlibm's `e_exp.c`/`e_log.c`, everyone else
  moved to the table-driven ARM optimized-routines versions.
  `pk_core::combo` calls `libm::exp`/`libm::log` for the corner-restitution,
  corner-add and combo-window curves that feed pinball physics;
  `gambler::darts` calls `libm::log10`; `intro.rs` uses std `ln`/`exp`. The
  600-tick momentum fixture is bit-exact today, which is a fact about the
  inputs those traces happen to take and NOT about the primitives being safe.
  Pinned as a named gap test that fails when a twin lands.

**Rule 4, learned here.** A gate that cannot fail is not a gate, and the
failure modes are quieter than "it went green": a path typo that reads as a
missing fixture, a comment that asserts coverage the numbers do not provide,
and a primitive nobody swept because nobody noticed it was being called. All
three passed review as recently as the commit that introduced them.

**Closed the same day — `js_exp`/`js_log`, and a lesson about reading a
digest.** The survey printed the same four words for both rows,
`NOTHING MATCHES`, and the two rows had nothing to do with each other.

- `log` IS the `cos` story. `libm::log` is musl's table-driven
  optimized-routines version; V8 kept fdlibm 5.3. Verbatim `e_log.c`
  reproduces the runtime. The divergence is confined to the `k == 0` band
  (√2/2 … √2) where `k·ln2` stops dominating the sum — 2,013 of 50,001 inputs
  there, and **zero** at 1e300 and zero in the subnormals.
- `exp` is NOT. `libm::exp` already **is** fdlibm's `e_exp` — the Rust crate
  never took the rewrite. Across eight ranges and ~400,000 inputs it misses the
  runtime on exactly one: `x == 1`, where V8 answers `Math.E`. It shows in the
  raw dump as a break in monotonicity (`…768, …769, …769, …76b` — `76a`
  skipped). `js_exp` is `e_exp.c` plus one guard.

**Rule 5.** A digest is a verdict, not a diagnosis. "This curve is wrong" over
200,001 points and "this curve is wrong at one point" produce the identical
failure, and acting on the verdict alone would have justified a 200-line
transcription on evidence that supported a one-line guard. Dump the raw f64s
and diff them per input — `legacy/scripts/dump-trig-sweep.mjs` against
`cargo run -p pk-core --example dump_unary` — BEFORE deciding what the fix is.
It named the input on the first run.

Consequence for the negative controls: they can no longer be one blanket
"`libm` disagrees", because for five of the new sweeps `libm` agrees exactly
and asserting otherwise would pin a falsehood. They are now per-range, with
`libm::exp`'s divergence pinned at *exactly one* swept range — so adding a
sweep that contains 1.0, or a `libm` that stops being fdlibm, both fail loudly.

**What the sabotage pass found — the gates hold, with three named holes.**
Seventeen sabotages, each reverted, all re-run under a private target dir.

- **The three huge sweeps are not decoration.** Disabling the multi-word
  reduction (medium-size bound raised so `k_rem_pio2` is never called) turns
  exactly the six 1e8/1e15/1e300 ranges red and leaves the four small ones
  green. Those ranges were added on suspicion; they are the only thing that
  catches it.
- **Three of the prescribed sabotages were NO-OPS, and that is a result.**
  Perturbing C6's last digit produces the *same f64* (below the parse floor,
  not the rounding floor). `trunc(a + 0.5)` vs `round(a)` are arithmetically
  identical over this branch's reachable domain. Reverting `track_grow:326` to
  `libm` changes nothing because Spine's theta is one of {0, π/4, π/2, 3π/4},
  where every implementation agrees bit-for-bit. A sabotage that does not
  reproduce a defect proves nothing about the gate — it has to be replaced,
  not scored.
- **Hole 1: the readable unit test did not catch the mistake it documents.**
  `cos(0.1)` stayed green under a FreeBSD-ised `kernel_cos`, a FreeBSD-ised
  `kernel_sin`, AND deleting the `qx` branch — all three of which turn all ten
  sweeps red. At one input the two polynomial forms usually round the same; what
  differs at `cos(0.1)` is the shape of the final sum. Now spread across all
  three `kernel_cos` branches and both `kernel_sin` tail modes, with a header
  that says plainly it is not the gate.
- **Hole 2: both gates halted on the first divergence and threw away the
  shape.** One red range means a branch bug; ten red ranges mean the kernel.
  One moved floor means a value on a rounding boundary; three mean the
  algorithm — and deleting `qx` moves three while the old abort reported one.
  Both now collect and report the whole set.
- **Hole 3: two things are untestable here and now say so in the code.** The
  third Cody–Waite iteration (`if i > 49`) is reached **zero** times across
  every sweep and every corpus floor while the second fires 192,436 times —
  deleting it is undetectable. And only about the first EIGHT significant
  digits of the trailing coefficients are load-bearing: a genuine 1-ulp change
  to C6 is invisible to everything.
- **The maze corpus is a much weaker trig gate than it looks.** Across the five
  hub floors, 153 trig calls, 3 differ between `js_*` and `libm`, and exactly
  ONE moves a node into a different cell. The maze side of this rests on a
  single sample; the sweeps carry the weight. The corpus also cannot see the
  `sin` half at all — FreeBSD-ising `kernel_sin` leaves 10 of 10 floors green.

**The call sites: `combo.rs` switched, and the switch changes nothing.** All
five (`comboSpeedCeil`'s `log`, the restitution/add/window `exp`s) now call the
twins, and every trace stayed bit-exact — which is exactly the situation the
repo's own rule warns about, so it was measured rather than assumed. The raw
`log(1 + 0.15·n)` really does differ from `libm`'s on 2 of the first 201 combo
depths; `combo_speed_ceil` does not differ on any of them, because `num / den`
divides the ulp away. The `exp` sites are safe for a different reason:
`libm::exp` already IS fdlibm and its only divergence is at `x == 1`, which
`-λ·n ≤ 0` cannot reach.

So the switch is correct-by-construction, not a bug fixed, and **no test can
tell the two versions apart today** — recorded in `combo.rs`'s header rather
than left as an unexplained green. It is still right: `bounce_combo` is integral
only because `comboTicks` is 0/1/2 with a one-draw pick and no blending, and
`COMBO_CEIL_K` is a tuning constant. Move either and the divergence becomes
reachable as a physics desync nobody would trace back to a logarithm.

**Still open:** `intro.rs`'s camera zoom still uses std `ln`/`exp`, and it is
not covered by any fixture — `intro_trace.rs` replays the ball, not the camera
pose. A fixture has to exist before that switch can be verified, so it is
deliberately not made. `Math.log10`
is computed independently by V8 (not `log(x)/LN10` — they differ 1–2 ulp) and
`libm::log10` misses on 3,827 of 100,001, but no `Math.log10` exists anywhere in
the legacy TS, so `darts.rs`'s use of it is Rust-original with no runtime answer
to reproduce and needs no twin today.

## 2026-08-09 — serde_json silently mangles the parity fixtures

The very first bit-exact fixture replay failed at tick 12:
`0.9100000000000037` (fixture, confirmed in the raw JSON and by Python)
read back as `…36` in Rust. The sim was bit-perfect — **serde_json's default
float parsing is fast but up to 1 ulp lossy**. The `float_roundtrip` feature
makes it correctly rounded; it is now enabled in the workspace with a
LOAD-BEARING comment.

**Rule:** the harness must be held to the same bit-exactness as the sim.
Any new fixture reader (another format, another crate) gets a
known-hard-decimal round-trip test before it is trusted. Also proof the
harness works: it caught a real 1-ulp bug on its first run — just in its own
parser rather than the port.

## 2026-08-09 — SwiftShader WebGPU fails 4-byte mapped buffers

Headless WSL Chrome with `--use-webgpu-adapter=swiftshader` panics the wasm
build in `createBuffer`: *"size (4) is too large for the implementation when
mappedAtCreation == true"*. Instrumenting every `createBuffer` showed only
3.3 MB total allocated, 0.1 MB of it mapped, before a **4-byte** mapped
allocation failed — and the same call succeeds on a fresh device. Not memory
pressure, not our textures (reproduced with ÷8 sheets): a SwiftShader defect
in mapped-buffer allocation after ~35 buffers of Bevy device setup.

**Rule:** SwiftShader cannot smoke-test this Bevy app at all — it isn't just
wrong-perf, it's wrong-correctness. All wasm verification goes through real
Windows host Chrome over CDP (`legacy/scripts/lib/host-chrome.mjs`, same infra
the TS playtest used). That path verified the slice end-to-end the same day.

## Inherited from the TS era (so the port doesn't relive them)

- **2026-08-08 — "A port that deletes ships green."** A sub-phase 6/7 "native
  WebGPU" conversion in braindeadbot-client deleted the renderer and room art
  it claimed to port; new tests certified the stubs; it shipped live and was
  reverted (`7937bfe`). Lesson for THIS port: parity fixtures against the
  legacy oracle, in the same PR as the ported code — a green suite over stubs
  proves nothing unless the suite is the oracle's.
- **Inbox sidecar vs published manifest.** Two JSON shapes; conflating them
  fails silently (loader falls back to the painter with no error). `pk-assets`
  now owns both shapes in the type system.
- **WSL GPU mirages.** SwiftShader (headless) and WSLg/llvmpipe render
  wrong-perf truth; every GPU timing must come from Windows host Chrome or a
  host-native build.

*(new incidents go above this line, newest first)*
