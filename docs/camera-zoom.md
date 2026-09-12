# Camera zoom, and why changing it used to need a restart

**Written 2026-09-12.** Reported as three things that turned out to be one
mechanism: "the pixel effect is too strong", "zoom only works if I restart",
and "either we're too far away or too close".

Related: [`docs/monster-art-pipeline.md`](monster-art-pipeline.md) for how
sprites are baked, `constants/render.ts` for the sizing arithmetic.

---

## 1. The zoom was ALWAYS live. The art was not.

`applyCameraZoom` has always set `camera.zoom` and the settings screen has
always called it, so the framing did change instantly — and the settings screen
has been reachable in-run since the OPTIONS tab landed (Esc → OPTIONS). That is
not what forced the restart.

What forced it is the pixel identity the whole renderer is built on:

```
SPRITE_UNITS * PPU === SPRITE_PIXEL_GRID     (3/2 * 46 === 69)
```

One atlas texel is exactly one screen pixel. **Atlases are baked at boot PPU**,
so a live zoom sets `camera.zoom = chosenPpu / bootPpu` — e.g. 66/46 = 1.435 —
and every texel now covers 1.435 screen pixels. With `NearestFilter` some texels
land on one pixel and some on two. That unevenness is what "it looks wrong until
I restart" was: a reload re-bakes the atlas at the new PPU and the ratio returns
to exactly 1.0.

So the restart was never applying the setting. It was **re-baking the art**.

## 2. Zoom is a line now, not seven rungs

`CAMERA_ZOOMS` had seven named rungs, and the gap between `wide` (54) and
`wider` (46) is the widest step in the playable half of the ladder — so the
framing most people want was the one framing the ladder could not express. That
is the "either too far away or too close" report; there was no middle because
the middle was not a rung.

`cameraPpu` is now a continuous setting clamped to the **old ends** (24..66), so
nothing that used to be selectable stopped being so.

| rung | ppu | tiles @1280 | tiles @1920 | tiles @2560 | zoom vs default |
|---|---|---|---|---|---|
| close | 66 | 19.4 | 29.1 | 38.8 | 1.435× |
| normal | 60 | 21.3 | 32.0 | 42.7 | 1.304× |
| wide | 54 | 23.7 | 35.6 | 47.4 | 1.174× |
| **wider** (default) | **46** | **27.8** | **41.7** | **55.7** | **1.000×** |
| widest | 40 | 32.0 | 48.0 | 64.0 | 0.870× |
| panorama | 32 | 40.0 | 60.0 | 80.0 | 0.696× |
| overview | 24 | 53.3 | 80.0 | 106.7 | 0.522× |

**Tiles across depends on the window**, which is why the options row reports
tiles off the LIVE render width rather than printing a PPU against the 1280
reference. The same rung frames very differently on a 2560-wide window.

The rungs still exist as presets and still name the boot atlas resolution. A
rung now **writes through** to `cameraPpu` in `saveSettings` — without that the
presets go dead the moment framing stops reading them: still stored, still
naming a distance, and consulted by nothing.

### Controls

- **Scroll wheel**, during play. Gated on `state.uiPauses`, *not* on "a screen is
  open": the HUD is a screen and is open for the whole run, so gating on
  openness means the wheel never zooms in game — the same trap `syncPause`
  documents for the keyboard. Menus keep the wheel for scrolling.
- **A slider** in Esc → OPTIONS, live on every drag.
- `wheelNotches` is plumbed alongside `scroll` rather than derived from it:
  `scroll` is rounded to whole UI rows, so every sub-row trackpad flick would
  floor to zero and only coarse mouse wheels would zoom.
- The step is **multiplicative** (`CAMERA_ZOOM_STEP`), so a notch is the same
  perceived change at both ends. Additive read as the wheel speeding up as you
  zoomed out.

## 3. Two separate things were making it "look low-res"

### The scenery pixel block is a SCREEN-space size

`pixelBlockSize` is 1/2/4 screen pixels (`off`/`subtle`/`chunky`, default
`subtle`). Left alone, one block swallows more and more **world** the further
you zoom out — so the scenery got progressively chunkier exactly where detail
was scarcest. `setZoomRatio` multiplies the block by the zoom ratio, pinning it
to a fixed world size, floored at 1 (below 1 would sample *between* texels,
which is not a smaller pixel, it is a blurred one).

### Nearest MINIFICATION was throwing away detail that was present

Sheet textures were `NearestFilter` in **both** directions with no mipmaps.
Nearest magnification is correct and stays — blowing a texel up into a square
block is what pixel art is. Nearest *minification* is the opposite case: once
the camera is zoomed out past the baked scale, one screen pixel covers more than
one texel and nearest picks an arbitrary one. The detail is not lost gracefully,
it is replaced by whichever texel sat under the sample point — and that moves
with the camera, so it reads as crawling and sparkling rather than as "smaller".
The information was in the atlas the whole time.

`minFilter` is now `LinearFilter`, sized for this exact range: the widest zoom
is 24 PPU against an atlas floored at 46, so the worst minification is ~2:1 and
a 2×2 average covers it. Exposed as **"Smooth when zoomed out"** so the old look
can be A/B'd in game.

**NO MIPMAPS, deliberately.** Atlas frames are packed edge to edge with no
gutter (`repeat = 1/cols`), so a mip chain would average across frame boundaries
and ghost the neighbouring frame in. `LinearFilter` bleeds at most one texel,
and the frames' shared registration rect leaves that edge transparent.

### The atlas floor — the trap in the obvious version

`atlasPpuFor` is **floored at the default** and only follows the zoom upward.
Letting it follow the zoom down is the obvious reading and is backwards: at the
far end it would bake sprites at 24 PPU — 36 texels instead of 69 — so zooming
out would permanently destroy the detail it was already short of, and the next
launch would look *worse* than the session that chose it. Minifying a 69-texel
sprite has the information and merely needs filtering; magnifying a 36-texel one
does not have it at all.

It must also stay **even**: `SPRITE_PIXEL_GRID = SPRITE_UNITS(3/2) × PPU` has to
be a whole texel count.

## 4. What this proved, and how

- Both pre-existing `camera-zoom.test.ts` cases pass **untouched**. Their red was
  taken seriously rather than edited away, and it is what surfaced the dead-preset
  bug: the fix was the rung write-through, not the test.
- `options-tab.test.ts` is updated for the new control. It now asserts the
  readout a slider actually paints (a slider paints no text of its own, so
  checking the heading alone would pass on a row that labels itself and then
  throws) and that the old two-button cycler is **gone**, not merely unused.
- **Sabotage-verified:** removing the atlas floor, making the wheel step
  additive, and removing the clone walk each turn the suite red.
- **The clone walk was found BY sabotage, not by reading.** Actors sample
  `sheet.texture.clone()`, which copies the filter at clone time and is not
  linked afterwards — so walking only `state.sheets` reached no monster already
  on screen. Removing that walk left all 206 tests in the touched suites green:
  the accessor had a test, the caller using it did not, and that was the half
  that mattered.
- Suite: **390 files passed, 5 skipped; 4,487 tests passed, 12 skipped, 0
  failed.** `tsc --noEmit`: **60 errors before and after**, none in the touched
  files (the build does not typecheck — run it yourself).

### Not verified

**None of this has been looked at on a real GPU.** llvmpipe under WSL invents
artefacts, so a screenshot from this box is not evidence. The specific
judgements that need eyes on Windows:

- whether `LinearFilter` minification reads as "clean" or as "soft" at the wide
  end, and whether any frame-edge bleed is visible;
- whether the zoom-scaled pixel block is now too subtle at the close end;
- whether the wheel step (5% per notch) feels right;
- where the player's preferred framing actually lands on the continuous line.

## 5. Open items

- **The internal render target is capped at 2560×1440** (`MAX_RENDER_W/H`). On a
  **4K monitor the game renders at ~1920×1080 and upscales 2×**, which reads as
  "everything looks low-res" independently of zoom and of everything above. This
  is untouched here because raising it is a real performance decision (4K is
  2.25× the pixels of 1440p) and because it is a no-op on 1080p/1440p. If the
  low-res report persists after this change, **this is the next thing to look
  at**, and it needs to know the player's monitor.
- Changing `MAX_RENDER_*` means editing **both** `constants/render.ts` and the
  mirror block in `engine/config.ts` — `pixel-pass.ts` destructures its tuning
  out of `engineConfig.post` at module import, which happens before
  `installEngine()` runs, so patching `constants/render.ts` alone changes
  nothing at runtime. `config-mirror.test.ts` is what keeps the two equal.
- The atlas only re-bakes at the new PPU on the **next launch**. Within a
  session, zooming in past the baked scale still magnifies. Sharp-bilinear texel
  filtering (Inigo Quilez's `fwidth`-driven method) would fix the magnification
  side the way `LinearFilter` fixed the minification side, but it needs a custom
  node material for sprites and sprites currently use core-`three`
  `MeshBasicMaterial`/`MeshLambertMaterial`, not node materials.
- `CAMERA_ZOOM_ORDER` is now only used for the preset table; nothing paints the
  cycler any more.
