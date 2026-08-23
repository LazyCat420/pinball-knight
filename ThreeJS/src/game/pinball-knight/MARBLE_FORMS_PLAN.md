# MARBLE FORMS — six marbles get a body, and three get a mechanic

## What is already here (measured, not assumed)

`MarbleMaterial = "diamond" | "water" | "stone" | "storm" | "shadow" | "lava"`
(`state.ts:49`) shipped a while ago as a **physics + VFX** axis. All six have
tuned constants (`constants/pinball.ts:900-1010`), thirteen pure physics hooks
read at one choke point each (`entities/marble.ts:203-312`), on-bounce and slam
emitters, floor scars, and seven material × terrain reactions.

So this wave is **not** "add six materials". It is the two things that layer
never did:

1. **They have no body.** The clip union is `"ball" | "steelball"`
   (`engine/render/paint-types.ts:45-46`). `steelball` — the 🪩 Ball Form potion
   — is a hand-painted chrome sphere (`render/cel-painter.ts:996-1170`). Every
   *material* still draws `ball`: the tucked knight, with the material showing
   only as trail-ghost tint. That is the "we have the metal one, we still need
   the other six" gap, and it is the headline of this wave.
2. **Half the named behaviours are absent.** Table below.

### Behaviour audit

| Asked for | Status |
|---|---|
| water is slippery, leaves a slippery trail | ✅ shipped — `WATER_FRICTION_MULT`, `WATER_STEER_MULT`, `slick` floor-fx. Tune only. |
| diamond cuts through enemies | ❌ diamond throws shards on bounce; it never passes *through* anything |
| diamond can't break | ❌ the `sapper` enemy strips any material on hit, diamond included |
| water smooshes on wall hit | ❌ no squash-and-stretch anywhere in the codebase |
| stone smashes walls | ⚠️ partial — stone keeps 0.9 of its speed through masonry, but only **diamond** lowers the break *threshold*. Stone can't start a smash it isn't already fast enough for. |
| storm turns into a bouncing lightning bolt | ❌ nothing like it |
| shadow passes through walls | ❌ `SHADOW_PLAYER_R` only shrinks the collider 0.3 → 0.21 |
| shadow kills ghost types | ❌ |
| shadow vampires health | ❌ (`lifesteal` exists, but only as a card modifier: `cards.ts:56`) |
| lava melts walls partially | ❌ **walls have no HP at all** — `smashWallAt` is a binary speed gate (`secrets.ts:372`) |
| laser power-up | ❌ zero hits for "laser" in the tree |

### The two load-bearing facts that shape the design

- **Walls are binary.** `WALL_BREAK_SPEED = 15` and that's the whole model.
  Lava's "melts the wall a little bit" needs a genuine erosion system — that is
  the single biggest piece of new machinery here.
- **Storm's bolt form and the laser power-up are the same mechanic.**
  Both are "2-3 seconds of uncontrollable rapid random ricochet". They get
  **one** subsystem with two flavours, not two parallel implementations.

---

## Design

### 1. The bodies — one parametric painter, not six copies

`steelBallFrames` is ~175 lines for one material. Six more copies would be a
thousand lines of near-duplicate canvas code. Instead: **one `marbleFrame(skin,
spin)`** driven by a `MarbleSkin` spec — the same "monsters are painters, not
images" rule the roster already follows.

A skin declares: body gradient stops, a *surface treatment* (`facet` | `fluid` |
`rough` | `arc` | `void` | `crust`), band/specular strength, and a rim glow.
`spin` rotates the surface treatment only, so the silhouette stays perfectly
round while the ball visibly rolls — the trick `steelball` already uses.

| Material | Treatment | What sells it |
|---|---|---|
| 💎 diamond | `facet` | hard polygonal facets, prismatic edge fringing, a razor specular with almost no falloff, near-white core |
| 💧 water | `fluid` | translucent body, an internal meniscus line that lags the spin, a refracted bright spot *below* centre, soft rim |
| 🪨 stone | `rough` | matte — **no specular at all** (that absence is the whole tell), pitted craters, heavy dark occlusion under |
| ⚡ storm | `arc` | dark storm-blue core, crawling lightning filaments that re-seed per frame, blown-out electric rim |
| 🌑 shadow | `void` | inverted lighting — *darkest where the highlight should be* — with a violet rim glow that is the only bright thing |
| 🔥 lava | `crust` | dark basalt plates with glowing molten seams between them; the crust rotates, the glow does not |

Six clips: `diamondball` … `lavaball`. Each 4 frames, all sharing the `ball`
cadence. Frames are handed to all three facings **by reference** — a sphere
looks the same from every angle, and `buildSpriteSheet` dedupes by reference
(`engine/render/sprite.ts:552-560`), so 6 clips cost 24 atlas frames, not 72.

### 2. Squash-and-stretch (water, and a touch of lava)

New `p.squashT` / `p.squashNx` / `p.squashNz`, set on wall contact, decaying
over ~0.18s. The sprite mesh scales non-uniformly: compressed along the
contact normal, bulged perpendicular, conserving area. `materialSquash()`
returns the amplitude — water full, lava half, stone/diamond zero (a rock and a
diamond do **not** deform, and that contrast is what makes water read as fluid).

### 3. Wall erosion — the new system lava needs

New `entities/wall-erosion.ts`:

- `state.wallErosion: Map<"i,j", number>` — 0..1, cleared per floor.
- `erodeWallAt(i, j, amount)`: accumulate; at ≥ 1 hand off to the existing
  `smashWallAt(i, j)` so the grid-opening path stays single-sourced.
- **Visual, per instance, no new geometry.** `maze.wallAt` already maps a tile
  to `{ mesh: InstancedMesh, index }` (`maze/build.ts:901-903`) and the wall
  meshes already carry `instanceColor` (`build.ts:1302`). Erosion drives
  `setColorAt` toward molten orange-black and `setMatrixAt` to sag the instance
  in Y — the wall visibly slumps and glows before it goes. Plus embers and a
  scorch floor scar.
- Lava erodes the contacted tile on every fast wall bounce, scaled by speed.
  Several hits to breach: "not full damage" is the point.

The system is deliberately generic (an amount, not a lava call) so future
melters/borers reuse it. Only lava supplies erosion this wave.

### 4. Ricochet form — storm's bolt AND the laser potion

New `entities/ricochet-form.ts`, flavour `"bolt" | "laser"`:

- Input is **ignored** for the duration — that is the fantasy, "you can't
  control it".
- Speed is pinned at a high constant; every wall contact reflects with a large
  randomized deflection so the path reads as chaotic, not billiard-clean.
- It damages whatever it passes through, and it does not stop on contact.
- On expiry: restore control, and eject if it ended somewhere illegal.

Storm enters it from the material slam (storm's existing big move becomes
"become the bolt"). The laser potion enters it directly. Same code, different
speed / damage / trail colour / sprite.

### 5. Per-material behaviour work

- **diamond** — `materialCutsThrough()`: above a speed gate, a ram does not
  bounce or knock back; the ball passes *through* the foe, applying a slice and
  **keeping its momentum**. Plus material-drain immunity, so it "can't break".
- **stone** — its own `STONE_WALL_BREAK_SPEED` / `STONE_SECRET_BREAK_SPEED`.
  Lower than default, higher than diamond: stone smashes by **mass**, so it
  still needs real momentum, where diamond smashes by hardness and needs almost
  none. The two must not feel the same.
- **shadow** — three additions: wall phasing (skip wall resolution in the ride
  sweep, with a guaranteed eject on expiry so the run can never end sealed
  inside masonry), a slayer multiplier that deletes the wall-phasing roster
  (`ghost`, `reaper`, `wisp`), and lifesteal on ram with a cooldown.

### 6. Drift guard

`MarbleMaterial` is **not** in `registry-drift.mjs`'s `UNIONS` (`:97-100`), so
none of the ten hand-maintained marble tables are checked. Registering it is a
two-line change that immediately covers the `MATERIAL_LIST` array, the debug
chips, and any `MarbleMaterial[]` literal in a test. Highest leverage line in
the wave — it goes in first, before the tables start multiplying.

---

## Checklist

### Wave 0 — guard rails
- [x] Register `MarbleMaterial` in `scripts/hooks/registry-drift.mjs` UNIONS
- [x] Add a clip-coverage check: every material has a `<material>ball` clip in
      `paint-types`, `animator` (cadence + LOOPS), and `sprite.ts` clipNames

### Wave 1 — the bodies
- [x] `MarbleSkin` spec + parametric `marbleFrame(skin, spin)` in `cel-painter`
- [x] Six treatments: facet / fluid / rough / arc / void / crust
- [x] `MARBLE_SKINS: Record<MarbleMaterial, MarbleSkin>` (tsc-enforced)
- [x] Register six clips, deduped by reference across facings
- [x] `paint-types` union · `animator` cadence + LOOPS · `sprite.ts` clipNames
- [x] `player.ts:1642` clip selection: material > ironT > plain ball
- [x] Frame-count check — the atlas grid must not regress

### Wave 2 — squash
- [x] `squashT` / `squashNx` / `squashNz` on the player + init
- [x] Set on wall contact; decay in the ride tick
- [x] `materialSquash()` amplitude per material (water 1, lava 0.5, rest 0)
- [x] Apply as non-uniform sprite scale, area-conserving

### Wave 3 — behaviours
- [x] diamond: `materialCutsThrough()` — pass through, slice, keep momentum
- [x] diamond: immune to the `sapper` material drain
- [x] stone: `STONE_WALL_BREAK_SPEED` / `STONE_SECRET_BREAK_SPEED`
- [x] shadow: wall phasing + **guaranteed eject** on expiry
- [x] shadow: slayer multiplier vs `ghost` / `reaper` / `wisp`
- [x] shadow: lifesteal on ram, cooldowned
- [x] water: verify the shipped slip physics still reads right; tune

### Wave 4 — wall erosion
- [x] `entities/wall-erosion.ts` — map, `erodeWallAt`, handoff to `smashWallAt`
- [x] Per-instance melt visual (`setColorAt` glow + `setMatrixAt` sag)
- [x] Embers / smoke / scorch scar
- [x] Clear on floor change
- [x] Lava erodes on fast wall bounce, speed-scaled

### Wave 5 — ricochet form
- [x] `entities/ricochet-form.ts` — enter / tick / exit, input lockout
- [x] Randomized deflection on every wall contact
- [x] Damage on pass-through
- [x] Storm slam enters bolt flavour
- [x] Bolt visual: zigzag lightning body

### Wave 6 — laser potion
- [x] `laser` in `PotionId` / `POTIONS` / `POTION_IDS`
- [x] `p.laserT` + buff tick + HUD chip
- [x] Enters ricochet form, laser flavour
- [x] Laser visual: a beam, not a marble
- [x] Shop row + floor spawn weighting

### Wave 7 — verify and ship
- [x] Unit tests per wave (erosion, cut-through, phasing+eject, ricochet, laser)
- [x] `npx tsc --noEmit -p tsconfig.json` scoped to pinball-knight — **zero**
- [x] `node scripts/hooks/registry-drift.mjs`
- [x] Full suite (88s)
- [x] `__lab` visual QA of all six bodies + the two ricochet forms
- [x] Commit on `feat/marble-forms`, merge to `main`, delete branch + worktree
- [x] Deploy, then hand off

## What the build actually taught us

Two findings that were not in the plan and cost real time:

**1. The palette snap is LUMA-WEIGHTED, and it will steal your colours.**
The six skins were first authored in free-hand hex (`#6fc4e8` for water,
`#b06fe8` for shadow). They looked correct at 128px. But the screen-space
quantizer snaps every texel to the 32-entry palette using a luma-weighted
distance, where green carries 0.587 — so a mid-luminance cyan is matched
mostly on its GREEN channel, and the rot ramp (6-9) sits closer in green than
the arcane ramp the colour belongs to. Measured with `scripts/marble-census.mjs`:
**26.8% of the water marble was rot green**, and shadow's violet was
snapping to skin-brown. No test could see it; at 128px the eye could not
either. Three fixes, in order of how much each bought:

  · author every colour as a palette entry (`pc(n)`), never free hex,
  · HARD-STOP the gradients, so there are no intermediate tones to mis-snap,
  · prefer opaque flat shapes to translucent washes (which is also just
    correct for cel shading — a specular is a shape, not a bloom).

Water went 26.8% → 9.1% rot, lava to 0.1%. `marble-census.mjs` exists so the
next person can measure instead of arguing.

**Note the palette has no purple and no magenta.** Shadow's "glowing dark
purple" is steel-dark 19 (the only violet-leaning entry) glowing against a
void-black body; the laser is blood 12-13. Those are the honest limits of
32 colours, and pretending otherwise is what produced brown and green.

**2. A 45° isometric makes an axis-aligned squash cancel to nothing.**
`squashScale` first blended both screen axes (`1 − d·|hx| + d·|hy|`). This
camera maps every axis-aligned world normal — i.e. every wall in the maze — to
|hx| = |hy|, where those terms cancel exactly and the scale returns [1, 1]. The
squash was a silent no-op in the only case that ever occurs. It now picks a
dominant axis, and the test feeds WORLD-axis normals specifically so a future
version cannot pass by testing a pre-projected one.

Also: the naive `[1−d, 1+d]` pair multiplies to 1−d², so the ball quietly lost
~16% of its apparent area on every impact. The bulge is now the reciprocal.

## Risks

- **Shadow phasing sealing the run.** The eject-on-expiry path is mandatory and
  gets its own test; a player stuck inside masonry is an unrecoverable run.
- **Atlas width.** 24 new frames on a texture that has a documented history of
  silently resizing past its ceiling and rendering a black screen
  (`sprite.ts:575+`). Frame count gets checked, not assumed.
- **Erosion vs. the flow field.** `smashWallAt` resets `state.flowTimer` so the
  horde re-paths. Erosion must only do that at the moment of breach, not per tick.
- **`npm run lint` is broken** in this repo (Next 16 removed `next lint`). tsc
  and registry-drift are the real gates.
