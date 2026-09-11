# Fry Sentinel

The Fry Sentinel is the third creature built as a hand-authored Three.js rig
baked into the gameplay sprite atlases, after the Clockwork Knight and the
slime.

## Source of the design

[sprite-sheet.png](sprite-sheet.png) is the pixel sheet the rig replaces, the
SHAPE SPEC, one row per clip:

| Row | Clip | What it draws |
| --- | --- | --- |
| 1 | idle | the red carton stands, fries sway, arms hang, a gentle bob |
| 2 | walk | crinkle-fry legs stride, arms counter-swing, the body bobs |
| 3 | attack | leans in, winks, and fires crinkle-cut fry darts from its head |
| 4 | death | the carton buckles, fries spill, it crumples flat with a sad face |

The old sheet authored one facing (S). The rig bakes S, N and E; W mirrors E.
E is a three-quarter view toward the camera, as the pixel sheet draws its
walk: a strict profile would hide the face, which is most of the character.

## Multi-angle references

The sheet's idle frame was turned through the forge's `rotate` mode
(Qwen-Image-Edit 2511 with the fal Multiple-Angles LoRA, seed 7, fast bundle):

- [reference-S.png](reference-S.png) front
- [reference-E.png](reference-E.png) right side
- [reference-N.png](reference-N.png) back
- [reference-SE.png](reference-SE.png) front-right three-quarter
- [reference-NE.png](reference-NE.png) back-right three-quarter
- [reference-top.png](reference-top.png) high-angle front
- [turnaround.png](turnaround.png) all six on one sheet

```sh
node cli.mjs rotate --init <idle frame on white> --to E --seed 7 --fast --file-as fries
```

## The rig

`ThreeJS/src/game/pinball-knight/render/fries-3d.ts`. A tapered red box for
the carton with a cartoon face on its +z side (white eyes, ink pupils, brows,
a torus-arc smile), a rim group that carries the bundle of crinkle-cut fries,
crinkle-fry arms and legs on pivots, a gold amulet with a mystic eye on a
chain, a volley of fry darts, and a set of spilled fries for the death. A
crinkle fry is a zig-zag stack of short boxes, which is what reads at sprite
size.

| Clip | Frames | Rate | Loops |
| --- | --- | --- | --- |
| idle | 6 | 3 fps | yes |
| walk | 8 | 8 fps | yes |
| attack | 12 | 12 fps | no |
| death | 5 | 6 fps | no, holds the crumpled carton |

`death` is 5 frames so it finishes inside the 0.96 s the roster's death-trace
test simulates. `run` is aliased from `walk` by the importer; `wake` and
`stumble` are synthesised from `idle`; `crouch` falls through to the painter.

## Rebuilding the sheets

With Vite serving the ThreeJS folder and a Chromium CDP endpoint (host Chrome
on Windows), from `ThreeJS`:

```sh
CDP_URL=http://127.0.0.1:9345 PK_URL=http://localhost:5174 node scripts/bake-fries.mjs
```

- Preview at the game's clip rates: `http://localhost:5174/scripts/fries-preview.html`
- Studio page the baker drives: `scripts/fries-bake.html`
- Tests: `render/fries-3d.test.ts`
- In game: `__lab.only("fries")`. The art loads with floor 3 and above; on an
  earlier floor call `loadMonsterSheet("fries")` from `boot/sheets.ts` first.
