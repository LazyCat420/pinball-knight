# Slime

The slime is the second creature built the way the Clockwork Knight was: a hand
authored Three.js rig, posed per frame and rendered into the gameplay sprite
atlases, instead of a pixel sheet drawn or generated frame by frame.

## Source of the design

[sprite-sheet.png](sprite-sheet.png) is the pixel sheet the rig replaces. It is
the SHAPE SPEC, one row per clip:

| Row | Clip | What it draws |
| --- | --- | --- |
| 1 | idle | a settled dome with three trapped bubbles |
| 2 | walk | gather tall, leap forward as a comma, splat flat, settle |
| 3 | attack | curl into a C, rear up as a cresting wave, splash, reform |
| 4 | death | shiver, a bubble bulges out of the crown and pops, melt, puddle |

The old sheet authored one facing (S). The rig bakes S, N and E; W mirrors E.

## Multi-angle references

The sheet's idle frame was turned through the forge's `rotate` mode
(Qwen-Image-Edit 2511 with the fal Multiple-Angles LoRA, seed 7, fast bundle)
to give the rig a reference for the sides it had never been drawn from:

- [reference-S.png](reference-S.png) front
- [reference-E.png](reference-E.png) right side
- [reference-N.png](reference-N.png) back
- [reference-SE.png](reference-SE.png) front-right three-quarter
- [reference-NE.png](reference-NE.png) back-right three-quarter
- [reference-top.png](reference-top.png) high-angle front
- [turnaround.png](turnaround.png) all six on one sheet

Recreate any of them from `ThreeJS/src/game/pinball-knight/tools/sprite-forge/comfy`:

```sh
node cli.mjs rotate --init <idle frame on white> --to E --seed 7 --fast --file-as slime
```

## The rig

`ThreeJS/src/game/pinball-knight/render/slime-3d.ts`. A slime has no skeleton,
so the rig is one dome lattice whose vertices are recomputed per pose by
`deform()`: squash and stretch, the walk's forward lean, the attack's curl and
crest, the death's bulge and melt are all closed-form displacements of the rest
shape. The ink outline is the same lattice pushed out along the posed normals,
so it keeps its width when the body is flattened into a puddle. Three bubbles
and a gloss ride the skin; a droplet fan carries the splash and the pop.

Frames per clip, chosen against the animator's clip rates in `engine/config.ts`:

| Clip | Frames | Rate | Loops |
| --- | --- | --- | --- |
| idle | 6 | 3 fps | yes |
| walk | 8 | 8 fps | yes |
| attack | 12 | 12 fps | no |
| death | 5 | 6 fps | no, holds the puddle |

`run` is aliased from `walk` by the importer; `wake` and `stumble` are
synthesised from `idle` by `withRecoil`. `crouch` falls through to the painter,
as it did before.

## Rebuilding the sheets

With Vite serving the ThreeJS folder and a Chromium CDP endpoint (host Chrome on
Windows, so the bake runs on a real GPU), from `ThreeJS`:

```sh
CDP_URL=http://127.0.0.1:9345 PK_URL=http://localhost:5174 node scripts/bake-slime.mjs
```

The bake writes `public/sprites/slime-{S,N,E}.png` and their manifests, each
with a content hash. One registration rectangle is shared by every frame of a
sheet so the puddle is not inflated back to a dome by bounding-box placement.

- Live preview of the baked frames at the game's clip rates:
  `http://localhost:5174/scripts/slime-preview.html`
- Studio page the baker drives: `scripts/slime-bake.html`
- Tests: `render/slime-3d.test.ts` pins the published sheets to the rig's clip
  list and checks the poses (the leap leaves the floor, the crest is taller
  than wide, the puddle is flatter than a quarter of the dome).
- In game: `__lab.only("slime")`. The slime's art loads with floor 3 and above,
  so on an earlier floor call `loadMonsterSheet("slime")` from
  `boot/sheets.ts` first, or spawn after descending.
