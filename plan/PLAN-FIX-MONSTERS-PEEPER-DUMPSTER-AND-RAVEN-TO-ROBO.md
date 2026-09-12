# PLAN — Fix Peeper, Dumpster & Sprite-Forge 12 Monsters (Raven to Robo)

## Context & Objectives
1. Fix `pit_peeper`:
   - Chroma magenta pixels in death frame.
   - White noisy pixel quantization on the orange belly.
2. Fix `dumpster_dan`:
   - 331 enclosed magenta pixels between baseball cap and hotdog club.
3. Generate and Ingest 12 Missing Monsters via Nano Banana (`generate_image` + `prep` + `npm run sprites`):
   - **4 Birds**: `corvid_bomber` (Raven), `vulture_scavenger` (Vulture), `gull_bomber` (Gull), `sky_falcon` (Falcon).
   - **4 Slimes**: `magma_slime` (Magma), `toxic_slime` (Acid), `frost_slime` (Frost), `void_slime` (Void).
   - **4 Cops**: `riot_cop` (Riot), `highway_patrol` (Patrol), `detective_cop` (Noir), `robo_cop` (Robo).
4. Register in `IMPORTED_ART` in `boot/sheets.ts` and `boot/manifest-inventory.ts`.
5. Verify with automated tests (0 chroma artifacts, non-collapsed UVs, correct loading).
6. Redeploy container to NAS.
