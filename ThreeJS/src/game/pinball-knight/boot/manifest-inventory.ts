/**
 * 📦 Manifest Inventory — Authored sheet facings registry.
 *
 * Eliminates blind HTTP 404 network probes for directions that were never authored.
 */
import type { Dir } from "../engine/render/paint-types";

export const IMPORTED_FACINGS: Record<string, readonly Dir[]> = {
  archivist: ["S"],
  bat: ["S"],
  beaver: ["E", "S"],
  broodmother: ["S"],
  brute: ["S"],
  chomper: ["S"],
  compass: ["E", "N", "S"],
  crawler: ["S"],
  croaker: ["S"],
  crystalback: ["S"],
  demon: ["S"],
  dragon: ["S"],
  fish_feet: ["E", "S"],
  frog: ["E", "S"],
  ghost: ["S"],
  goblin: ["S"],
  golem: ["S"],
  hound: ["S"],
  jester: ["S"],
  magnet: ["S"],
  mario: ["N", "S"],
  merchant: ["S"],
  mimic: ["S"],
  necro: ["S"],
  overlord: ["S"],
  pin: ["S"],
  pinball_knight: ["E", "N", "S"],
  reaper: ["S"],
  slime: ["S"],
  spider: ["S"],
  sporeling: ["S"],
  stiltneck: ["E", "S"],
  warden: ["S"],
  webspinner: ["S"],
  trex: ["S"],
  zombie: ["E"],
};

export function hasAuthoredFacing(name: string, dir: Dir): boolean {
  const facings = IMPORTED_FACINGS[name];
  if (!facings) return dir === "S";
  return facings.includes(dir);
}

export function authoredFacingsFor(name: string): readonly Dir[] {
  return IMPORTED_FACINGS[name] ?? ["S"];
}
