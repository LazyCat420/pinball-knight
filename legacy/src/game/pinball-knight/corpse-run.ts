/**
 * ⚰️ CORPSE RUNS — death drops your kit where you fell, and the tavern lets you
 * go back for it.
 *
 * Death is no longer a restart. You lose the floor, not the run: your carried
 * weapons/gear/cards stay on the floor you died on as a CORPSE PILE, you wake up
 * in the tavern, and the plunger offers to take you straight back down.
 *
 * Two rules the rest of the code leans on:
 *
 *  1. **Piles accumulate — a new death never replaces an old one.** Die five
 *     times reaching the same pile and there are five piles. That is the point:
 *     a failed recovery must not cost you the thing you were recovering, or the
 *     mechanic becomes a one-shot trap instead of "try as many times as you
 *     want". The cap below exists only so a hoarder can't melt the renderer.
 *
 *  2. **A pile is OWNED.** Floor loot is shared with the pool (that's the co-op
 *     bargain), but the kit off your own corpse is yours alone — otherwise a
 *     stranger who happens to be on your floor walks away with your run. The
 *     owner id is checked at the pickup funnel, not at the renderer, so a pile
 *     is visible to everyone and takeable by one.
 *
 * Persistence is deliberately local (the `best-depth.ts` pattern: one key,
 * shape-validated, fail-soft). Corpses are a single-player promise — "your stuff
 * is where you left it" — and routing that through the pool server would make it
 * a shared-state problem with contention, migration, and an authority to elect,
 * for no gain. Storage that throws must never take the game down with it.
 */

import type { ItemRarity } from "./items";

/** One item lying in a corpse pile. Mirrors the persistable half of GroundItem. */
export interface CorpseItem {
  kind: "weapon" | "gear" | "card";
  id: string;
  durability?: number;
  rarity?: ItemRarity;
  cards?: string[];
  upgrade?: number;
}

/** One death: a pile of kit at a spot on a floor. */
export interface CorpsePile {
  /** Unique per pile — the ground-item nid suffix and the dedupe key. */
  id: string;
  floor: number;
  x: number;
  z: number;
  /** Pool id of the knight who died, when connected; "" for a solo/offline run.
   *  Only this knight may pick the pile up. */
  owner: string;
  items: CorpseItem[];
}

/**
 * Hard ceiling on stored piles PER FLOOR. Piles accumulate by design, but each
 * one is a set of meshes and a physics-adjacent pickup check, and a player who
 * dies thirty times on their wall floor would otherwise pay for it in frame
 * time forever. At the cap the OLDEST pile's items are merged into the
 * second-oldest rather than dropped — losing gear to a silent cap would break
 * the promise this whole module exists to make.
 */
export const MAX_PILES_PER_FLOOR = 12;

const KEY = "pinball-knight-corpse-runs";
const RESUME_KEY = "pinball-knight-resume-floor";

interface Saved {
  piles: CorpsePile[];
}

let cached: Saved | null = null;

function isItem(v: unknown): v is CorpseItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (o.kind === "weapon" || o.kind === "gear" || o.kind === "card") && typeof o.id === "string";
}

function isPile(v: unknown): v is CorpsePile {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.floor === "number" &&
    Number.isFinite(o.floor) &&
    o.floor > 0 &&
    typeof o.x === "number" &&
    Number.isFinite(o.x) &&
    typeof o.z === "number" &&
    Number.isFinite(o.z) &&
    Array.isArray(o.items)
  );
}

function load(): Saved {
  if (cached) return cached;
  const out: Saved = { piles: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(p.piles)) {
        for (const entry of p.piles) {
          if (!isPile(entry)) continue; // hand-edited or corrupt → skip, don't throw
          out.piles.push({
            id: entry.id,
            floor: Math.floor(entry.floor),
            x: entry.x,
            z: entry.z,
            owner: typeof (entry as CorpsePile).owner === "string" ? (entry as CorpsePile).owner : "",
            items: (entry.items as unknown[]).filter(isItem),
          });
        }
      }
    }
  } catch {
    // Blocked/parse-failed storage → this session starts with no piles. The run
    // still works; you just can't recover a corpse from a previous session.
  }
  cached = out;
  return out;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cached ?? { piles: [] }));
  } catch {
    // Session-only is fine — the in-memory piles still work for this sitting.
  }
}

/** Every stored pile on `floor`, oldest first. */
export function pilesOnFloor(floor: number): CorpsePile[] {
  return load().piles.filter((p) => p.floor === floor);
}

/** Floors that currently hold at least one pile, shallowest first. */
export function floorsWithPiles(): number[] {
  const seen = new Set<number>();
  for (const p of load().piles) seen.add(p.floor);
  return [...seen].sort((a, b) => a - b);
}

/**
 * Record a death. Returns the new pile, or null when there was nothing worth
 * dropping (a knight who died holding only their starting fists leaves no pile
 * — an empty grave is just a confusing prop).
 */
export function addPile(floor: number, x: number, z: number, owner: string, items: CorpseItem[]): CorpsePile | null {
  if (!Number.isFinite(floor) || floor <= 0) return null;
  if (items.length === 0) return null;
  const st = load();
  // `id` must be unique but need not be unguessable: pile ids are local-only and
  // never trusted from the wire. Floor+time+counter is plenty, and a counter
  // guards the case where two deaths land in the same millisecond.
  const pile: CorpsePile = { id: `c${floor}-${Date.now().toString(36)}-${st.piles.length}`, floor, x, z, owner, items };
  st.piles.push(pile);
  enforceCap(st, floor);
  save();
  return pile;
}

/**
 * Merge down to the cap, oldest-into-next-oldest. Items are never discarded —
 * see MAX_PILES_PER_FLOOR. The survivor keeps the NEWER pile's position, since
 * that is the one the player is most likely to be walking back toward.
 */
function enforceCap(st: Saved, floor: number): void {
  for (;;) {
    const onFloor = st.piles.filter((p) => p.floor === floor);
    if (onFloor.length <= MAX_PILES_PER_FLOOR) return;
    const oldest = onFloor[0];
    const next = onFloor[1];
    next.items = [...oldest.items, ...next.items];
    st.piles.splice(st.piles.indexOf(oldest), 1);
  }
}

/** Drop a pile once its items have been handed back to the player. */
export function clearPile(id: string): void {
  const st = load();
  const k = st.piles.findIndex((p) => p.id === id);
  if (k < 0) return;
  st.piles.splice(k, 1);
  save();
}

/**
 * May `viewerId` loot `pile`? Corpse kit is owner-only (module header, rule 2).
 *
 * An empty owner means the pile was made offline/solo. Those stay lootable by
 * whoever is at the keyboard — the alternative is stranding the gear of anyone
 * who dies before the pool connects, and there is no second claimant to protect
 * it from in the first place.
 */
export function canLoot(pile: CorpsePile, viewerId: string | null): boolean {
  if (!pile.owner) return true;
  return pile.owner === viewerId;
}

// ── Resume floor ─────────────────────────────────────────────────────────────

/**
 * The floor the tavern plunger offers to drop you back onto — the last floor you
 * DIED on, not the deepest you ever reached. Those differ, and the difference is
 * the whole feature: your stuff is at the place you failed.
 */
export function loadResumeFloor(): number {
  try {
    const n = Number.parseInt(localStorage.getItem(RESUME_KEY) ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveResumeFloor(floor: number): void {
  if (!Number.isFinite(floor) || floor <= 0) return;
  try {
    localStorage.setItem(RESUME_KEY, String(Math.floor(floor)));
  } catch {
    // Not fatal — you just start from floor 1 next session.
  }
}

export function clearResumeFloor(): void {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Test seam — drops the memo so a fresh localStorage is re-read. */
export function __resetCorpseCache(): void {
  cached = null;
}
