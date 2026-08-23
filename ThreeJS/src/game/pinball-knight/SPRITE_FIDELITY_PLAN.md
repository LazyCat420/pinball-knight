# SPRITE FIDELITY — kill the confetti, lock the palette, unstiffen the walk

Written 2026-07-30 after two shipped fix waves and one measurement session.
The complaint that started it: *"the monsters have all this noise / don't look
clean / the style could be more defined"*, with Ragnarok Online as the target
look. The jester was correctly singled out by eye as the worst — the numbers
agree exactly, and this document is the numbers plus the plan they imply.

**Read `[[art-qa-must-measure-the-live-atlas]]` in agent memory first.** The one
rule that matters: the 128-unit authored cel is a SKETCH. The product is the
81-texel atlas cell. Review, census and gate on the atlas or you are approving a
picture nobody renders — that mistake shipped a brown giraffe past 13 green
tests.

---

## 1. How a monster sprite is actually built (so nobody re-derives this)

Four stations. Confusing any two of them is the source of every bug in this file.

```
painter fn (128 art units, vector shapes)      render/monsters/<kind>.ts
   │  paintInArtSpace: setTransform(SS) where SS = SPRITE_PX / ART_PX
   ▼
raster buffer  162 px                          engine/render/sprite.ts
   │  crushToGrid: separable premultiplied AREA-AVERAGE box filter (exact ÷2)
   │               then snapColor() every pixel to the 32-entry palette
   ▼
atlas cell  81 texels  ── packed into one strip per monster ──▶ CanvasTexture
   │  one camera-facing quad, unlit MeshBasicMaterial, alphaTest 0.5,
   │  NearestFilter, no mips. Animation = sliding tex.offset. Flip = negative
   │  repeat.x. RESKIN mesh scale MUST be 1.0 (non-integer breaks texel identity)
   ▼
pixel pass (screen)                            engine/render/pixel-pass.ts
      AO → bloom → linear→sRGB → vignette → ink outline → UI → flash
      → Bayer dither → 32-palette snap → scanlines
```

Key constants (`constants/render.ts`), and the identity that binds them:

| constant | value | meaning |
|---|---|---|
| `ART_PX` | 128 | the painter's coordinate space |
| `SPRITE_PX` | 162 | rasterisation buffer — MUST be an integer multiple of the grid |
| `SPRITE_PIXEL_GRID` | 81 | stored texels per cell |
| `PPU` | 72 | render pixels per world unit |
| `SPRITE_UNITS` | 1.125 | sprite world height |

    SPRITE_UNITS * PPU === SPRITE_PIXEL_GRID     (1.125 * 72 === 81)

**ONE TEXEL = 128 / 81 = 1.580 art units.** Write that on the wall. Every
feature a painter draws "a couple of units wide" is *sub-texel*.

`figure.ts` auto-paints each solid shape as up to **five** tonal bands: selout
ink (`INK_W` 3.2), shade fill, mid inset (nudged up-left), warm rim (upper-left),
and a cross-family BOUNCE edge (`BOUNCE_W` 1.9, `BOUNCE_FOR` table). So a shape
count is not a colour count — multiply by ~4.

---

## 2. The measurements (reproduce before changing anything)

Metrics, all computed on the **atlas cell**, `alpha > 127` only (what the GPU
keeps past `alphaTest`):

- **`runLen`** — mean horizontal run of identical palette entries. Pixel art is
  runs; noise is runs of 1. Best single "is it flat" number.
- **`isolated%`** — pixels differing from ALL four orthogonal opaque neighbours.
  A literal orphan-pixel count.
- **`entries`** — distinct palette indices in one frame.

| monster | entries | isolated% | runLen | verdict |
|---|---|---|---|---|
| **brute** | **18** | **11.5** | **2.25** | cleanest — nobody complains |
| zombie | 19 | 20.3 | 1.66 | fine |
| goblin | 21 | 31.3 | 1.73 | ok |
| hound | 22 | 35.5 | 1.51 | noisy |
| stiltneck | 26 | 33.2 | 1.42 | noisy |
| rotortail | 29 | 39.0 | 1.44 | bad |
| **jester** | **31** | **41.8** | **1.36** | **worst — matches the eye** |

> ⚠️ **THE TABLE ABOVE IS AT THE WRONG RUNG — superseded, see §8.** It was taken
> at grid 81 (`normal`, PPU 72). The shipped default is `wider`, PPU 56, **grid
> 63**, so one texel is **2.032** art units, not 1.580. It also covers 7 of 20
> actors. §8 has the measured roster at the shipped rung, reproducible with one
> command. Two consequences of the rung error worth carrying: the eye glows are
> **1.28–2.36 texels** at 63 (so a naive despeckle deletes them — the claim in
> §4 Wave 1a that they "are 2+ texels" is false), and `BOUNCE_W` 1.9 is **0.93
> texels**, i.e. the bounce band is itself sub-texel on every material.

Near-monotonic in `entries`. The brute is *already* at the 16-18 budget every
pixel-art guide recommends; the jester spends 31 of 32.

**Per-region (rotortail idle E):** rotor band `y0..28` = runLen 1.39,
isolated 41.1%, 29 entries. Body band `y28..60` = 1.54 / 35.5% / 17. The rotor
is the worst region and it is where the three translucent free-hex washes live.

**Shape budget (rotortail idle):** 28 `ellShaded` + 7 `limbShaded` +
4 `plateShaded` = **39 solids** → ~170 tonal regions, inside a figure occupying
~2,000 texels. **≈12 texels per tonal region** — a region that size has no
interior, it is all edge. Plus **18 `detail()` marks** and 2 glows.

**THE DECISIVE NUMBER.** The rotortail painter declares 18 palette indices; the
`BOUNCE_FOR` table adds 2; the atlas contains **29**.

    declared 18  +  bounce 2  =  20 intended        MEASURED 29
    → 9 entries nobody chose, invented by the downscale + snap

**This is why a "use ≤16 colours" style rule cannot work by discipline.** The
pipeline adds colours after the artist is finished. A 16-colour budget is only
real if the crush *snaps to the sprite's own subset*.

### Reproducing the census

`/tmp/.../scratchpad/noise-census.mjs` from the diagnosis session is gone with
the session. Rebuild it from `scripts/stiltneck-sheet.mjs`, which already does
the hard part (bundle → real `paintInArtSpace` → real `crushToGrid` → census).
Two gotchas that cost time:

- `card-harness.mjs` `bundle()` uses `resolveDir: process.cwd()` — **run from the
  repo root**.
- `open()` uses `setContent`, i.e. `about:blank`, where **`localStorage` throws**
  and something in the game's import graph reads it at module load. Stub it in a
  `<script>` before the bundle or the harness dies on storage policy, not art.

### The in-game A/B method (this is the one that finds real bugs)

Dev server on a spare port → playwright + swiftshader →
`/dungeon?seed=777` (**pins maze AND biome — unseeded runs roll different themes
and the comparison is worthless**) → seed
`localStorage["pinball-knight-settings"]` per variant (quantize / dither /
scanline / outline are applied at boot) → `__dungeonStartRun()` → wait on
`__dungeonPlayer().active` → `__lab.only(kind)` → screenshot.

`__lab.floor(n)` from the tavern builds a level but never swaps the presented
scene — enter through `__dungeonStartRun`. First-visit descent needs ~15 s
(shader compile), not 9.

---

## 3. Root causes, ranked

1. **Too many tonal regions per texel.** ~170 regions in ~2,000 texels. Drives
   `runLen` to 1.4 and forces edge-only shapes. Worst on the newest, most
   detailed painters — which is the opposite of the intent.
2. **`detail()` floors its width at one texel** (`TEXEL()` in `figure.ts`). That
   floor was added to stop sub-texel marks becoming invisible fractional tints —
   it converted *invisible* confetti into *visible* single-pixel confetti. The
   rotortail's 18 detail calls (whiskers 0.63 texels, grain 0.70, scutes 0.76,
   rivets 1.27) are orphan pixels by construction.
3. **The snap invents colours.** 9 unrequested entries on the rotortail; the
   area-average blends across texel boundaries and the nearest-of-32 lookup
   sends each blend wherever the luma-weighted metric points — frequently a
   different material family.
4. **Translucent free-hex washes.** `rotortail.ts` still has three:
   `rgba(255,243,200,…)` rotor blur rings (L197), `rgba(255,217,138,…)` speed
   lines (L666), `rgba(214,159,126,…)` release arc (L693). Already fixed once on
   the stiltneck's swing arcs — see `neckTube`/`sweep()` there for the pattern
   (palette-index polylines via `figDetail`, fade as a COUNT of strokes, not
   alpha). **Grep the whole `render/` tree for `rgba(` before starting.**
5. **Stiffness is unrelated to any of the above** — it is frame counts and
   rates. See §5.

---

## 4. THE PLAN

### Wave 1 — engine despeckle + small-shape tone suppression
*Helps all 22 monsters at once. No art re-authoring. Do this first.*

**1a. Despeckle after the snap, inside the crush.** In `crushInto`/
`crushToGridShared` (`engine/render/sprite.ts`), after every pixel is snapped:
any opaque texel whose colour differs from all four orthogonal opaque
neighbours adopts the **majority neighbour colour** (ties → the neighbour with
the lowest palette index, so it is deterministic). This is the universal pixel-art
rule ("orphan pixels are avoided — responsible for the image looking noisy")
applied algorithmically; it is the "pixel-over" cleanup practitioners do by hand
and what tools like PixelRefiner automate.

- Do NOT despeckle the ink outline into oblivion — run it *once*, not to
  convergence, and skip texels whose colour is index 1 (ink) or 0 (void).
- Preserve intentional single-pixel highlights? Measure first. The eye glows go
  through `figGlow` and are 2+ texels; they should survive. If they don't, exempt
  a small "sparkle" allow-list rather than weakening the pass.
- **Target: `isolated%` under 15 on every monster** (brute is 11.5 unaided).
  `runLen` should rise toward 1.8+.

**1b. Suppress `rim` and `bounce` on small shapes.** In `figure.ts`, skip the
rim and bounce bands when the shape's smaller extent is under ~6 art units
(≈4 texels) — `ellShaded` already gates bounce on `rx > 3 && ry > 3`; extend the
idea to `rim`, and add the same gate to `limbShaded` (by width) and
`plateShaded` (by bbox). A 12-texel region cannot show five tones; it just
generates blends.

**1c. Kill the remaining `rgba()` washes** in `rotortail.ts` (and anything the
grep finds), using the stiltneck `sweep()` pattern.

**Gate it:** promote the census into a real test — `render/monsters/noise.test.ts`
— asserting per-monster `isolated% < 15` and `entries <= 22` for the *current*
roster, measured through `paintInArtSpace` → `crushToGrid`. That is the gate that
makes Wave 2's budget enforceable.

**Verify:** seeded in-game A/B (§2) on the jester and rotortail specifically,
plus `scripts/foe-sheet.mjs`-style contact sheets. Expect the biggest visible
delta of the whole plan.

### Wave 2 — per-sprite 16-colour palette lock (the RO/SNES model)
*The structural fix, and the thing the user actually asked for. Pilot it.*

Keep the 32-entry master palette (the environment needs all 8 families). Give
each monster a declared **subset of ≤16**, and make the crush snap to *that
subset*.

**Why 16:** SNES sprites got 15 + transparent from a 256-entry CGRAM; RO `.spr`
files are 256-colour indexed with per-sprite subsets and `.pal` dye swaps; modern
guidance is 8-16 per sprite / "12 of 32" for a character, with 3-4 values per
material ramp (5-7 only above 64px). 16 decomposes cleanly as
**ink + 5 materials × 3 shades** — exactly what these creatures need.

**Mechanism.** `ActorPaints` (or the `BUILDERS` entry in `boot/sheets.ts`) gains
an optional `palette: number[]`. Thread it to `crushToGrid`/`crushInto` and snap
against the subset instead of the full 32. Keep the existing luma-weighted metric
— only the candidate set changes. `snapColor` already isolates the lookup; give
it an optional candidate list and let `snapLut()` stay the fast path for the
full-palette case.

**Order of work.**
1. Pilot on **jester** (31 entries) and **rotortail** (29). Declare their 16 from
   what the painters already ask for — the rotortail declares 18, so it is a
   two-colour edit, not a redesign.
2. Measure. Expect `entries` to drop to ≤16 by construction and `isolated%` to
   fall further (fewer candidates = fewer family hops).
3. Roll out across the roster; tighten the Wave-1 gate to `entries <= 16`.

**Free bonus, worth taking:** a per-sprite palette IS a palette row. Once this
lands, RO-style **dye swaps cost one array** — night/lava/elite variants, damage
flashes as a row swap instead of an RGB multiply, and the `bakeTintedSheet`
expansion tints (shipped 2026-07-30) can retire in favour of proper rows. That
also removes the residual complaint that a baked tint lands wherever the
luma-weighted snap puts it (the wisp's cyan going minty).

### Wave 3 — animation
*Independent of Waves 1-2. Can be done in parallel by a second dev.*

Current (`constants/render.ts`): `FPS_IDLE 3`, `FPS_WALK 8`, `FPS_ATTACK 12`,
`FPS_DEATH 6`, `FPS_RUN 10`, `FPS_ROLL 14`. Rotortail frame counts: idle 2,
walk 4, attack 3, death 4.

Reference practice: the classic walk is **8 frames** (contact, down, passing, up
× 2 legs), compressible to 6; attacks want **3-6** with a **150-200 ms hold on
the impact frame** for weight; idles read better at 4-6 fps with 3+ frames.

- walk 4 → **6-8** on the monsters that read stiffest (rotortail, stiltneck,
  jester, hound).
- attack 3 → **5-6**, and add an impact hold. The animator has no per-frame
  duration today — it steps at `1 / (fps * rate)` (`engine/render/animator.ts`).
  Either add optional per-frame durations, or cheat the hold by **repeating the
  impact frame** (free: `startSpriteSheet` dedupes identical `FramePaint`
  references, so a repeated frame costs zero atlas space).
- idle 2 → **3**.
- **Cost check before committing:** every frame is atlas area and boot paint time.
  `MAX_ATLAS_WIDTH` is enforced in `startSpriteSheet` and throws with a clear
  message. Frames are cheap to *author* (a pose is a parameter set) but not free
  to bake — re-measure `ESSENTIAL` warm-up after.

---

## 5. Already shipped (do not redo)

| change | commit |
|---|---|
| Stiltneck monster + bomb/blast mechanic, 23 tests | `32ff5a0` |
| Atlas-level art QA (`paintInArtSpace`→`crushToGrid` in harness + tests) | `0ac15da` |
| Bodies cap at palette 17 (18 blooms — `BLOOM_THRESHOLD` 0.7 vs 18 ≈ 0.90 luma) | `0ac15da` |
| **Warmth gate** — colour-edge ink skipped where centre + 4 taps are `r ≥ g` | `0ac15da` |
| Stiltneck RESKIN scale 1.12 → 1.0 (texel identity) | `0ac15da` |
| `bakeTintedSheet` — expansion tints baked + palette-snapped, not GPU-multiplied | `739f631` |
| Dither amplitude 2/32 → 1/32 (full step hopped colour families) | `739f631` |
| `dispose.ts` leak — 6 bespoke atlases were never disposed | `739f631` |

## 6. Known open items

- **Non-integer RESKIN scales remain** on golem 1.12, chomper 1.1, hound 1.05,
  rotortail 0.95, pin 0.85 (`spawn/factory.ts`). Each breaks
  `SPRITE_UNITS * PPU === SPRITE_PIXEL_GRID` and duplicates roughly every 8th
  texel row — "uneven pixels", visible as crawl under camera motion. Fix by
  setting 1.0 and resizing **in the art**. Cheap, mechanical, do it during Wave 1.
- **`hud-minimap`** had a fractional blit; noted fixed 2026-07-29 (116→58) but
  worth re-verifying.
- **Baked tints land where the snap puts them.** If a kind's hue identity
  matters, tune its tint *value* until the bake lands on the intended family —
  `spawn/expansion-tint.test.ts` can measure it.
- **`figure.ts` `detail()`'s texel floor** is the direct cause of root cause #2.
  Wave 1a treats the symptom. The deeper fix is for painters to stop asking for
  sub-texel marks at all — consider making `detail()` *throw* in dev when asked
  for less than one texel, so the pressure lands at authoring time.

## 8. MEASURED 2026-07-29 — the seam, the real baseline, and one dead theory

Wave 1's measurement half is **shipped**. Everything below is reproducible in
about three seconds; do not re-derive it by reading code.

**The tooling.**

| piece | what it is |
|---|---|
| `render/atlas-census.ts` | pure metrics — `censusCell`, `declaredSet`, `invented`, `formatNoise` |
| `testkit/atlas-census.ts` | node-canvas harness driving the REAL `paintInArtSpace` → `crushToGrid`; `ROSTER` is `Record<SheetKey,…>` so tsc enforces completeness |
| `testkit/testkit-boundary.test.ts` | keeps node-canvas and `withCrushOptions` out of shipped code |
| `withCrushOptions()` in `sprite.ts` | scoped try/finally variant seam; defaults byte-identical to today |
| `crushToGrid(src, grid?)`, `paintInArtSpace(ctx, paint, px?)` | defaults-only params so a test can pin ANY camera rung. `configureEngine` **cannot** — `sprite.ts` destructures `engineConfig.sprite` into consts at import and never re-derives |

```
CRUSH_AB=1     npx vitest run src/game/pinball-knight/render/crush-variants   # the table
CRUSH_SHEET=/abs/x.png npx vitest run src/game/pinball-knight/render/crush-sheet  # the picture
```

**The real baseline (grid 63, E facing, idle + 2 walk frames, 20 actors).**
Roster mean: **entries 22.9 · isolated 26.2% · runLen 1.73**. Worst offenders are
not the ones §2 named: `chomper` 31/38.2/1.36, `jester` 32/40.5/1.40, `croaker`
32/34.2/1.57, `stiltneck` 30/34.4/1.39, `rotortail` 29/39.9/1.43, `sporeling`
29/27.3/1.68. Cleanest: `golem` 15/6.9/2.64, `brute` 18/12.1/2.28.

**The unsharp mask is a net colour GENERATOR — and its stated rationale is
inverted.** Five arms over the full roster:

| arm | entries | isolated% | runLen | invented | **ink share** |
|---|---|---|---|---|---|
| A per-channel 1.3 (shipped) | 22.9 | 26.2 | 1.73 | 295 | 21.82% |
| **B sharpen OFF** | **20.1** | **22.5** | **1.82** | **238** | **22.84%** |
| C per-channel 0.65 | 21.8 | 23.8 | 1.80 | 271 | 23.38% |
| D luma-only 1.3 | 21.9 | 26.4 | 1.73 | 276 | 21.75% |

The pass exists to stop the selout ink averaging into the fill, so removing it had
to COST ink. It **gains** ink. It was eating the outline, not protecting it.

Two predictions died here; do not re-propose them. *"Amplitude is not the
mechanism, per-channel is"* — false, C sits neatly between A and B, the effect is
monotonic in amount. *"Luma-only keeps the edge without inventing hues"* — false,
D is within noise of A. The mechanism is local-contrast amplification itself.

**Why arm B is not shipped yet.** The stiltneck's gold read is propped up by it:

    sharpen  0.0 → neck torch 0.211 FAIL, torch 0.229 vs leather 0.270 FAIL
             0.65 → 0.246 FAIL      0.9 → 0.250 FAIL (exactly on)      1.3 → pass

The stiltneck does not reach gold on its own art; the sharpen brightens borderline
blends up into the torch ramp instead of letting them fall to leather. That is the
"brown giraffe" failure `b4409e4` fixed. **Fix the art first, re-run the sweep,
then take arm B** — do not loosen the stiltneck bound, it has been retuned twice
already for camera rungs.

**A finding nobody was looking for: half the roster is not painted in the
palette at all.** `declaredSet` measures exact-palette pixels in the pre-crush
buffer. The `render/monsters/` painters declare 13–18 indices as expected. The
older `cel-painter.ts` ones declare almost nothing — **spider declares ZERO**,
brute 6, spitter 4, ghost 4 — because they paint in raw `rgba()`/hex (~30 such
literals in `cel-painter.ts`). So §3's root cause 4 is far larger than "three
washes in rotortail": for those actors, *every* atlas colour is one the pipeline
chose. Wave 1c should be scoped against `cel-painter.ts`, not just the six new
monsters, and `invented` should be read as "undeclared" for them.

**Corrections to the counts in §4/§6.** Seven non-1.0 RESKIN scales, not five
(adds `magnet` 0.95, `webspinner` 1.05). Six `rgba()` washes in `render/monsters/`,
not three (adds `hound.ts:377`, `sporeling.ts:214`), plus a raw hex at
`rotortail.ts:272` that is palette index 27's own value hardcoded.

**Wave 3 as written ships a bug.** `Animator.update` uses ONE global fps per clip
and monsters never call `setRate` — only the player and remote-party do. Walk
4→8 at `FPS_WALK` 8 doubles the cycle to 1.0 s while world speed is unchanged:
foot-sliding. Add `beats?: Partial<Record<ClipName, number>>` to `ActorPaints`
(carried to `SpriteSheet`, applied as `fps × indices.length / beats[clip]`) and
pin every current cycle duration BEFORE the mechanism lands. The impact-hold-by-
repeated-closure trick is verified real: `startSpriteSheet` dedupes by object
reference while `clips` keeps the duplicate index.

## 9. SHIPPED 2026-07-29 — the waves, and what remains

| wave | state |
|---|---|
| Measurement seam, testkit, census, noise gate | **shipped** |
| Unsharp mask retired (roster 22.9→20.1 entries) | **shipped** |
| Stiltneck warmth fixed in the ART (it was propped up by the sharpen) | **shipped** |
| Indexed lighting — shadows walk palette rows | **shipped** (2nd attempt) |
| Per-sprite palette lock, cap 20 | **shipped** |
| `beats` — clips gain in-betweens without retiming | **shipped** (mechanism) |
| 6-8 frame walks on the stiffest monsters | **open** — art work |
| `detail()` sub-texel floor, 7 non-1.0 RESKIN scales, 6 rgba washes | **open** |
| AI-generated sprites vs painters | **open** — generator + judge landed, service unreachable |

**Roster noise, before → after:** entries 22.9 → 20.1 (and capped at 20 by the
lock), isolated 26.2% → 22.5%, runLen 1.73 → 1.82, invented colours 295 → 238.

**The two findings worth carrying forward.** First, the unsharp mask running
before the palette snap was a colour GENERATOR whose own stated justification
was inverted — removing it *gains* ink share. Check a filter's falsifier, not
just the metric you hope improves. Second, lighting was a multiply resolved by
a nearest-of-32 snap, and 24 of 32 entries leave their material family before
0.35 — the tavern floor at 0.95. The green and blue floor tiles on floor 1 were
never moss; they were lit STONE thrown into the rot family.

**Indexed lighting took two attempts.** The first mapped shade linearly to a row
index, which put most of the frame on row 0 and rendered the dungeon bright
grey-brown. The second chooses the row by MATCHING LUMA against what the old
multiply would have produced — self-calibrating, no constant to tune. Verified
on a real WebGPU adapter, tavern and floor 1.

## 7. Definition of done

1. `isolated%` under 15 and `entries` ≤ 16 for every monster, gated in CI.
2. A seeded in-game A/B showing the jester and rotortail before/after.
3. Walk cycles at 6-8 frames on the four stiffest monsters, with boot warm-up
   re-measured and no `MAX_ATLAS_WIDTH` regression.
4. Full suite green (was 135 files / 1540 tests), `tsc` clean,
   `scripts/hooks/registry-drift.mjs` clean.
