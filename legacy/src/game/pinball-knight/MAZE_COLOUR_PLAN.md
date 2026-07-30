# Maze colour — where this stands and what to do next

Written 2026-07-30, after fixing "the colors in the maze are all screwed up".
Read `HANDOFF.md`'s top entry for what shipped; this is the forward-looking half.

---

## 1. What is true now

Indexed lighting is live and, since `9caa89a`, **actually receives its shade
table**. The pixel pass snaps a pixel to a palette index, then walks that index
down its own material family's ramp (`render/palette-shading.ts` `SHADE_DOWN`,
`SHADE_ROWS = 6`, row chosen by matching luma).

For a day it did not. `installEngine()` hand-built a `PaletteSource` that omitted
the optional `shadeDown`, so `setEnginePalette` substituted `descendingChain(32)`
— `i → i-1` — which walks straight out of every family. There is now **one
installer** (`installPalette()`), and `render/palette-install.test.ts` fails if
the boot path stops calling it.

Measured in-game, pinned seeds, real NVIDIA adapter (family share of on-palette
pixels, before → after):

| biome | seed | move |
|---|---|---|
| Cold Crypt | 6 | leather 37.2 → 6.7 |
| Rotting Warren | 1 | rot 2.1 → 10.0 |
| Bloodworks | 2 | blood 5.8 → 46.9, leather 50.7 → 6.5 |
| Arcane Deep | 3 | arcane 1.0 → 2.6, leather 24.7 → 5.9 |

`BIOME_STONE[2]` (Bloodworks) also changed from `[10, 27, 24]` — blood + leather
+ skin, three materials pretending to be one rock — to `[11, 12, 13]`, one blood
ramp.

---

## 2. The next wave: the material index is chosen from the LIT colour

**This is the biggest remaining defect in the colour path, and it is the same
class of bug as the one just fixed.**

`engine/render/pixel-pass.ts` runs its 32-way min-reduction on `col`, which is
the diffuse render target. By then the scene's own three.js lighting is already
multiplied in:

- `AmbientLight(biome.amb, 3.5)` — a **coloured** fill at above-unity intensity
- `HemisphereLight(sky, ground, 1.1)`, `DirectionalLight(0xa7c0e0, 1.5)`
- **six `PointLight(PALETTE_HEX[16], 6, 6)`** — flame orange, intensity 6, parked
  on the nearest torches every frame (`TORCH_LIGHT_POOL = 6`)
- a warm player lamp `0xd9cba8`
- bloom, **added before the snap**

So a warm-lit grey flagstone can still snap to leather or ember, and only *then*
shade correctly down the wrong family. Indexed lighting protects against AO, the
vignette and the ink outline; it does nothing about the term that does most of
the work. `BLUEPRINT.md:576` already records the extreme version — torches at
intensity 18 "lit the whole room warm… the cold crypt came out looking like a
cosy burrow."

### Why measure it now rather than earlier

The `i-1` fallback was masking the size of this. Under it, non-stone families
could not reach ink at all, so warm mis-snaps stayed as mid-tone browns instead
of resolving. **Re-measure before designing.** The question to answer first is
blunt: *what fraction of environment pixels land in a family their albedo does
not belong to?* Until that number exists, any fix is speculation.

### The shape of the fix

Render an **albedo / material target** alongside the diffuse one, snap on that,
and derive `light` from the ratio of lit to unlit luma. Then the entire lighting
chain — scene lights, AO, vignette, outline — becomes one scalar and the family
is chosen from the material, which is what "indexed lighting" means in the SNES
/ RO sense the design cites.

Constraints, from the two failed attempts already recorded in
`render/palette-shading.ts`:

- **Do not** map shade linearly to a row index. That was attempt #1: most of the
  frame lands on row 0 and the dungeon renders bright grey-brown. The shipped
  luma-matching is self-calibrating; keep it.
- **Do not** dither the row. One row is an enormous step; it speckles. Dither the
  target luma (a sub-row quantity), as it does now.
- Sprites are unlit everywhere (`lit: false`), so they already have a clean
  albedo — the target only has to be correct for terrain and props.

### Cheaper things to try first, if the MRT is too big a swing

1. **Desaturate the torch light.** It is `PALETTE_HEX[16]` (`0xf0a63c`), fully
   saturated orange, at intensity 6. Most of the hue rotation comes from here. A
   warmer-but-paler light colour would cut the family crossing without touching
   the render graph. Cheap, measurable with `--census`, easy to revert.
2. **Move bloom after the snap.** It is added in linear before it
   (`pixel-pass.ts`), so a warm halo pushes neighbouring pixels across families
   before the material is chosen.

Neither is the real fix. Both are one-line experiments the census can score.

---

## 3. Ranked backlog after that

1. **Warm props against warm floors.** The warmth gate suppresses colour-edge ink
   where the centre and all four taps have `r ≥ g`. Its premise — "this dungeon's
   environment is cold" — stopped being true when `BIOME_STONE` gained warm rows.
   A brightness term was designed and then **dropped on measurement**: the colour
   edge fires above a 0.26 luma step and no masonry pair reaches it (tavern
   leather steps are 0.095 / 0.100). The one pair that did was the old Bloodworks
   mid→light at 0.279, now gone. But a skin-light prop (0.674) on a leather floor
   (0.317) is a 0.357 step and *is* gated. Settle it with a seeded A/B on the
   tavern, not with a guessed constant.
2. **Surface wash textures hardcode off-palette `rgba()`** (`maze/build.ts:797-870`).
   Each has a comment naming a palette index that the literal does not match, so
   a palette edit silently desyncs them and the biome remap can never reach them.
   This is the sand wash's reddish-brown, among others.
3. **`stoneMat` (`build.ts:1537`) and `stepMat` (`build.ts:1646`)** read
   `PALETTE_HEX[3]` / `[2]` directly instead of `css(3)` / `css(2)`, so pilasters,
   architecture props and stairs stay cold grey on every biome.
4. **`FLOOR_SURFACES[].hex` is dead** (`engine/surfaces.ts:191-201`) — superseded
   by `makeSurfaceWashTexture`; the doc comment still claims it is live.
5. **Shaped walls share the tall-wall texture** (`build.ts:1400, 1456`), so slant
   prisms, round shells and arc sweeps never get mossy/cracked variants.

---

## 4. How to measure anything here

```
pnpm install --prefer-offline                 # in the worktree; node_modules must be REAL
nohup npx next dev -p 5312 &                  # a port nobody else is on
node scripts/biome-ab.mjs --before <old-port> --after 5312 --out /tmp/shots
node scripts/biome-ab.mjs --census /tmp/shots
```

Seeds pin the biome at depth 1: **6** Cold Crypt, **1** Warren, **2** Bloodworks,
**3** Arcane Deep. Unseeded runs roll a different biome and the A/B is noise.

### Four traps this harness already pays for

- **`__dungeonPlayer().active` goes true while the DESCENT CARD is still up.**
  The card is drawn inside the canvas, the loop is HELD during generation, and no
  DOM query can see it. The first run of this harness produced six complete,
  healthy-looking palette censuses **of a loading screen**. The HUD band guard
  rejects those now. Do not remove it; raise `--boot` instead.
- **Measure the saved PNG, not the page.** `document.querySelector("canvas")`
  returns `#room-canvas-element` — the arcade room *behind* the overlay — so the
  guard's own first version reported 0.0% for scenes that were fine.
- **Half the frame is off-palette by design.** The scanline pass dims every other
  row by 0.86. Any census over "all pixels" buries real moves under that
  constant; `--census` uses on-palette pixels as the denominator.
- **Ink (1) and void (0) are not stone.** They are the shared terminator every
  family falls through to. Folding them into the stone bucket hides exactly the
  effect a shading change has.

### The lesson worth carrying

The bug shipped because verification covered one biome and one seed — and worse,
**it was read as the fix**: `51bbd77` recorded "the green and blue checkerboard on
floor 1 — it was never moss… it is now correctly grey", but at seed 777 floor 1
is the Rotting Warren, whose masonry *is* authored rot green. The broken table
greyed out real moss and the greying was written down as a success.

Two guards against a repeat, both now in the repo:

- `render/palette-install.test.ts` carries the `i-1` chain as an **explicit
  negative control**, so the invariant cannot quietly become unfalsifiable.
- `scripts/biome-ab.mjs` shoots **all four** biomes, because a control that is
  structurally identical under both branches (stone under `i-1`) proves nothing.

No automated check in this repo knows what colour the dungeon should be. Every
claim here came from a picture plus a census.
