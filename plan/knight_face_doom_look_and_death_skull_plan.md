# Plan: Knight Pixel Face Doom Looking & Exposed Skull Death Art

**Date**: 2026-09-05  
**Target Projects**: `pinball-knight` (Both `ThreeJS/src/game/pinball-knight/hud-face.ts` and `Rust/crates/pk-gui/src/hud_face.rs`)  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT)

---

## 1. Executive Summary & Root Cause Analysis

### Problem 1: "Looking around doesn't look like Doom"
- **[Verified Fact - Code Evidence]**: In both `ThreeJS/src/game/pinball-knight/hud-face.ts` (lines 820–828) and `Rust/crates/pk-gui/src/hud_face.rs` (lines 661–668), `paintEyes()` computes eye offset using `ox = turn` and then draws the irises with `sym(ix, iy, 2, 2, C.iris)`.
- **[Verified Fact - Mathematical Proof of Eye Divergence / Cross-Eye Bug]**:
  - `sym(gx, gy, gw, gh)` draws at `gx` AND at `mir(gx, gw) = 36 - gx - gw`.
  - Left Eye is at `x = 11..15` (width 5).
  - Right Eye is at `mir(11, 5) = 36 - 11 - 5 = 20..24` (width 5).
  - When looking left (`turn = -1`, `ox = -1`):
    - Left Eye iris is placed at `ix = 12 + (-1) = 11` (far left / ear side).
    - Right Eye iris is mirrored to `36 - 11 - 2 = 23` (far right / ear side).
    - **Result**: The eyes diverge in opposite directions (wall-eyed / strabismus) instead of both tracking left!
  - When looking right (`turn = 1`, `ox = 1`):
    - Left Eye iris is placed at `ix = 12 + 1 = 13` (inward toward nose).
    - Right Eye iris is mirrored to `36 - 13 - 2 = 21` (inward toward nose).
    - **Result**: The eyes become completely cross-eyed!
- **[Verified Fact - Doom Mechanics]**: In original id Software DOOM (`STFST00`, `STFST01`, `STFST02`), Doomguy's eyes are **conjugated**:
  - Looking Left: Both pupils move to the left (Left eye: outer; Right eye: inner/nasal).
  - Looking Right: Both pupils move to the right (Left eye: inner/nasal; Right eye: outer).
  - Glint / Catchlight remains anchored to the top-left keylight on both pupils.

---

### Problem 2: "Clean up how he looks when dead so it's an exposed skull"
- **[Verified Fact - Code & Visual Evidence]**:
  - In `hud-face.ts` (lines 1243–1244) and `hud_face.rs` (lines 893–894), death literally calls `drawX(11, 14)` and `drawX(20, 14)`, stamping cartoon ink `X X` crosses over the sockets.
  - The far cheek has a small 4-pixel grey box (`C.bone`, `C.boneHi`) intended as teeth, but with no jaw arch, no orbital cavity, and no nasal cavity, it looks like an isolated metal bandage or dirt clump.
  - The face retains random blood speckles and a split mouth that clutters the portrait without creating a readable skull silhouette.
- **[Verified Fact - Test Constraint]**: `ThreeJS/src/game/pinball-knight/hud-face.test.ts` line 223 contains `it("keeps both x-eyes whole and on something they can be read against")` which explicitly asserts 20 ink cells for the `X`'s. This test was pinned to the old cartoon design and must be updated to assert the new exposed skull features.

---

## 2. Proposed Architectural & Visual Changes

### A. Conjugated Doom Looking-Around Eye Engine
1. **Decouple Left and Right Eye Rendering**:
   - Replace `sym()` for pupils/irises with explicit, coordinated coordinates for each eye:
     - Left Eye Box: `x = 11..15`, `y = 14..17`
     - Right Eye Box: `x = 20..24`, `y = 14..17`
   - **Gaze Coordinates**:
     - Center (`ox = 0`): Left iris at `x = 12..13`; Right iris at `x = 22..23`.
     - Glancing Left (`ox = -1`): Left iris at `x = 11..12`; Right iris at `x = 20..21` (both move -1 leftward toward the direction of view).
     - Glancing Right (`ox = +1`): Left iris at `x = 13..14`; Right iris at `x = 23..24` (both move +1 rightward toward the direction of view).
     - Vertical Look (`dy = -1 / +1`): Both irises track up/down smoothly within the socket.
2. **Doom-Style Eye Catchlights & Sclera**:
   - Upper-left keylight glint (`C.glint`, entry 18) placed at top-left of pupil regardless of gaze, giving intelligent life and sharpness.
   - Sclera (`C.white`, entry 22) visibility balanced realistically on the opposite side of gaze direction.
3. **Head Turn & Brow Dynamics**:
   - When glancing left (`turn = -1`), subtle 1px shift of the nose ridge and slight perspective narrowing on the far temple, matching Doom's 3-frame status bar turn feel.

---

### B. Exposed Skull Death Art ("The Pinball Knight Skull")
Clean up the dead face to replace the cartoon `X X` look with a genuine, grim medieval skull:
1. **Deep Skeletal Orbital Sockets (No 'X's)**:
   - Deep hollow sockets rendered in `C.ink` (entry 1) and `C.void` (entry 0), rimmed by the orbital bone ridge (`C.bone`, `C.boneHi`, entries 4 and 5).
   - Instant anatomical readability as a skull from across the room.
2. **Skeletal Nasal Cavity (Piriform Aperture)**:
   - Inverted triangular dark void (`C.ink` / `C.boneDeep`) at the center of the face replacing the fleshy nose.
3. **Exposed Dental Arch & Maxilla**:
   - Anatomically connected zygomatic arch and upper/lower jaw bone.
   - Distinct tooth notches in `C.boneHi` (entry 5) separated by dark interstitial gum lines (`C.ink`), creating the unmistakable grim skull grin.
4. **Shattered Helmet & Exposed Cranium**:
   - Smashed helmet plate (`C.steel`, `C.steelHi`) peeling back to expose the cracked parietal bone / cranium dome in ivory bone tones (`C.bone`, `C.boneHi`), accented with jagged fracture lines and a dark blood rim.
5. **Mortis Palette & Clean Geometry**:
   - Removal of all random 1px blood specks and sweat beads from the corpse.
   - Crisp, deliberate pixel clusters that do not blur or alias under nearest-neighbor 72px HUD blitting.

---

## 3. Options for Exposed Skull Presentation (User Review Required)

### Option 1 (Recommended): The "Half-Revenant" Skull (Asymmetrical Battle Fracture)
- **Concept**: The right side of the helmet and face is completely cleaved open by the fatal dungeon blow, exposing a pristine, terrifying anatomical skull (cranium dome, deep hollow eye socket, cracked cheekbone, and grinning exposed teeth), while the left side remains the bloodied, pale knight with closed dead lid and bruised cheek.
- **Pros**: Tells the dramatic story of the fatal blow, preserves the knight's identity while showing the exposed skull, maximum visual interest.

### Option 2: Full Skeletal Skull ("Crypt Death Mask")
- **Concept**: The entire face collapses into a full skeletal warrior skull inside the broken helm: both eye sockets are deep dark voids, dual-sided exposed teeth grin, and the central nasal cavity is fully skeletal.
- **Pros**: 100% skull purity, unmistakable classic gothic horror.

---

## 4. Verification Plan

### Automated Tests
1. **ThreeJS Vitest Suite**:
   - Command: `npm --prefix ThreeJS test -- hud-face.test.ts`
   - Update `hud-face.test.ts` to replace the deprecated `keeps both x-eyes whole` test with `shows exposed skull eye sockets and bone geometry at death`.
   - Ensure all 22 tests pass with 0 off-palette colors and correct 72px grid blits.
2. **Rust Cargo Test Suite**:
   - Command: `cd Rust && cargo test --test hud_face_sim`
   - Update `hud_face.rs` in `pk-gui` to maintain 100% parity with TypeScript, ensuring all Rust tests pass.
3. **Contact Sheet Generator Visual Check**:
   - Inspect `faceContactSheet()` output covering all 6 tiers and turn directions.

---

## 5. Follow-Up Questions for the User
1. **Skull Style**: Do you prefer **Option 1 (Half-Revenant Skull)** where one side of the face is peeled back to the exposed skull while the other side is the dead knight, or **Option 2 (Full Frontal Skull)** where the entire face is a skull?
2. **Eye Sockets in Death**: For the skull socket, do you want a complete dark hollow void (`C.ink`), or a tiny faint red soul ember/dot in the center of the dark socket?
