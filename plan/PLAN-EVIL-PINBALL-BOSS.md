# Implementation Plan — Evil Pinball Boss ("Tilt Titan" / "Lord Tilt")

## Overview
Add a new evil pinball boss monster to `pinball-knight`: **Tilt Titan** (`BossKind "pinball_boss"`, `EnemyKind "pinball_boss"`).
The boss is a giant evil chrome pinball sphere with a malevolent etched mechanical face and glowing crimson eyes that rolls around the arena, charges up with unpredictable randomized timing, flattens the Pinball Knight like a pancake, smashes the knight into walls for extra impact crunch, and ricochets off arena walls like a real pinball.

---

## 1. Claims & Evidence Classification

Per `.agents/plan-verification-standard.md`, every claim is classified:
- `[Verified Fact]`: Confirmed in `boss-kinds.ts` (lines 732–775), `boss-roster.test.ts` (lines 90–147), and `maze/prefabs.ts` (lines 355–407) that `warren` is the ONLY biome with 1 guardian (`broodmother`), while `crypt`, `bloodworks`, `arcane`, and `magma` all have 2 guardians. Adding `pinball_boss` to `warren` completes a balanced 2-boss-per-biome roster.
- `[Verified Fact]`: Confirmed in `boss-moves.ts` (lines 339–396) that `updateCharge` currently handles linear line dashes with wall stoppage (`moved < step * 0.4`), which can be extended or paired with a bespoke `PinballCharge` featuring randomized cadence, wall ricochet, and flattening.
- `[Testable Claim]`: The randomized timing can be asserted within min/max bounds (`2.6s <= interval <= 4.8s`), and the player flattening debuff can be asserted on `player.scale.y` and `player.momSpeed`.
- `[Testable Claim]`: Wall collision during player launch can be asserted to deal `WALL_CRUNCH_DAMAGE = 2` with screen shake.
- `[Assumption-1]`: `warren` (Floors 31–35 on Pass 1) is the ideal biome for `pinball_boss` because it completes the 2-boss-per-biome symmetry. Risk: User may prefer `pinball_boss` in a different biome (e.g. `crypt` or a dedicated secret arcade level). Validation path: Included as Open Question #1 for user confirmation.

---

## 2. Visual Identity & Sprite Generation (Nano Banana)

### Visual Anatomy
- **Form**: Giant spherical chrome pinball head (scale `2.20`, body radius `0.95`).
- **Face & Finish**: Mirror-polished steel with curved specular reflections, an etched grinning mechanical mouth with jagged steel teeth, and glowing crimson visor/eyes.
- **Energy Accents**: Blue and yellow electric lightning arcs crackling across seam lines and rivets.

### Sprite Sheet Grid (4×4 16 Frames on `#00FF00` Chroma Green)
- **Row 0 (`idle`)**: 4 frames facing South — Heavy metallic floating/bobbing, surface reflection sweep, glowing red visor pulsing, small electric sparks discharging.
- **Row 1 (`walk` / roll)**: 4 frames facing South — Rolling forward across dungeon floor with rotating etched face and specular highlights, dust and sparks kicking up at ground contact.
- **Row 2 (`attack` / boost charge)**: 4 frames facing South — High-RPM spin revving in place with grinding floor friction sparks, visor blazing bright, followed by a rocket-boost forward launch with blue electric speed lines.
- **Row 3 (`death`)**: 4 frames — Chrome hull crumples with deep structural fractures, core detonation vents bright flash, exploding outward into steel shrapnel, ball bearings, and coiled bumper springs.

---

## 3. Moveset & Combat Mechanics

### Move 1: Boost Charge & Flatten Wall Smash (`pinballCharge`)
- **Randomized Timing**:
  - Unlike predictable metronomic bosses, Tilt Titan chooses a randomized cooldown:
    - Phase 1: `interval = randomBetween(2.6, 4.8)s`, `telegraph = randomBetween(0.65, 1.20)s`.
    - Phase 2: `interval = randomBetween(1.8, 3.2)s`, `telegraph = randomBetween(0.45, 0.85)s`.
- **Telegraph Rev-Up**:
  - The Titan spins in place with intense sparks; an electric targeting lane projects toward the player.
- **Charge & Flatten**:
  - Launches at `speed = 26` along the lane.
  - Direct Hit: Deals `damage = 3` and applies **Flatten Debuff** (`p.flattenT = 1.5s`):
    - Knight scale is squashed vertically: `player.scale.set(1.4, 0.2, 1.4)`.
    - Knight speed is hobbled by 60% (`p.momSpeed *= 0.4`).
    - Floating toast: `"🥞 FLATTENED!"`.
- **Wall Crunch**:
  - Knight is launched into the momentum channel at `launch = 28`.
  - If knight hits a dungeon wall while launched:
    - Extra 2 damage (`WALL_CRUNCH_DAMAGE = 2`).
    - Seismic screen shake (`state.shakeT = 0.45`).
    - Impact sparks and dust burst.
    - Floating toast: `"💥 CRUNCH! SMASHED INTO THE WALL!"`.
- **Pinball Ricochet**:
  - When Tilt Titan hits a wall during its charge, it reflects off the collision normal with a loud metallic CLANG, emitting radial bumper sparks and continuing momentum for 1 ricochet!

### Move 2: Bumper Slam / Seismic Tilt Shockwave (`bumperSlam`)
- **Telegraph (0.85s)**: Pulsing circular bumper mandala expands under the player.
- **Execution**: The Titan slams into the ground, dealing `2` damage, launching the knight (`launch = 22`), and sending an expanding neon spark ring outward.

### Phase 2 Escalation (at 50% HP)
- **Title**: `"🚨 TILT OVERLOAD: SUPERCHARGED MULTIBALL 🚨"`
- **Speed Multiplier**: 1.35x.
- **Visual**: Chrome shell glows superheated molten red/orange with heat distortion particles.
- **Attacks**: Even faster randomized cadence (1.8s–3.2s intervals), double wall ricochets, and walls emit bouncing electric mini-pinball spark orbs on impact!

---

## 4. Proposed Changes

### Component: Boss Roster & Kind Registry
#### [MODIFY] [boss-kinds.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boss-kinds.ts)
- Add `"pinball_boss"` to `BossKind` union.
- Define `PinballChargeSpec` with min/max randomized intervals, telegraph bounds, speed, flatten duration, and wall smash damage.
- Add `pinball_boss` entry in `BOSSES` table guarding `warren` on Pass 1 (Floors 31–35).

#### [MODIFY] [boss-moves.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boss-moves.ts)
- Implement `PinballChargeRt`, `freshPinballCharge`, `updatePinballCharge`, and `disposePinballCharge`.
- Handle randomized timer resetting, wall ricochet vector reflection, player flatten debuff application, and wall collision check.

### Component: Runtime Engine & Renderers
#### [MODIFY] [boot/sheets.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/sheets.ts)
- Add `"pinball_boss"` to `SheetKey`, `SHEET_KEYS`, `SHEET_NAME_BY_KEY`, `IMPORTED_ART`, and floor key preloaders.

#### [NEW] [render/monsters/pinball-boss.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/monsters/pinball-boss.ts)
- Implement procedural chrome sphere cel-painter with reflective shading, glowing crimson eyes, toothy grin, and lightning accents for fallback and tests.

#### [MODIFY] [render/sheet-painters.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/sheet-painters.ts)
- Wire `pinball_boss: makePinballBossPaints` into `SHEET_PAINTERS`.

#### [MODIFY] [bestiary.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/bestiary.ts)
- Add `"pinball_boss"` entry with lore, icon `⚪`, family `boss`, and loot drops.

#### [MODIFY] [debug-panel.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/debug-panel.ts) & [gui/screens/debug.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts)
- Add `pinball_boss: "Titan"` in `LABEL_OVERRIDE` (5 characters <= 8, <= 16 with icon) to guarantee zero UI chip overflow.

### Component: Assets & Sprite-Forge Pipeline
#### [NEW] `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-pinball-boss.mjs`
- Ingestion script for Nano Banana 4×4 master sheet with `#00FF00` chroma background, grid slicing, and JSON metadata generation.

#### [NEW] `public/sprites/pinball_boss-S.png` & `public/sprites/pinball_boss-S.json`
- Ingested sprite sheet and atlas metadata.

#### [SYNC] `dist/pinball-knight-windows-x86_64/assets/sprites/`
- Synchronize sprite PNG and JSON sidecar for Windows native release binary.

---

## 5. Verification Plan

### Automated Tests
1. **Unit Tests in [entities/pinball-boss.test.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/pinball-boss.test.ts)**:
   - `pnpm vitest run src/game/pinball-knight/entities/pinball-boss.test.ts`
   - Assert randomized interval and telegraph fall strictly within configured `[min, max]` boundaries.
   - Assert player hit triggers 50% flatten scale (`scale.y = 0.2`) and 60% speed hobble.
   - Assert wall impact triggers `WALL_CRUNCH_DAMAGE = 2`, screen shake, and ricochet vector.
2. **Boss Roster Reachability in [boss-roster.test.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boss-roster.test.ts)**:
   - `pnpm vitest run src/game/pinball-knight/boss-roster.test.ts`
   - Assert all 10 bosses across all 5 biomes are strictly reachable by descending.
3. **Debug UI Length Tests**:
   - `pnpm vitest run src/game/pinball-knight/debug-console.test.ts src/game/pinball-knight/debug-panel.test.ts`
   - Assert `"Titan"` chips fit without overflowing dock (<=8 chars) or panel (<=16 chars).
4. **Sprite-Forge Tests**:
   - `npm run sprites` (verify all 29+ sprite-forge test suites pass with chroma `#00FF00` keying).
5. **Production Build**:
   - `pnpm run build` (verify 0 TypeScript/asset build errors).

### Manual Verification
- Deploy to Synology NAS container (`npm run deploy`) and test live at `http://10.0.0.16:8789`.
- Test native Windows executable at `dist/pinball-knight-windows-x86_64/pk-game.exe`.

---

## 6. Open Questions for User Approval

1. **Biome Placement**: We recommend placing Tilt Titan in the **Warren** (Pass 1, Floors 31–35) as it is currently the only biome with just 1 guardian (`broodmother`), bringing all biomes to an even 2 guardians each. Do you prefer Warren, or would you like it in another biome (such as Crypt, Bloodworks, or a dedicated arcade floor)?
2. **Flatten Duration & Effect**: We currently propose a 1.5-second pancake flatten effect (squished sprite/mesh + 60% slow) before popping back to normal size. Is 1.5 seconds a good duration, or would you prefer shorter (e.g. 1.0s) or longer (e.g. 2.0s)?
3. **Wall Smash Lethality**: If the player is launched into a wall, should it cause extra damage and a brief 0.5s stun, or only damage and screen shake?
