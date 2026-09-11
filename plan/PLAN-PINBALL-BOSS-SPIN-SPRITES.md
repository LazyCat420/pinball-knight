# Implementation Plan — Redo Giant Pinball Boss Sprite Sheet (360° Spin Charge-Up)

## 1. Problem Statement & Intake (/fix)

### One-Sentence Summary
The giant pinball boss (**Tilt Titan** / `pinball_boss`) fails to visibly spin when revving up and charging to hit the knight because its sprite sheet's attack row contains static front-facing frames with sparks instead of sequential spherical rotation frames, compounded by non-looping playback in `MonsterAnimator`.

### Expected vs. Actual Behavior
- **Expected Behavior**: During the telegraph / rev-up phase (0.8s–1.4s) and subsequent dash of `pinballCharge`, the pinball boss should remain locked in place and visibly spin rapidly around its vertical axis like a high-RPM spinning top / turbine building kinetic energy before launching into a blazing forward roll attack.
- **Actual Behavior**: The boss stands facing directly forward towards the camera with static red visor eyes and grinning mouth. Subtle spark effects flicker around it, but neither the sphere's face nor its metallic body rotates. After ~0.5s, the animation freezes on frame 3, dashing forward in that exact frozen pose.

### Steps to Reproduce
1. In `pinball-knight`, start any floor with `pinball_boss` (or open the debug panel with \`~ and click "Titan" / spawn `pinball_boss`).
2. Stand within engagement distance to trigger `pinballCharge`.
3. Observe the boss during the telegraph rev-up phase:
   - Notice the boss is staring straight at the camera with no facial or body rotation.
   - Notice the animation locks on frame 3 for the remainder of the telegraph and dash.

---

## 2. Root Cause Analysis & Invariants Broken

### Root Cause 1: Sprite Sheet Content Defect (Primary)
Direct inspection of `public/sprites/pinball_boss-S.png` frames 8..11 (Row 2, `attack`):
- **Frame 8 (Attack 0)**: Front-facing evil chrome grin, minor electric spark.
- **Frame 9 (Attack 1)**: Identical front-facing evil grin, blue lightning arc.
- **Frame 10 (Attack 2)**: Identical front-facing evil grin, yellow lightning arc.
- **Frame 11 (Attack 3)**: Identical front-facing evil grin, horizontal motion lines.
*Finding*: The AI generator in the previous generation produced a static forward-facing ball with lightning overlays instead of rotating the sphere. In 2D pixel art sprites, a spinning ball **must** have sequential rotation frames depicting 360-degree yaw/roll.

### Root Cause 2: Animation Playback Clamping (`MonsterAnimator`)
In `ThreeJS/src/game/pinball-knight/engine/render/monster-animator.ts`:
- `LOOPS["attack"] = false`.
- When `ctx.playAnim?.("attack")` is called, `MonsterAnimator` plays frames 0 -> 1 -> 2 -> 3 and then locks `this.frameIdx = 3` (`this.finished = true`).
- Because `boss-moves.ts` repeatedly invokes `ctx.playAnim?.("attack")` without `{ force: true }`, it never restarts or loops; it remains stuck on frame 3.

### Root Cause 3: Eccentric 2D Billboard Pivot Disconnect
In `boss-moves.ts`, lines 1491 & 1605:
- `rt.spinAngle = (rt.spinAngle + rt.spinSpeed * ctx.dt) % (Math.PI * 2); ctx.rotateSprite?.(rt.spinAngle);`
- In `ThreeJS/src/game/pinball-knight/engine/render/sprite.ts` line 119:
  `geo.translate(0, SPRITE_UNITS / 2, 0); // Origin at the bottom-centre`
- Rotating `mesh.rotation.z` rotates the entire 2D quad around its **feet** (the floor contact point) rather than the center of the sphere, causing the boss to wobble eccentrically like a pendulum. True spherical spinning must be rendered within the sprite frames while the billboard quad remains stably anchored.

---

## 3. Nano Banana Sprite Generation Specification

### Layout & Style Standards
- **Grid**: 4 columns × 4 rows (16 frames, 1024×1024, 256×256 per cell).
- **Background**: Perfectly uniform flat `#00FF00` chroma green (edge-to-edge, zero ground shadows or border lines).
- **Visual Identity**: Giant spherical chrome steel pinball boss with mirror-polished silver/chrome shading, glowing crimson robotic visor eyes, and sharp etched steel grin.
- **Reference Image**: `src/game/pinball-knight/tools/sprite-forge/sources/pinball_boss-2026-09-07/pinball_boss-S.png` passed into `ImagePaths`.

### Row-by-Row Frame Architecture
- **Row 0 (`idle`, frames 0..3)**:
  - 4 frames: Heavy metallic hover / bounce in place, moving chrome specular glints, pulsing crimson visor eyes.
- **Row 1 (`walk`, frames 4..7)**:
  - 4 frames: Forward rolling motion across the floor with contact friction sparks at the bottom base.
- **Row 2 (`attack`, frames 8..11) — THE 360° SPIN REV-UP**:
  - **Frame 8 (0° → 45°)**: Face begins rapid clockwise horizontal spin; evil grin and eyes turn 45° to the right; chrome specular glint shifts dynamically.
  - **Frame 9 (90° Profile)**: Face turns away into right side profile; centrifugal spin motion blur streaks across the sphere; electric sparks erupt from spinning seams.
  - **Frame 10 (180° Rear View)**: Complete rear view of the chrome sphere; mechanical armor plating seams, steel rivets, and glowing orange/red reactor turbine coil vent at the back.
  - **Frame 11 (270° Profile)**: Opposite side profile turning back toward the front; intense radial motion blur trails and turbine discharge sparks.
  - *Result*: When looped 8 → 9 → 10 → 11 → 8, the titan performs a continuous, unmistakable 360° turbine spin!
- **Row 3 (`death`, frames 12..15)**:
  - 4 frames: Chrome hull fractures under stress, glowing core breach, exploding outward into shrapnel, ball bearings, and springs.

---

## 4. Engine & Gameplay Code Improvements

### 1. `MonsterAnimator` Looping Support
- In `ThreeJS/src/game/pinball-knight/engine/render/monster-animator.ts`:
  - Extend `play(clip: ClipName, opts: { force?: boolean; onEnd?: () => void; loop?: boolean }): void`.
  - In `update(dt)`, check `const shouldLoop = this.loopOverride ?? LOOPS[played];`.
  - This allows `attack` to be explicitly looped during channeled / rev-up moves without breaking default one-shot attacks for other monsters.

### 2. `boss-moves.ts` RPM Acceleration
- In `ThreeJS/src/game/pinball-knight/boss-moves.ts` (`updatePinballCharge`):
  - In `phase === "telegraph"`:
    - Invoke `ctx.playAnim?.("attack", { loop: true })`.
    - As `progress` ramps from 0 to 1, scale animation rate via `ctx.setAnimRate?.(1.0 + progress * 2.5)` (or equivalent) so the spin visibly accelerates from 8 fps to 28 fps as RPM peaks!
    - Ensure `ctx.rotateSprite?.(0)` so the billboard does not swing eccentrically around its feet.
  - In `phase === "running"`:
    - Maintain `ctx.playAnim?.("attack", { loop: true })` at high rate until the charge concludes.
  - In `phase === "idle"` / cleanup:
    - Reset rate to 1.0, clear loop override, and play `"idle"`.

---

## 5. Implementation Workflow (Sprite-Forge Pipeline)

1. **Nano Banana Generation**:
   - Generate new 16-frame sheet using `generate_image` with reference image and explicit 360° spin frame prompt.
   - Archive raw take into `src/game/pinball-knight/tools/sprite-forge/sources/pinball_boss-2026-09-07/alt-takes/pinball_boss_sheet_<timestamp>.jpg`.
   - Update `alt-takes/README.md`.
2. **Sprite-Forge Prep Execution**:
   - Update `src/game/pinball-knight/tools/sprite-forge/prep/prep-pinball-boss.mjs` to target new master take.
   - Run `node src/game/pinball-knight/tools/sprite-forge/prep/prep-pinball-boss.mjs`.
   - Output cleaned PNG & JSON to `sources/pinball_boss-2026-09-07/` and `inbox/pinball_boss-S.*`.
3. **Sprite Build & Distribution**:
   - Run `npm run sprites` to crop, pack, hash, and publish to `public/sprites/pinball_boss-S.*`.
   - Copy published assets to `dist/pinball-knight-windows-x86_64/assets/sprites/pinball_boss-S.*`.
4. **Code Updates**:
   - Update `MonsterAnimator` loop option.
   - Update `boss-moves.ts` rev-up animation rate acceleration.
5. **Testing & Validation**:
   - Run `npx vitest run src/game/pinball-knight/entities/pinball-boss.test.ts`.
   - Run `npx vitest run src/game/pinball-knight/engine/render/monster-animator.test.ts`.
   - Run `npm run test:sprites`.

---

## 6. Verification Plan

### Automated Tests
- `npx vitest run src/game/pinball-knight/entities/pinball-boss.test.ts`: Verify `pinballCharge` telegraph, stationary lock, RPM spin acceleration, and flatten combat logic.
- `npx vitest run src/game/pinball-knight/engine/render/monster-animator.test.ts`: Verify `MonsterAnimator` `{ loop: true }` option behaves deterministically and loops attack clips.
- `npx vitest run src/game/pinball-knight/boot/lazy-sheets.test.ts`: Verify `pinball_boss` sheet resolves cleanly in lazy loader.
- `npx vitest run src/game/pinball-knight/tools/sprite-forge/inbox.test.ts`: Verify inbox manifest syntax and grid dimensions.

### Manual Verification
- Deploy container via `npm run deploy` inside the repository directory.
- Verify in browser: spawn Titan boss via debug panel, observe `pinballCharge` rev-up spin and forward charge.

---

## 7. Open Questions for User Brainstorming

1. **Spin Direction & Axis**: Would you like the boss to spin horizontally around its vertical axis (like a spinning top / turbine, showing front → side → back → side → front), or vertically forward (rolling end-over-end in place with ground burn friction), or a dynamic combination?
2. **Speed Scaling Visuals**: During rev-up, would you like the animation playback to dynamically accelerate from 8 fps up to 24–30 fps as the RPM builds toward launch, accompanied by accelerating electric sparks?
3. **Charge Phase Visual**: While the boss is actively rocketing across the floor towards the player, should it continue looping the 360° spin animation, or should it use an aerodynamic forward speed-dash posture?
