# PLAN: Aggressive Floor Scaling from Level 1 to Level 10

**Date:** 2026-09-16  
**Status:** Proposal / Brainstorming Plan (Pending User Review & Confirmation)  
**Author:** Antigravity / LazyCat420  
**Target Repository:** `pinball-knight` (LazyCat420)  

---

## 1. Context & Diagnosis

### 1.1 The User's Question & Observations
The user noted:
```markdown
| Depth band | Macro cells | Render/grid tiles | Change                                 |
| ---------- | ----------- | ----------------- | -------------------------------------- |
| Level 1    | 37×26       | 75×53             | Compact onboarding floor               |
| Level 20   | 90×64       | 181×129           | Near old baseline ceiling              |
| Level 25   | 114×86      | 229×173           | Larger than the former 193×145 maximum |
| Level 30   | 192×144     | 385×289           | 4× area tier                           |
| Level 34+  | 304×228     | 609×457           | Final 10× area tier                    |
```
> *"is this the sizes? can we make it so level one is larger, and we ramp up to 10 so 10 is already pretty big instead of ramping up to 34"*

### 1.2 Evidence & Root Cause
1. **Yes, that table represents the legacy progressive scaling model**:
   - Level 1 was clamped to $37 \times 26$ cells ($75 \times 53$ tiles, only ~850 walkable tiles).
   - Level 10 only grew to $62 \times 44$ cells ($125 \times 89$ tiles, ~2,400 walkable tiles).
   - It stayed under the old baseline maximum ($96 \times 72$ cells / $193 \times 145$ tiles) until Level 25+.
   - It did not reach the 4× tier until Level 30 and the 10× tier until Level 34+.
2. **Code Wiring Issue**:
   - In [`ThreeJS/src/game/pinball-knight/spawn/floor-authoring.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/spawn/floor-authoring.ts#L44), `authorFloor` passes `progressive: true`.
   - In [`ThreeJS/src/game/pinball-knight/maze/spec/floor-spec.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/maze/spec/floor-spec.ts#L200), `opts.progressive` was mistakenly passed as the `legacyProgressive` parameter to `calculateProgressiveCells`.
   - As a result, the live game runtime was actively falling back to the legacy formula, producing a cramped Level 1 and an undersized Level 10.

---

## 2. Proposed Sizing Options: Ramping Aggressively from L1 to L10

To make Level 1 larger and ramp up so **Level 10 is already pretty big**, we propose three options:

### Option A (Recommended): "Fast Escalation" — Level 10 reaches Phase 2 (4.0× Area)
Level 1 starts roomy and spacious; Level 5 already surpasses the old campaign maximum; Level 10 is a massive 4× area dungeon with 6–10 macro sectors.

| Level | Macro cells | Render/grid tiles | Area vs Baseline (96×72) | Gameplay & Sector Feel |
|---|---|---|---|---|
| **Level 1** | $64 \times 48$ | **$129 \times 97$** | **$0.44\times$** | Roomy tutorial floor; multiple distinct rooms, first rail/catapult launch pad. |
| **Level 3** | $84 \times 63$ | **$169 \times 127$** | **$0.77\times$** | Multi-corridor network with branching paths and wall shortcuts. |
| **Level 5** | $104 \times 78$ | **$209 \times 157$** | **$1.17\times$** | **Exceeds old campaign max ($193 \times 145$)**; multiple hubs and loop corridors. |
| **Level 7** | $140 \times 105$ | **$281 \times 211$** | **$2.13\times$** | Phase 1 milestone; 4+ sectors, cross-sector catapults and rails. |
| **Level 10** | $192 \times 144$ | **$385 \times 289$** | **$4.00\times$** | **Phase 2 Milestone: "Pretty Big"**. 6–10 sectors, mechanism gauntlet, epic traversal. |
| **Level 15** | $240 \times 180$ | **$481 \times 361$** | **$6.25\times$** | Vast labyrinth; sector streaming and chunked instancing active. |
| **Level 20+**| $304 \times 228$ | **$609 \times 457$** | **$10.00\times$** | **10× Ceiling**. Full multi-district abyss. |

---

### Option B: "Hyper Escalation" — Level 10 reaches 10× Area Ceiling Directly
A very steep curve where Level 10 is already the final 10× area world.

| Level | Macro cells | Render/grid tiles | Area vs Baseline | Gameplay Feel |
|---|---|---|---|---|
| **Level 1** | $72 \times 54$ | **$145 \times 109$** | $0.56\times$ | Large launch arena from the very first room. |
| **Level 3** | $110 \times 82$ | **$221 \times 165$** | $1.30\times$ | Already larger than old deep floors. |
| **Level 5** | $160 \times 120$ | **$321 \times 241$** | $2.78\times$ | Giant multi-hub floor. |
| **Level 7** | $220 \times 165$ | **$441 \times 331$** | $5.25\times$ | Halfway to 10×. |
| **Level 10+**| $304 \times 228$ | **$609 \times 457$** | **$10.00\times$** | **Maximum 10× area achieved at Level 10**. |

*Note: In Option B, Level 10 reaches the maximum physical scale possible. Players spend 15–20 minutes on floor 10 alone.*

---

### Option C: "Moderate Escalation" — Level 10 at 2.8× Area (~321×241 tiles)
A middle ground where Level 1 is comfortable, Level 10 is almost triple the old baseline ceiling, and Level 20 reaches 10×.

| Level | Macro cells | Render/grid tiles | Area vs Baseline | Gameplay Feel |
|---|---|---|---|---|
| **Level 1** | $56 \times 42$ | **$113 \times 85$** | $0.34\times$ | Moderate starting floor. |
| **Level 5** | $100 \times 75$ | **$201 \times 151$** | $1.09\times$ | Just past old baseline max. |
| **Level 10** | $160 \times 120$ | **$321 \times 241$** | **$2.78\times$** | Very substantial floor with 8+ sectors. |
| **Level 15** | $220 \times 165$ | **$441 \times 331$** | $5.25\times$ | Large expedition. |
| **Level 20+**| $304 \times 228$ | **$609 \times 457$** | **$10.00\times$** | 10× Ceiling. |

---

## 3. Technical Changes Required to Implement

1. **Fix `calculateProgressiveCells` in `floor-spec.ts`**:
   - Replace the legacy curve with the selected option (e.g. Option A).
   - Remove or deprecate `legacyProgressive` parameter so `authorFloor` never silently diverts to the old 37×26 table.
2. **Update Mission Templates for L1–L10**:
   - Level 1: `linear_descent` (introduces mechanics safely).
   - Level 2–4: `branching_hunt` / `locked_vault`.
   - Level 5: `boss_approach` (Mini-boss or milestone).
   - Level 10: `mechanism_gauntlet` (Massive floor dedicated to pinball traversal).
3. **Automated Verification**:
   - Update `canonical-floor-scaling.test.ts` to assert L1, L5, L10 dimensions match the chosen table.
   - Run seed corpus benchmark across 50+ seeds on L1–L10 to ensure 0 routing/connectivity failures.

---

## 4. Open Questions for User Approval

1. **Scale Curve Preference**:
   - Do you prefer **Option A** (Level 10 is 4× area, 385×289 tiles, reaching 10× at L20), **Option B** (Level 10 is the full 10× ceiling, 609×457 tiles), or **Option C** (Level 10 is 2.8× area, 321×241 tiles)?
2. **Level 1 Sizing**:
   - Does **$129 \times 97$ tiles** ($64 \times 48$ cells, about half the old deep-floor ceiling) feel right for Level 1, or should Level 1 be even larger?
3. **Mission Template at Level 10**:
   - Would you like Level 10 to feature the `mechanism_gauntlet` mission template with guaranteed interconnected catapult/rail hubs?
