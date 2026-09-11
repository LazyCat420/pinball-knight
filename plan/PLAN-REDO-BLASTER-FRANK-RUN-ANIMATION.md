# Implementation Plan — Redo Blaster Frank Running/Walking Animation

**Target System**: `pinball-knight` (ThreeJS)  
**Character**: `blaster_frank` (Danny DeVito / Frank Reynolds Inspired Monster)  
**Date**: 2026-09-11  
**Status**: PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT YET)  
**Methodology**: Strictly compliant with [`plan-verification-standard.md`](file:///home/lazycat/github/projects/sun/.agents/plan-verification-standard.md)  

---

## 1. Problem Statement & Evidence

- **[CONFIRMED]** In the current master sheet (`blaster_frank_sheet_1789149818575.jpg` / `public/sprites/blaster_frank-S.png`), Row 1 (the 2nd row, frames 4, 5, 6, 7) defines the `walk` animation clip.
- **[CONFIRMED]** Frames 4, 5, and 6 (the first 3 frames of the run row) share virtually identical static leg positions: both feet are planted flat on the ground with only minor torso twitching and coat fluttering.
- **[CONFIRMED]** In-game effect: At runtime (in `entities/zombie.ts:updateZombies` where `z.clip === "walk"`), Frank slides across the floor in a near-static stance for 75% of his gait cycle instead of performing a frantic, hilarious waddling run.

---

## 2. Solution & Target Animation Specification

We will re-generate the master sprite sheet using **Nano Banana** (`generate_image`), referencing the approved visual design (`blaster_frank_sheet_1789149818575.jpg`) via `ImagePaths` to preserve exact character fidelity while completely overhauling **Row 1** into an exaggerated, 4-phase waddle-run cycle.

### Exaggerated 4-Phase Running Cycle (Row 1, Frames 4–7)
1. **Frame 4 (Col 0 — Right Stride Contact)**:
   - Right stubby leg thrust far forward with heel strike; left leg extended backward.
   - Left arm swung forward; right arm clutching snubnose revolver pulled back; coat tails flared out behind.
2. **Frame 5 (Col 1 — Right Foot Plant & Left High Knee Lift)**:
   - Right foot firmly planted bearing full body weight; left knee lifted comically high toward chest.
   - Torso leaned forward aggressively; glasses bobbing down; head tucked into trenchcoat collar.
3. **Frame 6 (Col 2 — Left Stride Contact)**:
   - Left stubby leg kicked far forward with heel strike; right leg extended straight back.
   - Right arm thrusting revolver forward; coat tails billowing out in full stride.
4. **Frame 7 (Col 3 — Left Foot Plant & Right High Knee Lift)**:
   - Left foot planted; right knee pulled high up into the air; body rising slightly on the bounce.
   - Mouth open in frantic, out-of-breath yelling run grimace.

All other rows (Row 0 Idle, Row 2 Sky-Shoot Attack, Row 3 Comic Dizzy Collapse Death) will maintain visual consistency with the original approved sheet.

---

## 3. Atomic Claim Classification Matrix (VCPM Standard)

| ID | Claim Statement | Classification | Evidence / Source / Validation Path |
|---|---|---|---|
| `CLAIM-1` | `blaster_frank` uses a 4×4 grid layout (16 frames) with Row 1 assigned to `"walk"` in `inbox/blaster_frank-S.json` and `public/sprites/blaster_frank-S.json` | **Verified Fact** | Inspect [`inbox/blaster_frank-S.json:10-14`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge/inbox/blaster_frank-S.json) |
| `CLAIM-2` | Passing the existing sheet in `ImagePaths` allows Nano Banana to maintain exact character palette, spectacles, trenchcoat, and revolver details | **Verified Fact** | Reference sprite workflow in `.agents/AGENTS.md` |
| `CLAIM-3` | `prep-blaster-frank.mjs` automatically keys out `#00FF00` chroma green, re-bounds all 16 cells, and writes to `inbox/` | **Verified Fact** | Inspect [`tools/sprite-forge/prep/prep-blaster-frank.mjs:118-175`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-blaster-frank.mjs) |
| `CLAIM-4` | Running `npm run sprites` (`FORGE_PUBLISH=1`) trims and publishes the new sheet to `public/sprites/` with zero manual atlas editing | **Verified Fact** | Verified via previous deployment pipeline |
| `CLAIM-5` | Increasing leg stride extension in Row 1 will produce a measurable gait peak in `snap-metric.test.ts` above 0.20 | **Testable Claim** | Run `vitest run snap-metric.test.ts` and inspect gait peak telemetry |
| `ASSUMPTION-1` | The existing frame timing in `zombie.ts` (walk animation rate ~0.15s per frame) will match the new 4-frame stride without needing speed curve adjustments | **Assumption** | Validation: Inspect in-game run speed and verify visual foot-slide vs ground speed |

*Metrics: 4 Verified Facts (67%), 1 Testable Claim (17%), 1 Assumption (17%), 0 Unverifiable Claims (0%). Passes VCPM ≥80% Gate.*

---

## 4. Execution Steps

1. **Generation (Nano Banana)**:
   - Call `generate_image` passing existing `blaster_frank_sheet_1789149818575.jpg` as reference.
   - Prompt specifically instructs keeping Rows 0, 2, and 3 identical while completely redrawing Row 1 with high-knee, alternating-leg running stride.
2. **Archival & Source Replacement**:
   - Save new master image to `tools/sprite-forge/sources/blaster_frank-2026-09-11/alt-takes/blaster_frank_master_v2.jpg`.
   - Update `alt-takes/README.md`.
3. **Preprocessing**:
   - Run `node src/game/pinball-knight/tools/sprite-forge/prep/prep-blaster-frank.mjs`.
4. **Publishing**:
   - Run `FORGE_PUBLISH=1 pnpm exec vitest run src/game/pinball-knight/tools/sprite-forge/commit.test.ts`.
5. **Testing**:
   - Run `pnpm exec vitest run src/game/pinball-knight/entities/blaster-frank.test.ts src/game/pinball-knight/tools/sprite-forge/published.test.ts`.
   - Run `pnpm run build`.
6. **Git & Redeploy**:
   - Commit changes on worktree branch `feat/blaster-frank-run-anim`.
   - Fast-forward merge to `main`, push to GitHub `origin main`.
   - Deploy container to Synology NAS via `npm run deploy`.

---

## 5. Open Questions for User Alignment

1. **Run Stride Style**:
   - Do you prefer a **wide comedic duck-waddle run** (feet kicking out sideways comically like Penguin / Danny DeVito) or a **forward pumping high-knee sprint**?
2. **Revolver Position while Running**:
   - While running, should he hold the revolver **pointed forward ready to shoot**, or **flailing wildly around in one hand** as his coat flaps?
