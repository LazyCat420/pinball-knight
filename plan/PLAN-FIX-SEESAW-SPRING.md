# Fix & Implementation Plan: Spring-Loaded Seesaw Alignment & Grounded Launch

**Date**: 2026-09-10  
**Target Project**: `pinball-knight` (`ThreeJS/`)  
**Workflows Applied**: `/fix`, `/plan`  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT)

---

## 1. Problem Statement
The seesaw shortcut machine (`seesaw`) in `pinball-knight` is inverted between its 3D visual rendering and collision detection:
- The side resting on the ground cannot be entered to launch across the wall.
- The player can only trigger a launch if they jump onto the high end that is sticking up into the air.
- The user also requested adding a physical **spring** to one side so entering from the grounded side compresses/triggers the spring and flings the knight across.

---

## 2. Expected vs. Actual Behavior

| Dimension | Expected Behavior | Actual Behavior |
| :--- | :--- | :--- |
| **Grounded End Collision** | Stepping onto the low end resting on the dungeon floor triggers the launch. | Stepping onto the low end does nothing; collision returns without action. |
| **Elevated End Collision** | The elevated end sticking in the air is unreachable / blocked. | Jumping onto the elevated end triggers the hop across the wall. |
| **Mechanical Model** | The seesaw features a visible spring mechanism under the launch/elevated side that compresses upon entry and propels the player. | Pure wooden plank on fulcrum without visible spring; rotation direction is inverted. |
| **Audio Feedback** | Launch plays a spring twang / mechanical launch audio (`sfxSpring`). | Currently plays only `sfxSpin()`. |

---

## 3. Missing Information & Clarification Needed
1. **Spring Mechanics Behavior (One-Way vs. Reversible)**:
   - *Option A (One-Way Spring Reset)*: The spring is mounted under Side B (the far side). It holds Side A down on the ground as the default entry. When you enter Side A, the seesaw compresses the spring, flings you across to Side B, and after a brief cooldown, the spring pushes the seesaw back to resting position (Side A down).
   - *Option B (Bi-Directional Seesaw with Dual Springs / Dynamic Spring)*: The seesaw stays tilted until used from the other side, but features a spring under each end (or a center compression coil) that compresses on entry.
   - *Option C (Catapult-Style Spring Platform on Entry)*: A visible compression spring coil sits directly on the entry end (or under it), which the knight steps on to trigger the launch.
2. **Launch Arc & Speed**:
   - Should the spring launch feel punchier (e.g. increase launch speed from `SEESAW_SPEED = 14` to `SPRING_SPEED = 16` with vertical spring arc)?

---

## 4. System Model and Invariants

```
             [Side A: Entry]            [Fulcrum]             [Side B: Exit]
                Corridor A              Wall Band               Corridor B
                 ════════                ▓▓▓▓▓▓▓                 ════════
                  ░░░░░                 ┌───────┐                 ░░░░░
                    \                   │   ▲   │                   |
                     \                  └───┼───┘              [SPRING COIL]
                      \═════════════════════╪══════════════════════/|
                    [GROUNDED: Entry]                         [ELEVATED: Exit]
```

### Top 3 Invariants That Must Hold:
1. **Visual & Collision Parity Invariant**:
   If side $X$ is visually touching the ground ($Y_{\text{tip}} \approx 0$), then physical collision MUST accept entry at side $X$. If side $X$ is elevated in the air ($Y_{\text{tip}} > 0.4$), physical collision MUST reject entry at side $X$.
2. **Coordinate & Rotation Sign Invariant**:
   In Three.js standard coordinates:
   - Plank local origin is at fulcrum $(span/2, fulcrumY, 0)$.
   - Side A tip is at local $x = -plankLen/2$.
   - Side B tip is at local $x = +plankLen/2$.
   - When $\theta > 0$, Side A rotates DOWN ($y < fulcrumY$), Side B rotates UP ($y > fulcrumY$).
   - When $\theta < 0$, Side A rotates UP, Side B rotates DOWN.
3. **One-Way Traversal & Safety Invariant**:
   A player hopping across must land safely on walkable floor `(destI, destJ)` without clipping into the wall band, and the machine must have cooldown protection against infinite trigger loops.

---

## 5. Ranked Hypotheses for the Root Cause

### Hypothesis 1 (Rank 1 - CONFIRMED BY CODE & MATH): Sign Inversion in 3D Mesh Rotation
- **Why it fits**:
  In `ThreeJS/src/game/pinball-knight/render/pinball-parts.ts`:
  - Line 498: `plankPivot.rotation.z = -SEESAW_TILT_ANGLE;`
  - Line 1962: `const targetTilt = (part.tilt ?? -1) * SEESAW_TILT_ANGLE;`
  When `part.tilt === -1`, `targetTilt = -0.22`.
  Because Side A is at negative local $X$ relative to the fulcrum, rotating by a negative angle about $+Z$ lifts Side A UP ($y > 0.32$) and pushes Side B DOWN ($y \approx 0$).
  However, in `pinball-collide.ts` line 1146:
  `if (currentTilt === -1) { const dxA = p.x - part.x; if (dxA * dxA + dzA * dzA > r2) return; }`
  The collider tests proximity to Side A (`part.x, part.z`).
  Therefore, the collider requires the player to be at Side A (which is visually sticking up in the air!), while ignoring Side B (which is resting on the ground).
- **Falsification check**: Invert `targetTilt` sign to `-(part.tilt) * SEESAW_TILT_ANGLE` or redefine `tilt` angle orientation, and observe if the grounded end becomes the active entry end.

### Hypothesis 2 (Rank 2): Fulcrum Origin Offset Mismatch
- **Why it fits**: The group yaw `yawFor(dirX, dirZ)` rotates $+X$ to $(dirX, dirZ)$. If the fulcrum position `span / 2` was misaligned with the wall band, the plank would enter the wall at an asymmetrical angle.
- **Evidence review**: The fulcrum is correctly placed at `span / 2`, but the rotational sign was mapped to clockwise instead of counter-clockwise relative to the camera isometric view.

---

## 6. Root Cause Synthesis

In `ThreeJS/src/game/pinball-knight/render/pinball-parts.ts`:
```ts
// BUG: -SEESAW_TILT_ANGLE rotates local -X (Side A) UP into the air!
plankPivot.rotation.z = -SEESAW_TILT_ANGLE;
const targetTilt = (part.tilt ?? -1) * SEESAW_TILT_ANGLE;
```
Because the author wrote `// Default tilt: Side A down (-SEESAW_TILT_ANGLE)`, they assumed negative rotation meant down. In Three.js right-handed coordinates:
$$\Delta y_A = (-x_A) \cdot \sin(\theta) = (-L/2) \cdot \sin(-0.22) = +0.11 \cdot L > 0 \quad (\text{ELEVATED!})$$
$$\Delta y_B = (+x_B) \cdot \sin(\theta) = (+L/2) \cdot \sin(-0.22) = -0.11 \cdot L < 0 \quad (\text{GROUNDED!})$$

The visual representation had Side B grounded and Side A elevated, while `pinball-collide.ts` checked Side A when `tilt === -1`.

---

## 7. Minimal Fix & Spring Mechanism Architecture

### Part A: Fix Visual / Collision Inversion
In `render/pinball-parts.ts`:
Change the rotation formula so that `tilt = -1` (Side A down) tilts Side A DOWN to the floor:
```ts
// When tilt === -1 (Side A down), targetTilt must be +SEESAW_TILT_ANGLE so local -X dips down
const targetTilt = -(part.tilt ?? -1) * SEESAW_TILT_ANGLE;
```
Or in `buildSeeSaw`:
```ts
// Default tilt: Side A down (+SEESAW_TILT_ANGLE)
plankPivot.rotation.z = SEESAW_TILT_ANGLE;
```

### Part B: Add Spring Mesh & Dynamics
In `buildSeeSaw`:
Add a heavy-duty steel spring assembly under the elevated launch side:
1. **3D Spring Geometry**:
   - Steel base collar plate on the floor anchor (`std(C_STEEL_DK)`).
   - Coiled spring loops using `torusGeo(0.14, 0.03, 6, 12)` stacked vertically.
   - Heavy contact bumper pad (`std(C_GOLD, C_ARCANE, 0.3)`) directly underneath the elevated end of the timber plank.
2. **Spring Animation**:
   - In `PART_ANIMATORS.seesaw`:
     When the seesaw tilts, the spring group scales along Y (`springMesh.scale.y`) to compress and recoil dynamically when triggered.
3. **Sound & VFX**:
   - When triggered, call `sfxSpring()` for the classic pinball spring recoil sound.
   - Emit spring spark particles `state.vfx?.sparks(...)` and dust puffs `state.vfx?.dust(...)`.

---

## 8. Multiple Approaches for User Consideration

### Approach 1 (Recommended): The Spring-Loaded Launch Seesaw
- **Look & Feel**: A visible coiled steel spring is mounted under the far side (or under both sides if bi-directional).
- **Mechanics**: Stepping on the grounded end pushes the lever down, which compresses the heavy spring on the far side; the spring recoils and catapults the player in an energetic hop arc across the wall band with `sfxSpring()`.
- **Direction**: Remains bi-directional (flips states so it can be traversed back from the other side), with the spring compressing and flexing on each launch.

### Approach 2: One-Way Spring Return Seesaw
- **Look & Feel**: A coiled return spring is mounted under Side B.
- **Mechanics**: Side A is ALWAYS grounded. Stepping on Side A compresses the spring, flings the player to Side B, and the spring immediately pops the seesaw back to resting position (Side A down). Side B cannot be used to go backward (strictly a one-way shortcut).

---

## 9. Verification & Test Plan

### Automated Regression Tests
1. **Mathematical Orientation Test** (`ThreeJS/src/game/pinball-knight/render/pinball-parts.test.ts`):
   - Measure world Y of Side A tip vs Side B tip when `tilt = -1`.
   - Assert: $Y_{\text{tipA}} < Y_{\text{tipB}}$ (Side A is lower than Side B).
   - Assert: $Y_{\text{tipA}} \le 0.08$ (touching or near ground level).
   - Assert: $Y_{\text{tipB}} \ge 0.50$ (elevated in the air).
2. **Collision Trigger Test** (`ThreeJS/src/game/pinball-knight/entities/pinball-collide.test.ts`):
   - Position player at Side A when `tilt = -1` $\implies$ triggers `startSeesawHop` and `sfxSpring`.
   - Position player at Side B when `tilt = -1` $\implies$ blocks entry (no hop).
   - Position player at Side B when `tilt = 1` $\implies$ triggers `startSeesawHop` and `sfxSpring`.
   - Position player at Side A when `tilt = 1` $\implies$ blocks entry (no hop).
3. **Spring Presence & Animation Test**:
   - Assert seesaw mesh has a `spring` child object with expected geometry and material.
   - Assert `spring` animates during trigger hit window.

---

## 10. Open Questions for the User
1. **Spring Behavior**: Do you prefer **Approach 1** (seesaw flips and can be used both ways, with spring action on launch) or **Approach 2** (one-way shortcut with spring reset)?
2. **Spring Placement**: Do you prefer the spring coil mounted **under the elevated end** (acts as a rebound/pusher spring) or **directly on the plank** as a launch plate?
3. **Audio**: Confirm using `sfxSpring()` (the spring launch twang) for seesaw activations.
