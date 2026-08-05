# The sprite forge pipeline

How a picture becomes a creature the dungeon can draw. Read this chapter to
understand the machine; read *Current state* for what is verified working today
and *Open items* for what is not.

## The shape of it

```
any image
   │
   ├─ INTAKE ──────────── letterbox → cut out → reframe → QA → style → re-key
   │                      one clean 1024² idle frame, or a named rejection
   │
   ├─ MOVE SETS ───────── one idle frame → 6 keyframe sheets (4 extreme poses each)
   │                      every job branches off the SAME master, never a previous output
   │
   ├─ ASSEMBLY ────────── cut sheets into cells → tray → crush → stage to inbox/
   │
   ├─ PUBLISH ─────────── npm run sprites → public/sprites/<name>-<S|N|E>.{png,json}
   │
   └─ ADOPTION ────────── reskin a monster · play as it · (a new monster kind: not yet)
```

Four architectural rules hold the whole thing together. Each was learned by
breaking it.

**1. Rendering is measured, never assumed.** Every stage boundary has a gate that
reports numbers a human can act on. "It looks right" is not a result.

**2. One canonical crush.** Generation stays soft and large; `commit.ts` is the
only place art becomes pixels. Quantising anywhere else means a second, unowned
opinion about what the palette is.

**3. GPU work is a *mode*; measurement and geometry are a *pipeline op*.** Modes
live in `comfy/modes.mjs` and cost 100–450 s. Ops live in
`app/api/comfy/pipeline/route.ts` and are free. That split is what makes
checkpoints cheap enough to actually run — and it is why every repair the UI
offers is ordered by cost, with the free geometry fixes first.

**4. `tools/sprite-forge/*.ts` imports nothing from node.** Pixels in, pixels
out. `testkit/testkit-boundary.test.ts` enforces it, and node-canvas belongs at
the route or test edge. This is what lets the browser refiner and the headless
run drive the same functions with the same arguments — the only way "what the
tool shows" and "what CI scores" can be guaranteed to agree.

## Intake — any image → one clean idle frame

Everything downstream inherits this frame's framing, scale and identity, so the
contract is strict and non-negotiable by anything later in the chain:

| # | requirement | why |
|---|---|---|
| 1 | PNG RGBA, exactly 1024×1024 | matches `qwenEdit`'s latent |
| 2 | background transparent in alpha **and** flat white in RGB | `matte.ts` needs a flat opaque border, `sliceSheet` needs alpha; a frame that loses alpha in a diffusion round-trip still mattes |
| 3 | exactly one 4-connected opaque component ≥1% of canvas | the "two frogs" failure |
| 4 | subject height 0.72 ± 0.04 × H, width ≤ 0.75 × W | 0.72 subject + 0.10 floor + 0.18 headroom, because the keyframe pass re-poses *from* this frame and a raised sword must not clip |
| 5 | feet at y = 0.90 H ± 2 px | mirrors the engine's `ART_GROUND/ART_BOX` = 118/128 |
| 6 | bbox centre x = W/2 ± 2 px | the same anchor `register.ts` uses |
| 7 | no debris below the feet, no text, no detached shadow | debris below the feet *lifts* the character at registration |

QA returns three values, because a human has to be able to say "good enough":
`ready` (all green) · `usable` (works, at a named cost) · `reject` (downstream
provably breaks). Each failing check carries what breaks and what to do, and the
fixes are listed cheapest-first — re-framing is free and instant, a style pass
costs two minutes of GPU.

## Move sets — one frame → every clip

The keyframe mode generates **4 extreme poses** per move: the classic animator's
keys, not in-betweens. They deliberately disagree with each other as much as the
move allows, because timid keys are what make motion slide.

Two hard-won details live in `comfy/modes.mjs`:

**Pose scripts describe mechanics, not mood.** "Walking in place, smooth" reads
to the model as *keep everything anchored*, and it glides the feet along the
floor. Lift-and-plant language plus an explicit slide ban in `avoid` is what buys
visible leg motion.

**The camera must be pinned.** Asked for "right foot planted far forward" with no
viewpoint stated, an edit model expresses a stride the easiest way it can — by
*rotating the character*. The first measured run came back front → side →
three-quarter → front, so the in-between animated a turn rather than a walk.

Clip names are the engine's, not the reference sheet's. The obvious name for the
getting-hit row is `hurt`; the engine calls it `stumble`, and a row named `hurt`
is dropped on import. A block maps onto `crouch`.

## The crush — where art becomes pixels

`grid.ts` can only report, and it has measured every generated sheet this project
has received as NOT PIXEL ART. Asking the generator for pixel art was tried and
measured: distinct colours went **204,201 → 301,541** when 16 were requested, and
every other metric moved the wrong way while the art got visibly better. A
generator emits a continuous-tone *rendering* of flat pixel art — each
apparently-flat block is a gradient of hundreds of near-identical values.

So the property is imposed rather than requested, once, offline:

1. reduce each cell to the texel count it will actually occupy
2. snap to the real palette and evict down to the atlas's 20-entry lock
3. nearest-upscale by `factor`, on a lattice the whole sheet agrees about

After step 3 the sheet passes `detectPixelGrid`, and a block reduce recovers
step 2's texels **exactly** — which is what "imports 1:1" means. The pixels
reviewed here are the pixels the player sees at every camera rung.

The crush is offline and not at load time on purpose: it is a destructive,
opinionated decision about which 20 of 32 colours survive, and the artist has to
be able to look at the result and repair it. An eviction nobody saw is how a
creature quietly loses its costume.

### The gutter self-check

After laying out the committed sheet, the crush **re-slices its own output** and
widens the gutter until the cells come back separated. This exists because a
tightly packed sheet defeats the slicer: it erases any row whose ink spans ≥70%
of the sheet width as a ruled line, and eight trimmed figures at a 1-texel gutter
do exactly that across their shoulders.

The invariant it checks is *separation*, not cell count — every sliced blob must
nest inside exactly one placed cell, and every placed cell must hold at least one
blob. That distinction is not pedantic; see *Incidents*, where checking the count
instead cost the player character its art for weeks.

## Publish

`npm run sprites` (i.e. `FORGE_PUBLISH=1 vitest run …/sprite-forge`) is the only
sanctioned publisher. It is a test file because the node edge of this pipeline
already lives in tests, and because publishing should fail the same way a broken
sheet does.

What ships is the **matted source plus its cell rects**, not the crushed preview
— the crush has to happen at runtime against whatever camera rung the player is
on. A committed sheet is promoted into `inbox/` by hand, deliberately, after
someone has looked at it.

```
work/comfy/<job>/  ──(keep)──▶  sources/<char>-<date>/     tracked originals
                                      │
                         tray ──(stage)──▶  inbox/<name>-<dir>.{png,json}
                                      │
                              npm run sprites
                                      ▼
                    public/sprites/<name>-<dir>.png   matted source, full res
                    public/sprites/<name>-<dir>.json  SheetManifest
```

> Two JSON shapes exist and must never be conflated. An **inbox sidecar** is
> `{rows, rects, commit, matte, palette}` — authoring input. A **published
> manifest** is `{name, dir, image, source, grid?, scale?, palette?, rows}` —
> what the game reads. Copying the first where the second belongs is a silent
> failure; the loader gets `image: undefined` and drops the creature to its
> painter with no error.

## Adoption — what a published sheet can become

| route | how | status |
|---|---|---|
| reskin a monster | one line in `IMPORTED_ART` (`boot/sheets.ts`) | works; the panel should write it |
| play as it | `__lab.playAs("<name>")`, then reload | works; console-only |
| a brand-new monster kind | nine `Record<EnemyKind, X>` tables + a spawn case + constants | not built |

A published sheet is art. It is not a monster: HP, damage, steering mode, pain
threshold, drops and the behaviour branches are *design*, and no scaffold can
invent them.

## Verification — the boot line, not a screenshot

The game prints what it actually loaded:

```
[dungeon] <kind>: imported art from N sheet(s) [S/E]     ← a monster
[dungeon] player: imported <name> art loaded             ← the player
```

**Absence of that line is the failure signal.** A screenshot cannot tell the
difference between imported art and the procedural painter, because the painter
also looks fine. `scripts/sprite-shot.mjs` scrapes the monster line;
`scripts/knight-check.mjs` asserts the player one.

Both drive **Windows-side Chrome over CDP**. WSL2 headless falls back to
SwiftShader, which is not the renderer the game ships on and would judge a
different image.
