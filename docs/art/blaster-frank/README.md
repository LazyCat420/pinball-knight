# Blaster Frank

Blaster Frank is the fifth creature built as a hand-authored Three.js rig
baked into the gameplay sprite atlases, after the Clockwork Knight, the
slime, the Fry Sentinel and the Toxic Shake.

## Source of the design

[sprite-sheet.png](sprite-sheet.png) is the Nano Banana pixel sheet the rig
replaces, the SHAPE SPEC, one row per clip:

| Row | Clip | What it draws |
| --- | --- | --- |
| 1 | idle | stout, chest heaving, round spectacles, the snub-nose revolver twitching at the hip |
| 2 | walk | a frantic waddle: stubby legs pump, coat tails flap, arms and gun swing, mouth open |
| 3 | attack | raises the revolver straight up and empties it into the ceiling — three muzzle flashes, recoil, smoke, a yelling grimace |
| 4 | death | dizzy spirals in the glasses, drops the smoking gun, keels over backwards onto his back, X eyes and stars |

The old sheet authored one facing (S). The rig bakes S, N and E; W mirrors E.
E is a three-quarter view toward the camera; a strict profile would hide the
spectacles and the gun, which are most of the character.

## The rig

`ThreeJS/src/game/pinball-knight/render/blaster-frank-3d.ts`. A short,
rotund, balding man: bald skin dome with grey side tufts and ears, thick
round spectacles (rim, tinted lens, eye behind), a moustache, a smirk that
gives way to a yelling mouth, a tan trenchcoat hanging open over a green
shirt and a belly with a belt, two coat tails that flap on the walk, brown
trousers, big dark shoes, and a chrome snub-nosed revolver (frame, cylinder,
barrel, wooden grip) in the right hand with a spiky muzzle flash and smoke
puffs for the volley. Every face feature sits ON the head sphere (`onHead`),
and `setFacing` slides the face round toward the camera for the E bake.

| Clip | Frames | Rate | Loops |
| --- | --- | --- | --- |
| idle | 6 | 3 fps | yes |
| walk | 8 | 8 fps | yes |
| attack | 12 | 12 fps | no |
| death | 5 | 6 fps | no, holds the fallen body |

`death` is 5 frames so it finishes inside the 0.96 s the roster's death-trace
test simulates. `run` is aliased from `walk` by the importer; `wake` and
`stumble` are synthesised from `idle`; `crouch` falls through to the painter.

The volley's three shots are `BLASTER_FRANK_SHOTS` — [start, end) windows in
clip time — so the bake, the rig and the test agree on which frames flash.

### Sizing

The bake registers every frame with ONE shared rect, so anything the volley
or the fall draws outside the idle's box shrinks the standing man (learned on
the Toxic Shake, whose first bake drew at 69 art units for that reason). The
raised gun's flash stays close over the head, and the fall stays inside
±`BLASTER_FRANK_DEATH_HALF_WIDTH` and above the floor; the sheet test measures
the standing ink height with node-canvas against the Fry Sentinel's.

## Rebuilding the sheets

With Vite serving the ThreeJS folder and a Chromium CDP endpoint (host Chrome
on Windows), from `ThreeJS`:

```sh
CDP_URL=http://127.0.0.1:9345 PK_URL=http://localhost:5174 node scripts/bake-blaster-frank.mjs
```

- Preview at the game's clip rates: `http://localhost:5174/scripts/blaster-frank-preview.html`
- Studio page the baker drives: `scripts/blaster-frank-bake.html`
- Tests: `render/blaster-frank-3d.test.ts`
- In game: `__lab.only("blaster_frank")`. The art loads with floor 3 and above;
  on an earlier floor call `loadMonsterSheet("blaster_frank")` from
  `boot/sheets.ts` first.
