# Implementation Plan — Crawling Hand Monster ("Thing" / Addams Family Inspired)

**Target Project**: `pinball-knight`  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT)  
**Render Asset**: Nano Banana 16-bit SNES Pixel Art Sheet Generated & Embedded  

---

## 1. Overview & Monster Identity

Add a new disabler enemy to `pinball-knight`: **The Crawling Hand** (`EnemyKind "crawling_hand"` / `"hand"`), directly inspired by "Thing" from *The Addams Family*.

The creature is a severed, pale, stitched gothic hand with purple veins and cut wrist stump that skitters rapidly across dungeon flagstones on its fingertips like a spider. Unlike normal shambling zombies that simply swipe and cause knockback, the Crawling Hand's signature attack is to lunge and clamp tightly onto the knight, **pinning the player in place**. While held, the player must **spam inputs (attack, dodge, directions)** to break free. Crucially, **while held, the rest of the dungeon horde (zombies, brutes, spitters, hounds) can close in and attack the immobilized knight**.

---

## 2. Visual Design & Nano Banana Render

The 16-bit SNES-era pixel art sprite sheet was generated via Nano Banana following the `sprite-forge` 4×4 grid specifications:

![Crawling Hand Sprite Sheet Render](/home/lazycat/.gemini/antigravity-ide/brain/4321b33f-3337-4e16-b603-ef2e52ab7300/crawling_hand_sheet_1788760396424.jpg)

### Animation Grid Structure (4×4 Layout, 16 Frames)
1. **Row 1 (`idle`)**: Severed hand resting on fingertips, wrist arched upward, fingers nervously tapping and drumming in sequence, knuckles flexing.
2. **Row 2 (`walk` / `crawl`)**: Rapid scuttling locomotion on 5 fingertips, fingers stepping and crawling forward with crab/spider cadence.
3. **Row 3 (`attack` / `grab`)**: Hand rears back on its wrist, springs forward with fingers spread wide into a clutching claw, clamping onto the target.
4. **Row 4 (`death`)**: Hand is struck, flips backward onto its knuckles/palm, fingers curling into a dying spasm/clenched fist, before collapsing limp onto the floor.

---

## 3. Gameplay Mechanics & Combat Integration

### Core Stats
- **`EnemyKind`**: `"crawling_hand"`
- **HP**: 4 (fragile, severed limb; vulnerable to direct hits and pinball bounces)
- **Radius (`r`)**: 0.28 (small, low-profile collider)
- **Movement Speed**: 1.35× normal zombie speed (fast, erratic skittering)
- **Movement Policy (`enemy-rules.ts`)**: `"chase"` (or `"flanker"` to slip behind and ambush)
- **Grab Contact Range**: 0.75 tiles
- **Attack Windup**: 0.20s (lightning-fast lunge)
- **Attack Cooldown**: 1.8s (recovery after a whiff or being broken off)
- **Constriction Damage**: 1 damage upon initial grab + 1 damage tick every 1.5s while held.

### Signature Move: "Death Clutch" (Grab & Pin System)
1. **Grab Latch**:
   - When the hand makes contact during its attack windup, if the player is not currently invulnerable/dodging:
   - Sets player state:
     - `p.handGrabT = 4.0;` (Maximum hold duration in seconds)
     - `p.handGrabEscape = 6;` (Spam count required to break free)
     - `p.handGrabHost = z;` (Reference to the hand instance)
   - Audio: Snapping sinew / wet flesh clamp sound effect (`sfxHurt()` / bespoke click).
   - HUD Toast: `"🖐️ PINNED BY THE HAND! SPAM TO BREAK FREE!"`

2. **Player Immobilization & Vulnerability (User Core Requirement)**:
   - While `(p.handGrabT ?? 0) > 0`:
     - Player directional velocity is zeroed (`p.momSpeed = 0`).
     - Standard movement and dodge roll are blocked.
     - Player animation forced into `"stumble"` or struggle frame.
     - The player is pinned at the hand's coordinates (`p.x = z.x; p.z = z.z;`).
     - **Vulnerability to Other Monsters**: Standard knockback from external monster hits is suppressed while grabbed so other enemies (zombies, brutes, spitters) do not knock the player out of the grab early, allowing the horde to swarm and pummel the trapped knight!

3. **Spam Escape Mechanic**:
   - Player inputs (`Attack`, `Dodge`, or rapid `axis` changes) decrement `p.handGrabEscape` by 1.
   - Each spam input triggers feedback:
     - Sparks & dust burst at player base (`state.vfx?.sparks(...)`).
     - Knight jiggle / struggle animation shake.
   - When `p.handGrabEscape <= 0`:
     - Player breaks free with a burst of force!
     - The Crawling Hand is knocked back 1.2 tiles and stunned for 0.8s (`z.stunT = 0.8`).
     - Player receives a brief grace window of 0.35s i-frames (`p.iframes = 0.35`) so they aren't instantly re-grabbed.
     - HUD Toast: `"✨ BROKE FREE! Hand knocked loose!"`

4. **Host Death / Interruption**:
   - If the Crawling Hand is killed by a trap, bomb, ricochet ball, or companion while holding the knight, the grab ends immediately (`p.handGrabT = 0; p.handGrabHost = null;`).

---

## 4. Architecture & File Touchpoints

### A. Dedicated Git Worktree
- Branch `feat/crawling-hand-monster` in dedicated worktree `.worktrees/wt-crawling-hand-monster` off clean `main`.

### B. Types, State & Constants
- [state.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts):
  - Add `"crawling_hand"` to `EnemyKind`.
  - Add `handGrabT?: number`, `handGrabEscape?: number`, `handGrabHost?: Zombie | null` to `Player`.
- [constants/enemies.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/constants/enemies.ts):
  - Define `CRAWLING_HAND_HP = 4`, `CRAWLING_HAND_R = 0.28`, `CRAWLING_HAND_DAMAGE = 1`, `CRAWLING_HAND_SPEED_MULT = 1.35`, `CRAWLING_HAND_ESCAPE_COUNT = 6`.

### C. Combat & Player Update
- [combat.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/combat.ts):
  - In `hitPlayer(z)`: Add grab trigger for `z.kind === "crawling_hand"`. Suppress knockback displacement if `p.handGrabT > 0`.
- [player.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/player.ts):
  - In `updatePlayer(dt)`: Handle `p.handGrabT` countdown, spam escape detection (`input.consumeAttack()`, `input.consumeDodge()`, `ax.x !== 0`), break-free knockback, and struggle VFX.
- [zombie.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/zombie.ts):
  - Register `crawling_hand` stats in `STATS` table.

### D. Rules, Bestiary & Economy
- [enemy-rules.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/enemy-rules.ts):
  - Add `crawling_hand: "chase"` in `MOVEMENT_BY_KIND`.
- [stagger.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/stagger.ts):
  - Add `crawling_hand` in `PAIN_BY_KIND`.
- [reagents.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/reagents.ts):
  - Add drop table in `ENEMY_DROPS` (`rotflesh: 0.30`, `bone_splinter: 0.25`).
- [bestiary.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/bestiary.ts):
  - Add entry for `"crawling_hand"`: Name "Crawling Hand", icon "🖐️", description of grab & swarm vulnerability.

### E. Sprite-Forge Pipeline & Rendering
- [prep-crawling-hand.mjs](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-crawling-hand.mjs):
  - Ingestion script to process the generated Nano Banana sprite sheet into `sources/crawling-hand-2026-09-06/` and `inbox/crawling_hand-S.json`.
  - Execute `node prep-crawling-hand.mjs` and `npm run sprites` to generate `public/sprites/crawling_hand-S.json` and `public/sprites/crawling_hand-S.png`.
- [boot/sheets.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/boot/sheets.ts):
  - Register `crawling_hand` in `SheetKey` and `IMPORTED_ART`.
- [render/monsters/crawling-hand.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/render/monsters/crawling-hand.ts):
  - Procedural fallback painter for crawling hand (knuckle arch, crawling fingers, stitched wrist).

### F. Debug Menu & Spawning
- [gui/screens/debug.ts](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/gui/screens/debug.ts):
  - Add `"🖐️ Hand"` debug spawn button.

---

## 5. Verification Plan

### Automated Tests
1. **New Dedicated Vitest Suite**: `ThreeJS/src/game/pinball-knight/entities/crawling-hand.test.ts`:
   - Verify `crawling_hand` stats in `STATS` and `MOVEMENT_BY_KIND`.
   - Verify grab initiation on contact sets `p.handGrabT` and `p.handGrabEscape`.
   - Verify player position locking and movement suppression while grabbed.
   - Verify spam inputs decrement `p.handGrabEscape` and clear grab at 0.
   - Verify other monsters can inflict damage on player while grabbed.
   - Verify killing the hand instantly frees the player.
   - Verify sprite sheet JSON and PNG assets load cleanly under `installSpriteTestDom()`.
2. **Sprite Contract Suite**:
   - `npm run sprites` (`vitest run src/game/pinball-knight/tools/sprite-forge`).
3. **Full ThreeJS Regression Suite**:
   - `npm --prefix ThreeJS test`.

### Manual & In-Game Verification
- Spawn Crawling Hand in debug panel.
- Observe walking animation on fingertips.
- Allow hand to grab knight; verify pinned state, toast prompt, and spamming buttons to break free.
- Test with multiple enemies present: verify zombies/brutes hit knight while held.

---

## 6. Follow-Up Questions for the User

1. **Identifier / Name Preference**: Do you prefer the enemy ID as `"crawling_hand"`, `"hand"`, or `"thing"`? (In the UI / Bestiary it can be displayed as "Crawling Hand" or "The Hand").
2. **Spam Difficulty**: How many button spams feels right to break free? (We propose **5–6 taps**, taking ~0.8–1.2 seconds of rapid spamming, leaving a tense but fair window for other monsters to land 1–2 hits).
3. **Grab Positioning**: When the hand grabs the knight, should it clamp onto the knight's boots/feet (pinning ankles to the ground), or jump up and clutch the knight's helmet/face?
