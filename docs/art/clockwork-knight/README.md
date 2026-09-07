# Clockwork Knight

Choose Clockwork Knight on the character screen, equip a launch and Confirm.

| Launch | Unlock | Gameplay benefit |
| --- | --- | --- |
| 🎳 Bowling | Available immediately | Fast release and standard pinball momentum |
| 🏈 Football | Reach floor 2 | +30% launch speed; 1.5 seconds of reduced drag |
| ⚾ Sword baseball | Reach floor 3 | +60% launch speed; 2 seconds of reduced drag |

Football replaces basketball. Previously equipped basketball saves migrate to football.
Bonuses fire once per momentum ride at the authored release/contact frame. They respect
the existing speed ceiling and retain normal wall collisions and steering. Different
surfaces and collisions affect the eventual distance; the preview stage is not a range measurement.

The shared Three.js rig has one detachable steel helmet, cyan eyes, brass trim,
articulated hands, layered armor, a red cape and a sword. Football is a one-handed
overarm throw. Baseball uses two hands, a load and stride, hip-led rotation and a
wraparound sword swing, followed by catapult-style head flight. See the
[motion references and rig mapping](motion-reference.md).

The sprite transitions preserve a launch across logical roll/ball changes, hold the
head form during momentum, and reform the suit on exit.

## Assets and preview

- [Multi-angle design reference](turnaround-reference.png)
- [Action design reference](action-reference.png)
- [Generation prompts](reference-prompts.md)
- [Live animation preview](http://localhost:5174/scripts/clockwork-preview.html)

Nine transparent atlases cover front, back and side views of all three launches.
West mirrors east. Bowling and football contain 72 frames per sheet; baseball contains
88, including a longer load/stride sequence. All nine sheets total 696 frames.
Registration rectangles remain consistent within each sheet; manifests include content hashes.

## Rebuilding

The source rig is `ThreeJS/src/game/pinball-knight/render/clockwork-knight.ts`.
With Vite running and a Chromium CDP endpoint, run from `ThreeJS`:

```sh
node scripts/bake-clockwork.mjs
```

Defaults: `PK_URL=http://localhost:5174`, `CDP_URL=http://localhost:9345`.
The baker uses its own temporary tab and closes it after publishing the sheets.
Launch timing and gameplay benefits are shared in `clockwork-launches.ts`.
The movement integration test compares four seconds of real `updatePlayer` physics
at the same starting speed on an empty, open floor without steering.
