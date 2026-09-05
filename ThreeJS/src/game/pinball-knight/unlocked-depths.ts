/**
 * 🗺️ UNLOCKED DEPTHS PERSISTENCE & SELECTION
 *
 * Tracks the highest floor/maze depth unlocked by the player, allowing them to:
 * 1. Replay any previously cleared floor from the beginning (Floor 1, 2, 3...)
 * 2. Jump directly into specific depths or boss milestones from the Tavern
 * 3. Choose a starting depth after Game Over or when returning to the hub
 */
import { loadBestDepth } from "./best-depth";
import { loadResumeFloor } from "./corpse-run";
import { guardianFor } from "./boss-kinds";
import { biomeFor } from "./boot/biomes";
import { bandFloorFor, themeFor } from "./maze/prefabs";
import { BOSS_EVERY } from "./constants/enemies";

const UNLOCKED_KEY = "pinball-knight-unlocked-depth";

export interface DepthInfo {
  floor: number;
  name: string;
  /**
   * The floor's biome, as `maze/prefabs.ts` THEMES names it — the generator's
   * own word for it, not a second vocabulary. This used to be a hand-written
   * union ("web", "flesh") that named two biomes the generator calls "warren"
   * and "bloodworks", and a fifth ("magma") that did not exist at all.
   */
  biome: string;
  isBoss: boolean;
  bossName?: string;
  danger: "Safe" | "Standard" | "Challenging" | "Deadly" | "BOSS";
}

/**
 * Returns the highest depth unlocked by the player (at least 1).
 */
export function loadUnlockedDepth(): number {
  try {
    const raw = localStorage.getItem(UNLOCKED_KEY);
    const stored = raw ? Number.parseInt(raw, 10) : 0;
    const best = loadBestDepth();
    const resume = loadResumeFloor();
    const maxVal = Math.max(1, Number.isFinite(stored) ? stored : 1, best, resume);
    return maxVal;
  } catch {
    return 1;
  }
}

/**
 * Permanently unlock depth up to `floor`.
 * Returns true if a new depth was unlocked.
 */
export function saveUnlockedDepth(floor: number): boolean {
  if (!Number.isFinite(floor) || floor <= 0) return false;
  try {
    const current = loadUnlockedDepth();
    const target = Math.floor(floor);
    if (target <= current) return false;
    localStorage.setItem(UNLOCKED_KEY, String(target));
    return true;
  } catch {
    return false;
  }
}

/** Alias for saveUnlockedDepth */
export function unlockDepth(floor: number): boolean {
  return saveUnlockedDepth(floor);
}

/** Checks if a given floor is unlocked. */
export function isDepthUnlocked(floor: number): boolean {
  if (!Number.isFinite(floor) || floor < 1) return false;
  return floor <= loadUnlockedDepth();
}

/** Returns an array of all currently unlocked floor numbers: [1, 2, ..., N]. */
export function unlockedDepthList(): number[] {
  const max = loadUnlockedDepth();
  const list: number[] = [];
  for (let f = 1; f <= max; f++) {
    list.push(f);
  }
  return list;
}

/** Reset unlocked depth to 1 (for testing or full reset). */
export function clearUnlockedDepths(): void {
  try {
    localStorage.removeItem(UNLOCKED_KEY);
  } catch {
    /* nothing */
  }
}

/**
 * Returns display metadata for a floor depth (name, biome, boss milestone, danger rating).
 *
 * ⚠️ EVERY FIELD IS DERIVED FROM THE GENERATOR'S OWN TABLES. Nothing here is
 * transcribed, on purpose.
 *
 * What used to be here was a hand-written if-chain — "1-5 crypt, 6-10 web,
 * 11-15 flesh, 16-20 arcane, 21+ magma" with five boss names beside it — and
 * every clause of it was false. The generator shuffled FOUR themes per run, so
 * no floor's biome matched the band this screen advertised; two of the names
 * ("web", "flesh") were a private vocabulary for biomes the generator calls
 * warren and bloodworks; and the magma band it promised did not exist at all,
 * which is why the Ancient Dragon it named was unreachable at every depth.
 *
 * The schedule now lives once, in `FloorTheme.from`, and this reads it. A test
 * that compares this function against a copy of the same numbers would agree
 * with itself and prove nothing, so `unlocked-depths.test.ts` compares it
 * against `themeFor`/`guardianFor` — the functions the SPAWNER calls.
 */
export function depthMetadata(floor: number): DepthInfo {
  const f = Math.max(1, Math.floor(floor));
  // The MILESTONE floors: every floor is boss-gated (see spawn/floor-populate),
  // but every BOSS_EVERY-th one is the MEGA at double HP, and that is the row
  // this screen paints red.
  const isBoss = f % BOSS_EVERY === 0;

  const biome = themeFor(f).name;
  const guardian = guardianFor(f);
  const bossName = isBoss ? guardian.name : undefined;

  let danger: DepthInfo["danger"] = "Standard";
  if (isBoss) {
    danger = "BOSS";
  } else if (f === 1) {
    danger = "Safe";
  } else if (f <= 4) {
    danger = "Standard";
  } else if (f <= 14) {
    danger = "Challenging";
  } else {
    danger = "Deadly";
  }

  // The place's name comes from BIOMES — the same string the descent card
  // shouts when you actually arrive — so the screen and the floor agree on what
  // the player is looking at. The old local table said "Spider Cavern" for a
  // place the game itself calls The Rotting Warren.
  const placeName = biomeFor(f).name;

  const name = isBoss
    ? `${placeName} Guardian · ${bossName}`
    : `${placeName} · Level ${bandFloorFor(f)}`;

  return {
    floor: f,
    name,
    biome,
    isBoss,
    bossName,
    danger,
  };
}
