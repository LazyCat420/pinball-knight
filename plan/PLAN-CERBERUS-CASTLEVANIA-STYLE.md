# PLAN: Cerberus Boss Sprite Sheet Restyle (Medieval Castlevania Aesthetic)

## 1. Objective & Design Vision

Redo the sprite sheet for the **Cerberus** boss in `pinball-knight` to match a dark, gritty **medieval Castlevania** (e.g. *Symphony of the Night* / *Rondo of Blood* / *Order of Ecclesia*) gothic pixel art boss aesthetic.

### Castlevania Visual Identity & Hallmarks
- **Gothic Demonic Canine Anatomy**: Sinewy demonic musculature, visible ribcage ridges, dark bristled slate/obsidian/midnight-blue fur with razor-sharp specular highlights.
- **Three Menacing Heads**: Skeletal/elongated canine skulls, sunken eye sockets with piercing crimson/amber glowing embers, snarling muzzles with dripping steel-sharp fangs.
- **Gothic Medieval Detailing**: Heavy rusted iron torture collars, broken iron chains dangling from the necks, cursed runic brandings on the shoulders/flanks.
- **High-Contrast Dark Gothic Palette**:
  - Primary body: Dark obsidian, slate charcoal, midnight indigo (`#12131a`, `#1e2029`, `#2e3440`).
  - Accents & Highlights: Rusted medieval iron and weathered steel chains (`#4c566a`, `#88c0d0`, `#d8dee9`).
  - Embers & Gore: Blood crimson, glowing volcanic ruby (`#8b0000`, `#bf616a`, `#ff4500`).
  - Fangs: Aged bone white / steel teeth (`#eceff4`, `#e5e9f0`).

---

## 2. Sprite Sheet Grid & Animation Architecture

The sprite sheet must strictly adhere to the Sprite-Forge specification:
- **Grid Layout**: 4 columns × 4 rows (16 frames, 1024×1024 total, 256×256 per cell).
- **Background**: Perfectly flat, uniform `#FF00FF` magenta chroma field edge-to-edge (no ground shadows, no dividing grid lines, no text banners).
- **Animation Rows**:
  1. **Row 0: `idle` (4 frames)**
     - Menacing quadruped gothic stance facing South.
     - Independent shifting/breathing of the three heads; glowing eyes burning in the dark; hanging iron chains swaying subtly.
  2. **Row 1: `walk` (4 frames)**
     - Heavy predatory stalk forward.
     - Sinewy muscles flexing, paws striking the stone, rhythmic gait cycle.
  3. **Row 2: `attack` (4 frames) — Signature Jaw Grab & Thrash**
     - Frame 0: Rearing back, center head gaping wide, iron chains rattling.
     - Frame 1: Center head snapping shut in a ferocious bite (capturing knight), side heads snarling.
     - Frame 2: Violent lateral thrashing left-to-right, side heads venting dark brimstone flames/embers.
     - Frame 3: Recovery snap/flinging pose with teeth bared.
  4. **Row 3: `death` (4 frames)**
     - Frame 0: Heads howling in agony toward the heavens.
     - Frame 1: Torso buckling, fissures erupting with cursed purple/red soul energy.
     - Frame 2: Crashing down onto forelimbs, dissolving into dark demonic ash.
     - Frame 3: Final gothic pile of charred bones, broken chains, and dissipating dark mist.

---

## 3. Implementation Workflow

### Step 1: Branch & Worktree Setup
- In accordance with repository rules, create a dedicated git worktree and branch:
  - Branch: `feat/cerberus-castlevania-style`
  - Worktree: `.worktrees/wt-cerberus-castlevania`

### Step 2: AI Sprite Generation with Nano Banana (`generate_image`)
- Craft an exact prompt specifying:
  - 16-bit / 32-bit Konami Castlevania Symphony of the Night style boss sprite sheet.
  - 4x4 grid of 16 animation frames, 256x256 each.
  - Uniform `#FF00FF` magenta flat background with zero drop shadows, zero grid lines, zero UI text.
  - Gothic three-headed hellhound with rusted iron collars, broken chains, glowing red eyes, and dark demonic anatomy.
- Review generated image and save raw take into `tools/sprite-forge/sources/cerberus-2026-09-07/alt-takes/`.

### Step 3: Sprite-Forge Processing (`prep-cerberus.mjs`)
- Update and run `prep-cerberus.mjs`:
  - Flood-fill chroma to clean `#FF00FF`.
  - Calculate ink-tight bounding rects per cell (`[minX, minY, maxX, maxY]`) to guarantee 0px ground spread across all 4 rows.
  - Export processed PNG to `sources/cerberus-2026-09-07/cerberus-S.png`.
  - Copy processed sheet and metadata to `inbox/cerberus-S.png` and `inbox/cerberus-S.json`.
  - Update `alt-takes/README.md`.

### Step 4: Sprite Commit & Verification
- Run `npm run sprites` to slice, mat, and publish to `public/sprites/cerberus-S.png` and `public/sprites/cerberus-S.json`.
- Run vitest suites:
  - `boss-cerberus.test.ts` (mechanics, struggle, fling)
  - `boss-roster.test.ts` (boss atlas assembly)
  - `tools/sprite-forge/published.test.ts` (hash and metadata verification)
  - `render/monsters/noise.test.ts` (confetti budget check across 72/84/120 rungs)
  - `boot/lazy-sheets.test.ts` (cold state loading)
- Build check: `pnpm run build` (verify Vite production bundle).

### Step 5: Distribution Sync & NAS Deployment
- Copy updated `public/sprites/cerberus-S.*` to `dist/pinball-knight-windows-x86_64/assets/sprites/`.
- Commit changes to `feat/cerberus-castlevania-style`, merge to `main`, and push to GitHub.
- Redeploy container to Synology NAS using `npm run deploy`.
- Verify HTTP endpoint `http://10.0.0.16:8789` and sprite asset delivery.
- Notify user of test readiness for both Windows executable and web container.

---

## 4. Verification Plan

| Layer | Check | Method |
| :--- | :--- | :--- |
| **Visual / Style** | Castlevania gothic horror aesthetic, rusted chains, glowing red eyes, demonic musculature | Visual inspection of generated master sheet |
| **Sprite-Forge Metrics** | 0px ground spread, centered sweep, valid sidecar hashes | `npm run sprites` & `published.test.ts` |
| **Engine Mechanics** | Jaw grab, thrash oscillation, button-spam struggle escape, fling timeout | `boss-cerberus.test.ts` |
| **Bundle & Packaging** | Vite production build compiles clean | `pnpm run build` |
| **Distribution** | Windows assets synchronized | Inspect `dist/pinball-knight-windows-x86_64/assets/sprites/` |
| **Deployment** | NAS container rebuild and restart | `npm run deploy` + `curl -I http://10.0.0.16:8789/sprites/cerberus-S.json` |
