# Nano Banana Monster Sprite Generation & Sprite-Forge Pipeline

**Status: `SHIPPED` (2026-08-10)** · Produces: 16-bit SNES pixel art monster sprite sheets & published game manifests.

> **Summary**: All monsters that previously relied on procedural canvas-2D painters (`spider`, `goblin`, `slime`, `reaper`, etc.) are being converted to 16-bit SNES-era pixel art sprite sheets generated via Nano Banana AI image generation, processed through `sprite-forge` keying & slicing, validated via `npm run sprites` vitest contract suite, and registered in `IMPORTED_ART`.

---

## 1. Generation Pipeline & Rules

Every monster sprite sheet generation follows six strict pipeline constraints:

1. **Preamble Prompting**:
   - 16-bit SNES-era pixel art sprite strip for a dungeon crawler.
   - Hard-edged pixel fills with 1-pixel dark selout outline around silhouette.
   - Flat `#FF00FF` (magenta) chroma background edge-to-edge.
   - NO ground planes, NO shadows, NO text banners, NO palette swatches.

2. **Grid & Clip Structure**:
   - Neat 4×4 grid layout (4 animation rows: `idle`, `walk`, `attack`, `death`, with 4 frames per row).

3. **Directory Organization**:
   - Primary generated source sheet saved to `legacy/src/game/pinball-knight/tools/sprite-forge/sources/<monster>-2026-08-10/<monster>-S.png`.
   - Backup/alt-takes stored in `alt-takes/` with updated `alt-takes/README.md`.

---

## 2. Ingestion & In-box Processing

1. **Inbox Sidecars**:
   - Saved to `legacy/src/game/pinball-knight/tools/sprite-forge/inbox/<monster>-S.json`.
   - Drop the `"cells"` key so the `sprite-forge` slicer finds ink-tight bounds automatically:
     ```json
     {
       "rows": ["idle", "walk", "attack", "death"],
       "matte": { "bg": [255, 0, 255], "tolerance": 90 }
     }
     ```

2. **Contract & Centering Validation**:
   - Run `npm run sprites` (`FORGE_PUBLISH=1 vitest run src/game/pinball-knight/tools/sprite-forge`).
   - Asserts 0px grounding spread, sweep tolerances (< 0.25), and palette lock.

3. **Engine Registration**:
   - Register monster sheet key in `IMPORTED_ART` within `legacy/src/game/pinball-knight/boot/sheets.ts`.

---

## 3. Shipped Monster Roster

| Monster | Source PNG | Published Sheet | Published Manifest | Status |
|---|---|---|---|---|
| **spider** | `sources/spider-2026-08-10/spider-S.png` | `public/sprites/spider-S.png` | `public/sprites/spider-S.json` | ✅ Shipped |
| **goblin** | `sources/goblin-2026-08-10/goblin-S.png` | `public/sprites/goblin-S.png` | `public/sprites/goblin-S.json` | ✅ Shipped |
| **slime** | `sources/slime-2026-08-10/slime-S.png` | `public/sprites/slime-S.png` | `public/sprites/slime-S.json` | ✅ Shipped |
| **reaper** | `sources/reaper-2026-08-10/reaper-S.png` | `public/sprites/reaper-S.png` | `public/sprites/reaper-S.json` | ✅ Shipped |
