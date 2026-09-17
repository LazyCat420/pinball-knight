# PLAN: Aggressive Progressive Floor Scaling & Level 10+ Scaling Rework

**Date:** 2026-09-16  
**Status:** Proposal / Plan Mode (Pending User Review & Confirmation)  
**Author:** Antigravity / LazyCat420  
**Target Repository:** `pinball-knight` (LazyCat420)  

---

## 1. Problem Diagnosis & Evidence

### 1.1 Observed Issue
The user is playing at **Level 10** and reported:
> *"make map larger im on lvl 10 its not large enough. it should have been ramping up since lvl 1"*

### 1.2 Root Cause Analysis in Code
In [`ThreeJS/src/game/pinball-knight/maze/spec/floor-spec.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/maze/spec/floor-spec.ts):
```typescript
  const l = Math.max(1, level);
  if (l <= 20) {
    // Normal campaign growth: smooth expansion
    const cellsW = 34 + Math.ceil(l * 2.8);
    const cellsH = 24 + 2 * l;
    return { cellsW, cellsH, tier: "baseline", mult: (cellsW * cellsH) / (37 * 26) };
  } else if (l <= 25) { ... }
```
Under this formula:
- **Level 1**: $37 \times 26$ cells $\rightarrow \mathbf{75 \times 53}$ tiles ($\sim 850$ walkable tiles).
- **Level 5**: $48 \times 34$ cells $\rightarrow \mathbf{97 \times 69}$ tiles ($\sim 1,400$ walkable tiles).
- **Level 10**: $62 \times 44$ cells $\rightarrow \mathbf{125 \times 89}$ tiles ($\sim 2,400$ walkable tiles).
- **Level 20**: $90 \times 64$ cells $\rightarrow \mathbf{181 \times 129}$ tiles ($\sim 3,000$ walkable tiles).

**Diagnosis**:
The previous scaling model kept all levels 1 through 20 below the old baseline ceiling of $96 \times 72$ cells ($193 \times 145$ tiles). As a result:
1. At **Level 10**, the map was only $125 \times 89$ tiles—less than half the size of the old deep-floor ceiling.
2. The larger milestones ($132 \times 100$, $192 \times 144$, and $304 \times 228$) did not even begin until Level 21+.
3. The player experienced a cramped, slow-growing maze through the entire first 10 levels instead of an expansive, escalating dungeon that demands strategic traversal mechanisms (catapults, cannons, rails, seesaws).

---

## 2. Claim Classification & Traceability Matrix

| ID | Claim Statement | Classification | Evidence / Verification Path |
|---|---|---|---|
| C-1 | At Level 10, current code produces $62 \times 44$ cells ($125 \times 89$ tiles, 11,125 total grid cells). | **CONFIRMED** | Evaluated via Node command in `floor-spec.ts`. |
| C-2 | The old baseline ceiling was $96 \times 72$ cells ($193 \times 145$ tiles, 27,985 total grid cells). | **CONFIRMED** | Documented in `constants/level.ts:levelConfig`. |
| C-3 | Level 10 is currently smaller than the old baseline ceiling by $\sim 60\%$. | **CONFIRMED** | $11,125 / 27,985 \approx 39.7\%$ of baseline max tiles. |
| C-4 | The player expects the ramp to start noticeably from Level 1, so Level 10 is substantially larger. | **CONFIRMED** | Direct user instruction. |
| C-5 | Expanding Level 10 to $\ge 140 \times 105$ cells requires $\ge 4 \times 4$ sector grids and precomputed landing pads. | **TESTABLE CLAIM** | Vitest sector traversal benchmark at scale $> 1.9\times$. |
| C-6 | Generation time for up to $304 \times 228$ cells remains under 2.0s on the Synology NAS. | **CONFIRMED** | Benchmark recorded 1.74s for 10× in `docs/sector-10x-scale-traversal.md`. |

---

## 3. Proposed Scaling Curve Options

We have three distinct ways to structure the ramp-up from Level 1 to 10 and beyond:

### Option 1 (Recommended): Rapid Exponential Ramp (Starts Big, Surpasses Baseline by L7, Reaches 10× by L20)
- **Concept**: A steep monotonic curve that makes the world expand rapidly right from Level 1.
  - **Level 1**: $50 \times 38$ cells $\rightarrow \mathbf{101 \times 77}$ tiles ($\sim 1,600$ walkable tiles, comfortable intro).
  - **Level 5**: $80 \times 60$ cells $\rightarrow \mathbf{161 \times 121}$ tiles ($\sim 3,500$ walkable tiles).
  - **Level 7**: $100 \times 75$ cells $\rightarrow \mathbf{201 \times 151}$ tiles (surpasses old $96 \times 72$ baseline).
  - **Level 10**: $140 \times 105$ cells $\rightarrow \mathbf{281 \times 211}$ tiles ($\sim 7,500$ walkable tiles, **$2.5\times$ area**, full multi-sector traversal).
  - **Level 15**: $210 \times 158$ cells $\rightarrow \mathbf{421 \times 317}$ tiles ($\sim 14,000$ walkable tiles, **$5.0\times$ area**).
  - **Level 20+**: $304 \times 228$ cells $\rightarrow \mathbf{609 \times 457}$ tiles ($\sim 30,000$ walkable tiles, **$10.0\times$ area ceiling**).
- **Pros**: Matches player expectation directly: Level 10 is already more than $2.5\times$ larger than the old maximum ceiling, with massive rooms, winding rails, catapult hops, and distinct exploration sectors.
- **Cons**: Players who prefer smaller tight mazes in mid-game may find L10 very large.

### Option 2: Aggressive Linear Ramp (Uniform Growth per Level)
- **Concept**: Linear step increase of $+14$ cells in width and $+10$ cells in height per level starting from Level 1 ($48 \times 36$) up to Level 20 ($304 \times 228$).
  - **Level 1**: $48 \times 36$ cells $\rightarrow \mathbf{97 \times 73}$ tiles.
  - **Level 5**: $102 \times 76$ cells $\rightarrow \mathbf{205 \times 153}$ tiles.
  - **Level 10**: $170 \times 128$ cells $\rightarrow \mathbf{341 \times 257}$ tiles ($\sim 10,000$ walkable tiles, **$3.5\times$ area**).
  - **Level 15**: $238 \times 178$ cells $\rightarrow \mathbf{477 \times 357}$ tiles ($\sim 19,000$ walkable tiles, **$6.5\times$ area**).
  - **Level 20**: $304 \times 228$ cells $\rightarrow \mathbf{609 \times 457}$ tiles (**$10.0\times$ area**).
- **Pros**: Perfectly uniform growth every single floor; each stair descent is visibly and measurably larger.
- **Cons**: Level 10 is already $3.5\times$ area; very fast escalation for casual play.

### Option 3: Immediate High-Tier Jump (Baseline Starts at Old Max)
- **Concept**: Level 1 begins at the old deep-floor ceiling ($96 \times 72$), and scales up to 10× at Level 10.
  - **Level 1**: $96 \times 72$ cells $\rightarrow \mathbf{193 \times 145}$ tiles ($1.0\times$).
  - **Level 5**: $192 \times 144$ cells $\rightarrow \mathbf{385 \times 289}$ tiles ($4.0\times$).
  - **Level 10**: $304 \times 228$ cells $\rightarrow \mathbf{609 \times 457}$ tiles ($10.0\times$).
- **Pros**: Maximum size immediately; Level 10 is the full 10× world.
- **Cons**: Level 1 is already very large; removes the sense of starting in a manageable tavern dungeon.

---

## 4. Work Items & Implementation Scope

### File 1: [`ThreeJS/src/game/pinball-knight/maze/spec/floor-spec.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/maze/spec/floor-spec.ts)
- Update `calculateProgressiveCells(level, ...)` with the chosen scaling curve (Option 1).
- Ensure continuous monotonic progression starting at Level 1 so Level 10 delivers $\sim 140 \times 105$ cells ($281 \times 211$ tiles) or higher.
- Maintain `baseCfg.floorTiles` reference so `areaRatio` calculation remains accurate for enemy & part densities.

### File 2: [`ThreeJS/src/game/pinball-knight/maze/spec/canonical-floor-scaling.test.ts`](file:///home/lazycat/github/projects/sun/pinball-knight/ThreeJS/src/game/pinball-knight/maze/spec/canonical-floor-scaling.test.ts)
- Update unit assertions to verify:
  - Level 1 is larger than previous tiny baseline ($> 75 \times 53$ tiles).
  - Level 10 is substantially scaled ($> 200 \times 150$ tiles, $\ge 2.0\times$ area).
  - Level 20 reaches $10\times$ ceiling ($304 \times 228$ cells / $609 \times 457$ tiles).
  - Monotonic growth: `area(L + 1) > area(L)` for all $1 \le L \le 20$.

---

## 5. Verification & Rollback Plan

### Automated Verification
1. `npm test` across all 422 test files in `pinball-knight/ThreeJS`.
2. Dedicated assertions in `canonical-floor-scaling.test.ts`, `author-floor.test.ts`, and `mega-floor.test.ts`.
3. Secret scanning check: `git diff --cached -i -G"password|secret|token|api_key|credential"`.

### Live Deployment & Validation
1. Merge to `main` and push to GitHub.
2. Deploy container to Synology NAS via `npm run deploy`.
3. Verify container is healthy (`sudo /usr/local/bin/docker ps`).
4. Verify HTTP 200 via `curl -I http://10.0.0.16:8789/`.
5. Test Level 10 live in browser: `window.__dungeonLevel(10)` and check `window.__dungeonStats()`.
