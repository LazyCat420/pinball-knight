/**
 * Player settings — persisted across sessions, same pattern as best-depth.ts:
 * one small module, one stable key, try/catch around storage so a blocked
 * localStorage (private mode, quota) degrades to session-only settings.
 *
 * These are PLAYER preferences, distinct from the debug panel's god-mode
 * toggles (which are deliberately session-only). The menu's Settings tab is
 * the only writer; core applies them once at launch.
 */
import { isPixelFilter, type PixelFilter } from "./engine/render/selective-pixel";
import {
  QUANTIZE_DEFAULT,
  DITHER_DEFAULT,
  SCANLINE_DEFAULT,
  OUTLINE_DEFAULT,
  CAMERA_ZOOMS,
  CAMERA_ZOOM_DEFAULT,
  SETTINGS_KEY,
  VOLUME_STEPS,
  type CameraZoom, clampCameraPpu } from "./constants";

/**
 * The key lives in `constants/render.ts`, not here.
 *
 * That looks backwards — this module owns settings — and it is deliberate:
 * `PPU` is resolved from this same blob at MODULE LOAD, before anything can
 * import this file, so the reader has to sit further down the graph. One
 * declaration, imported both ways round, is what stops the two readers drifting
 * onto different keys and the camera setting silently never being read.
 */
const KEY = SETTINGS_KEY;

/**
 * RETIRED. Card pickups no longer interrupt the fight at all, so the setting
 * that chose WHEN they interrupt has nothing left to choose. The type survives
 * only so a returning player's stored blob still parses, and so a saved
 * "never" can be migrated onto `haulReveal` below. See card-reader.ts.
 */
export type ReaderPolicy = "always" | "smart" | "never";

export interface DungeonSettings {
  muted: boolean;
  /**
   * SFX loudness, 0..1, snapped to `VOLUME_STEPS` notches.
   *
   * Kept INDEPENDENT of `muted`: turning sound off and back on must restore the
   * level the player chose rather than jumping to full. Absent from every blob
   * saved before this existed, which is the correct outcome — it defaults to 1
   * and every returning player hears exactly what they heard before.
   */
  volume: number;
  /**
   * Heat shimmer — the screen-space refraction around fire.
   *
   * Its own toggle, alongside the other post effects, because it is the one
   * elemental effect that moves pixels that are not its own: it warps the SCENE
   * behind and around a flame. That is exactly the sort of thing someone will
   * want off, and it also makes motion sickness a real consideration where a
   * static palette snap is not.
   */
  heatShimmer: boolean;
  /** Scenery pixel size; actors and UI retain their original pixels. */
  pixelFilter: PixelFilter;
  /**
   * RETIRED (2026-08-03). The screen-space pixel filters — palette quantize,
   * dither, scanlines, depth-edge ink — are permanently off: the sprites are
   * already palette-locked pixel art at the atlas, and the screen-wide snap only
   * posterized the environment's lit colours into confetti. The fields survive
   * so `state`/`pixel-pass` plumbing keeps its shape (and the debug surface can
   * still poke the uniforms), but they always carry the defaults: getSettings()
   * deliberately ignores a stored override — every pre-retirement blob has
   * `true` in all four, and honouring it would keep the old look forever.
   */
  quantize: boolean;
  dither: boolean;
  scanline: boolean;
  outline: boolean;
  /** Show the FLOOR HAUL screen (every card found on the floor, laid out at
   * once) on the way to the tavern. Off = the cards just arrive in the stash. */
  haulReveal: boolean;
  /**
   * How far back the camera sits — see `CAMERA_ZOOMS`.
   *
   * Applied immediately using camera zoom; the saved rung also determines
   * atlas resolution on the next launch.
   */
  cameraZoom: CameraZoom;
  /**
   * The CONTINUOUS camera zoom in PPU — what the scroll wheel and the options
   * slider actually move. `cameraZoom` above is now only the named preset the
   * player last clicked; this is the live value, and it is what the atlas
   * resolution is derived from on the next launch.
   */
  cameraPpu: number;
  /**
   * Filter sprites when the camera is zoomed out PAST their baked size.
   *
   * Magnification stays nearest either way — this only decides what happens
   * when one screen pixel covers more than one texel, where nearest picks an
   * arbitrary one and makes the image crawl as the camera moves.
   */
  spriteSmoothing: boolean;
}

export function defaultSettings(): DungeonSettings {
  return {
    muted: false,
    volume: 1,
    heatShimmer: true,
    pixelFilter: "subtle",
    quantize: QUANTIZE_DEFAULT,
    dither: DITHER_DEFAULT,
    scanline: SCANLINE_DEFAULT,
    outline: OUTLINE_DEFAULT,
    haulReveal: true,
    cameraZoom: CAMERA_ZOOM_DEFAULT,
    cameraPpu: CAMERA_ZOOMS[CAMERA_ZOOM_DEFAULT],
    spriteSmoothing: true,
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
      if (isPixelFilter(p.pixelFilter)) d.pixelFilter = p.pixelFilter;
      if (typeof p.muted === "boolean") d.muted = p.muted;
      if (typeof p.heatShimmer === "boolean") d.heatShimmer = p.heatShimmer;
      // RANGE-checked and snapped, not just typeof — this one ends up as a
      // GainNode.value, and a NaN there silences the graph permanently in some
      // implementations rather than merely sounding wrong. Snapping also means a
      // hand-edited blob always lands on a notch the slider can display.
      if (typeof p.volume === "number" && Number.isFinite(p.volume) && p.volume >= 0 && p.volume <= 1) {
        d.volume = Math.round(p.volume * VOLUME_STEPS) / VOLUME_STEPS;
      }
      // quantize/dither/scanline/outline are deliberately NOT read — see the
      // RETIRED note on the interface. A stored value (true in every blob saved
      // before 2026-08-03) must not resurrect the screen-space filters.
      if (typeof p.haulReveal === "boolean") d.haulReveal = p.haulReveal;
      if (typeof p.spriteSmoothing === "boolean") d.spriteSmoothing = p.spriteSmoothing;
      // MIGRATION: a player who had turned the old modal card reader OFF was
      // saying "stop showing me cards", so carry that across rather than
      // greeting them with a brand-new screen they already opted out of. Read
      // only when haulReveal itself is absent, so a later explicit choice wins.
      //
      // This `else` used to be chained to the cameraZoom check below, which is
      // the wrong `if` — the migration only ran for a blob that had no camera
      // setting, and stopped running for everyone the moment they saved one.
      else if ((p as Partial<{ readerPolicy: ReaderPolicy }>).readerPolicy === "never") d.haulReveal = false;
      // Membership-checked, not just typeof: this one indexes a table and ends
      // up as PPU, so a stale or hand-edited value would make the whole render
      // pipeline NaN rather than merely look wrong.
      if (typeof p.cameraZoom === "string" && p.cameraZoom in CAMERA_ZOOMS) d.cameraZoom = p.cameraZoom;
      // RANGE-checked and clamped for the same reason volume is: this ends up
      // as a divisor for camera.zoom, so a NaN or a 0 here does not look wrong,
      // it makes the projection matrix non-finite and the screen goes black.
      // MIGRATION: absent (every blob written before continuous zoom) falls
      // back to the rung the player had, so their framing is unchanged.
      d.cameraPpu = typeof p.cameraPpu === "number" && Number.isFinite(p.cameraPpu)
        ? clampCameraPpu(p.cameraPpu)
        : CAMERA_ZOOMS[d.cameraZoom];
    }
  } catch (_e) {
    // Blocked storage → defaults, session-only.
  }
  cached = d;
  return d;
}

export function saveSettings(patch: Partial<DungeonSettings>): DungeonSettings {
  // A named rung WRITES THROUGH to the continuous value, unless the caller set
  // both. Without this the presets go dead the moment zoom became continuous:
  // `cameraZoom` would still be stored and still name a distance, but nothing
  // reads it for framing any more, so picking one would change a label and
  // leave the camera where it was. The rung is a shortcut onto the line, not a
  // parallel setting.
  if (patch.cameraZoom !== undefined && patch.cameraPpu === undefined) {
    patch = { ...patch, cameraPpu: CAMERA_ZOOMS[patch.cameraZoom] };
  }
  const s = Object.assign(getSettings(), patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (_e) {
    // Session-only is fine.
  }
  return s;
}
