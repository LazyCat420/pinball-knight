# Plan: Fix Buddha Boss Spawning & Rendering in Admin Debugger

## 1. Problem Statement
When attempting to spawn the Buddha boss (`jade_buddha`) via the Admin Debugger / God Mode (` debug console -> MONSTERS -> 🪷 Buddha`), nothing renders into the game. `state.zombies` remains empty, and no sprite mesh is added to `state.scene`.

## 2. Test-Driven Diagnostics & Root Cause Analysis
We wrote a reproduction test suite in `ThreeJS/src/game/pinball-knight/spawn-buddha-debug.test.ts` and executed it via Vitest. All 4 tests failed **RED**:

1. **`KIND_SKIN` omission (`spawn/kind-skin.ts`)**:
   - `KIND_SKIN["jade_buddha"]` is `undefined`.
   - `makeSkinned("jade_buddha", ...)` immediately returns `null`.
2. **`spawnKind` switch omission (`spawn/factory.ts`)**:
   - `spawnKind("jade_buddha", ...)` has no `case "jade_buddha":`.
   - Falls through to `default: return null;`.
3. **`makeDebugEnemy` failure (`dev/debug-actions.ts`)**:
   - `makeDebugEnemy("jade_buddha")` delegates to `KIND_SKIN["jade_buddha"]` (fails) then `spawnKind("jade_buddha")` (fails), returning `null`.
4. **`debugSpawnEnemy` failure (`dev/debug-actions.ts`)**:
   - `debugSpawn` loops over candidate spawn points; since `makeDebugEnemy` returns `null`, every point is skipped (`if (!zz) continue`).
   - 0 actors are pushed to `state.zombies`, 0 meshes added to `state.scene`.
5. **Manifest inventory omission (`boot/manifest-inventory.ts`)**:
   - `IMPORTED_FACINGS` does not register `jade_buddha: ["S"]`.
6. **Boss Controller Engagement (`boss.ts` / `dev/debug-actions.ts`)**:
   - The Laughing Jade Buddha is both an `EnemyKind` and a full `BossKind` with custom moves (`moves.slam` for Belly Slam AoE, `moves.fanBoomerang` for whirling Chinese war fan boomerang, and Phase 2 dual-fans / belly quake).
   - In ordinary monster spawning, it only has basic melee chase logic unless adopted by the boss controller (`adoptBoss(z, BOSSES.jade_buddha)`).

---

## 3. Multiple Solutions & Approaches

There are two primary options for how the Buddha boss should behave when spawned via the admin debugger:

### Approach A: Skinned Enemy Only
- Register `jade_buddha` in `KIND_SKIN` (scale 2.15) and `spawnKind`.
- Spawning spawns a large, tanky (HP 50), high-damage Buddha zombie actor who chases and attacks the knight.
- Does *not* trigger the full floor boss state machine (no screen-wide boss HP bar, no exit lockdown, no fan boomerang projectile).

### Approach B (Recommended): Hybrid Boss-Aware Spawner
- Register `jade_buddha` in `KIND_SKIN`, `spawnKind`, and `IMPORTED_FACINGS`.
- In `dev/debug-actions.ts`:
  - If spawned and no boss is currently active (`!bossActive()`), automatically adopt it via `adoptBoss(zz, BOSSES.jade_buddha)`.
  - This activates the complete boss experience:
    - 🪷 The Laughing Jade Buddha title toast
    - Large boss health bar at the top of the HUD
    - Signature **Belly Slam** ground ring telegraph and AoE screen shake
    - Signature **Chinese Fan Boomerang** arcing throw, hovering apex spin, and live return trajectory
    - Phase 2 enrage at 50% HP (belly quake tremors and dual crossing boomerang fans)
  - If spawned with count > 1 (e.g., x3 or x5 in the debugger) or if a boss is already active, the first Buddha becomes the active boss and additional Buddhas spawn as high-HP elite guardians.
  - In `debugClearEnemies()`, invoke `disposeBoss()` so clearing the room cleanly resets any active boss meshes and lets you re-test spawning anytime.

---

## 4. Proposed Changes

### Component: Core Spawner & Skin Registry
- **[MODIFY] [ThreeJS/src/game/pinball-knight/spawn/kind-skin.ts](file:///home/lazycat/github/projects/sun/pinball-knight/.worktrees/wt-fix-buddha-boss/ThreeJS/src/game/pinball-knight/spawn/kind-skin.ts)**
  - Add `jade_buddha: { scale: 2.15 }` to `KIND_SKIN`.
- **[MODIFY] [ThreeJS/src/game/pinball-knight/spawn/factory.ts](file:///home/lazycat/github/projects/sun/pinball-knight/.worktrees/wt-fix-buddha-boss/ThreeJS/src/game/pinball-knight/spawn/factory.ts)**
  - Add `case "jade_buddha": return makeSkinned("jade_buddha", x, z, baseSpeed * 0.85);` to `spawnKind()`.
- **[MODIFY] [ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts](file:///home/lazycat/github/projects/sun/pinball-knight/.worktrees/wt-fix-buddha-boss/ThreeJS/src/game/pinball-knight/boot/manifest-inventory.ts)**
  - Add `jade_buddha: ["S"]` to `IMPORTED_FACINGS`.

### Component: Debug Spawner & Boss Teardown
- **[MODIFY] [ThreeJS/src/game/pinball-knight/dev/debug-actions.ts](file:///home/lazycat/github/projects/sun/pinball-knight/.worktrees/wt-fix-buddha-boss/ThreeJS/src/game/pinball-knight/dev/debug-actions.ts)**
  - In `debugSpawn`: when `spec.kind === "jade_buddha"`, if `!bossActive()`, call `adoptBoss(zz, BOSSES.jade_buddha)`.
  - In `debugClearEnemies`: call `disposeBoss()` to ensure clean boss teardown on room clear.

---

## 5. Verification Plan
1. **Automated Vitest Suite**:
   - Run `npx vitest run src/game/pinball-knight/spawn-buddha-debug.test.ts` to confirm all 4 reproduction tests turn **GREEN**.
   - Run `npx vitest run src/game/pinball-knight/boss-buddha.test.ts` to ensure all 12 fan boomerang and belly slam tests pass.
   - Run `npx vitest run src/game/pinball-knight/boss-roster.test.ts` to verify full roster compatibility.
2. **Build & Staging / Deployment Verification**:
   - Build ThreeJS bundle with `npm run build:threejs`.
   - Git commit to worktree branch `fix/buddha-boss-spawning`, merge/push to `origin/main`, deploy container via `npm run deploy`.
   - Verify web URL (`http://10.0.0.16:8789`) and Windows executable (`dist/pinball-knight-windows-x86_64/pk-game.exe`).
