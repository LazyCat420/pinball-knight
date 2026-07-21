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

/** When the modal card reader interrupts: every pickup, the smart policy
 * (first-of-kind this run or epic+), or never (always the passive popup). */
export type ReaderPolicy = "always" | "smart" | "never";

export interface DungeonSettings {
  muted: boolean;
  quantize: boolean;
  dither: boolean;
  scanline: boolean;
  outline: boolean;
  readerPolicy: ReaderPolicy;
}

export function defaultSettings(): DungeonSettings {
  return {
    muted: false,
    quantize: QUANTIZE_DEFAULT,
    dither: DITHER_DEFAULT,
    scanline: SCANLINE_DEFAULT,
    outline: OUTLINE_DEFAULT,
    readerPolicy: "smart",
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
      if (p.readerPolicy === "always" || p.readerPolicy === "smart" || p.readerPolicy === "never") d.readerPolicy = p.readerPolicy;
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

/** Test seam. */
export function __resetSettingsCache(): void {
  cached = null;
}
