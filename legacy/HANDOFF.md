# Handoff — braindeadbot-client

_Replaced on each deploy. Not a log; if something here is done, delete it._

> ⚠️ STILL NOT collapsed, same call as the last three sessions and for the same
> reason: `main` moved underneath this work while it was in flight (the zoom-cancel
> commit landed mid-session and had to be merged in), and `bdb-cam` /
> `truetint` are live in this repo right now. Collapsing 1500 lines I have not
> read would delete their notes. Prepended instead.

## ✅ LIVE NOW — the descent screen actually reaches the glass; the chrome is chiselled (2026-07-29)

**416e91d · tsc clean · registry-drift clean · 2052 tests · verified on a real
WebGPU adapter WITH a negative control.**

### The descent screen was never on screen

Reported as "black on maze entry". The screen itself was healthy the whole time
and every diagnostic said so — pushed onto the stack, `isFloorLoadingOpen()`
true, `__gui().screens` listing it, its `paint` correct, its bar wall-clocked.

The canvas UI is painted **by the frame loop**, and `loop()` opened with a bare
`return` while the descent hold was up. That was right when the descent screen
was a DOM overlay the browser composited on its own. It became a black screen
the moment the screen moved onto the canvas: **the one screen whose entire job
is to be visible while the loop is blocked was the one screen the loop refused
to draw.** `armFloorLoading` had the same shape — it waited two frames for a
paint that, post-migration, nothing was going to perform. On the FIRST descent
of a session there is no running loop at all and the tavern has just disposed
its own canvas, so that frozen frame is black; on later descents it is a still
of the floor you just left.

The fix is not "render anyway" — rendering the scene during a descent triggers
the lazy pipeline compile storm `warmFloorPipelines` exists to schedule, which
is the entire reason the hold is there. `PixelPass.presentUi()` composites the
UI over a **cleared** scene+bloom target and touches no scene material.

| | UI frames composited per HELD frame |
|---|---|
| before | **0.004** (2 across 508 — the two `armFloorLoading` squeezed out) |
| after | **1.001** (762 across 761) |

`scripts/descent-probe.mjs` is that measurement, kept. It drives a real descent
and samples `__gui().painted` while `__dungeonHeld()` is true. ⚠️ Its first
threshold was `gained > 0` and it **PASSED the broken build** — two is greater
than zero. The bar is "keeps up", not "moves at all". Run it against any future
change to the hold:

```
node scripts/descent-probe.mjs --url "http://localhost:5301/dungeon?no-intro=1&gpu=webgpu"
```

`armFloorLoading` moved to `run/floor-hold.ts`. `deps.ts` justified keeping it in
core because it "writes the floorLoad and renderHeldForLoad module flags" —
those flags ARE the two `let`s at the top of floor-hold.ts, so the extraction
that moved them left the reason behind. Core ratchet 611 → 595.

### The chrome is id-software plate now, not hairlines on black

`im.ts` gains the shape those menus are built from: `bevel()` (two-tone chisel),
`key()` (raised face + keyline + inner chisel), `well()` (the same, sunken),
`cursorMark()` (a blocky selector), and `bar()` now fills in **cells**. Every
screen inherits it through `theme.ts` + `im.ts`; only `menu.ts`'s hand-rolled
tab strip needed touching, because it paints its own rows to carry a glyph.

**⚠️ TWO TRAPS, both found by looking at pixels rather than at code.**

1. **The panel body rendered GREEN.** It was set to `stone dark` — a plainly
   grey `#2b303b`. The UI composites *before the ordered dither* as well as
   before the palette snap, and the snap is luma-weighted, so a flat fill is not
   guaranteed to arrive as itself. Swept over all 32 entries at the shader's own
   amplitude and metric, exactly three pairs are unstable:

   ```
    0 void black  ↔  1 outline        (both near-black — invisible)
    2 STONE DARK  ↔  6 ROT SHADOW     ← the green panel
   23 skin shadow ↔ 28 leather mid    (both mid-brown — invisible)
   ```

   The plate moved to `leather shadow`, which is stable, warmer, and closer to
   the source anyway. **`gui/theme.test.ts` is that sweep, kept**, with the
   crossing that caused it as its own negative control. Re-run it before moving
   any UI colour.

2. **A 1px accent stroke overwrites a 1px bevel completely.** Every button
   rendered flat with a coloured outline. Invisible in review — both calls were
   plainly present and plainly correct on their own. The keyline is drawn inside
   `key()` now, on the outer ring, with the chisel one pixel in.

### Where to look

- `src/game/pinball-knight/engine/render/pixel-pass.ts` — `presentUi()`
- `src/game/pinball-knight/run/floor-hold.ts` — the hold + `armFloorLoading`
- `src/game/pinball-knight/sim/loop.ts` — the held branch
- `src/game/pinball-knight/gui/theme.ts` / `im.ts` — the chrome vocabulary
- `src/game/pinball-knight/run/floor-hold.test.ts` — 7 tests; 3 fail against the
  pre-fix code (verified by reverting)

### Not done

- The **selector chevron** (`cursorMark`) is wired into `button()` only. Toggles,
  tabs and hand-rolled rows still say "focused" with the ring alone.
- The descent labyrinth backdrop is unchanged — it is good, and its docblock
  explains why it is not the real floor. Left alone deliberately.

---

## ✅ ALSO LIVE — browser zoom cancelled, UI 20% down, camera out, ability marks (2026-07-29)

**tsc clean, 1537 tests, verified through the real pixel pass on host Chrome.**

### Browser zoom no longer changes the game

Ctrl +/- moves `innerWidth` and `devicePixelRatio` by reciprocal amounts; the
window's PHYSICAL size does not move. Sizing off `innerWidth` alone read that as
a resize and re-derived everything from it. Measured on 1920x1080 before this:

| zoom | what happened |
|---|---|
| 90% | game letterboxed — 106px bars L/R, 60 T/B |
| 80% | 240px bars |
| 125% | HUD dropped 167 → 95 device px in one keypress |

`cancelBrowserZoom()` compares `devicePixelRatio` against the value **at page
load** and divides the change back out. The baseline matters: dpr is also 2 on a
Retina panel at 100%, and treating the raw value as zoom would quadruple the
render target on every HiDPI laptop — the opposite of this file's deliberate
"fat honest pixels, dpr ignored" choice. Only the CHANGE is zoom.

`RenderSizing` gains `cssScale = scale / browserZoom`. That distinction is now
load-bearing in three places and each was a real bug waiting: the canvas is
SIZED in CSS px, the pointer ARRIVES in CSS px, and the wheel delta is in CSS
px, while the drawing buffer is device px. Pinned by
`render-sizing.test.ts` — the grid must be byte-identical across twelve zoom
steps for five window sizes, not merely similar, because a one-pixel difference
still flips an integer design zoom across a boundary.

Verified in a real browser via CDP `Emulation.setDeviceMetricsOverride`
(`scripts/ui-probe.mjs --steps 'dpr:1.5'`): CSS window 1141x619 → 2140x1161
across the range, render grid pinned at 1712x928 throughout, screenshots
compositionally identical.

### The letterbox band

`MAX_RENDER_*` clamped the GRID after `scale` had already been chosen against
the unclamped size, so `out` came out smaller than the window and the gap was
black bars — for the ENTIRE 1921..2559 CSS band. Now the ceiling raises the
SCALE instead, and only while the resulting grid stays ≥1024x576; below that
(a 7680x1080 ultrawide would reach 1920x270, four tiles of vertical view) bars
are correct and the clamp still takes over. Ceiling itself went 1920x1080 →
2160x1216 to cover the common band without a bump.

### UI 20% smaller, and the zoom stops flipping

Design boxes 800x450 → **600x338, capped at 2x**. Both halves matter:

- The box is what makes it smaller. Where old and new resolve to the same zoom
  the UI is exactly **0.80x** its previous device size. Where they differ the new
  one is BIGGER — and those are precisely the grids where the old box fell to 1x
  and the HUD rendered at half size.
- The cap is what stops it growing. Uncapped, the sheets would jump 2x → 3x at a
  1920 grid: 50% growth from one browser-zoom notch.

HUD refit to the 584-unit content width: `PANEL_H` 76→61, `TILE` 40→30,
`ITEM_ICON` 36→24, and the weapon's NAME became the cell caption (52 units
cheaper than a label column, and strictly more informative than the word
"WEAPON" next to a picture of a sword). Minimap store 116 → **120** — purely for
its divisors, since 116 = 2·2·29 and `exactIconSize` could only take 29 in the
smaller cell.

### Camera out 12.5%, not 15%

`PPU` 72 → 64. PPU is the zoom (`world visible = renderW / PPU`) AND the
denominator of `SPRITE_UNITS`, and `SPRITE_PIXEL_GRID = SPRITE_UNITS × PPU` must
be a whole number of texels or every sprite samples between them. With
`SPRITE_UNITS` held at 9/8 that makes PPU a multiple of 8, so the ladder is 72 →
64 (+12.5%) or 72 → 56 (+28.6%); 72 × 0.85 = 61.2 is not on it. **56 would take
the sprite grid to 63, under the ≥64 floor `sprite-scale.test.ts` asserts** — so
if more zoom-out is wanted, that test and the fidelity call behind it have to be
revisited deliberately.

`SPRITE_PIXEL_GRID` 81→72 and `SPRITE_PX` 162→144 move WITH it. Holding the grid
at 81 would keep sprites their old screen size while the level shrank — every
actor 12.5% larger than its own collider, visibly overlapping walls it does not
touch. Zooming out costs texels; there is no arrangement where it does not.

### The skill slots showed the same symbol for every ability

`hud.ts` drew `glyph("spark")` for BOTH cast slots, so the only thing separating
Flipper Charge from Time Crawl was the mana number underneath. `AbilityDef`
has carried `icon` (an emoji) and `color` all along, dead since the DOM menu was
deleted — emoji cannot come back (font-stack dependent, see `gui/icons.ts`), so
there are now six real glyphs and `ABILITY_GLYPH: Record<AbilityId, GlyphId>`
makes a new ability without a mark a COMPILE error. Each is told apart by
SILHOUETTE at 16px — wedge / rings / horseshoe / hourglass / crescents /
teardrop, no two sharing an outline — and tinted with the ability's own
`color`. The menu's ability rows had no mark at all; they have the same one now.

### The beard read as chainmail

A VALUE collision, not a hue one: beard body at the worn tiers was palette 3
(luma 78.0) and the helm's gorget/cracks are palette 19 (luma 80.8) — **2.8
apart** — while the "grey strands" used palette 21, which IS one of the four
colours the helmet is painted in. Stone and steel are 3° apart in hue, so grey
on grey has nothing but value to separate it.

Beard and moustache moved to the warm LEATHER ramp (26/27, luma 30.4/53.9,
hue 24° against the cool ramps' ~215°): 27–50 luma below the LOWEST steel entry,
so hue and value both separate and neither has to hold alone. The far side is
pinned a step darker because `paintSkin` runs a `skinDeep` column down x24-25 in
that same entry — mirrored flat, the far sideburn would have been painted the
exact colour of the shadow it sits in.

### Left undone
- Exactly 15% camera-out is not reachable; see the ladder above.
- The mugshot did NOT shrink with the rest of the HUD — `FACE_PX` is 72 and the
  blit must be a whole multiple, so its cell has a hard 76-unit floor. It is now
  proportionally the largest thing on the bar.

## ✅ LIVE NOW — the UI pass: scroll, zoom, icons, the descent screen (2026-07-29)

**tsc clean, registry-drift clean, 1508 tests. Verified through the real pixel
pass on host Chrome with `scripts/ui-probe.mjs` — every claim below is from a
screenshot or a state read, not from reading the code.**

### The two bugs behind "the debug buttons don't work"

Both lived in `beginScroll`, both silent, and the second was hiding under the
first.

1. **The scroll region never scrolled.** It laid content out at `r.y + offset`
   while translating the context by `-offset` — an exact cancellation. `offset`
   advanced, the clamp behaved, the scrollbar thumb slid down its track, and
   every row stayed exactly where it was. Measured: `__gui().scroll` read 175
   with two screenshots pixel-identical. Anything below the fold of any list was
   unreachable by any means.
2. **Hit testing did not move with the paint.** Once (1) was fixed, widget rects
   are in CONTENT space and the pointer arrives in SCREEN space, so every click
   inside a scrolled list lands `offset` pixels off. `UiFrame.originY` +
   `UiFrame.clip` reconcile them, and the clip also stops a row scrolled out of
   view from answering a click that hits the chrome above it.

Pinned in `gui/im.test.ts`. End-to-end proof: CLEAR ROOM took 81 enemies to 0,
then a scroll of 575 and a click on SPIDER spawned exactly one spider.

### `UiScreen.design` — the readability fix, and the standardisation

Text was 8px Press Start 2P on a 1600-wide grid: one device pixel per font
pixel, which is as small as this UI can physically be. Every screen now declares
the box it was authored for, and the driver hands it the largest INTEGER zoom
that still fits (`screenZoom`, capped at 4, floored at 1). Whole numbers only —
a fractional magnification of a nearest-sampled layer is the same "game-wide
mush" `pixel-pass.ts` already documents.

On a 1600x900 grid: descent screen and intro 3x, everything else 2x. Screens
that omit `design` stay at 1x, so adding it is opt-in and reversible.

**800x450 is now the design floor for every sheet.** menu/tavern/haul were
880-940 wide and had to come down to 780x424 to earn the zoom; settings rows went
40→32 because six of them ran the last control under the footer.

Mixed zooms are legal and used — the floor map paints at 1x (a half-resolution
floor plan magnified back is a worse map) while the HUD is at 2x, so it derives
the HUD's real height via `screenZoom(HUD_DESIGN, …)` rather than the hardcoded
108 it had, which was only ever right at one zoom.

### The icons were dots because of FRAMING, not size

A sprite's frame is an ACTOR BOX — sized for the tallest thing that can stand in
it, origin at the feet. The painted subject is 25-45% of it, so a "20px icon"
was drawing a 6-9px creature. `gui/icons.ts:reframe` crops to the opaque
bounding box and fits that square to 72px, once, into a cache. The debug
console's monster roster went from thirty identical specks to thirty
recognisable creatures.

### Every fractional blit in the UI, closed

`exactIconSize` snaps an icon to a size its source divides EXACTLY, and
`drawIcon` centres the result — smoothing is off, so a non-integer ratio is not
a soft filter, it deletes whole rows. Fixed at four sites that all had it:

| what | was | now |
|---|---|---|
| HUD weapon icon | 72 → 28 (2.57:1) | 72 → 36 (2:1) |
| HUD belt items | 72 → 24 | 72 → 36, in a 40px tile |
| HUD minimap | 116 → 72 (1.61:1) | 116 → 58 (2:1) |
| card faces, 7 sites | 512 → 44-180, nearest | `cardFaceAt(id, w)`, filtered, cached by width |

The rule the whole pass turns on: **a filtered downscale is right when it lands
in a cache and wrong when it lands on the screen.**

### The descent screen was empty

The DOM→canvas port dropped the labyrinth, the caption, the divider and the
percentage, keeping a title and a bar on a flat black field. All of it is back
(`gui/screens/floor-loading.ts`), at 3x, with the maze regrown per descent and
the progress sweep energising it left to right.

### The debug console is a LEFT DOCK

Every button on it changes the world and the point is to watch what that does; a
centred sheet covered the arena, so the loop was press → close → look → reopen.
Docked, with the game's own art on every weapon, material and monster row.

### Still DOM, and NOT the game's

`#gold-hud-badge` / `#gold-popup-container` (`src/utils/gold-hud.ts`) are the
arcade SITE's currency badge — shared by every game, outside
`src/game/pinball-knight/`, and the only HTML left floating over the dungeon.
Verified at runtime: the element list is byte-identical with a menu open and
closed, so the game itself adds nothing.

### Left undone
- The card hover FX (tilt/glare/foil) are still not rebuilt — unchanged from the
  original migration's handoff.
- `scripts/ui-probe.mjs` is new: `--steps 'eval:…|clickui:x,y|wheel:x,y,dy|shot:name'`
  against host Chrome. It is how the above was verified; keep it.

## ✅ LIVE NOW — `a1f0c40` · the CROAKER, sharper sprites, jester spring (2026-07-29)

**Deployed to synology, container healthy, `restarts=0`,
`10.0.0.16:5174/dungeon` → 200. tsc clean, registry-drift clean, 1443 tests.**

Three things shipped, plus one repo-wide fix that was blocking everybody.

### 1. THE CROAKER — a laser frog that does not respect the maze

`__lab.only("croaker")`. Kites, gated at level 2, weighted into the **warren**
biome. Every other monster is a prisoner of the corridor graph; this is the
first one that routes around it.

- **It hops KNEE-HIGH walls.** A camera-side rim is an obstacle to the horde and
  a kerb to a frog. The reason this is worth having rather than arbitrary: the
  player's model of "I am safe behind this" is built from wall HEIGHT, which is
  already on screen, so the exception is legible before it is experienced.
- **Its leap RICOCHETS** off full masonry — capped at two bounces, because
  unlimited is a pinball and nobody can predict where it lands.
- **Twin eye-beams straddling the aim line.** The gap is on the exact line to
  the player, so you answer this one by closing HEAD-ON, which is the opposite
  of the advice for the spitter standing next to it.

Both movement rules are exceptions to COLLISION, not steering — hence a bespoke
branch in `updateZombies` rather than a movement policy.

**`isLowWall` now lives in `engine/grid.ts`.** It was written out twice inside
`maze/build.ts`, which was fine while it was purely a rendering decision. It
stopped being one the moment gameplay asked the same question: a frog clearing a
wall the renderer drew full-height is a plain bug, and one function for both
readers is the only defence.

### 2. THE JESTER SPRINGS YOU OFF

A melee blow refused by its momentum gate now THROWS the knight — the goblin's
bumper pop moved from CONTACT to the refused SWING, so what it punishes is
committing to melee rather than standing close. Land it at momentum and you
compressed the coil past its travel, so nothing throws you. Same sentence as the
damage rule, which is what makes the pair learnable.

`MOMENTUM_GATES` gained `gatesDamage`. The check in combat.ts used to name
`goblin`/`golem` inline — a second roster to keep in step with the table the
bestiary prints from.

### 3. THE CRUSH PIPELINE (`engine/render/sprite.ts` `crushInto`)

"Very blurry, should look like Ragnarok Online." The display path was already
right, so the softness was in the ART — found by dumping the shipped atlas cell
and magnifying it, NOT by screenshotting the game. Four changes:

- **Dither deleted.** Ordered dither assumes the entries either side of a value
  are adjacent TONES. Cold Crypt is eight ramps in different hue families and
  the snap is luma-weighted, so a uniform r/g/b bias lands in a different
  FAMILY — steel picked up rot-green, bone picked up arcane cyan. Chroma
  confetti, not stipple.
- **Premultiplied box downscale** replacing `drawImage`, which mixed RGB against
  an undefined transparent surround and put a dark fringe on every actor. Also
  removes the dependency on which engine baked the atlas.
- **Unsharp at the grid**, putting back the selout ink the downscale averaged
  into the fill it exists to separate.
- **Selout on the SHADOW-side rim only** — figure.ts lights from a fixed
  upper-left key, so darkening the up/left rim would be painting shadow onto the
  light source. Replacing edge pixels ate 1px spider legs; adding ink outside
  fattened everything.

⚠️ **This composes with `c82c433` (2.25× texels, 216→108).** That session
diagnosed the REMAINING blur after this as sub-texel features and raised the
resolution; 216/108 is an exact 2:1, so the box filter's taps are a clean
two-tap box. Rendered side by side afterwards the combination is clean, no
over-sharpen halos — but `SHARPEN_AMOUNT` (1.3) was tuned against the old
1.78:1 downscale, so if the grid moves again, re-render and look rather than
assuming it still holds.

### 4. ⚠️ THE registry-drift GATE WAS BLOCKING EVERY EDIT IN THE REPO

`799e911 delete the DOM UI (P5)` removed `hud-diablo.ts`, which check F read by
name. `read()` throws on ENOENT and `post-edit.sh` treats any non-zero exit as
BLOCKING — so since that merge the checker refused every edit anywhere in the
repo with a Node stack trace. Fixed: a missing registry FILE now reports as
drift instead of throwing.

**And the underlying finding, which is NOT fixed and is not mine:** the three
marble-material surfaces were deleted, not moved — `hud-diablo.ts`'s HUD tiles,
`ui.ts`'s `MATERIAL_CHIP` buff strip, and `debug-panel.ts`'s `MATERIALS_DBG`
grant chips. The canvas HUD does not display a marble material at all. The
materials still ship (all six behaviours from `d459244`), so a player carrying
Lava or Diamond gets the physics with **no on-screen indication**, and there is
no debug affordance to grant one for testing. Restore those three drift rows
WITH the display.

### Gotchas

- **`git stash pop` is REPO-WIDE and will pop another session's stash.** There
  were seven concurrent worktrees on this checkout tonight. `git stash push --
  <path>` on a clean tree silently creates nothing, and the following `pop` then
  applies whoever was on top — it dumped another session's 19-file WIP into this
  worktree as conflicts. Nothing was lost (they had it back), but use
  `git diff > patch` for the stash-and-retest trick instead.
- **`maze/floor-pipeline.test.ts` is FLAKY under full-suite load**, and it flaked
  on two different tests on two different branches tonight. Both times it passed
  3/3 in isolation and the full suite passed on a re-run. Consistent with the
  known path-dependent floor-gen bug — do not chase it as a regression without
  running it in isolation first.
- **A blank atlas used to pass the whole suite.** A normalisation slip in the new
  downscale made every texel transparent and 1,386 tests stayed green.
  `snap-lut.test.ts` now asserts the crush emits pixels and that they are
  palette colours.

---

## ✅ LIVE NOW — `03a23ce` · NO DOM UI ANYWHERE (2026-07-29)

**Deployed to synology as `main@03a23ce`. `10.0.0.16:5174/dungeon` → 200.
tsc clean, 1934 tests pass across 167 files.**

Two follow-ups landed after the first pass, both worth reading:

**1. The WALKABLE TAVERN's own overlays were still DOM** and had been missed —
the first sweep guarded `src/game/pinball-knight/` only. The station prompt,
the pool arrival banner, the run summary, the lobby pill + "who's down there"
board and the whole GAMBLER CABINET are now painted
(`scenes/tavern/scene-screens.ts`, and the cabinet inside
`scenes/tavern/gambler/index.ts`). `scenes/tavern/ui.ts` is deleted. The guard
now covers `src/scenes/` too, exempting only the site boot sequence
(`app-bootstrap.ts`, `intro-scene.ts`) — those run before any renderer exists,
so there is no pass to composite into.

**2. `stack.remove()` exists now, and the distinction matters.** `close(id)`
TRUNCATES — it drops the named screen and everything above it, which is right
for a modal and the child it raised. That is wrong for the bottom-of-stack
layers (HUD, toasts, touch pad, station prompt). The tavern raised its prompt
and then called `close("hud")`, which found the HUD at index 0 and took the
prompt with it: the scene rendered perfectly and had NO interface at all. Use
`remove()` for always-on layers, `close()` for sheets. Pinned by a test.

**3. The deploy gate was testing other people's worktrees.** vitest's default
exclude does not cover `.claude/worktrees/`, so `deploy.sh` was running every
parallel session's uncommitted code — 222 test files instead of ~167 — and
aborted twice on failures in three checkouts that were mid-edit by someone else
and were not being deployed. It also caused the load that makes
`floor-pipeline` hit its 30s timeout. Fixed in `vitest.config.js`.

Every screen — the knight menu, the tavern and its four vendors, the shop, the
death screen, the floor haul, both HUDs, toasts, the floor map, the descent
screen, the debug panel, the intro chrome and the on-screen touch controls — is
now painted onto a canvas composited **inside the pixel pass**. The UI snaps to
the same 32-colour palette and wears the same dither and scanlines as the art.

Deleted outright: `menu.ts`, `tavern.ts`, `hud-diablo.ts`, `hud-wolf.ts`,
`ui-cards.ts`, `engine/touch-controls.ts`. Reduced to DOM-free delegates:
`ui.ts`, `card-reader.ts`, `map-overlay.ts`, `floor-loading.ts`,
`debug-panel.ts`, `pickup-toast.ts`.

### The new shape

| file | what it is |
|---|---|
| `gui/layer.ts` | the canvas + `CanvasTexture` the pass samples |
| `gui/im.ts` | immediate-mode toolkit — layout, focus, widgets |
| `gui/stack.ts` | the screen stack; owns `state.uiPauses` |
| `gui/input.ts` | edge-triggered keyboard/pad/mouse snapshot |
| `gui/root.ts` | the per-frame driver |
| `gui/screens/*` | one file per screen |
| `economy/tavern-shop.ts` | every tavern price and action, extracted from `tavern.ts` |

Composite point: `engine/render/pixel-pass.ts`, **after the ink outline, before
the flash**. The comment there explains why both neighbours matter — an outline
downstream of the UI would ink the scene *through* an open menu.

### What got better, not just moved

- **Gamepad and touch navigation** work in every menu. The DOM versions had none.
- **Modality is game state.** Eight `HTMLDivElement | null` fields collapsed to
  one `state.uiPauses`, written only by `gui/stack.ts`. `isSimPaused()` in
  `sim/paused.ts` is one expression.
- **Widget identity is call order**, so the `data-idx` shadowing bug that made
  the skill tree "select everything then nothing" is structurally impossible.
- **Icons are the game's real sprites** (`gui/icons.ts` → `ITEM_PAINTS` through
  the same palette crush). No emoji anywhere — `holo-card.ts` already recorded
  that `fillText` emoji broke headless renders.
- `core.ts` grew by **zero** lines through the whole migration.

### Three bugs the verification caught that reading would not have

- **The composite was v-flipped.** With `rtUv()` the probe's cyan left-edge bar
  looked right while its top-left gold block landed at the *bottom*, where the
  DOM HUD covered it — so the frame just looked empty. Rule: one flip per
  RENDER-TARGET hop, and an uploaded canvas texture has zero.
- **Key presses were eaten.** `tapped` was a `Set`, so repeats between two
  painted frames collapsed into one. Nav input is counted now.
- **The always-on HUD swallowed gameplay keys**, because capture was gated on
  "a screen is open" rather than "a screen pauses". Pinned by a test.

### Guards and tooling

- `gui/no-dom.test.ts` fails the build if interface is rebuilt out of elements.
  Two exemptions, both justified in the file: `core.ts` (the renderer's host
  div) and `intro/index.ts` (its 2D rendering surface).
- `scripts/gui-shot.mjs` screenshots the UI on a real WebGPU adapter (host
  Chrome over CDP). In the console: `__gui()` reports stack/focus/frame
  counters, `__gui.probe()` paints the asymmetric orientation marker, and
  `__gui.shot()` dumps the layer canvas — the one measurement that separates
  "the UI never painted" from "the composite ate it".

### Open items from this work

1. **Card hover FX are gone.** `ui-cards.ts` spent ~200 lines on rarity-scaled
   tilt, pointer-tracked glare, prismatic foil, parallax and a mythic sparkle
   field. It was a deliberate rarity TELL. Cards are flat now. Rebuilding tilt +
   glare as canvas transforms is very achievable — all affine transforms and
   gradients — and is the biggest visual regression of this change.
2. **Bestiary and skill tree lost density.** 8px Press Start 2P on a 1280×720
   grid fits fewer rows than 9–13px CSS text; both scroll. A layout pass aimed
   at those two tabs specifically is worth it.
3. **The intro's two 2D canvases are still DOM.** Converting them means
   re-projecting a 480-wide virtual space onto the pixel grid.
4. **The layer uploads a full-grid texture every frame while the HUD is up**
   (~5.8 MB/frame at 1600×900). Not measured as a problem — the sim is paused
   behind every screen that matters — but the HUD is up during play, so look
   here first if the profiler ever points this way. `gui/layer.ts` already has
   the `dirty` flag to build on.
5. **Production runs WebGL2, not WebGPU.** Pre-existing and unrelated: the NAS
   serves http-over-IP, so `navigator.gpu` is absent. `gui-shot.mjs
   --allow-webgl` says so loudly. All verification above was on a real NVIDIA
   adapter locally.

## ✅ LIVE NOW — `8a4bfa7` · the JESTER, a new monster (2026-07-29)

**Deployed to synology as `main@8a4bfa7`. Container `braindeadbot-client` is
`Up (healthy)`, `restarts=0`, `10.0.0.16:5174/dungeon` → 200.
tsc clean, `registry-drift` clean, 1361 tests pass (was 1355 — +6 art tests).**

### What it is

A **spring-loaded harlequin** that walks you down, loads the coil spring on its
head, and fires the star-stamped plate off it. Built from a supplied reference
sheet the way `sporeling` and `hound` were: as a **parametric painter**
(`render/monsters/jester.ts`), NOT by importing or filtering the reference's
pixels. See `monsters-are-painters-not-images` — filtering buys one facing, a
foreign palette and a foreign lighting model; authoring buys N/S/E, phase-driven
animation and Cold Crypt by construction, with no quantization step at all.

Try it without waiting for a spawn: **`__lab.only("jester")`** in the console.

### The two ideas worth keeping

1. **The silhouette IS the mechanic.** Everything else on the roster is a blob
   with limbs. The jester is a vertical stack that CHANGES HEIGHT — body, coil,
   plate. `SPRING_LOAD` (7) compresses on the wind-up, `SPRING_FIRE` (30)
   extends on the release, `SPRING_IDLE` (18) sits between. A player reads the
   threat off the creature's height at any facing with no colour cue. This is
   pinned by a test, because a proportion tweak that flattened the range would
   keep the monster WORKING while quietly making it unreadable — the failure
   mode nothing else in the repo can catch.
2. **The coil is a projected helix, not stacked rings.** Sample
   `x = cx + rw·sin(2πNt)`, `y = climb + rw·k·cos(2πNt)`, then stroke the runs
   where `cos < 0` BEFORE the runs where `cos > 0`. Correct occlusion with no
   depth buffer and no per-ring bookkeeping, and it stays correct at every
   extension because it is a property of the parameterisation, not of a pose.
   The death frame reuses the same function with 2.2 turns and a huge lean — a
   spring that lost its tension is just a low-turn coil.

### Gameplay

`kite` movement, `ranged: true`, gated at level 2, ratio 11 / residue 4 (a
FRESH pair — no other kind uses ratio 11, so it cannot contend in the horde
roll). Weighted into the **bloodworks** biome.

It fires **one** plate straight down the line — no spread, unlike the spitter's
volley. The plate is the game's **first hostile RICOCHET**: `kind: "disc"` rides
the golem-shard integration path (reflect the blocked axis, die by fuse) with
`hostile` set. **Breaking line of sight does not beat it**; closing the distance
does — which is exactly what `kite` is trying to prevent. That is the tension.

### Gotchas

- **The plate's ink edge nearly shipped sheared off.** `SPRING_FIRE` was 32,
  which put the top of the tallest frame of the most important clip on row 0 of
  the 128px cel. It is 30 now, with ~3px of margin. If you raise the spring, or
  `PLATE_R`, or `CROWN_Y`, re-render and look — nothing fails when a cel clips.
- **Do not count exact palette matches when measuring a cel.** Canvas
  antialiases every ellipse and stroke, so ~60% of a painted cel matches no
  palette entry literally, and the undercount is WORST on thin features (the
  coil, the eye diamonds) — i.e. exactly what you are usually measuring.
  `jester.test.ts` snaps to nearest under the same luma-weighted metric
  `engine/render/sprite.ts` uses (0.3/0.59/0.11). Exact-matching reported the
  warm-ramp share as 5.3%; snapped, it is 11.1%.
- **Two art bugs here were VALUE bugs, not shape bugs**, and both looked like
  "the drawing is wrong" until measured:
  - a bone face on a bone ruff fused into one white mass with a nose floating in
    it. Fixed physically — the collar casts a shadow on the neck and the
    greasepaint is a brighter tone than the linen.
  - the plate's field filled with its ramp's SHADE (`rim: false`), so the
    reference's bright red plate came out maroon. The rim stays ON for the field
    and OFF for the edge stack.
- **Horns angled UP read as ARMS RAISED**, in every clip, at every facing. They
  droop now. Nothing reads a downward limb off a skull as an arm.
- The `warm > 9%` and `steel above head > 90` thresholds in `jester.test.ts` are
  real measurements with headroom (11.1% and 120), not round numbers. If you
  change the motley or the coil, expect to re-measure rather than to loosen.

### Where the reasoning lives

`render/monsters/jester.ts` header (palette + silhouette argument),
`constants/enemies.ts` `JESTER_*` block (why ricochet, why ratio 11),
`jester.test.ts` header (what is worth asserting and what is not).
The registry checklist is `adding-an-enemykind-ten-registries`.

---

## ✅ PREVIOUSLY LIVE — `3da7693` · card pickups (2026-07-29)

**Deployed to synology as `HEAD@3da7693`, container healthy,
`10.0.0.16:5174/dungeon` → 200, and re-verified AGAINST THE LIVE CONTAINER:
16 cards taken in a row, none stranded, no sprite left in the scene.**

### What the report was, and what it actually was

> "when i pick up a card it's still on the map"

**It was not a rendering leak, and that is the whole lesson here.** Every pickup
kind unparents and disposes its sprite through `removeGroundItem`; a headless
soak (120s of bot play with cards flowing + four descents) shows zero orphan
billboards. The card was simply **never picked up**:

- `state.cardStash` was capped at `STASH_MAX = 10`.
- **Nothing drains that stash mid-run** — only the Tavern and the pause menu do.
- Past the cap `pickUpCard` returned false and `checkPickups` LEFT the card on
  the floor, drawn identically to one you could still take.

So from the tenth card on, every card for the rest of the run was stranded, and
the knight could run over it forever. At depth 5 / ~190 kills that is every card
on the floor — which is exactly what the reporting screenshot showed. The only
tell was one line in a busy corner rail: `🃏 stash full — visit the Tavern`.

### What shipped

- **The stash is uncapped.** `STASH_MAX` is deleted. Every former cap site now
  just pushes: this pickup path, the Tavern's buy and un-socket guards, and the
  shatter-insurance / salvage card rescue — the last two could silently EAT
  cards the player had paid to protect.
- **`pickUpCard` tries the off-hand weapon's sockets** before falling through to
  the stash. A card refused while the weapon on your back had an empty slot for
  it was the same defect in miniature.
- **Card drop rate 8% → 1%**, with a debug lever for the other direction:
  ` panel → **LOOT → "CARDS 100%"** (`state.dbgCardDropAlways`, or
  `__dungeonDebug({cardDrops: true})` from a script) forces the COMMON gate.
- **`__dungeonItems()`** — new hook. Reports `state.groundItems` BESIDE the
  scene graph, so "not picked up" and "still rendered" can be told apart.

### Gotchas

- **`guaranteed` is applied AFTER the gate's `rand()`, never instead of it.**
  Written as `opts.guaranteed || rand() < t` it would skip the draw, shift the
  shared random stream, and every other roll (which card, the boss rarities)
  would differ between a debug run and a real one — i.e. the debug run would be
  testing a game that does not ship. Pinned by a test in `cards.test.ts`.
- **Unowned quads in `__dungeonItems()` are not automatically leaks.** The
  floor's props are quads (subtract `props`), and so is the merchant NPC from
  floor 2 on. A soak that ignores both reads a steady "+1 orphan" that is just
  the shopkeeper standing there. **A real leak GROWS with pickups or descents;
  a constant is furniture.**
- The deploy hit the known `canvas.node` gate failure from a clean worktree
  (2 suites failed to LOAD, all 569 tests that ran passed). Fixed the documented
  way: copy `node_modules/.pnpm/canvas@3.2.3/node_modules/canvas/build` in from
  the main checkout, re-run. Do not try to race the copy into the first run.
- Deployed from a **detached worktree at the merged SHA** with `--skip-pull`,
  because the shared checkout was dirty with another session's WebGPU work and
  `deploy.sh` copies the WORKING TREE, not `git HEAD`. Success banner reads
  `HEAD@3da7693` (not `main@…`), which is how you confirm the clean copy shipped.

### Open

- Nothing from this fix. `pickup-removal.test.ts` guards both properties (40
  cards in a row all clear the floor — it fails at card #11 against the old cap;
  and every walk-over kind leaves the scene empty and disposed).
- Worth knowing: the Tavern and pause-menu stash UIs now print `STASH (n)` with
  no denominator. If the stash is ever meant to have a *soft* limit, that label
  is where it would go back.

## ✅ MAP GENERATION — three waves, merged to main as `a354889` (2026-07-27)

Live QA of **floor 5**: "boosters just going into walls … the section in the
middle where i fight the boss is just kind of a jumbled mess". Both were real,
and floor 5 is fully covered by the archetype system (`(level-1) % 5` →
ringkeep) — nothing was unbuilt. What was wrong is that the geometry rule
systems we already had did not COVER the two things in the screenshot, and none
of them ran anywhere except in tests.

Verified by census over 36-64 live floors AND by headless render (the recorded
`RENDER IT AND LOOK` recipe). Floor 5, same seed, before → after:

    parts        213-261 → 81-99        route parts  127-186 → 19-28
    objects/1k   154-167 → 86-96        routeShare   0.60-0.73 → 0.23-0.29
    king's tile  1-7 tiles across → 9-13, zero relaxations over 78 floors
    cfg.floorTiles ÷ real walkable  3.2x → ~1.0x

### `3d7c866` — rails were aimed by a coin flip

`arc-sweeps.ts` picked a rail's throw direction with `rng() < 0.5`, and NOTHING
checked what lay past its exit (`planFillet` proves exactly ONE open tile; a rail
hands off at ≥10 u/s). Cause: a rail is a `LaneBand` on an `ArcFeature`, not a
`PinballPartSpot`, so the entire Φ apparatus had never seen one.
`orientArcRails(g, phi)` runs last in the geometry layer over `g.arcs`, so it
owns BOTH rail authors (`authorArteryBanks` writes them too). 322 → 220 lanes,
32% dropped as unfixable either way round; writes only `feature.lanes`, so it
cannot perturb a layout (pinned by a test).

Also: `checkPieces` gained a `furniture` label and an optional `{phi, parts}`, and
now runs on a DECORATED floor — the largest population on screen had never been
judged after placement. It immediately found three real defects: a route part
being "saved" by pointing it uphill, `openLaunchTargets` cracking SHAPE_ARC
tiles, and the crack rule judging a tile when the piece is a 2×2 band.

### `5b0569a` — the route was segmented on the LATTICE, and every budget rode a floor 3.2× too big

`layStationSpine` cut routes into maximal lattice runs, and **62% of those runs
are ONE TILE LONG** because a Φ descent is a staircase — so it alternated pad,
station, pad, station down every diagonal. One route event every 1.37 tiles =
eleven per second. Now segmented on the SMOOTHED heading (accumulated 45° turn,
`STATION_MIN_GAP` apart). `PAD_STRIDE = 8` is DERIVED: a booster is not an
accelerator (at stride 3 it restores 1.2% of its own speed floor) — what it
spends is STEERING, and the duty cycle `2.4/s` was 0.80.

`floorTiles = cellsW*cellsH*8` was calibrated for the legacy `thickenWalls` grid;
`buildTrackFloor` never thickens. Both the zombie and torch caps therefore bound
from level 1 and their depth ramps were dead code. `floorBudgets(level, walkable)`
extracted so `levelConfig` (a prediction, for delve's XP projection) and `core.ts`
(the counted grid) cannot drift. Re-tuned so **L10+ zombies and L8+ torches are
bit-identical** — only the shallow floors, where the crowding was, come down.

New `maze/floor-density.ts` + gate: 60 floors, thresholds derived (nearest-
neighbour spacing, the radius-6 light pool, the route budget itself).

### `be05d19` — the King gets a hall

A track floor shipped **no authored room of any kind** (`core.ts` discards the
`raw` grid all the room/prefab stamps were carved into), and floor 5 was the ONE
floor denied the antechamber — `level % BOSS_EVERY !== 0` withheld the bumper
ring from exactly the double-HP mega-boss floors. Un-skipped; the ring now asks
the maze for space instead of stamping fixed radius-2 offsets.

`BOSS_ARENA_R = 7` is derived from `boss.ts` (2·(SLAM_RADIUS+PLAYER_R) +
2·(KING_BODY_R+PLAYER_R), + KING_HOME_TILES), pinned against those constants by a
test. Diameter 14 stays inside `BONE_MAX_DIST` ON PURPOSE — a hall he cannot
shoot across is one you kite him around.

⚠️ **WHERE it is carved is most of the design.** Early → `stampOrbitIsland` eats
it (the hall is by construction the widest open disc on the floor); around the
provisional exit → built around the wrong tile (the re-pick lands 17-81 tiles
away); pinning the exit instead → `floor-metrics` reports "exit on the doorstep".
It is carved AFTER the final endpoints, guarded three ways: a route re-check with
revert (measured FROM THE CHUTE MOUTH, as `measureFloor` does — a spawn-relative
guard read 52 where the gate read 32), a clearance to the orbit island's RING
(a full circle is the one curve family `trimArcToBacking` refuses to trim, so it
cannot repair itself), and the artery banks.

### Open / worth knowing

- **`decorate.test`'s chain rate moved 0.81 → 0.60** on shipping floors with 4.1×
  fewer pads. Stated, not hidden: a pad fires along a cardinal while its road may
  bend away, which at stride 3 it had no room to do. The per-seed claim is now
  the exact one ("no route pad is stranded"); the rate is aggregate-only.
- **The hall's mouths are not authored doorways.** Carving after `planDoorways`
  is the price of carving after the final exit. Recoverable later by planning
  doorways twice.
- `zz-*.test.ts` census harnesses were temporary and are deleted; `floor-density`
  is the permanent replacement.
- Merged into `origin/main` with `git push origin HEAD:main` from a worktree —
  the shared checkout was never touched, because another session was live in it.

> ⚠️ **THIS FILE IS 850+ LINES AND HAS BECOME THE LOG IT SAYS IT IS NOT.** Eight
> sessions have prepended to it rather than replacing it, because there has been
> a concurrent session live in this checkout nearly every time. Consolidating it
> means deleting another session's in-flight notes, which no session has been
> willing to do unilaterally. **Whoever next works here alone: collapse it to the
> live state and delete the superseded sections.** Everything below the
> flow-orientation wave (`2215eff`) is history, not current state.

> ⚠️ **Sessions live in this checkout on 2026-07-27:** the flow-orientation wave
> (`2215eff`), the descent screen (`89d1aeb`), site-map readability (`ef78126`),
> the king's leash + floor rules (`efe67db`/`6f4d30b`), and the load warm-up
> (`1d46f96`, below). The last of those found the maze session's uncommitted
> edits (`maze/floor-rules.ts`, `maze/track-floor.ts`, new `maze/doorways.ts`) in
> the tree and **left them strictly alone** — committed only its own files and
> deployed from a clean `HEAD` worktree so that work did not ship early.

## ✅ DECLONE WAVE 1 SHIPPED — momentum is a dial (2026-07-27, `ed5678e`…`b1ab552`)

Read `src/game/pinball-knight/DECLONE_PLAN.md` §0-§2. §2 is now a record of what
shipped (with its two deliberate deviations written down); §3-§6 are the
remaining waves, one per session, in order.

**Why the wave exists.** A two-track review — a full code audit plus a digest of
the 12 reference-game reports in `docs/game-dev-rules/game-research/` — found
that the pinball layer and the ARPG layer are two games sharing a HUD. Nearly
every borrowed mechanic is a faithful, speed-blind port (dodge roll ~85%
Gungeon, cards ~90% Ragnarok Online, refine gamble ~80% RO, reaper ~80%
Gungeon), and the ENTIRE momentum-build interface was one binary constant:
`momSpeed > CARD_PINBALL_SPEED` (8 of a 22 ceiling). Fully on at 36% of top
speed, worth nothing above it.

**What landed.** `momentumT()`/`momentumScaled()` in `entities/combo-curve.ts` —
one concave hyperbolic ramp, 0 at a walk, 1 at terminal. Pinball cards, the
tree's two momentum nodes and the wrecking ball's bespoke ramp all fold onto it.
Card stacks now run through the house DR curve. 18 of 23 part kinds were
invisible to the named-combo system; bumper-lighting, jackpots, flippers,
mirrors and slings record shot identity now, and 6 new named combos spend the
wider vocabulary. `scoreRun` finally reads the shot layer. The grade's pace axis
was raw wall-clock (a brisk walk graded like a carried line) and is now FLOW;
style capped at combo 8, exactly where the combo curve gets interesting, now 24.
Clear a floor untouched and keep a heart. The S/A vault bonus has existed
silently since Wave F and now says so.

**Two bugs fixed on the way.** `flippercharge` ASSIGNED `momSpeed` instead of
`max()`-ing it, so casting the signature speed ability while fast made you
slower. The spinpad was a `Math.random()` fling — unaimable and not
co-op-replayable; it is a rotating deflector now, sharing one phase function
with the rotor the renderer draws.

**Two deviations from the plan, both deliberate — see DECLONE_PLAN §2.**
Softening the whole card stack made a SINGLE card under-deliver its printed
value, which would have made `describeModifier` lie; the curve exempts the best
card. And "bounces sustain, kills grow" is Hotline Miami's rule for a KILL
combo — applied literally to a BOUNCE combo it would have turned `bounceCombo`
into a kill counter and invalidated every curve calibrated on it, so it shipped
inverted (bounces grow, a momentum kill refreshes the window).

**Verified, not just built.** 1631 tests, 0 tsc errors in `pinball-knight`,
coop-determinism + floor-pipeline green, `next build` clean, and a real headless
run: the bot launched, combo climbed to 21, speeds rode 13-18.4 u/s, and the
descend fired the flawless heart (hp 6→7) with zero non-WebSocket console
errors. Deployed and re-checked on the NAS (`10.0.0.16:5174/dungeon`, 10 probes
over a minute all 200, canvas renders, 0 console errors).

**Gotcha for the next session:** `__dungeon*` hooks are DEV-ONLY — they do not
exist in the production container, so headless prod checks must go through the
canvas, not the hooks. Locally, `__dungeonLaunch` sets `momSpeed` without
releasing the plunger, so the knight sits frozen at `plungerArmed: true` and
looks like a dead sim; use `__dungeonBot()` to actually play. Under SwiftShader
RAF runs at ~1.7fps — poll with `wait_for_function`, never a tight loop.

## ✅ DOORWAYS SHIPPED — uniform openings between sections (2026-07-27)

Third attempt, and the one that landed. Read
`src/game/pinball-knight/DOORWAY_PLAN.md` — it is now a record of what shipped,
not a proposal, and §4 is the part worth your time.

**What it does.** `maze/doorways.ts` labels a floor's SECTIONS once from a
clearance field, partitions corridor space between them with a multi-source BFS,
and authors one opening per CONNECTION at that connection's narrowest
cross-section, sized to the smallest member of `[3, 5, 7]` that clears both the
size the two sections earned and the opening's current width. Wall → floor only.
Planned before the curves are authored (so the sweeps build around it), carved
after every floor→wall pass, gated by `doorways-are-uniform` in the floor-rules
registry.

```
9.9 doorways/floor over 78 floors    sizes 3w x301  5w x340  7w x131
99.2% finish at exactly their authored size          0 under 3 tiles
narrow section connections, same builder, same seeds:  4.13 → 3.41 per floor
```

**Two things in the plan's spec were wrong, and both mattered.**

1. Step A's pseudo-code guarded the band `publishArcs` PROBES (2.0-4.5 tiles
   inside the radius). `piece-rules` samples `backedAt`, which probes **0.6**
   inside — a disjoint set of tiles. Guarding the first blocks plenty and
   protects nothing. The span guard now mirrors `backedAt` and rejects **3.6%**
   of planned sites, well under the 15% acceptance, so Step B was never needed.
2. "The meeting tile with the greatest clearance" is a NO-OP read
   tile-by-tile. Two rooms joined by a one-tile slot meet across two tiles: the
   slot, and the room tile past it. The room tile is wider, so the door lands
   inside the room, measures nineteen across, and is discarded as "merged" —
   while the squeeze survives untouched. Measured: **1181 doorways carving 5.6
   tiles per floor between them**, with every summary statistic still looking
   healthy. Site at the narrowest cross-section instead.

**Two neighbouring bugs it flushed out**, both independent of doorways:

- `compactArcs` and `removeWallStubs` needed a JOINT fixed point. De-stubbing can
  open the last stone behind a drawn arc span, and compaction turns dropped rims
  into nubs. Safe to iterate (unlike the doorway pass) because both are monotone
  in opposite directions. Was 1 unbacked arc per 150 floors.
- `arc-sweeps.planFillet` asked `occupied` only on the CONCAVE branch. True of
  content, false of a plan — a convex sweep marks a rim straight through a
  planned doorway. It was the largest single reason doorways were refused, 220 of
  1788, more than every other guard combined.

**`__dungeonDoorways()`** is the new referee: authored size, finished size,
world position for `__dungeonTeleport`. Verified in the running game on L1/8/12/17
— authored == finished on every doorway, screenshots taken at carved ones.

1614 tests green (138 files), typecheck clean.

### Still open here
- **`throat` — 89 of the 266 declined narrow openings** are long 1-wide corridors
  between sections. Deliberately untouched (widening corridors wholesale is how
  attempt 1 carved floors open). Fixing them means siting a doorway at each MOUTH
  of the corridor instead of at its midpoint: a different rule, a real feature.
- **The 25-40/floor band in the old plan is dead.** It came from a rule that
  authored a door at every section pair whether or not a threshold existed there.
  The gate now asserts 4-30 as an amplification guard. If the siting changes,
  re-derive the band; do not port it.
- KING_WAKE_TILES (26) / KING_LEASH_TILES (34) are reasoned, not playtested.
- Contraflow is down 77% per launcher but flat in absolute count. Lever is
  `ALT_ROUTE_GAP`.
- **This file is still 900+ lines and still the log it says it is not.**

## ✅ NOT AN INCIDENT — the "vanished" maze work was deliberately reverted by its own author (2026-07-27)

**Closing this out because it has been logged as a data-loss event and it was
not one.** The note above records that `maze/floor-rules.ts` and
`maze/track-floor.ts` reverted and a new untracked `maze/doorways.ts` was
deleted, "with no reflog entry and no stash", counted as a fourth occurrence of
a pattern.

That was the maze session deleting **its own uncommitted prototype, on purpose**,
and saying so at the time. No third-party work was touched:

- the three files were last committed by that same session (`efe67db`,
  `6f4d30b`); the uncommitted delta on top was purely its own doorway layer, and
  `git checkout --` restored them to HEAD with every shipped rule intact
  (`minBossEuclid`, `perimeterBias`, the leash — all still present and green);
- `doorways.ts` was created in that session and never staged.

**Do not spend time on `git fsck --lost-found` for this.** It cannot work: the
changes were never staged, so no blob was ever written to the object database.
There is nothing dangling to recover. The absence of a reflog entry and of a
stash is likewise expected — `git checkout --` on unstaged changes creates
neither. Those absences are not evidence of anything.

**Why it was thrown away rather than shipped** — it failed two gates and one of
the failures was a design error, both recorded below so the next attempt does
not repeat them.

## 🚪 DOORWAYS — measured, prototyped twice, REVERTED twice (2026-07-27)

> **▶ THE PLAN LIVES IN `src/game/pinball-knight/DOORWAY_PLAN.md`.** Start there;
> this section is the history behind it.

### What was asked

> "we need to make sure we don't have narrow exits … it looks bad / looks
> sloppy. It should have clear doorways, entrances from one place to another …
> it should be a uniform size, and we have different uniform sizes that can go
> from one section to another"

Read carefully: this is a **vocabulary**, not a minimum. A minimum turns a
1-tile squeeze into a 3-tile one and leaves every other opening at whatever
arbitrary width the maze left, so the floor still reads as accidental. What
makes an opening look authored is being recognisably the same object each time.

### The measurement (keep this — it cost the most to get right)

Passage width must be measured on the **medial axis** — the widest circle that
fits at the pinch. An arbitrary tile's wall clearance is NOT width: every tile
of a 2-wide corridor touches a wall exactly like a 1-wide one. Over 120 floors:

| passage at a pinch | share | slack per side (ball r = 0.3) |
|---|---|---|
| **1 tile** | **81.3%** | **0.20** |
| 3 tiles | 16.4% | 1.20 |
| 5 tiles | 2.3% | 2.20 |

Restricted to pinches that gate a **room** (a squeeze between two 5+-wide
spaces): **10.9 per floor**. That is the set worth fixing — widening all 51
pinches per floor would carve the maze open wholesale.

⚠️ Two measurement mistakes were made before those numbers were trustworthy, and
both are easy to repeat: (1) filtering candidates to clearance ≤ 2 and then
printing "the clearance histogram", which is truncated by its own filter; (2)
treating tile clearance as width.

### Why v1 was reverted

1. **The region detector is self-amplifying.** It decided what counted as a
   "room" from LOCAL clearance, so widening an opening promoted the corridor
   beyond it into a room, which manufactured a fresh doorway, which widened
   again. Iterating it with `removeWallStubs` took authored doorways from **34
   to 107 per floor** while barely moving the defect (109 → 102 surviving
   pinches). This is the OPPOSITE of `removeWallStubs`, where every round
   strictly reduces the work left — assuming the same shape is the trap.
2. **It broke `piece-rules`** — carving cut into arc backing (the see-≠-hit
   class: the collider derives from `Grid.arcs`, not from tiles).

Residual after one pass: ~1.4 fixable 1-tile room pinches per floor. Not
shippable.

### v2 WAS BUILT AND ALSO REVERTED — read this before attempting v3

v2 fixed the amplification and its own gate went green. It still could not ship,
and the blocker is in a different module than the doorway code.

**What worked.** Section labels computed ONCE from the clearance field, before
any carving; a doorway is then "the opening between section 3 and section 7", a
statement carving cannot invalidate. Siting by multi-source BFS out of every
section at once — where two territories meet, those sections are connected, and
the meeting tile with the greatest clearance is the cheapest place to put the
door. One door per section PAIR (three corridors between the same two sections
get one canonical door, not three, or the pair dissolves into one space).

    authored ...... 32.4 doorways/floor, stable
    sizes ......... 3w x3035  5w x469  7w x382 across 120 floors
    CLOSED by a later pass ....... 0   (v1: 12)
    plan drift on re-plan ........ 2.45/floor — no amplification
    under 3 tiles after clamping centres inside the border .... 0/78 floors

**Why it still cannot ship — `publishArcs` is not backing-aware.** It lays the
circuit's fillets from the track PATH, not from the current grid. So:

- carve BEFORE it → the fillets assume tiles are solid that are now open, and
  `piece-rules` fails with "curved wall with nothing behind it";
- carve AFTER it → every widening must dodge not just arc FACES but every tile
  under a curve's whole drawn SPAN. A 3×3 neighbourhood guard is not enough —
  that was tried and still failed;
- guarding hard enough to satisfy the arcs then broke `floor-metrics` too.

**⚠️ CORRECTION — an earlier draft of this section said "v3 must change the arc
layer". Read `src/game/pinball-knight/DOORWAY_PLAN.md` instead; that claim was
based on a wrong reading of `publishArcs`.** It already claims only tiles that
are `T_WALL` at stamp time, so it is not publishing over open floor. The real
mismatch is that a feature's drawn ANGULAR SPAN covers tiles it never owned, so
a doorway carved under the band un-backs the drawn geometry. That is why a 3×3
guard around `arcIdx` failed — it checked ownership when the requirement is
about the span. A span-occupancy guard is precise and needs no arc-layer change;
clipping spans is the fallback if it rejects too many doorways.

Also carried over and still true: never carve a `mask.sealed` tile — the launch
chute's side walls are sealed, and opening one turns the plunger hallway into a
corridor with a hole in it (`track-launch.test.ts` catches it).

### The original v2 design notes

**Fix the regions ONCE, before any carving**, from structure the generator
already has (track lanes, the plaza, `TrackMask.lane`) rather than from a
clearance heuristic that moves the moment you carve. Then enumerate the openings
*between those fixed regions* and snap each to the vocabulary. The region set
never changes, so there is no cascade — and it matches the ask better, since
"each room/section" is a thing the generator already knows about.

Carry over from v1, which was sound:
- vocabulary `[3, 5, 7]` — **odd**, so an opening has a true centre tile and
  centres on the passage's own medial axis;
- size chosen by what the opening JOINS (bigger space ⇒ wider mouth), so the
  size carries information a player can learn, rather than being an rng roll;
- widening is **only ever wall → floor**, so it cannot strand anything;
- doorway tiles must be fenced off from `authorArteryBanks` / `authorArcSweeps`
  / `resealChute`, all of which convert floor back to wall afterwards;
- never widen a `T_CRACKED` tile — that is a deliberate hidden route, and
  announcing it is the opposite of a secret;
- the late pass must not cut a tile carrying an arc face.

**Revolving secret doors are DONE** — shipped separately (`5ab8596`), see below.
They were independent of all of this, which is why they landed and the doorways
did not.

**Physics is owned by another dev.** The bounce/rattle half of the narrow-gap
complaint was explicitly handed to them; this work is geometry only.

## ⚡ THE DESCENT PREWARM COULD NOT SEE ANYTHING HIDDEN (2026-07-27)

**`main@1d46f96`** → synology (clean `HEAD` worktree deploy, banner
`HEAD@1d46f96`). Container `healthy`; `/dungeon` and `/` both 200 on
`10.0.0.16:5174`. 1585 tests green (136 files) · `tsc` clean for
`pinball-knight`.

Plan + measurement protocol: **`src/game/pinball-knight/LOAD_PERF_PLAN.md`**.
Research this came from: **`docs/game-dev-rules/game-research/`** (12 reference
games; the perf one is `asteroids-and-performance.md`).

### The defect

`89d1aeb` shipped `warmFloorPipelines` and it works — it took a measured
5103 ms first frame down to 44 ms. But `compileAsync` walks `_projectObject`,
which **returns early on `object.visible === false`** and frustum-tests meshes
(`three/src/renderers/common/Renderer.js:3082` and `:3132`, quoted in the plan).

Every pooled effect in this game is constructed **invisible**, and their groups
*are* scene children — so the warm-up reached all of them, skipped all of them,
and reported success:

| Pool | Slots | Built invisible at |
|---|---|---|
| SlashPool | 10 | `render/vfx.ts:305` |
| BoltPool | 40 | `render/vfx.ts:396` |
| RingPool | 16 | `render/vfx.ts:516` |
| SigilPool | 8 | `render/vfx.ts:679` |
| BladeRing | 6 | `render/vfx.ts:768` |
| DamageTextPool | 32 | `engine/render/damage-text.ts:254` |

Two more families it *could not* have seen: the dash **ghost** builds its
material at spawn (`vfx.ts:992`), and the five **floor-fx** decal materials are
lazy (`entities/floor-fx.ts:173`) so on a fresh floor none exist. Net effect:
the first slash, bolt, ring, blade, sigil, damage number, dash and each decal
kind of a run still compiled a pipeline **mid-fight**. Nothing threw; it hitched.

### The fix

- Each pool exposes `warmupTarget()`; `vfx.warmupReveal()` makes **one**
  representative per family visible + unculled and returns a restore closure.
  Pipelines key on material **content**, so one slot warms the whole pool.
- A hidden **ghost prototype** carries the afterimage descriptor (`map` +
  `alphaTest: 0.4`) on a 1×1 dummy texture.
- `warmFloorFxReveal(scene)` forces all five `matFor(kind)` materials to exist
  and reveals one proxy each. `spawnFloorFx` **clones** those, and a clone keys
  to the same pipeline.
- `warmFloorPipelines` wraps its existing loop with both reveals, restored in a
  **`finally`** — a throw must never park a stray quad in the world.

**Position is deliberately untouched.** `frustumCulled = false` skips the frustum
test outright, so where a proxy sits is irrelevant, and not moving pool slots
keeps this free of side effects on live effects.

### Also: `state.floorFx` had no cap at all

`FLOOR_FX_MAX = 300`, evicting oldest-first through the existing `despawn()`.
Coins (28) and ghosts (14) were capped; this was not. The groove is the producer:

    GROOVE_RAIL_MAX_SPEED 17 u/s ÷ GROOVE_SPACING 0.34 u  =  50 stamps/s
    50 stamps/s × GROOVE_LIFE 26 s                        = 1,300 live decals

Each is a Mesh **plus a cloned material** added straight to the scene. Eviction
is from the FRONT on purpose: `carveGroove` reads `floorFx[length - 1]`
immediately after spawning to stamp the cut's direction.

### Measurement enablers — none of this was falsifiable before

- **`engine/gpu-adapter.ts`** — probes `GPUAdapter.info`, flags software
  rasterisers (`swiftshader`/`lavapipe`/`llvmpipe`). **Unknown counts as
  untrusted**, deliberately.
- The profiler prints the GPU and a loud **UNTRUSTED** banner on software.
  **`__dungeonGpuInfo()`** answers it *before* you spend 600 frames.
- **`profCount("gpu programs")`** — `info.memory.programs` is THE gate: it must
  be **flat** from the descent screen closing through a whole fight. Any rise
  names a material family the reveal still misses.
- **`profCount("gpu textures")`** exists to settle the per-actor texture-clone
  question (`render/sprite.ts:477`): ~135 at a full horde confirms one upload
  per zombie, ~20 refutes it. **Nobody should cost that fix before reading it.**

### Verified

`load-warmup.test.ts` (6 tests), **negative-controlled**: disabling the reveal
and the cap fails 4 of 6 with the exact expected assertions (0 revealed instead
of 7; 350 and 325 decals instead of 300; evicted material never disposed). The
restore test specifically pins that the ORIGINAL flags come back — BoltPool
ships `frustumCulled` already false, so a restore assuming three's defaults
would silently re-enable culling on it.

### ⚠️ Open — the live numbers are NOT yet measured

The before/after in the table under the descent-screen section is from
`89d1aeb`; **this wave has no live profile yet.** It ships on reasoning plus
unit tests. Someone with a real GPU should run the protocol in
`LOAD_PERF_PLAN.md` §Measurement:

1. `__dungeonGpuInfo()` — if it says software, **stop**, the numbers are void.
2. Note `info.memory.programs` when the descent screen closes → `P_warm`.
3. `__dungeonProfile(600)`, then fight: swing, cast a bolt, dash, take a hit,
   ride a groove, ignite oil.
4. **Pass = `# gpu programs` max equals `P_warm`.** Any positive delta names a
   family still compiling cold.

Prod is http-over-IP, so `navigator.gpu` is absent and you get the WebGL2
fallback — use `https://braindeadbot.com/dungeon` over host Chrome/CDP, per the
recipe further down this file.

Other open items:

- **`FLOOR_FX_MAX = 300` is reasoned, not playtested.** It keeps ~6 s of rut at
  top speed. If the groove stops feeling like a rideable rail on long runs, that
  is the dial.
- The warm-up now compiles **more** than before, so the descent screen may get
  marginally longer. It was 6–10 s cold; the added work is ~8 representative
  materials, so this should be noise — but it is unmeasured.
- The reveal covers pools that exist **at warm-up time**. Anything that invents
  a material later (a new ability's one-off mesh) reopens the same hole, and the
  `gpu programs` counter is how you would notice.

### Deferred from the same audit, deliberately

- **`blob-pool.ts` is dead code** — a tested `InstancedMesh` contact-shadow pool
  with **zero call sites**; every actor still gets its own blob mesh
  (`render/sprite.ts:158`), one extra draw call each. Wiring it is a sprite
  lifecycle change, not a warm-up one.
- **Torch-light sort** allocates ~80 objects and a full sort **per rendered
  frame** (`core.ts:2335`, 80 torches/floor ≈ 4,800 objects/sec).
- `mapSignature` builds a string over all 135 zombies per frame
  (`map-render.ts:422`); `core.ts` rebuilds a 13-string literal per sim step.

## 🗺️ SITE MAP READABLE — binarized text sprites + a 2x logical grid (2026-07-27)

**`main@ef78126`** → synology (clean `HEAD` worktree deploy). Touches only
`src/map/map-renderer.ts` + new `src/pixel/pixel-text.ts`.

### What was reported

> "the resolution for the pixels is too blurry, the words are unreadable"

### Two root causes, compounding

1. **Canvas `fillText` anti-aliases glyphs and cannot be told not to.** On the
   352px-logical surface, every grey fringe pixel became a 4×4 grey block after
   the integer upscale. `imageSmoothingEnabled=false` never touches this — the
   grey is baked into the low-res surface before the blit.
2. **Labels were VT323 at 8px — HALF that face's 16px native design size** — so
   strokes never landed on the pixel grid to begin with.

### The fix

- **`src/pixel/pixel-text.ts`**: rasterise each string once offscreen,
  threshold alpha to 0/255 (cut at 96, not 128, so a stroke straddling two
  pixels thickens instead of vanishing), cache per `(font,color,text)`, blit at
  integer coords. `clearPixelTextCache()` is called when the webfonts land —
  sprites rasterised in the fallback face must not survive.
- **Map grid doubled to 640 logical px** (every layout constant ×2, icons drawn
  at 2× cell scale, `maxScale` 6→4): same physical size on screen, twice the
  pixel detail, and labels run at VT323's **native 16px**.
- Label placement gained left/right fallbacks after below/above — recovers
  PINBALL KNIGHT, AQUARIUM, SKI SLOPE, RACCOON TORNADO in the dense middle.
- `LABEL_MAX` 13→16 ("PINBALL KNIGHT" now fits whole).

### Verified

Headless playwright screenshots at DPR 1 **and** 2, 1440×900 (`shotmap.mjs`
recipe in the session scratchpad): every label crisp at both densities;
`hitTestRoom` unchanged in structure (slop scaled with the grid). `tsc` clean
for `src/map` + `src/pixel`; `pixel-canvas.test.ts` 11/11.

### Gotchas for whoever touches this next

- `drawPixelText` assumes **solid fills** — the threshold trick breaks on
  gradients. Fine here; don't lift it somewhere it isn't.
- The dungeon's own floor map (`src/pixel/` consumer) still uses raw `fillText`
  — same mush is available there if anyone complains; the sprite cache is
  drop-in.
- The intro's SKIP button can still be up when the map opens over it
  (bottom-right, overlaps "YOU ARE HERE") — cosmetic, site-level, not the map's
  z-order.

## 👑 THE KING GUARDS HIS POST + FLOOR RULES (2026-07-27)

**`main@efe67db`** → synology. 1075 tests green · `tsc` clean · boss bar
verified absent at spawn in-engine.

### What was reported

> "the boss can't be next to the starting point. and the starting point should
> always be the corner of a map not just randomly in the middle of it unless
> it's for specific types of levels … global maze generation logic … then we can
> just cycle those theme rules with the global rules"

### The boss was never misplaced — measure before building

| | |
|---|---|
| king's spawn tile, nearest observed to the player (78 floors) | **56 BFS steps** |
| mean, as a fraction of the floor's whole reach | **68%** |

He rides the exit (`nearestOpenTile(stairs, 2)`) and the exit is already pushed
a lap away. **Placement was correct and always had been.** `spawnBoss` set
`z.aggro = true` — the one flag the generic zombie AI reads to decide whether to
chase. Every other enemy starts `false` and wakes only inside `AGGRO_TILES` *by
path distance*; the king opted out of that gate, so from the frame the floor
built he walked to the spawn and never stopped.

**No generation rule can fix a mover.** Hence `boss.ts` THE LEASH: an anchor
(his spawn = the exit), a wake radius on the same flow field the grunts use, and
a leash measured **from the anchor** so kiting him away and looping back cannot
walk him off the stairs a step at a time. Disengaged he returns home. His
barrage and slam are gated too — otherwise the leash removes the chase and
leaves the harassment, which is the worse half. 8 tests in `boss.test.ts`.

The boss bar is gated on engagement as well; it used to announce
"☠ THE REAPER KING ☠" the instant the floor built, which by itself reads as
"he's right here". `BossAux.engaged` is streamed so replicas agree.

### maze/floor-rules.ts — the registry

Rules are **scored preferences, not booleans**. "Spawn in a corner", "exit a lap
away" and "boss far from spawn" can be jointly unsatisfiable on a small floor;
applied in sequence, whichever ran last silently wins. When a rule genuinely
cannot be met the generator records a **declared relaxation**
(`TrackFloor.relaxed`) and the gate caps the rate — currently **3.8%**, capped
at 12%. A silent fallback is indistinguishable from a broken rule.

Every rule carries its own `check`, and `floor-rules.test.ts` iterates them over
78 floors — a new rule is covered the moment it joins the array. It also prints
each rule's *tightest observed margin*, which is what tells a regression guard
apart from a threshold that has drifted into irrelevance.

The archetype supplies **weights, never its own placement code**.

| archetype | perimeterBias | why |
|---|---|---|
| warrens | 0.90 | a tangle with no centre worth starting in |
| ringkeep | 0.85 | progression is working inward ring by ring |
| spine | 0.80 | start at an END of the boulevard, not halfway along |
| cavern | 0.70 | no architecture to respect |
| **greathall** | **0.15** | **the exemption** — the floor IS its central chamber |

Consumed by `carveLaunchChute` (which decides spawn on **94%** of floors) as a
**term, never a filter**: a filter would reject every site on a floor whose
circuit never reaches the border, and could override the runout gate that stops
a chute firing into a wall. The geometry band is unchanged; perimeter chooses
*within* it.

    spawn perimeterScore, mean by archetype (1.0 = hard against the edge)
      before   all five 0.35-0.42 — an 8-point spread, i.e. no archetype effect
      after    warrens 0.68  spine 0.73  cavern 0.70  ringkeep 0.68
               greathall 0.44  ← still central, on purpose

### ⚠️ Found on the way — `removeWallStubs` stopped mid-cascade

Moving the chute to the edge took the piece gate from 0 to **9 violations per
150 floors**, 8 of them wall stubs. Against a bias-off control on the *same*
floors: **2/150 before, 9/150 after** — the regression was real, the cause was
not the chute.

`removeWallStubs` iterated with `maxRounds = 6`. That is not a fixed point, it
is six waves — opening a stub creates stubs around it, and on floors needing
more the loop stopped **mid-cascade**, leaving nubs its own previous round had
manufactured. Silently. Raising the cap to a runaway guard takes **both regimes
to 0/150**, clearing the pre-existing 1.3% as well.

The piece gate's sweep is widened **40 → 150 floors** and stays zero-tolerance:
a 40-floor sample is exactly what let a 1.3% defect sit green.

**A measurement mistake worth not repeating:** the first census of this said the
two regimes were indistinguishable (5/300 vs 6/300). It built floors its own way
instead of the way the gate does, so it sampled a different population. Rebuilt
against `floorAt` verbatim, the difference was 4.5×. Copy the harness you are
comparing against.

### ⚠️ Open

- `KING_WAKE_TILES` (26) / `KING_LEASH_TILES` (34) are reasoned, not playtested.
  A test pins WAKE < LEASH (inverted, he oscillates), but the *feel* is unproven.
- The leash is world distance from the anchor; the wake is path distance. Mixing
  metrics is deliberate (you should not wake through a wall; the leash is about
  how far he has physically strayed) but if he ever behaves oddly around a thin
  wall, that asymmetry is the first place to look.
- `perimeterScore` is edge distance, not corner distance — see its comment for
  why corners were rejected. If "corner" specifically is wanted, that is a new
  rule, not a retune.

## ⏳ THE DESCENT SCREEN — the freeze was SHADER COMPILATION, not generation (2026-07-27)

**`main@89d1aeb`** → synology. Written by a **parallel session** in this
checkout; committed and shipped by the flow-orientation session because
`deploy.sh` builds `COPY . .` (the working tree, **not** HEAD), so an
uncommitted file either ships untracked or is lost on the next clean deploy.

### The measurement that reframes it

On real hardware (NVIDIA Ampere, WebGPU backend):

    buildLevel .................  544 ms
    first frame after it ....... 5103 ms   ← the freeze

WebGPU compiles a render pipeline **per distinct material, lazily**, the first
time it is drawn — so a floor's worth of shaders all landed on frame one with
the main thread blocked and nothing on screen. **A progress bar over the maze
generator would have covered a tenth of the wait**, which is the trap here.

### The shape of the fix

`floor-loading.ts` puts a descent screen up; `warmFloorPipelines` then calls
`renderer.compileAsync(child, camera, scene)` per top-level scene child (per
child, not one whole-scene call, so the bar shows real progress) while
`renderHeldForLoad` keeps the loop from simulating or rendering. Rendering early
would trigger the exact compile storm the warm-up exists to schedule. Same
technique as Unity's `ShaderVariantCollection.WarmUp` / Unreal PSO precaching.

`buildLevel` (the old `startLevel` body) stays **synchronous**: `descendInto`,
the co-op regroup, the seed-adoption rebuild and `__dungeonLevel` all rely on
the floor existing the moment the call returns.

### The other half — SHARED MATERIALS AND GEOMETRY (in `2215eff`, undocumented there)

⚠️ **This shipped inside the flow-orientation commit, not the descent-screen
one**, because the two sessions shared a checkout. `render/pinball-parts.ts` is
where it lives, and it is the half that made the descent screen affordable:
prewarming ~1400 redundant pipelines cost 10.1 s, prewarming the deduplicated
set costs ~6 s.

A live-floor census found the parts were built from private copies of identical
GPU objects:

| | instances | distinct | redundant |
|---|---|---|---|
| materials | 1707 | 504 | 70% |
| geometries | 1668 | 100 | 94% |

`std()` and six `*Geo` helpers now memoise by value. **Two invariants, and both
will bite whoever adds the next part builder:**

1. **A material an animator WRITES to must not be shared.** The `PART_ANIMATORS`
   pulse `emissiveIntensity`, most of them offset per part by `part.i` or a
   random `phase`. Share one and every part of that kind breathes in lockstep,
   last writer winning. Build those with **`stdOwn`**. The reliable tell is that
   *every animated material is the one stashed in `userData`* — that made the
   audit mechanical, and it currently balances exactly: **24 `userData` captures
   ↔ 24 `stdOwn` call sites**. If you add a builder, keep that count matched.
2. **Never dispose a shared object.** `disposePinballParts` used to traverse and
   dispose everything it found; on cached geometry that is a use-after-free the
   *next* floor renders as nothing. `releaseOwned()` skips anything flagged
   `userData.shared`. Same rule the texture cache in `maze/build.ts` states.

`ExtrudeGeometry` is deliberately left uncached — both uses `.translate()` the
result, and a shared geometry translated once per part walks off the origin.

### Verified before shipping

Booted headless against the dev server: descent screen paints, the hold
**RELEASES**, floor renders with 152 parts. That check matters more than it
looks — `renderHeldForLoad` is only cleared in a `.finally()`, so a
`compileAsync` that never settled would strand the player on the loading screen
with no way out. `tsc` clean, 1059 tests green.

### Verified LIVE on production (2026-07-27, real WebGPU)

`https://braindeadbot.com/dungeon` over host Chrome/CDP — secure context, so the
adapter is real (`nvidia/ampere`) and the backend is **WebGPU**, not the WebGL2
fallback you get over `http://<IP>`:

| | before | after |
|---|---|---|
| first frame | **5103 ms frozen** | 44 ms |
| steady p50 / p95 | 81 ms / — | **35 ms / 40 ms** |
| p95 over 40 s of bot play | — | **12 ms** (60fps budget = 16.67) |
| draw calls at spawn | 1326 | 985 |
| descent screen up | — | 220–250 ms |
| playable | ~5.6 s frozen, then hitches | 6.2 s warm / 10.1 s cold |

Zero page errors; the floor renders complete (parts, chevrons, walls) — the
visual regression sharing could have caused did not happen.

**The honest trade:** the descent is now *longer* in wall-clock (6–10 s vs
~5.6 s) because the warm-up compiles **everything**, where lazy compilation only
did what was on screen — which is precisely why the old build kept hitching for
the next 10–20 s as you moved. It is now an animated screen with no hitches
after. The cold/warm gap is Chrome's on-disk pipeline cache, so a returning
player sees the 6 s number.

### ⚠️ Open / unverified

- **No test covers `floor-loading.ts`.** The release path is guarded by
  `try/catch` + `.finally()`, but nothing pins it.
- The 5103 ms figure is from the **WebGPU** backend on a real GPU. WSL/headless
  falls back to WebGL2 ([[webgpu-needs-a-secure-context]]), where the compile
  cost is different — don't re-tune the batching against a SwiftShader run.
  Concretely: under SwiftShader steady-state frames are **~1300 ms**, so a
  `compileAsync` experiment there measured **18.4 s** and looked like it made
  things *worse*. The same experiment on the real adapter took 6.6 s and removed
  the stall. Use host Chrome over CDP and confirm
  `(await navigator.gpu.requestAdapter()).info` names a real vendor.
- **Next lever, if 6–10 s is judged too long:** warm only what is near the
  player, close the screen, and background-warm the rest on a per-frame budget
  (~8 ms). The remaining unique-material count is dominated by ~466 sprite
  materials, which are per-instance **by design** — `createStaticSprite` says
  why (`tavern/npcs.ts` tints individual keepers via `mesh.material.color`), so
  that one needs the tint case handled before it can be shared.
- Captions and phase fractions (`0.3 + 0.7 * f`) are hand-set; the bar's
  relationship to real remaining time is approximate.

## 🧭 THE TRACK RUNS ONE WAY — Φ, and the booster family (2026-07-27)

**`main@2215eff`** → synology. 1059 tests pass (93 files) · `tsc` clean for
`pinball-knight` · verified in a rendered screenshot, not just as numbers.

### What was reported

> "here's examples I boxed in red of tracks that randomly generate that make no
> sense … it's making paths that feed back into itself causing feedback loops
> where the user gets stuck. we need to make sure that MOST of the tracks are
> going one direction but have multiple paths that are possible over having one
> set path. can we make different types of boosters? … we need corner booster,
> curved boosters, more jumpers in the mix"

The screenshot boxed two booster runs a few tiles apart pointing opposite ways.

### What the census found (78 floors, the shipping `TRACK_FIRST` path)

| measure | before |
|---|---|
| launch parts firing back toward the spawn | **16.2%** (544/3364) |
| …of non-spine boosters | **57.2%** (253/442) |
| …of flippers | **42.5%** (130/306) |
| anti-parallel duels surviving `breakLaunchDuels` | **1.58/floor** — 121 of 123 spine-vs-spine |
| launchers inside a CLOSED exit-ray cycle | **130** (6.4% of chained pads) |
| `booster` share of all launch furniture | **73%** (2471 of 3364) |

### Three rule bugs

1. **`booster` and `flipper` were never in `FORWARD_FLOW_KINDS`.** A kind not in
   that set takes its heading from `classifyTopology`, which resolves a straight
   run's two ends with `rng() < 0.5`. The most common launch part on the floor
   was aimed by a **coin flip**. The old comment justified omitting `flipper`
   ("a redirect — its direction is already meaningful") and never mentioned
   `booster` at all.
2. **`breakLaunchDuels` skips spine-vs-spine by design** — which was 98% of what
   it found — and cannot represent a ring of 3+ at all. The runtime
   `BOOSTER_JAM` guard can't see those either: it trips when a pad catches the
   ball in the same SPOT twice, and in a multi-pad ring it never does.
3. **One route.** `layStationSpine` furnished the single traced artery, so the
   floor had one set path however well it was aimed.

### The fix — a scalar potential, not more pairwise repair

`maze/flow-orient.ts` builds **Φ = BFS distance to the STAIRS**. Every launch
part fires strictly downhill on Φ, so any chain of shoves is a strictly
decreasing integer sequence — **a loop is impossible rather than rare**. Because
Φ is defined on every walkable tile (not just one artery), every leg of the
grown circuit gets a consistent forward direction, which is where the multiple
routes come from: `alternateRoutes` descends Φ from far-apart heads, giving up
to `ALT_ROUTES_MAX = 3` extra roads that all drain to the exit.

**Φ is distance-to-STAIRS, not distance-from-start, and that is the whole
point.** "Further from the spawn" is satisfied by any dead-end branch, so the
old down-flow test could certify a pad firing down a pocket the exit isn't in —
which is exactly how it stayed green while 16% of pads pointed home.

`maze/flow-loops.ts` then walks the successor graph (each part's exit ray → the
part it feeds; a functional graph, so trees hanging off cycles and nothing
else), finds every cycle in one linear three-colour pass, and breaks it. **No
spine exemption** — downhill is onward by definition now, so re-aiming a route
part is safe, which is what made the old pass a no-op.

### The booster family (was: one flat pad)

- **`boostcorner`** — a turn that ACCELERATES: enters on `dir`, fires along
  `dir2` (same two-leg convention as `deflector`, so they're interchangeable in
  the plan). Replaces the "curve carry" hack — a straight pad dropped in a
  corner, which re-fired its own rebound. This one knows which leg the ball
  arrived on and **declines a rebound** instead of relaunching it.
- **`boostcurve`** — carries a **TANGENT**, not a cardinal, so a grid staircase
  renders and plays as one curved lane instead of a zigzag of axis-aligned
  arrows. It fails `|dirI| + |dirJ| === 1`, so it is excluded from every
  cardinal-only repair pass *by construction* rather than by a flag.
- **`jumppad`** — the hop, made visible. The one shot per floor that flies over
  a wall band was a `ramp` with a `vault` flag and no distinguishing mesh.

### Found on the way — the jump shot didn't exist on track floors

`strictLaunchers` is on for every track floor and lifted the `vault` exemption
from the final runway re-aim. A vault part's runway is **0 by construction**
(it's aimed at rock on purpose), so it failed `MIN_RUNWAY` on every floor and
was re-aimed down the longest open corridor — silently turning the floor's only
jump-the-maze shot into an ordinary dash pad, on every track floor since that
flag shipped. `vault` is now exempt unconditionally.

### After, same 78 floors

| measure | before → after |
|---|---|
| firing backward | 16.2% → **1.5%** |
| closed feedback cycles | 130 → **2** |
| duels | 1.58 → **0.44** /floor |
| side-by-side contraflow (the screenshot case) | 0.0137 → **0.0031** /launcher |
| launch furniture | 3364 → **9162** (booster 50%, corner 40%, + curve/jump) |

Baseline measured by re-running the census in a worktree at the **unmodified**
parent commit, not from memory.

### Two tests were proxies; they now assert the property

- The down-flow test measured **dist-from-start** — wrong field, green while 16%
  pointed home. Now Φ.
- The duel test called an **intercepted lane** a duel. Two roads converging on a
  Φ minimum with a corner booster at the meeting point is a **merge**, not a
  ping-pong; the un-intercepted predicate would have "repaired" it by re-aiming
  one road back up itself. Both the test and production `firesAt` now require a
  clear lane with **nothing that catches the ball** in between.
- Added: `NO CLOSED LOOP of shoves survives` and `route pads run STRICTLY
  downhill on Φ`.
- The station-spine chain gate went from 75%-per-seed to an **aggregate** 70%
  plus a 50% per-seed collapse detector: a floor now has up to four roads and
  therefore four times as many run-ends, so the un-chained share rises for a
  structural reason. Measured 74.1% aggregate (was 69.6% before terminus
  stations were added, 75% on the old single-road floor).

### ⚠️ Gotchas

- **`boostcorner` is NOT in `LAUNCH_KINDS`** and must not be added. Its `dir` is
  the leg the ball ARRIVES on; a pass that read `dir` as a fire direction would
  re-aim the entry. `maze/flow-loops.ts` handles it via its own `exitRay`.
- **`boostcurve` has a non-integer `dirI/dirJ`.** Anything stepping
  `p.i + p.dirI * s` over tiles must exclude it (they all gate on
  `|dirI| + |dirJ| === 1`, which excludes it automatically).
- `TANGENT_SNAP` (0.34 ≈ 20°) decides straight-pad vs curved-pad. Raise it and
  curves become staircases again; drop it and near-straight runs get curve pads
  that read as noise.
- Emissives on the new parts were tuned **from a screenshot**: at the first
  values the jump pad rendered as one white mass because its chevrons were
  `C_SHOT`, the same colour and brightness as the takeoff lip behind them. Gold
  chevrons under a `C_SHOT` lip is the hierarchy. Re-check in-engine if you
  touch them.

### Open

- **Contraflow is down 77% per launcher but the absolute count is flat** (399 →
  430 pairs/78 floors) because the floor now carries 2.7× the launch furniture.
  If the user still points at side-by-side opposing runs, the remaining ones are
  two *different roads* passing each other, both individually correct — the
  lever would be `ALT_ROUTE_GAP` (currently 6) to push alternate roads further
  apart.
- **2 closed cycles remain** out of 5535 chained launchers. Not chased; they are
  cases where `breakFlowLoops` could neither re-aim downhill nor demote (fewer
  than 3 open sides) and removal left another ring.
- `ramp` is still 22.3% backward — mostly the deliberate `KICKBACK_CHANCE`
  (0.12) plus pads whose only open lane runs uphill. Both wanted; not a bug.

## 🙃 THE FLIP, ACTUALLY FIXED THIS TIME — the PIXEL PASS was inverting every frame (2026-07-26, third session)

### What was reported

> "flip the pinball knight game so its right side up. you have attempted to fix
> this multiple times and have failed do not attempt the same tactics look at
> your work."

The user was right for the third time. `38484a6` (the six flipY=false edits, the
section this replaces) shipped, was live on prod, and the game was **still
upside down** — because that fix, like `e1426d2` before it, compensated
individual textures **inside a flipped frame** instead of fixing the frame.

### The real root cause — one line of orientation, at the present seam

Under `WebGPURenderer` (BOTH backends), sampling a **render target's** texture
with TSL `uv()` on a fullscreen quad reads it **v-flipped** relative to the
legacy `WebGLRenderer`+`ShaderMaterial` idiom. The pixel pass
(`engine/render/pixel-pass.ts`) does exactly that for every frame of the game —
so the **entire presented frame** was upside down: geometry, sprites, textures,
everything except the DOM HUD.

**Fix:** every RT sampling hop in the pixel pass now goes through `rtUv()`
(v-flipped UV). The seven `flipY=false` texture edits are **reverted** — the
textures were never wrong.

### How it was proven (do it this way next time)

1. **Reproduce in the USER'S browser, not a harness**: headless **Vivaldi** over
   CDP (`/mnt/c/Users/Barco/AppData/Local/Vivaldi/Application/vivaldi.exe`,
   same recipe as playtest's `--gpu`) against prod. Landmarks matched the
   user's screenshot exactly.
2. **Pure-math oracle, no rasterizer**: replicate the camera from source
   constants (tilt 38°, yaw 45°, dist 24, ortho, zoom 0.78, target at spawn)
   and `project()` landmark world positions. The ENTER MAZE sign (y 3.0, north
   wall) projects to the screen **top**-right; the render had it **bottom**-
   right, in exactly the v-mirrored position. x preserved + y mirrored ⇒
   composite v-flip, not a yaw/mirror bug.
3. **The bloom parity clincher**: the "fireflies" floating in the void were the
   marquee's bloom, v-mirrored from its diffuse. Diffuse path = 1 RT sampling
   hop (odd ⇒ flipped), bloom path = 4 hops (even ⇒ upright). One flip **per
   hop** is the only model consistent with both — that pinned the seam without
   touching a line of code.
4. **Why the texture fixes fooled review**: with `flipY=false`, a texture is
   pre-inverted, so the flipped composite flips it back to readable — "ENTER
   MAZE" read fine on a frame where the KNIGHT WAS STANDING ON HIS HEAD (crop
   the sprites next time; sprite.ts keeps flipY=true so sprites showed the
   truth all along).

### Verified after the fix (dev server, real browsers over CDP)

| Oracle | webgl (Vivaldi) | webgpu (Chrome, real Dawn) |
|---|---|---|
| Marquee ABOVE notice board, top of screen | ✓ | ✓ |
| "ENTER MAZE" glyphs upright, arrows point DOWN at board | ✓ | ✓ |
| Player + NPC sprites head-up | ✓ | ✓ |
| Dartboard low on the SOUTH wall (5.9, 6.6) | ✓ | ✓ |
| Bloom registered on its source (no void bokeh) | ✓ | ✓ |

1427 pre-existing tests pass. (One failure in the full run is `__census.test.ts`,
an untracked in-flight file belonging to the parallel session — it passes alone.)

⚠️ Open, webgpu-only, **Vivaldi-only**: headless Vivaldi with `?gpu=webgpu`
renders a black canvas (zero console errors). Chrome webgpu is fine. Prod is
http-over-IP (insecure context ⇒ no `navigator.gpu`) so every prod visitor gets
webgl regardless; this only matters if prod ever moves to https.

### The backend default (unchanged by this session)

`auto` resolves to WebGPU, falling back to WebGL2 when `navigator.gpu` is
absent (i.e. all of http-over-IP prod today). `cf377a9`'s "WebGPU renders
upside down on some forks" attribution stays retired — the flip was the pixel
pass, on every backend.

⚠️ **Sprite atlas exception still real**: `engine/render/sprite.ts` computes
`offset.y = (rows-1-row)/rows`, which depends on `flipY=true`. It was correct
before, throughout, and now.

### ⚠️ How to test WebGPU from WSL — and why `?gpu=webgpu` alone proves nothing

**Headless SwiftShader has NO WebGPU adapter.** It logs "No available adapters",
`WebGPURenderer` silently falls back to WebGL2, and the page still reports
`__renderBackend === "webgpu"`. A run that looks like WebGPU but is not.

Working recipe: drive **host Windows Chrome over CDP**
(`/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`, `--headless=new
--remote-debugging-port=<p> --remote-allow-origins=* --user-data-dir=C:\Temp\...
--enable-unsafe-webgpu`), then `chromium.connectOverCDP`. WSL2 forwards listening
ports, so the WSL dev server on :5174 is reachable as `localhost`. Always assert
`navigator.gpu` **and** that `requestAdapter()` returned an adapter. The tell that
you are really on Dawn: Chrome logs "The powerPreference option is currently
ignored … on Windows". `scripts/playtest.mjs --gpu` already implements the pattern.

### `selectBackend()` now has tests — it had ZERO

`src/render/backend.test.ts`, 8 tests. This is the one function whose regression
flips the screen or silently downgrades the renderer, and `backend.ts` documents
that neither is detectable from inside the page. **Negative-controlled**:
restoring `forceWebGL = true` fails 4 of the 8, so the guard is not vacuous.

### ⚠️ METHOD WARNING — how the first pass got it wrong

The earlier session compared its own headless render against the user's
screenshot, found every landmark matching, and concluded "not flipped". **Both
images were flipped**, so they agreed. Comparing a suspect against another suspect
proves nothing.

What actually worked was an **absolute** oracle — an object whose correct
orientation is knowable from the source alone:
- `makeFlameTexture` paints tongues from `base = F - 4` (canvas BOTTOM) **upward**
  via `base - h`. So the wide base belongs at the bottom and the tip points up.
  On screen it was tip-down. That is decisive without any reference image.
- `makeWallTexture`'s own comment says moss is "denser at the bottom". It was
  rendering at the top.

Sprites and the HUD are drawn in screen space and stayed upright throughout, which
is exactly why this read as "everything except the UI is upside down" and why a
landmark-position check could not see it.

## 🖱️ SKIP left an INVISIBLE CLICK BLOCKER over the whole site (2026-07-26)

**Commit `f78bb4a`** → synology (`HEAD@f78bb4a`, clean worktree). Container
`healthy`. 1419 tests pass (123 files).

### What was reported

> "when i skip in braindeadbot intro then go to map i can't click it"

### Root cause — an orphaned overlay, not a map bug

The toucan flight owns **`#toucan-intro-blocker`**: a transparent, full-viewport
`div` at **z-index 99998** that swallows clicks while the bird flies. The only
thing that removes it is the flying run's own `_cleanupRef` closure.

SKIP stays live for the whole intro, so pressing it **mid-flight** called
`forceSkipBoot()` → the boot re-entered `triggerTransition(true)` → `startDissolve`
→ a **second** `playToucanIntro()` underneath the run already flying. That second
call saw `_running === true`, dismissed it as a stale HMR flag, and reset it —
orphaning the live run's cleanup closure, blocker and all. The `skipToucanIntro()`
immediately after then found `_running === false` and returned without doing
anything.

The console said it out loud, pre-fix:

```
[intro-scene] ⏭️ Skip button clicked
[DOS-Boot]    ⏭️ Fast-forwarding to dissolve
[DOS-Boot]    🎬 Preparing toucan intro…  fastForward: true
[toucan-intro] ⚠️ _running was stale true — resetting   ← blocker orphaned HERE
```

### Why it presented as "the map won't click"

An invisible overlay does not block the **keyboard**. `M` still opened the map,
so the map looked like the broken thing. Every click on the page — map, compass,
room props, games — was landing on the blocker instead. `#map-overlay` also
stayed `hidden` because the compass click never reached it.

### The fix — three layers

| File | Change |
|---|---|
| `src/transitions/toucan-intro.ts` | All end-of-run paths route through `_endLiveRun()`. Re-entry while `_running` now **tears the live run down** instead of writing the flag off as stale. `_sweepStrayBlocker()` added as a backstop. |
| `src/transitions/dos-boot.ts` | `_handedOff` — hand off to the toucan intro exactly **once**. Also stops `onDone`/`onReady` firing twice on a mid-flight skip (the app was booting the room on top of itself). |
| `src/scenes/intro-scene.ts` | Skip the flight **before** the boot; `_finish()` fires the app callback once; teardown sweeps any stranded blocker. |

### How it was verified — and how to re-verify

`scratchpad/skip-probe.mjs` (playwright + swiftshader) drives the real intro,
clicks SKIP mid-flight, then measures the **symptom**, not the teardown logs:
`elementFromPoint` at the viewport centre, plus a real `page.click` on the
compass that an overlay eats exactly as it would for a user.

|  | pre-fix | post-fix (local + prod) |
|---|---|---|
| element at viewport centre | `DIV#toucan-intro-blocker` | `CANVAS#room-canvas-element` |
| real click on the compass | **times out** | reaches it |
| element over the open map | `DIV#toucan-intro-blocker` | `CANVAS#map-canvas` |

Negative control was run by stashing the three files and re-probing — the bug
reproduced, so the probe discriminates. End to end: after a mid-flight skip, `M`
opens the map and a real click on OUTSIDE navigates to `/outside`. Boot-phase
skip (SKIP pressed before the bird appears) re-checked for regression.

⚠️ **No unit test.** This is a DOM-lifetime bug and `jsdom` is not installed
here; a jsdom-free unit test would have to mock the very lifetime it is meant to
check. The browser probe is the honest regression check — keep it.

⚠️ **`deploy.sh` builds the WORKING TREE, not HEAD.** With the other session
mid-edit, this shipped from `git worktree add … HEAD` per
`braindeadbot-deploy-working-tree`. Success banner reads `HEAD@f78bb4a`, not
`main@` — that is how you confirm the clean copy went out.

---

## 🔄 The flip's history, for anyone reading old commit messages (2026-07-26)

Three attempts are cited in commits; only the third is correct:
- **`e1426d2`** "the ENTER MAZE sign rendered upside down" — flipped the sign
  texture inside a flipped frame; its write-up's "the game is NOT flipped" was
  wrong (suspect-vs-suspect comparison).
- **`38484a6`** "the dungeon was upside down — flipY on canvas textures" —
  flipped six more textures inside the same flipped frame; its "verified
  upright" screenshots were textures double-flipped back to readable while the
  sprites in the same frame stood on their heads.
- The **pixel-pass `rtUv()` fix** at the top of this file is the root cause;
  both earlier commits' texture edits are reverted by it.

⚠️ **For the parallel session**: a `git stash` mishap briefly yanked your
in-flight edits; everything was restored from `stash@{0}` except
`jungle-controller.ts`, where your NEWER working-tree version was kept.
`stash@{0}` is intentionally left in place as a safety net — drop it once
you've confirmed nothing is missing.

## 🗂 ONE FOLDER PER GAME + a real engine (2026-07-26)

**`main`** → synology. 1419 tests pass (123 files, was 1404/121) ·
`next build` clean · all 21 game routes load in a browser · dungeon boots and
renders (202 enemies, palette intact).

Merged into `main` on top of `cf377a9` (WebGL2 becomes the default backend);
tests and build re-run green after the merge, not just before it.

### The layout now

Every game has one parent folder under **`src/game/`** — 18 of them:
`asteroids, beer-pong, chess, chinese-checkers, cigarette, cosmic-pool,
dog-feeding, fishing, goblin-blocks, mahjong, mouse-game, mouse-poker,
pinball-knight, pirate-chest, pirate-surf, raccoon-tornado, ski-game, toucan`.

`src/objects/` is now **props + infrastructure only**. `src/room/` is rooms and
props. Games no longer live in either.

### `src/game/pinball-knight/engine/` is real, not a folder rename

The engine imports **zero game content** — enforced by
`engine/purity.test.ts`, which resolves each specifier rather than counting
`../`, and was checked with a negative control (adding `import ../state` to
`engine/profiler.ts` does fail it).

Getting there needed dependency inversion, not moves:

| Seam | Was | Now |
|---|---|---|
| `engine/config.ts` | engine imported `constants.ts` (2279 lines) for ~8 numbers | `GameEngine.installEngine()` pushes values in; `constants.ts` still owns them |
| `engine/view-state.ts` | engine read AND WROTE `state.camX/shakeT/camera` | engine owns those fields; `state` delegates via accessors — **no call site changed, tavern untouched** |
| `engine/palette-source.ts` | pass imported "Cold Crypt" | game registers its palette |
| `engine/grid.ts` | collision/AI imported `maze/generator` | tile-grid substrate split out; generator re-exports it |
| `engine/render/paint-types.ts` | `sprite.ts` imported 3372 lines of cel art for 4 types | vocabulary in engine, art stays content |

`GameEngine.ts` holds the boot wiring plus **`FixedStepLoop`**, the 60Hz
accumulator lifted out of core's RAF callback. Its three rules (clamp the delta
BOTH ways, never bank time during a hit-freeze, tick juice clocks in REAL time)
each exist because of a past bug and were untestable inline — now 12 tests.

### Two judgement calls worth knowing

- **beer-pong was NOT split** despite looking like prop+game.
  `createBeerPongTable` shares module-level mutable state (`_sceneRef`, `cups`,
  `readyBall`) with the game functions — the table IS the board. Splitting meant
  duplicating state that drifts. Moved whole; the jungle room imports the
  builder from `game/beer-pong`.
- **fishtank WAS split** — its two halves import nothing from each other, so the
  barrel was the only thing joining them → `game/fishing` + `room/props/aquarium`.
- `cc-board.ts` / `sword-prop.ts` stay with `mouse-room` (they import its
  palette `P`). The `cc-` prefix is misleading — chinese-checkers never uses it.

### ⚠️ `scripts/playtest.mjs` fails on this branch AND on `main`

Reports "dungeon hooks never appeared" while its own diagnostics print
`active: true`. **Verified pre-existing**: checked out `3d0c626` (pre-refactor)
and it fails identically. Not caused by this work. The game does boot — a direct
probe shows all hooks present at ~20s under SwiftShader, which is slower than
the harness's effective window.

## 🔌 SOCKET CONTRACT — geometry that has to mate (2026-07-26)

**`main@0a50ddc`** → synology. 1402 tests pass (121 files) · `next build` clean.

### What was reported

> "the maze still renders as a mess … we don't have a system with labels for
> what things are and where they can and can not connect like a plumbing system
> … walls that go nowhere, dead ends into dead ends, boosters that go into
> curved walls that make no sense."

Correct diagnosis, and **sockets** is the industry term for exactly that. The
track-first change fixed the *topology*; nothing validated that adjacent pieces
actually mate.

### Measured before → after (20 floors)

| Defect | Before | After |
|---|---|---|
| Dead ends | 105.8/floor | **0.4** |
| Wall stubs (nubs into rooms) | 116.4/floor | **0.5** |
| Isolated wall pillars | 5.2/floor | **0** |
| Launchers firing into a wall | 11.3% | **0%** |
| Roads ending in mid-air | 1.3/floor | **0** |

### `maze/track-socket.ts`

Every tile presents a typed socket per edge — `road` / `room` / `wall` / `rim` —
derived from the grid + lane mask (so it cannot drift), plus a compatibility
table and a validator. Same idea as WFC's arc consistency: **a piece is valid
because its edges agree with its neighbours', not because of where it sits.**
Deliberately *not* a WFC solver — the growth model already makes the layout;
this supplies the constraint and the check.

### Four root causes, each of which defeated an earlier guess

1. **Roads to nowhere were degree-1 LEAF NODES in the graph.** `pruneToCircuit`
   keeps the graph connected and loopy — neither forbids a dangling spur.
   Repairing at tile level chases its own tail (each extension becomes the new
   end of the road: "joined" fired 8-24×/floor, count never moved). Fixed
   topologically by `pruneLeaves`.
2. **The socket table first forbade `road|wall`.** Wrong: ~2800 violations per
   floor, *all* of them `road|wall`, because **a road has walls along its
   sides**. The real defect is a road *ending* at a wall — a neighbourhood
   property, now `findRoadTerminations`.
3. **An unbounded dead-end cascade UNRAVELS the maze.** A 1-wide corridor zips
   out tile by tile; off-track floor fell to **1.5% of the grid** and the level
   read as one track blob. Capped, and corridors are **widened to 2-wide**
   instead so they have no 3-walled tiles by construction.
4. **`removeWallStubs` needed a fixed point** — one pass took 86 stubs to 19,
   and the 19 were the ones it had just created.

⚠️ `vault`/`spine` launchers stay exempt on the **legacy** generator (spine
boosters carry a down-flow contract and `breakLaunchDuels` refuses to move
them). Track floors opt in via `strictLaunchers`. Pulling them in unconditionally
broke 3 tests — don't "simplify" that back.

### Still not visually verified in-engine

Same caveat as below: verified as ASCII + metrics, not a rendered screenshot.
**Please play a floor.** Dials: `linkChance` / `fill` / `chance` in
`growMazeAround`, `maxFill` in `uncarveDeadEnds`.

## 🛣️ TRACK-FIRST MAZE — the circuit is grown, then the maze fills in (2026-07-26)

**`main@16bb1b9`** → synology. 1391 tests pass (120 files) · `next build` clean.

### What was reported

> "we need to fix how the maze is rendered as you can see a lot of it just
> doesn't make any sense. we need to build a track system and then build the
> maze around it instead of just randomly putting the course together … so it's
> like a bunch of interconnected highways?"

Chosen by the user: **track-first**, with a **figure-eight-or-better circuit
that morphs every level, grown with mould-growth algorithms**.

### The root cause

The pipeline was ordered backwards:

    generateMaze → carveRooms → pickEndpoints → widenMainArtery → arcSweeps

The "track" was a CONSEQUENCE of a random maze, so it inherited every wiggle it
happened to produce. Hence the three visible symptoms: ramp fragments pointing
nowhere (`authorArcSweeps` scans for corners that *fit*, not corners the ball
takes), curves too short to ride (`artery-banks` censused 22,713 open tiles —
**81.8% have an open radius of ZERO**; radius-4 fillets fitted **4 times in 40
floors**), and nothing reading as a circuit because nothing ever was one.

### The fix — four new modules

    growTrack → buildTrackPath → carveTrack → growMazeAround → publishArcs

- **`maze/track-grow.ts`** — Physarum (slime mould) growth, the
  Tero–Takagi–Nakagawa conductivity model. Flow between food sources thickens
  tubes; decay atrophies the rest. Redundant routes survive where two paths are
  comparably good — the interconnected-highway topology a spanning tree destroys
  by construction. Seeded, so co-op peers agree.
- **`maze/track-path.ts`** — rounds every junction into a real fillet, radius
  3–7 (9.4 tiles of arc at r=7 vs the shipped 3.1).
- **`maze/track-carve.ts`** — sweeps a disc brush so lane width and corner radius
  stay independent; grows the maze around the circuit; `connectAll` guarantees
  one component.
- **`maze/track-floor.ts`** — packages it as a drop-in base grid. `decorateMaze`
  (parts/zombies/torches) is untouched.

Flag: `TRACK_FIRST` in `constants.ts` (currently `true`). The legacy path is
kept so both generators can be A/B'd on one seed.

### Bugs found by measuring, not reading

| Bug | Measurement |
|---|---|
| Reinforcement ~20× weaker than decay — every tube starved | 42/42 edges at conductivity 0.000 |
| Rank pinned at exactly 2 — an *identical* figure-eight every floor | 30/30 seeds. Food count is the dial → now rank 2–9 |
| Uncapped chord length paved the whole floor | one floor 97% track; capped → 24–47%, 0/40 runaways |
| Maze districts sealed off from the track | 83 components on one floor, **75/75 floors fragmented** → 0/75 |
| Arc probe too shallow — curves unregistered | 124 arc tiles / 113 features → 5.6 tiles per feature |
| Arcs published before the maze carved | 20.6% orphaned onto open floor → 0 |

### ⚠️ Not visually verified in-engine

`__dungeonLevel(n)` confirms `startLevel` builds real floors with the new
generator (216 and 267 zombies, 18 parts, no errors), and layout quality was
verified exhaustively as ASCII. But I could **not** get a rendered screenshot:
driving the tavern headlessly didn't reach the board, and `__tavernClose()` is
not a descend (black screen — the `dungeon-headless-descend-recipe` memory).
**Someone should play a floor and confirm it reads right.** Tunables if it
doesn't: `linkChance` (on-ramp density) and `fill` (how much rock the maze
leaves) in `growMazeAround`.
