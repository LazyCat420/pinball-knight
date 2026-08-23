/**
 * Named depth BIOMES — descending should feel like passing through distinct
 * places, not the same maze re-tinted. Each biome carries a name + a one-line
 * flavour (shown on descent) and its own colour grade. They cycle every 4
 * floors, getting a fresh "chapter" feel as you go deeper.
 *
 * Extracted verbatim from core.ts. `BiomeTint` in boot/lighting.ts is the
 * structural subset the light rig needs; `Biome` adds the two strings the
 * descent card shows.
 */
import { themeIndexFor } from "../maze/prefabs";

export interface Biome {
  name: string;
  flavour: string;
  amb: number;
  sky: number;
  ground: number;
}

export const BIOMES: Biome[] = [
  { name: "The Cold Crypt", flavour: "damp stone · the dead stir", amb: 0x6b7d99, sky: 0x8fa3bd, ground: 0x1e2430 },
  { name: "The Rotting Warren", flavour: "moss and marrow · things breed here", amb: 0x6d8a78, sky: 0x8fbda6, ground: 0x1e2a22 },
  { name: "The Bloodworks", flavour: "the walls weep red · tread carefully", amb: 0x8a6f74, sky: 0xbd949a, ground: 0x2a1e20 },
  { name: "The Arcane Deep", flavour: "cold light · something old is awake", amb: 0x6f74a0, sky: 0x97a0e0, ground: 0x1e2233 },
];

/**
 * The biome for a given depth. Indexed through `themeIndexFor` — NOT a plain
 * modulo — because BIOMES and THEMES are paired one-to-one by index, so a
 * floor's colour grade matches the furniture pool it was dealt. The per-run
 * shuffle lives in that one function; both sides must read it or they drift.
 *
 * Takes `runSeed` rather than reading `state` so the pairing stays a pure
 * function of its two inputs — which is what makes it testable and what keeps
 * this module off the game's state singleton.
 */
export function biomeFor(level: number, runSeed: number): Biome {
  return BIOMES[themeIndexFor(level, runSeed)];
}
