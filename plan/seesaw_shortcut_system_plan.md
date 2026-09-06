# Implementation Plan: Seesaw Shortcut System for Pinball Knight

**Date**: 2026-09-06  
**Target Project**: `pinball-knight` (`ThreeJS/` and `Rust/crates/`)  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT)

---

## 1. Executive Summary & Problem Framing

The user requested adding a **seesaw system** to `pinball-knight`:
> *"a seesaw system where you have to go on a plank and the plank goes up/down to be able to let you access the other side of the map but if you already activated it since its a seesaw you can only get on it one way at a time."*  
> *"its kind of like how we have those jumpers its just another way for the user to find little shortcuts in the maze system."*

### 1.1 Ground Truth & Existing Baseline (Code Evidence)
- **[Verified Fact - Code Evidence]**: In `ThreeJS/src/game/pinball-knight/maze/decorate.ts` (lines 2996–3045), the dungeon generator creates shortcut launchers across 1–2 tile wall bands called `jumppad` using `crossableBand(g, c.i, c.j, di, dj)`.
- **[Verified Fact - Code Evidence]**: In `ThreeJS/src/game/pinball-knight/entities/pinball-collide.ts` (line 564), `jumppad` triggers `deps.startRampHop(part.dirX, part.dirZ, p.momSpeed)`, which vaults the player over the wall band to land on the far corridor.
- **[Verified Fact - Code Evidence]**: `state.ts` line 582 enforces `_AssertPartSpotKindExtendsPinballPartKind`. Unit tests `render/pinball-parts.test.ts` and `entities/pinball-collide.test.ts` assert exhaustive 1-to-1 parity across `PinballPartKind`, `PART_BUILDERS`, `PART_ANIMATORS`, `PART_HIT_LIFETIME`, and `PART_HANDLERS`.
- **[Verified Fact - Code Evidence]**: Rust crate `pk-game` (`pinball_parts.rs` line 42) defines `pub enum PinballPartKind` and mirror structures.

---

## 2. Seesaw Mechanics & Architecture

### 2.1 The Two-State Tilting Invariant ("One Way at a Time")
A seesaw connects two corridors separated by a wall band: **Side A** (tile `(i, j)`) and **Side B** (tile `(i + dirI * span, j + dirJ * span)`).

```
   [Side A]                 [Fulcrum on Wall]                 [Side B]
   Corridor A                   Wall Band                    Corridor B
     ══════                      ▓▓▓▓▓▓▓                       ══════
      ░░░░░                     ┌───────┐                      ░░░░░
       \                        │   ▲   │                         |
        \                       └───┼───┘                         |  [HIGH: Inaccessible]
         \══════════════════════════╪════════════════════════════/
       [LOW: Walkable]
```

1. **State 0 (`tilt = -1`: Tilted to Side A)**:
   - **Side A** is resting at ground level ($y \approx 0$).
   - **Side B** is raised in the air ($y \approx 0.7$, above player jump/step height).
   - **Accessibility**: A player approaching from Side A can step onto the plank. A player approaching from Side B cannot climb onto the high end ("can only get on it one way at a time").
2. **Transition Trigger**:
   - Player steps onto Side A.
   - Sfx: wooden creak and iron latch clank (`sfxHeavy` / mechanical latch).
   - Animation: Plank smoothly tilts from $-15^\circ$ to $+15^\circ$.
   - Player movement: The knight traverses across the tilting plank over the wall band to Side B.
   - On reaching Side B, the knight steps onto corridor B with forward momentum.
3. **State 1 (`tilt = +1`: Tilted to Side B)**:
   - **Side A** is now raised in the air ($y \approx 0.7$).
   - **Side B** is now resting at ground level ($y \approx 0$).
   - **Result**: The player at Side A can no longer re-enter from Side A. If the player is at Side B, Side B is now enterable and can tilt back to Side A (alternating reversible shortcut).

---

## 3. Design Decisions & Presentation Options (User Review Required)

### 3.1 Traversal Feel & Animation Style

#### Option 1 (Recommended): Interactive Tilting Plank Slide ("The Mechanical Teeter-Ramp")
- **How it works**: Stepping onto the low end initiates a brief, dynamic 0.45s slide. As the near end rises and the far end dips, the knight slides swiftly along the wooden plank across the wall band and lands into pinball momentum on the far corridor.
- **Visuals**: Realistic teetering plank pivot with iron brackets, dust puffs at contact points, and screen shake.
- **Pros**: Feels distinctly different from a jump pad. It genuinely feels like running across and riding a moving seesaw plank.

#### Option 2: Catapult Seesaw Vault ("The Teeter-Kicker")
- **How it works**: Stepping onto the low end causes the plank to slam down on the near side and fling/catapult the knight in a high parabolic hop arc (using `startRampHop`) over the wall. The plank then oscillates with damped spring physics and settles into the opposite tilted state.
- **Pros**: Reuses the proven `startRampHop` arc while adding the seesaw tilt state and one-way gating.

---

## 4. Proposed Changes Grouped by Component

### Component 1: Constants & State (`state.ts`, `constants/pinball.ts`)

#### [MODIFY] `ThreeJS/src/game/pinball-knight/constants/pinball.ts`
- Add constants:
  - `SEESAW_SPEED = 12` (momentum speed handed to player on exit)
  - `SEESAW_COOLDOWN = 1.2` (prevent instant re-triggering)
  - `SEESAW_TILT_ANGLE = 0.22` (~12.6 degrees tilt)
  - `SEESAW_TRAVERSE_DUR = 0.45` (seconds to cross the plank)
  - `SEESAWS_PER_FLOOR = 2` (default budget per floor)
  - `SEESAW_RADIUS = 0.65` (contact detection radius)

#### [MODIFY] `ThreeJS/src/game/pinball-knight/state.ts`
- Add `"seesaw"` to `PinballPartKind`.
- Extend `PinballPart` interface with:
  - `tilt?: number` (`-1` for Side A down, `+1` for Side B down)
  - `span?: number` (tile distance between Side A and Side B, e.g. 2 or 3)
  - `destI?: number`, `destJ?: number` (target landing tile coordinates)

---

### Component 2: Procedural Maze Placement (`maze/decorate.ts`)

#### [MODIFY] `ThreeJS/src/game/pinball-knight/maze/decorate.ts`
- Add `"seesaw"` to `PartSpotKind`.
- In `buildParts` / `decorateMaze`:
  - After `vaultRamps` placement, add a dedicated `seesaw` shortcut placement pass (`SEESAWS_PER_FLOOR = 2`).
  - Search for corridor tiles `(c.i, c.j)` with `crossableBand(g, c.i, c.j, di, dj)`.
  - Ensure minimum distance from existing parts (at least 3 tiles) and not overlapping jump pads.
  - Calculate `span = wallDistance + 1`.
  - Push spot with `kind: "seesaw"`, `dirI: di, dirJ: dj`, `tilt: -1`, `span`.
- Update `LAUNCH_KINDS` / `FORWARD_FLOW_KINDS` sets where applicable.

---

### Component 3: 3D Mesh Rendering & Animation (`render/pinball-parts.ts`)

#### [MODIFY] `ThreeJS/src/game/pinball-knight/render/pinball-parts.ts`
- Implement `buildSeeSaw(dirX: number, dirZ: number)`:
  - **Fulcrum Base**: Heavy triangular iron/timber fulcrum bracket mounted in the middle (`cylGeo`, `boxGeo`, `C_STEEL_DK`).
  - **Pivoting Plank Group**:
    - Weathered oak timber deck (`boxGeo(span * 1.0, 0.08, 0.54)`) with iron side rails and riveted steel end-caps.
    - Embedded arcane runes (`C_ARCANE` / `C_GOLD`) pulsing with subtle glow.
    - Pivot origin centered on the fulcrum axle.
    - Initial `plank.rotation.z = -SEESAW_TILT_ANGLE` (Side A resting on floor, Side B elevated).
- Implement `animateSeeSaw(part, ctx)` in `PART_ANIMATORS`:
  - Animates the plank transition when triggered (`part.hitT` lerping `plank.rotation.z` from current tilt to target tilt with a slight elastic settling bounce).
  - Emissive pulse on runes during activation.
- Add `seesaw: 0.6` to `PART_HIT_LIFETIME`.
- Add `seesaw` to `PART_BUILDERS`.

---

### Component 4: Collision & Interaction Logic (`entities/pinball-collide.ts`, `entities/player.ts`)

#### [MODIFY] `ThreeJS/src/game/pinball-knight/entities/pinball-collide.ts`
- Implement `seesaw` handler in `PART_HANDLERS`:
  - Determine if the player is approaching **Side A** or **Side B**:
    - Side A world position: `(part.x, part.z)`
    - Side B world position: `(part.x + part.dirX * span, part.z + part.dirZ * span)`
  - Check entry validity against `part.tilt`:
    - If `distToA < SEESAW_RADIUS` and `part.tilt === -1` (Side A is down):
      - Allowed! Trigger transition from A to B:
      - Set `part.tilt = 1` (will settle with B down).
      - Trigger crossing animation/motion towards Side B.
    - If `distToB < SEESAW_RADIUS` and `part.tilt === 1` (Side B is down):
      - Allowed! Trigger transition from B to A:
      - Set `part.tilt = -1` (will settle with A down).
      - Trigger crossing animation/motion towards Side A.
    - If approaching from the HIGH end (e.g. Side B when `tilt === -1`):
      - Inaccessible! Plank is high in the air. Ignore or deflect.

---

### Component 5: Rust Engine Parity (`Rust/crates/pk-game/`)

#### [MODIFY] `Rust/crates/pk-game/src/pinball_parts.rs`
- Add `SeeSaw` to `PinballPartKind` enum.
- Add `SeeSaw` mesh/material description to `build_part_visuals`.

---

## 5. Verification Plan

### Automated Tests
1. **ThreeJS Collision Exhaustiveness Suite**:
   - `npm --prefix ThreeJS test -- pinball-collide.test.ts`
   - Assert `seesaw` is present in `ALL_KINDS` and handles both Side A and Side B entry correctly while rejecting high-end entry.
2. **ThreeJS Render Exhaustiveness Suite**:
   - `npm --prefix ThreeJS test -- pinball-parts.test.ts`
   - Assert `seesaw` has builder, animator, hit lifetime, and builds valid non-empty meshes.
3. **Maze Decoration Placement Suite**:
   - `npm --prefix ThreeJS test -- decorate.test.ts`
   - Assert seesaws are placed across wall bands with valid spans and reachable endpoints.
4. **Rust Cargo Test Suite**:
   - `cd Rust && cargo test --lib`
   - Ensure Rust compiles cleanly and all 400+ unit tests pass.

### Manual Verification
- Deploy container and verify:
  - Approach seesaw from the down side: plank tips, player crosses to the other side.
  - Return to the original side: plank is elevated, player cannot get on.
  - Approach from the new down side: plank tips back and returns the player.

---

## 6. Open Questions for the User

1. **Reversibility (Two-Way Alternating vs. One-Way Lock)**:
   - **Option A (Alternating Reversible - Recommended)**: Whichever side is down can be entered. Once crossed, it stays tilted down on the other side, so it can now be entered from that side to return (only one way is open at any given moment).
   - **Option B (One-Way Permanent Lock)**: Once the seesaw is used from the initial side, it permanently locks in the tilted position and can never be used again on that floor.
   - *Which behavior do you prefer?*

2. **Traversal Motion Feel**:
   - Do you prefer **Option 1 (Interactive Plank Slide/Ride)** where you smoothly ride along the tilting wood plank as it tips under you, or **Option 2 (Catapult Jump Arc)** where stepping on it slams the seesaw and flings you airborne high over the wall like the jumpers?
