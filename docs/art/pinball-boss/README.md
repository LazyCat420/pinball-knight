# Tilt Titan (the pinball boss)

Tilt Titan is the sixth creature built as a hand-authored Three.js rig baked
into the gameplay sprite atlases, after the Clockwork Knight, the slime, the
Fry Sentinel, the Toxic Shake and Blaster Frank — and the first boss.

## Source of the design

[sprite-sheet.png](sprite-sheet.png) is the Nano Banana pixel sheet the rig
replaces, the SHAPE SPEC, one row per clip:

| Row | Clip | What it draws |
| --- | --- | --- |
| 1 | idle | the chrome ball hangs heavy, highlight sweeping, visor eyes pulsing, electric arcs |
| 2 | walk | rolls forward: the riveted seam turns, dust behind, sparks at the contact |
| 3 | attack | the REV — a full 360° spin about its axis, sparks grinding off the floor, eyes blazing |
| 4 | death | cracks spider across the hull, the core glows through, it detonates into chrome shards, ball bearings and a bumper spring |

The old sheet authored one facing (S) and — the defect
[plan/PLAN-PINBALL-BOSS-SPIN-SPRITES.md](../../../plan/PLAN-PINBALL-BOSS-SPIN-SPRITES.md)
records — its attack row was four identical front-facing frames with lightning
drawn over them, so the boss never visibly spun while revving. The rig's attack
is twelve frames of 30° each, and it LOOPS: `boss-moves.ts` plays `attack` with
`{ loop: true }` through the telegraph and the charge, so it reads as a turbine.
The sheet test asserts all twelve frames are distinct.

The rig bakes S, N and E; W mirrors E. The spin is the whole ball turning, so
it is the same from every facing.

## The rig

`ThreeJS/src/game/pinball-knight/render/pinball-boss-3d.ts`. A chrome sphere
of radius 1 (the game draws the boss at 2.2×, `boss-kinds.ts`): a darker
underside, a sweeping specular highlight, a riveted great-circle seam that
turns with the roll, slanted glowing crimson visor eyes under brow ridges, a
wide dark grin with thirteen jagged steel teeth, four electric arcs that
flicker on the hull, grinding floor sparks, dust puffs; for the death, nine
cracks, a glowing core, a flash, twelve shards, eight bearings, a coil spring
and smoke. Every face feature sits ON the sphere (`onBall`), and `setFacing`
slides the face round toward the camera for the E bake.

| Clip | Frames | Rate | Loops |
| --- | --- | --- | --- |
| idle | 6 | 3 fps | yes |
| walk | 8 | 8 fps | yes |
| attack | 12 | 12 fps | **yes** — a seamless 360° turn |
| death | 5 | 6 fps | no, holds the debris |

`death` is 5 frames so it finishes inside the 0.96 s the roster's death-trace
test simulates. `run` is aliased from `walk` by the importer; `wake` and
`stumble` are synthesised from `idle`; `crouch` falls through to the painter.

### Sizing

The bake registers every frame with ONE shared rect, so the detonation is
kept inside ±`PINBALL_BOSS_DEATH_HALF_WIDTH` and no taller than the ball; the
sheet test measures the standing ink height with node-canvas against the Fry
Sentinel's and requires the idle to fill ≥80% of its rect.

## Rebuilding the sheets

With Vite serving the ThreeJS folder and a Chromium CDP endpoint (host Chrome
on Windows), from `ThreeJS`:

```sh
CDP_URL=http://127.0.0.1:9345 PK_URL=http://localhost:5174 node scripts/bake-pinball-boss.mjs
```

- Preview at the game's clip rates: `http://localhost:5174/scripts/pinball-boss-preview.html`
- Studio page the baker drives: `scripts/pinball-boss-bake.html`
- Tests: `render/pinball-boss-3d.test.ts`
- In game: the debug panel's "Titan" chip, or `__lab.only("pinball_boss")`.
