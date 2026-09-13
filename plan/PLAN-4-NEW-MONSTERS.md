# Implementation Plan — 4 New Monsters (Sandwich, Palm Tree, Monster Bard, Don Quixote)

**Target Project**: `pinball-knight`  
**Date**: 2026-09-12  
**Status**: PARTIALLY SHIPPED — 2026-09-12. **Don Quixote is in the game.**
The Sandwich, the Palm Tree and the Monster Bard are still plan-only.

### What actually shipped, and where the plan was wrong

- **He is ON FOOT.** The plan specified a knight mounted on a donkey, and
  `CLAIM-3` was right that a sprite drop already existed — but that drop
  (`sources/don_quixote-2026-08-02/`) is a dismounted, paunchy knight in dented
  plate with a barber's basin helmet and a couched lance. There is no donkey in
  the art and none was generated. The art won; the spec was rewritten to it.
- **No bespoke state machine.** The plan called for `entities/don-quixote.ts`
  to own charge kinematics, wall crash and pinball bounce. The engine already
  has a committed locked-line dash (`startCharge` in `entities/zombie.ts`, used
  by the Hound and the woken Mimic) and a stun (`staggerT`). He is registered as
  a `leaper` and reuses both. `entities/don-quixote.ts` is now ~50 lines holding
  the ONE thing no other family does: the wall crash costs him real health and
  leaves him staggered for 1.8s.
- **The sheet is published**, not procedural: `prep/prep-don-quixote.mjs` →
  inbox → `npm run sprites` → `public/sprites/don_quixote-S.*`, 4 clips x 4
  frames. The painter in `render/monsters/don-quixote.ts` is the fallback and
  the bestiary portrait.

⚠️ `npm run sprites` REPUBLISHES EVERY SHEET IN THE INBOX, not just yours. That
run rewrote 11 other monsters from their inbox sidecars and cut fries, slime,
milkshake, blaster_frank and pinball_boss from 6 authored frames back to 4
(their richer versions come from the `scripts/bake-*.mjs` rigs, which the inbox
does not know about). Revert every `public/sprites/` file you did not intend to
touch before committing.  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md) (VCPM Claim Triage & Quality Gates)

---

## 1. Problem Statement & User Intent

The user requested designing and implementing four distinct new monsters with unique behavioral, projectile, and pinball mechanics:
1. **Sandwich Monster**: A deli sandwich monster that spits out mustard hazards.
2. **Palm Tree Monster**: A living palm tree that hurls coconuts which can be deflected back in pinball mode.
3. **Monster Singer / Bard**: A support monster that sings to buff all monsters with 2× damage until slain.
4. **Don Quixote**: A chivalrous knight mounted on a donkey who executes high-speed jousting charges.

---

## 2. Monster Specifications & Mechanics

### Monster 1: The Deli Sub ("Sandwich Monster")
- **Archetype**: Mid-range artillery / hazard spitter (Synergizes with Fast Food family: `burger`, `fries`, `milkshake`, `hotdog`).
- **Art / Visual**: Multi-decker submarine sandwich with crusty sesame bun, cold-cut layers, lettuce teeth, tomato tongue, and olive toothpicks.
- **Behavior & Attacks**:
  - `spit_mustard`: Unhinges crusty jaws and spits high-pressure mustard globs (`launchMustardJets`).
  - Upon impact, mustard globs coat the dungeon tiles with yellow mustard slick puddles (`kind: "mustard"`, floor friction cut by 65%, inflicting spinout and slight contact burn).
- **Stats**: HP `6`, Radius `0.45`, Speed `0.95`, Range `6.0`.
- **Drops**: Reagent `Deli Slice`, `Toasted Crust`.

### Monster 2: The Coco-Lobber ("Palm Tree Monster")
- **Archetype**: Artillery & interactive projectile bouncer.
- **Art / Visual**: Living tropical palm tree with flexing trunk legs, swaying fronds, and heavy brown coconuts in its crown.
- **Behavior & Attacks**:
  - `throw_coconut`: Lobs heavy spherical coconut projectiles in an arc towards the player.
  - **Pinball Ricochet Mechanic**:
    - If the player is in active pinball marble rolling/dash mode (`p.momSpeed >= 4.0`), colliding with a flying or bouncing coconut reflects the coconut with high impulse along the impact normal!
    - Reflected coconuts become player-aligned projectiles that deal massive blunt damage (`3x damage`) to enemies, rewarding active pinball deflections.
    - If hit while standing still or walking slowly, the coconut knocks the player back and deals 1 damage.
- **Stats**: HP `8`, Radius `0.52`, Speed `0.65`, Throw Range `7.5`.
- **Drops**: Reagent `Coconut Shell`, `Palm Fiber`.

### Monster 3: The Dirge Singer ("Monster Bard")
- **Archetype**: High-priority support buffer.
- **Art / Visual**: Flamboyant goblin/skeleton bard with a feathery hat, lute/horn, and singing mouth with floating musical note VFX (`♪ ♫ ♬`).
- **Behavior & Attacks**:
  - `sing_buff`: Struts into the room and channels "Chorus of Fury".
  - While singing, broadcasts a global floor buff: `state.monsterDamageBuff = 2.0`.
  - All enemies glow with crimson aura and deal double damage on all melee and ranged hits.
  - Slaying the singer immediately cancels the song, shattering the buff and causing nearby enemies to stumble.
- **Stats**: HP `5`, Radius `0.38`, Speed `1.1` (kites away from the player while singing).
- **Drops**: Reagent `Tuned String`, `Worn Sheet Music`.

### Monster 4: Don Quixote ("The Windmill Jouster")
- **Archetype**: Heavy linear charging knight.
- **Art / Visual**: Chivalrous mad knight in dented iron armor and barber's basin helmet, mounted atop a charging donkey with a couched wooden lance. (Source sheet already archived in `tools/sprite-forge/sources/don_quixote-2026-08-02`!).
- **Behavior & Attacks**:
  - `donkey_charge`: Telegraphs with donkey braying and hoof pawing (0.6s windup), then charges in a straight line at 3× speed (`chargeSpeed = 7.5`).
  - **Wall Impact Stun**: If Don Quixote hits a solid maze wall or pinball bumper during a charge, he suffers a massive crash: takes self-damage, spins around, and becomes stunned for 1.8 seconds with dizzy stars circling his helmet.
- **Stats**: HP `10`, Radius `0.58`, Speed `1.2` (walk) / `7.5` (charge).
- **Drops**: Reagent `Rusty Lance Tip`, `Donkey Horseshoe`.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `state.ts:EnemyKind` defines all monster kinds and can accept `"sandwich"`, `"palm_tree"`, `"monster_bard"`, and `"don_quixote"` | **Verified Fact** | Inspect [`state.ts:340-390`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L340-L390) |
| `CLAIM-2` | Mustard floor puddles and projectiles already exist in `entities/mustard.ts` and `entities/floor-fx.ts` | **Verified Fact** | Inspect [`entities/floor-fx.ts:973`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/state.ts#L973) (`kind: "mustard"`) |
| `CLAIM-3` | Complete sprite sources for Don Quixote already exist in `tools/sprite-forge/sources/don_quixote-2026-08-02/` | **Verified Fact** | Inspect [`sources/don_quixote-2026-08-02/`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge/sources/don_quixote-2026-08-02/) |
| `CLAIM-4` | Projectile deflection already exists in `entities/projectiles.ts` (e.g. baseball bat reflect / shield parry) | **Verified Fact** | Inspect [`entities/projectiles.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/entities/projectiles.ts) (`reflectProjectile`) |
| `CLAIM-5` | Coconut projectile can check player momentum `Math.hypot(p.momX, p.momZ) >= 4.0` to trigger ricochet rather than player damage | **Testable Claim** | Unit test verifying coconut deflection when player is moving fast vs hit when stationary |
| `CLAIM-6` | `damagePlayer` in `entities/combat.ts` can multiply enemy outgoing damage by `state.monsterDamageBuff ?? 1.0` | **Testable Claim** | Unit test asserting player takes 2 damage instead of 1 when singer is active |
| `CLAIM-7` | Slaying the monster bard sets `state.monsterDamageBuff = 1.0` and clears the vocal aura | **Testable Claim** | Unit test verifying buff cleanup on bard death |
| `CLAIM-8` | Don Quixote straight-line charge checks wall collisions; impacting a wall triggers 1.8s stun state | **Testable Claim** | Unit test verifying stun transition on wall hit |
| `ASSUMPTION-1` | Sandwich monster spawns alongside fast-food enemies in food/diner arcade biomes | **Assumption** | Risk: Spawn dilution. Validation: Check biome enemy weights. |
| `ASSUMPTION-2` | Coconut bounce angle uses player collision normal $\vec{n} = \text{normalize}(C - P)$ with velocity inversion | **Assumption** | Risk: Ball bounce direction feels unnatural. Validation: Playtest ricochet response. |

*Metrics: 4 Verified Facts (40%), 4 Testable Claims (40%), 2 Assumptions (20%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Proposed Implementation Steps

1. **Sprite Sheet Ingestion & Nano Banana Art**:
   - Process `don_quixote-2026-08-02` through sprite-forge prep script into `public/sprites/don_quixote-S.json` and `.png`.
   - Setup sprite sheets for `sandwich`, `palm_tree`, and `monster_bard` with procedural cel-painters and Nano Banana integration.
2. **Entity Behaviors**:
   - `entities/sandwich.ts`: Mustard glob barrage and puddle spawning.
   - `entities/palm-tree.ts`: Coconut ballistics and pinball deflection reflection.
   - `entities/monster-bard.ts`: Singing channel, song VFX notes, and global 2× horde damage buff.
   - `entities/don-quixote.ts`: Charging lance kinematics, wall crash stun, and pinball bounce.
3. **Registration & Bestiary**:
   - Register in `state.ts:EnemyKind`, `bestiary.ts`, `manifest-inventory.ts`, and `boot/sheets.ts`.
4. **Comprehensive Vitest Suite**:
   - `entities/sandwich.test.ts`
   - `entities/palm-tree.test.ts`
   - `entities/monster-bard.test.ts`
   - `entities/don-quixote.test.ts`
