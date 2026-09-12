# Armored pixel knight

The default Pinball Knight now uses live articulated 3D plate armor: a closed pointed helmet with narrow visor slits, overlapping shoulder plates, chainmail joints, worn silver steel, leather belt and a longsword. The cinematic shares the same rig, including its detachable helmet.

## Rendering

- `render/armored-knight.ts` owns the model, procedural surface textures, weapon variants and poses.
- `render/pixel-knight.ts` renders the on-foot player into a transparent 72 × 80 target and enlarges it with nearest-neighbor sampling. It retains the existing actor scale, contact shadow, damage tint and matching blue occlusion silhouette. Special ride/marble clips keep their existing art; selecting a different character restores its normal sprite.
- `render/character-pixel-pass.ts` renders cinematic characters at one quarter of the drawing-buffer dimensions, after lighting. Background geometry supplies occlusion depth; the scenery itself stays at full resolution. Render-target UVs compensate for the node renderer's vertical orientation.
- `public/sprites/armored-knight-portrait.png` is a transparent 96 × 120 render of the same model for character selection.

Actor disposal releases the model, geometry, textures and target. Both render passes restore the caller's target and clear state, including failed renders. The cinematic has camera-side fill lighting so the steel remains legible when the knight turns away from the main light.

## Release and validation

Feature batches: `0526e1b6`, `78a262b0` on `feat/armored-pixel-knight`.

Deployed release: `06ba12cd` on `release/armored-pixel-knight`, built on the previously live `b5331061` and merged with the subsequently published slime release `0e569b41`. No other developer's worktree was edited.

- Full release gate: 353 test files passed, 5 skipped; 4,145 tests passed, 12 skipped, no failures.
- Focused coverage verifies live silhouette registration, ride fallback, character switching, disposal, and restoration after renderer failure. Existing intro timing/skip and tavern selection tests pass.
- Muted browser checks exercised all seven intro scenes and inspected the model, pixel comparison, tavern and dungeon with no JavaScript exceptions.
- Production build and deploy-kit transfer/restart completed on 2026-09-11 at 03:38 UTC. NAS container `06ba12cd` was running and healthy; local and public health endpoints returned `healthy`.
- Public index SHA-256 matched the running container: `907c15898e92a9ba1ce4f13a3617a1891e9a94dae9b38d0fb97d581beda3ebdf`. The public portrait also matched the committed asset.

The repository-wide TypeScript check still reports pre-existing errors elsewhere; the changed rendering/gameplay files had no diagnostics in the targeted check.
