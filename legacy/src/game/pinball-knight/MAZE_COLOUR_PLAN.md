# Maze colour — where this stands and what to do next

Written 2026-07-30 after "the colors in the maze are all screwed up"; rewritten
the same day, after measuring the thing the first version only reasoned about.
Read `HANDOFF.md`'s top entry for what shipped.

---

## 1. What is true now

Two fixes landed, a day apart, and they are the same bug arriving twice.

**`9caa89a` — the shade table reached the pass.** Indexed lighting snaps a pixel
to a palette index, then walks that index down its own material family's ramp
(`render/palette-shading.ts`). For a day it walked `i → i-1` instead:
`installEngine()` hand-built a `PaletteSource` that omitted the optional
`shadeDown`, so `setEnginePalette` substituted `descendingChain(32)`, which
leaves every family immediately. There is now one installer (`installPalette()`)
and `render/palette-install.test.ts` fails if the boot path stops calling it.

**The albedo target — the snap stopped reading the lit frame.** The row walk was
correct and it was being handed the wrong row to start from: the min-reduction
ran on the diffuse render target, with the scene's own three.js lighting already
multiplied in. The family was chosen after the light had had its say. That is
now fixed at the source; §2 is the measurement that redirected the work and §3 is
what shipped.

### Measured in-game, pinned seeds, real NVIDIA adapter

Family share of on-palette pixels, before → after each fix. Each biome's own
masonry rows are in **bold**.

| biome | seed | shade table (`9caa89a`) | albedo target |
|---|---|---|---|
| Cold Crypt | 6 | leather 37.2 → 6.7 | **stone 5.7 → 23.4** |
| Rotting Warren | 1 | rot 2.1 → 10.0 | **rot 10.0 → 27.1**, stone 11.1 → 1.9 |
| Bloodworks | 2 | blood 5.8 → 46.9, leather 50.7 → 6.5 | **blood 46.8 → 45.9** (unchanged) |
| Arcane Deep | 3 | arcane 1.0 → 2.6, leather 24.7 → 5.9 | **arcane 2.7 → 24.5**, stone 24.2 → 5.2 |
| Warren (seed 777) | 777 | — | **rot 9.8 → 30.4**, stone 13.3 → 1.9 |
| tavern | 6 | — | leather 13.0 → 13.9 (unchanged) |

Every biome's masonry now reads as the material it was authored in. The Arcane
Deep is the clearest case: entries 29/30 are cold blue rock and the frame was
rendering them as grey stone, so "cold light · something old is awake" was a grey
room. It is blue now. Two seeds land on the Warren (1 and 777) and both replicate.

**The two that did not move are the reason to believe the four that did.**
Bloodworks and the tavern are natural controls: Bloodworks' rig is the most
neutral of the four (open-floor multiplier `[0.51, 0.41, 0.50]`, nearly grey) and
the tavern is lit warm on a warm floor, so neither had much crossing to lose. A
change that merely recoloured everything would have moved them too.

`BIOME_STONE[2]` (Bloodworks) also changed at the first fix, from `[10, 27, 24]`
— blood + leather + skin, three materials pretending to be one rock — to
`[11, 12, 13]`, one blood ramp.

---

## 2. The measurement, and how it changed the plan

The first version of this document asked the right question — *what fraction of
environment pixels land in a family their albedo does not belong to?* — and
pointed at the wrong instrument. `scripts/biome-ab.mjs --census` reports the
SHARE of each family in a frame. A share cannot tell you a pixel is in the wrong
family; you would need that pixel's albedo, and a screenshot has thrown it away.

The crossing rate does not need a screenshot at all. **The snap is a pure
function of (albedo, light), and both are constants in this repo.** The palette is
`palette.ts`, the biome tints are `boot/biomes.ts`, the intensities are
`constants/render.ts`. So the question is arithmetic. It lives in
`render/light-crossing.ts` and runs in the suite, over 4 biomes × 48 shading
situations × 30 material entries:

| snap runs on | crosses family |
|---|---|
| the LIT colour (what shipped) | **51.5%** |
| ...with a desaturated torch (`0xe8b878`) | 48.9% |
| ...with a white torch | 46.5% |
| ...with ambient pushed 3.5 → 6.0 | 47.9% |
| chromaticity (luma-normalised) | 31.7% |
| **the ALBEDO** | **0%**, by construction |

Two findings, and both redirected the wave.

**The cheap fixes were worth nothing.** This document previously offered
"desaturate the torch light" and "move the bloom after the snap" as things to try
before the render-graph surgery, on the reasoning that the hue rotation was
visible and the MRT was a big swing. They move a 51.5% defect by three to five
points. Had they been tried first, the A/B would have shown a small improvement —
and a small improvement in the right direction is the most expensive possible
result, because it looks like progress.

**The mechanism is the DARKENING, not the hue.** With ambient at 3.5 the rig
multiplies linear albedo by about `[0.34, 0.47, 0.70]` on an ordinary open floor:
after `BRDF_Lambert` divides by π, the "over-bright fill" is a 0.4× multiply and
the frame renders at under half its own albedo before anything is snapped.
`palette-shading.ts`'s header had already measured exactly what a scalar multiply
does to this palette — entry 28, the tavern floor, changes hue at **five percent**
shadow — and nobody had connected that table to the scene lighting being a 0.4×
multiply. Same defect, arriving from the dominant term.

That is also why no lighting tweak could have worked. Geometric shading *is* a
pre-snap multiply, and on this palette any pre-snap multiply crosses families.
There was nothing cheaper to try; the only fix was to stop snapping on the product.

### What the model is allowed to be wrong about

It reproduces three's Lambert path and ignores normal maps, shadow maps,
roughness and the specular lobe. Every one of those *adds* variation to the
multiplier, so they can only raise the rate — the number is a floor, not an
estimate, which is the safe direction for a figure used to justify work. Re-run
without the 1/π and the shipped path measures 42% against the albedo path's 0%,
with the cheap fixes still worthless: nothing rests on getting three's
normalisation exactly right.

**Its negative control caught a bug in itself.** The first draft's "no lighting"
case set ambient intensity to 0 and left the hemisphere and key lights on; it
reported 59.6% crossing for a rig that was supposed to cross nothing. Without a
control that number would have been written down as a finding.

---

## 3. What shipped

`engine/render/pixel-pass.ts`, plus the palette contract it reads.

**A second colour attachment.** `sceneTarget` is now MRT with `textures[0] =
"output"` and `textures[1] = "albedo"`, and the scene render declares
`mrt({ output, albedo: diffuseColor })`. `diffuseColor` is the node every three
material assigns in `setupDiffuseColor` — `color × map × vertexColor`, linear,
before any light, shadow, AO or fog.

**The snap moved onto it, and the row search onto the lit luma.** `alb` chooses
WHICH ramp; `col` says how far along it. Every lighting term in the game — the
three.js rig, the bloom halo, AO, the vignette, the ink outline — now arrives as
one scalar on one axis. Three consequences worth knowing:

- **Bloom is fixed for free.** It is still added in linear before the snap, as it
  must be, but it can no longer push a neighbour into the torch family: it raises
  the lit luma, which walks the pixel up its own ramp. This document wanted the
  bloom moved after the snap to get that. Moving it there would have broken the
  pass's central invariant — every presented pixel IS a palette entry — and it
  turns out not to be necessary.
- **The UI and the flash mix into BOTH buffers.** A menu mixed only into `col`
  would be drawn in the material of whatever scene it covers: a gold label over a
  blood wall snapping to blood and merely being brighter.
- **Chromatic aberration moved to the albedo,** because that is where hue now
  lives. Splitting the lit buffer would move only the luma and the frenzy fringe
  would be invisible after the snap.

**The shaded palette grew rows going UP** (`SHADE_UP_ROWS = 4`, and `shadeUp` on
`PaletteSource`). These were invisible while the snap read the lit colour — a
torch-lit surface had already been relocated to a brighter family, so it never
needed to walk up its own ramp. Measured, the frame's luma runs from 0.38× to
1.35× of its albedo's; a downward-only table clamps everything above unity at the
identity row, the torches stop brightening anything they light, and the dungeon
reads flat. Four rows, because the torch ramp 14→15→16→17→18 is the longest climb.

**`warmFloorPipelines` compiles inside the frame's render context**
(`pixelPass.withSceneContext`). three bakes the MRT declaration into the node
material's build, so a material compiled with no MRT set produces a *different*
program from the one `render()` looks up. Without this the descent warm-up would
have filled a cache nothing reads and every material would have compiled again,
lazily, mid-play — the exact stall `boot/warmup.ts` exists to prevent, arriving
as a silent performance regression with nothing in the suite able to see it.

### The guards that came with it

- `render/light-crossing.test.ts` — the model above, wired to the real constants,
  with a unit-multiplier negative control and the lit path kept as a live
  negative control so the invariant cannot quietly become unfalsifiable.
- `render/mrt-coverage.test.ts` — the albedo attachment has one blind spot and it
  fails to BLACK. A raw `NodeMaterial` with a `fragmentNode` takes three's
  fragment-output shortcut and never runs `setupDiffuseColor`, so it would write
  an unassigned albedo and render as a silhouette-shaped hole in the floor, with
  no error anywhere. No scene material may use `fragmentNode`; the post quads in
  `pixel-pass.ts` are the one exemption, and the test asserts the scan finds them
  so it cannot pass vacuously.
- `scripts/biome-ab.mjs` — the descent-card guard is now a POSITIVE signal. See
  §5; it failed again during this very wave.

---

## 4. Ranked backlog after that

1. **The ink outline still reads the LIT buffer.** Its colour-edge term is a
   cheap stand-in for a palette-index edge, and now that the albedo exists the
   honest version is an albedo edge — which would also stop a shadow boundary on
   flat floor from inking itself. Deliberately not changed in the same wave, so
   the A/B measured one thing. It brings the warmth gate with it: that gate exists
   because a warm creature's own markings were being inked, and its premise ("this
   dungeon's environment is cold") stopped being true when `BIOME_STONE` gained
   warm rows. On albedo taps the premise becomes checkable rather than assumed.
   Expect the threshold to need re-tuning — albedo steps are larger than lit
   steps, because the darkening no longer compresses them.
2. **Surface wash textures hardcode off-palette `rgba()`** (`maze/build.ts`
   ~797-870). Each has a comment naming a palette index the literal does not
   match, so a palette edit silently desyncs them and the biome remap can never
   reach them. Strictly worse than before: an off-palette albedo is snapped with
   no lighting to blur where it lands.
3. **`stoneMat` and `stepMat`** (`build.ts` ~1537 / ~1646) read `PALETTE_HEX[3]`
   / `[2]` directly instead of `css(3)` / `css(2)`, so pilasters, architecture
   props and stairs stay cold grey in every biome. Much more visible now that the
   masonry around them is correctly coloured.
4. **`FLOOR_SURFACES[].hex` is dead** (`engine/surfaces.ts` ~191-201) — superseded
   by `makeSurfaceWashTexture`; the doc comment still claims it is live.
5. **Shaped walls share the tall-wall texture** (`build.ts` ~1400, ~1456), so
   slant prisms, round shells and arc sweeps never get mossy/cracked variants.
6. **Transparent surfaces write albedo opaquely.** `MRTNode` defaults every output
   other than `output` to no blending, which is what we want — the family should
   come from the material a pixel most belongs to, not a weighted average of two
   that lands in a third — but it means a low-alpha fog quad or decal fully
   replaces the albedo underneath. Nothing visible in the six A/B scenes; worth a
   look if a decal ever reads as the wrong material.

---

## 5. How to measure anything here

```
pnpm install --prefer-offline                 # in the worktree; node_modules must be REAL
nohup npx next dev -p 5312 &                  # a port nobody else is on
node scripts/biome-ab.mjs --before <old-port> --after 5312 --out /tmp/shots
node scripts/biome-ab.mjs --census /tmp/shots
```

Seeds pin the biome at depth 1: **6** Cold Crypt, **1** Warren, **2** Bloodworks,
**3** Arcane Deep, **777** Warren again. Unseeded runs roll a different biome and
the A/B is noise.

And for anything about which family a colour lands in, reach for
`render/light-crossing.ts` first. It answers exactly, in milliseconds, what a
screenshot answers approximately in ten minutes.

### Five traps this harness has now paid for

- **A brightness threshold is not a HUD.** `__dungeonPlayer().active` goes true
  while the DESCENT CARD is still up: the card is drawn inside the canvas, the
  loop is HELD during generation, and no DOM query can see it. The first guard
  asked "is the bottom 12% of the shot lit", threshold 3% — a proxy — and **it let
  a card through during this wave**. At seed 1 the card floats over brown masonry
  that reaches into the band; it scored 5.5% and passed, and the resulting census
  reported the Rotting Warren as 26.7% LEATHER. A completely healthy-looking
  number, measured off a loading screen. The guard now asks a positive question
  instead — is the health orb there? — and the separation is not marginal: every
  real floor had 2691-2705 pixels of palette entry 31 in the band, the card had
  zero.
- **Measure the saved PNG, not the page.** `document.querySelector("canvas")`
  returns `#room-canvas-element` — the arcade room *behind* the overlay.
- **Half the frame is off-palette by design.** The scanline pass dims every other
  row by 0.86. `--census` uses on-palette pixels as the denominator.
- **Ink (1) and void (0) are not stone.** They are the shared terminator every
  family falls through to. Folding them into stone hides exactly the effect a
  shading change has — and note how far the albedo fix moved them (Cold Crypt
  82.0 → 67.2): that is the darkening no longer eating a fifth of the frame.
- **A control that cannot move proves nothing.** The Cold Crypt is the control for
  the SHADE TABLE only — stone is entries 0-5 in descending order, so `i-1` IS the
  stone ramp — which is precisely why an all-stone biome hid the first bug for a
  day. It is not a control for the frame, and it moved hard at both fixes.

### The lesson worth carrying

The first bug shipped because verification covered one biome and one seed — and
worse, **it was read as the fix**: `51bbd77` recorded "the green and blue
checkerboard on floor 1 — it was never moss… it is now correctly grey", but at
seed 777 floor 1 is the Rotting Warren, whose masonry *is* authored rot green. The
broken table greyed out real moss and the greying was written down as a success.

The second bug survived an extra day because the plan to fix it was written in
prose. "The snap runs on the lit colour" was known, correct, and stated in a
comment in the shader — and it sat next to a hedge about the fix being a big swing
and some cheaper things to try first, none of which were worth trying. The
arithmetic that settles it is forty lines and was always computable.

No automated check in this repo knows what colour the dungeon should be. But a
great deal more than "it looks better" is computable about where a colour LANDS,
and none of it needs a GPU.
