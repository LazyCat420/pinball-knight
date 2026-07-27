/**
 * Player settings — persisted across sessions, same pattern as best-depth.ts:
 * one small module, one stable key, try/catch around storage so a blocked
 * localStorage (private mode, quota) degrades to session-only settings.
 *
 * These are PLAYER preferences, distinct from the debug panel's god-mode
 * toggles (which are deliberately session-only). The menu's Settings tab is
 * the only writer; core applies them once at launch.
 */
import { QUANTIZE_DEFAULT, DITHER_DEFAULT, SCANLINE_DEFAULT, OUTLINE_DEFAULT } from "./constants";

const KEY = "pinball-knight-settings";

/**
 * RETIRED. Card pickups no longer interrupt the fight at all, so the setting
 * that chose WHEN they interrupt has nothing left to choose. The type survives
 * only so a returning player's stored blob still parses, and so a saved
 * "never" can be migrated onto `haulReveal` below. See card-reader.ts.
 */
export type ReaderPolicy = "always" | "smart" | "never";

export interface DungeonSettings {
  muted: boolean;
  quantize: boolean;
  dither: boolean;
  scanline: boolean;
  outline: boolean;
  /** Show the FLOOR HAUL screen (every card found on the floor, laid out at
   * once) on the way to the tavern. Off = the cards just arrive in the stash. */
  haulReveal: boolean;
}

export function defaultSettings(): DungeonSettings {
  return {
    muted: false,
    quantize: QUANTIZE_DEFAULT,
    dither: DITHER_DEFAULT,
    scanline: SCANLINE_DEFAULT,
    outline: OUTLINE_DEFAULT,
    haulReveal: true,
  };
}

/** The live settings object — loaded once, mutated by save(), read anywhere. */
let cached: DungeonSettings | null = null;

export function getSettings(): DungeonSettings {
  if (cached) return cached;
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<DungeonSettings>;
      // Shape-validate field by field — a stale or hand-edited blob must not
      // be able to poison the pixel pass with a non-boolean.
      if (typeof p.muted === "boolean") d.muted = p.muted;
      if (typeof p.quantize === "boolean") d.quantize = p.quantize;
      if (typeof p.dither === "boolean") d.dither = p.dither;
      if (typeof p.scanline === "boolean") d.scanline = p.scanline;
      if (typeof p.outline === "boolean") d.outline = p.outline;
      if (typeof p.haulReveal === "boolean") d.haulReveal = p.haulReveal;
      // MIGRATION: a player who had turned the old modal card reader OFF was
      // saying "stop showing me cards", so carry that across rather than
      // greeting them with a brand-new screen they already opted out of. Read
      // only when haulReveal itself is absent, so a later explicit choice wins.
      else if ((p as Partial<{ readerPolicy: ReaderPolicy }>).readerPolicy === "never") d.haulReveal = false;
    }
  } catch (_e) {
    // Blocked storage → defaults, session-only.
  }
  cached = d;
  return d;
}

export function saveSettings(patch: Partial<DungeonSettings>): DungeonSettings {
  const s = Object.assign(getSettings(), patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (_e) {
    // Session-only is fine.
  }
  return s;
}
