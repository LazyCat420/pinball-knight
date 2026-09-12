# Toxic Shake (Milkshake Monster)

The Toxic Shake is the fourth creature built as a hand-authored Three.js rig
baked into the gameplay sprite atlases, after the Clockwork Knight, the
slime, and the Fry Sentinel.

## Source of the design

[sprite-sheet.png](sprite-sheet.png) is the pixel sheet the rig replaces, the
SHAPE SPEC, one row per clip:

| Row | Clip | What it draws |
| --- | --- | --- |
| 1 | idle | stands on skinny legs, shake bubbles under the lid, straw sways, yellow gloves twitch |
| 2 | walk | a cocky strut: legs stride, the cup rocks, gloves counter-swing, the straw whips |
| 3 | attack | rears back and gargles (cup swells, mouth gapes), then lunges and hoses a cone of toxic shake at the player from the straw AND the mouth |
| 4 | death | the lid blows off, the cup buckles and topples onto its side, shake gushes out into a spreading puddle, X eyes, gloves and legs flop |

The old sheet authored one facing (S). The rig bakes S, N and E; W mirrors E.
E is a three-quarter view toward the camera, as the pixel sheet draws its
walk: a strict profile would hide the face and straw, which are most of the character.

## The rig

`ThreeJS/src/game/pinball-knight/render/milkshake-3d.ts`. A tapered white cup
on two skinny legs with dark shoes, a crimson fast-food stripe BELOW the face, a
plastic lid with toxic green shake doming up under it, a fat barber-striped bent
straw with a corrugated elbow, elbow-length yellow rubber gloves with flared
cuffs, three fingers and a thumb, and a cartoon face whose every feature sits ON
the cup's surface (`onCup`): big eyes, knotted brows, a smirk that gives way to
a gaping mouth with a tongue, and X eyes for the death. The attack carries a
14-droplet cone of spray, the death a gush, a puddle and splats.

### The second pass (2026-09-12)

The first bake read as a plain paper cup. Measured with the shared registration
rect it drew at **69 art units** standing against the Fry Sentinel's 89, because
it hovered with no legs and its death spread wide and low — the rect is ONE
box for every frame, so the puddle was charged to the idle. Now it stands on
legs, the death is kept inside ±1.45 units (`MILKSHAKE_DEATH_HALF_WIDTH`) and
above the floor, and the lid pops no higher than the straw tip, so the standing
cup draws at **~94 art units**. The E bake cheats the face round toward the
camera (`setFacing`) the way cartoon rigs slide a face round a head — a
three-quarter yaw of a cylinder otherwise puts the eyes on its silhouette. The
cup falls mouth-right (+x) so the blown lid lands BEHIND it from the E angle
too (+x is away from the camera there).

Two traps met on the way, both pinned by `render/milkshake-3d.test.ts`:

- `reset()` restored everything about the eyes but `visible`; the bake runs one
  facing's death straight into the next facing's idle, so E baked eyeless once.
- The bounds used by the tests must be PRECISE (`expandByObject(m, true)`): a
  rotated limb's loose AABB reported a floor dip that no pixel had.

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
