# Toxic Shake (Milkshake Monster)

The Toxic Shake is the fourth creature built as a hand-authored Three.js rig
baked into the gameplay sprite atlases, after the Clockwork Knight, the
slime, and the Fry Sentinel.

## Source of the design

[sprite-sheet.png](sprite-sheet.png) is the pixel sheet the rig replaces, the
SHAPE SPEC, one row per clip:

| Row | Clip | What it draws |
| --- | --- | --- |
| 1 | idle | the white cup hovers, straw sways, yellow gloves twitch, a gentle bob |
| 2 | walk | waddles forward with side-to-side tilt, opposing glove swings, vertical bob |
| 3 | attack | leans back, thrusts yellow gloved hands forward, and sprays toxic lime globules from its straw |
| 4 | death | cup collapses and crumples flat, yellow gloves flop limp, toxic milkshake puddle spreads |

The old sheet authored one facing (S). The rig bakes S, N and E; W mirrors E.
E is a three-quarter view toward the camera, as the pixel sheet draws its
walk: a strict profile would hide the face and straw, which are most of the character.

## The rig

`ThreeJS/src/game/pinball-knight/render/milkshake-3d.ts`. A tapered white cup
with a bold crimson fast-food stripe band, a plastic lid with toxic green shake
bubbling under the dome, a corrugated bent pink-and-white striped drinking straw,
elbow-length yellow rubber dishwashing gloves with flared cuffs and articulated
thumbs on shoulder pivots, a cartoon face on its +z side (expressive eyes, pupils,
impatient eyebrows, and smirking mouth arc), a cluster of toxic spray droplets for
the attack, and an expanding bubbling toxic green puddle with scattered splash
droplets for the death.

| Clip | Frames | Rate | Loops |
| --- | --- | --- | --- |
| idle | 6 | 3 fps | yes |
| walk | 8 | 8 fps | yes |
| attack | 12 | 12 fps | no |
| death | 5 | 6 fps | no, holds the collapsed cup and puddle |

`death` is 5 frames so it finishes inside the 0.96 s the roster's death-trace
test simulates. `run` is aliased from `walk` by the importer; `wake` and
`stumble` are synthesised from `idle`; `crouch` falls through to the painter.

## Rebuilding the sheets

With Vite serving the ThreeJS folder and a Chromium CDP endpoint (host Chrome
on Windows), from `ThreeJS`:

```sh
CDP_URL=http://127.0.0.1:9345 PK_URL=http://localhost:5174 node scripts/bake-milkshake.mjs
```

- Preview at the game's clip rates: `http://localhost:5174/scripts/milkshake-preview.html`
- Studio page the baker drives: `scripts/milkshake-bake.html`
- Tests: `render/milkshake-3d.test.ts`
- In game: `__lab.only("milkshake")`. The art loads with floor 3 and above; on an
  earlier floor call `loadMonsterSheet("milkshake")` from `boot/sheets.ts` first.
