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
  bloater: ["S"],
  broodmother: ["S"],
  brute: ["S"],
  burger: ["S"],
  chomper: ["S"],
  cigarette: ["S"],
  clockwork_knight_football: ["E", "N", "S"],
  clockwork_knight_baseball: ["E", "N", "S"],
  clockwork_knight: ["E", "N", "S"],
  compass: ["E", "N", "S"],
  crawler: ["S"],
  crawling_hand: ["S"],
  croaker: ["S"],
  crystalback: ["S"],
  demon: ["S"],
  dragon: ["S"],
  dragon_snake_head: ["S"],
  dragon_snake_body: ["S"],
  dragon_snake_tail: ["S"],
  espresso: ["S"],
  fish_feet: ["E", "S"],
  fries: ["S"],
  frog: ["E", "S"],
  ghost: ["S"],
  gnome: ["S"],
  goblin: ["S"],
  golem: ["S"],
  hound: ["S"],
  jade_buddha: ["S"],
  jester: ["S"],
  magnet: ["S"],
  mario: ["N", "S"],
  merchant: ["S"],
  mimic: ["S"],
  milkshake: ["S"],
  necro: ["S"],
  overlord: ["S"],
  pin: ["S"],
  pinball_knight: ["E", "N", "S"],
  platypus: ["S"],
  reaper: ["S"],
  slime: ["S"],
  spider: ["S"],
  sporeling: ["S"],
  sumo_ninja: ["S"],
  stiltneck: ["E", "S"],
  warden: ["S"],
  webspinner: ["S"],
  trex: ["S"],
  toucan: ["S"],
  zippo: ["S"],
  cerberus: ["S"],
  clam: ["S"],
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
