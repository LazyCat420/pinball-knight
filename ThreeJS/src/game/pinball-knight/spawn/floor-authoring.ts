/** Live wrapper. Geometry and content are authored in maze/author-floor.ts. */
import { state } from "../state";
import { biomeFor as biomeForSeed, type Biome } from "../boot/biomes";
import { saveBestDepth } from "../best-depth";
import { tintLights } from "../boot/lighting";
import { coopSeed, setCoopFloor } from "../coop";
import { resetItemNid } from "../economy/ground-items";
import { resetPickupSweep } from "../economy/pickups";
import { setMazeBiome } from "../maze/build";
import { themeIndexFor } from "../maze/prefabs";
import { resetZombieNid } from "../spawn/factory";
import { authorMaze } from "../maze/author-floor";

export type AuthoredFloor = ReturnType<typeof authorMaze> & { biome: Biome };

/** Apply run bookkeeping and lighting, then invoke the shared floor author. */
export function authorFloor(level: number): AuthoredFloor {
  // ── Co-op: adopt the SHARED POOL SEED so every player generates the identical
  // floor/enemy/boss layout. Set before the maze RNG below. No-op solo/offline. ──
  const cs = coopSeed();
  if (cs !== null) state.runSeed = cs >>> 0;
  setCoopFloor(level); // pool presence now filters to this floor
  resetZombieNid(); // per-floor network ids — deterministic across the pool
  resetItemNid();
  resetPickupSweep(); // the knight is about to be teleported to the new spawn
  // Run-scoped, so it must be updated here rather than in the per-floor reset
  // below. `saveBestDepth` no-ops unless this genuinely beats the record.
  if (level > state.runDeepestFloor) state.runDeepestFloor = level;
  saveBestDepth(level);

  // Depth grading: each biome down shifts the fill palette a family over.
  const biome = biomeForSeed(level);
  tintLights(biome);
  // ...and the STONE changes family with it, not just the light on it. A grade
  // cannot move a quantized palette entry onto a different one, so the masonry
  // painters remap their own three stone tones per biome (maze/build.ts
  // BIOME_STONE). Must run before buildMaze — the textures bake it in.
  setMazeBiome(themeIndexFor(level));

  const bonusRoom = state.bonusRoomNext;
  state.bonusRoomNext = false;
  const authored = authorMaze({ level, runSeed: state.runSeed, bonusRoom });
  state.doorways = authored.doorways;
  return { ...authored, biome };
}
