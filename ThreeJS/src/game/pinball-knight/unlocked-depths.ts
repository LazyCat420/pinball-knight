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

const UNLOCKED_KEY = "pinball-knight-unlocked-depth";

export interface DepthInfo {
  floor: number;
  name: string;
  biome: "crypt" | "web" | "flesh" | "arcane" | "magma";
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
 */
export function depthMetadata(floor: number): DepthInfo {
  const f = Math.max(1, Math.floor(floor));
  const isBoss = f % 5 === 0;

  // 5 biomes of 5 floors each: 1-5 crypt, 6-10 web, 11-15 flesh, 16-20 arcane, 21+ magma
  let biome: DepthInfo["biome"] = "crypt";
  let bossName: string | undefined = undefined;

  if (f <= 5) {
    biome = "crypt";
    if (isBoss) bossName = "The Reaper King";
  } else if (f <= 10) {
    biome = "web";
    if (isBoss) bossName = "The Broodmother";
  } else if (f <= 15) {
    biome = "flesh";
    if (isBoss) bossName = "The Overlord";
  } else if (f <= 20) {
    biome = "arcane";
    if (isBoss) bossName = "The Archivist";
  } else {
    biome = "magma";
    if (isBoss) bossName = "The Ancient Dragon";
  }

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

  const biomeNames: Record<DepthInfo["biome"], string> = {
    crypt: "Crypt",
    web: "Spider Cavern",
    flesh: "Flesh Pits",
    arcane: "Arcane Deep",
    magma: "Magma Abyss",
  };

  const name = isBoss
    ? `${biomeNames[biome]} Guardian · ${bossName}`
    : `${biomeNames[biome]} · Level ${((f - 1) % 5) + 1}`;

  return {
    floor: f,
    name,
    biome,
    isBoss,
    bossName,
    danger,
  };
}
