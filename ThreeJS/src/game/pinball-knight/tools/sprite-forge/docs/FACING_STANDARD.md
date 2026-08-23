# The facing standard

*Written 2026-08-05, after the knight moonwalked. This is the contract every
sheet, every generator prompt and every runtime draw agrees to. The
calibration fixtures and the tests that pin it are listed at the bottom.*

## The four screen directions

Facings are **screen-relative**, always. The camera is isometric
(yaw 45°, tilt 38°) but input, facings and sheets all live in screen space —
`engine/camera.ts` owns the world↔screen conversion and nothing else does.

| Facing | Means | Sheet | How |
|---|---|---|---|
| `S` | toward the camera — the player walking **down** | `<name>-S` | authored |
| `N` | away from the camera — walking **up** | `<name>-N` | authored |
| `E` | walking **right** | `<name>-E` | authored |
| `W` | walking **left** | — | **derived**: E drawn mirrored |

W is never authored. `resolve()` in `engine/render/animator.ts` maps it to
E-flipped at draw time (a texture-repeat trick, `sprite.ts setFlipped`).

**A sheet's `dir` is a promise about the screen**: an `E` sheet is what the
player sees when the figure walks right. It is *not* "a side profile" — a
generator asked for a side profile picks its own side, and the knight's
arrived facing left, which made him look backwards walking BOTH ways
(E showed left-facing art; W flipped it into right-facing art).

## When the art faces the wrong way: `mirror`

Declare it in the inbox sidecar; the publish run carries it into the
manifest and `render/imported-paints.ts` draws every cell flipped:

```json
{ "mirror": true, "rows": ["idle", "walk"], ... }
```

Never repaint the inbox PNG and never re-order sidecar `rects` to fake a
flip — a re-prep regenerates both and silently undoes it. The declaration
survives re-preps and the promoted-sidecar rewrite carries it (same survival
rule as `commit`).

Currently declared: `pinball_knight-E`, `zombie-E`.

## The roster orientation audit (2026-08-05)

Measured by rendering each published E sheet's first walk cell:

| Sheet | Faces | Verdict |
|---|---|---|
| `pinball_knight-E` | left | **inverted** → `mirror: true` shipped |
| `zombie-E` | left | **inverted** → `mirror: true` shipped |
| `beaver-E` | right | correct |
| `fish_feet-E` | right | correct |
| `frog-E` | camera (front 3/4) | **not a side view** — regenerate |
| `stiltneck-E` | camera (front) | **not a side view** — regenerate |

The frog and stiltneck are art-quality debts, not mirror candidates: their
"E" sheets are front views, so E and W look like S with different pixels.
Regenerate through `/forge` rotate (its `<sks>` grammar names the direction;
`CAMERA_BY_DIR` already pins one camera per facing).

## The calibration ("known-good sheet first") workflow

Before trusting a real character's move set, prove the mapping chain with a
sheet whose facing cannot be misread:

1. `node src/game/pinball-knight/tools/sprite-forge/prep/make-compass.mjs`
   writes `inbox/compass-{S,N,E}` — each figure is a fat arrow pointing its
   facing's screen direction, a chiral letter, and a red-LEFT/white-RIGHT
   flip marker. Then `npm run sprites` publishes them.
2. `tools/sprite-forge/compass.test.ts` pins the geometry through the real
   import path (arrow extends the right way from the body; red stays left of
   white; `mirror: true` swaps them).
3. In-game: `__lab.playAs("compass")`, reload, connect the pad, walk all
   four ways. Stick-down must show the down arrow; stick-left must show the
   E sheet MIRRORED (left arrow + backwards letter) — that mirroring is
   correct and expected, it is how W works.

For an external reference sheet (the "cut up a Mario sheet" path — any
labelled sheet with the four walk directions):
`python3 -m spriteforge.rip sheet.png --out frames/ --contact` cuts it into
clean matted frames plus a numbered contact sheet of its labels; map the
rows to clips in a sidecar by hand, name the facings per this standard, and
feed the inbox. (`rip.py` lives in `tools/sprite-forge/python/`; it is
deliberately not OCR — a human maps "Hurt" → `stumble`.)

## Real pixels: tracing a published sheet

`npm run pixels -- trace-manifest pinball_knight-S --clips idle,walk
--palette coldcrypt` traces every frame of a PUBLISHED sheet down to
hand-editable `AuthoredCell` grids (one traced set, cells keyed `walk0`,
`walk1`, …), honouring `mirror` so the cells come out in screen orientation.
`npm run pixels -- render <set>.traced.json` presses it back to a contact
PNG. One-way for now: nothing at runtime reads traced sets — the road to
"edited cells republish as the sheet" is in `documentation/chapters/04`.

## What pins this standard

- `tools/sprite-forge/compass.test.ts` — the fixtures still point where
  their name says, and `mirror` still flips.
- `render/imported-paints.test.ts` — `mirror: true` swaps a lopsided mark's
  side through the real paint path.
- `tools/sprite-forge/camera-sync.test.ts` — `CAMERA_BY_DIR` copies agree.
- The engine chain (stick → `facingFromVelocity` → `dir:clip` key → E/W
  flip) was measured live 2026-08-05: all four directions resolve and draw
  correctly (probe recipe: `__dungeonStartRun()`, plunger, short stick
  pulses, sample only while `clip === "walk"`; mute with `__setMute(true)`).
