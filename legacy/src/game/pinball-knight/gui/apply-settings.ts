/**
 * Push the persisted settings onto the live systems.
 *
 * Moved out of `menu.ts` when that file was deleted. It never belonged to the
 * menu: the menu was simply the only thing that called it, and the DOM sheet
 * happened to be where it was typed. It is the bridge between
 * `settings-save.ts` (what the player chose, persisted) and the systems those
 * choices drive — the sfx gate and the pixel pass — and every one of its
 * callers is now something other than a menu (boot, the settings screen).
 */
import { state } from "../state";
import { getSettings } from "../settings-save";
import { setSfxMuted, setSfxVolume } from "../sfx";

export function applySettingsLive(): void {
  const s = getSettings();
  setSfxMuted(s.muted);
  // Independent of the mute, on purpose: un-muting restores the level the player
  // chose rather than jumping to full. Both are pushed on every call so a boot
  // with a persisted volume is at the right level before the first sting.
  setSfxVolume(s.volume);
  state.quantize = s.quantize;
  state.dither = s.dither;
  state.scanline = s.scanline;
  state.outline = s.outline;
  state.pixelPass?.setQuantize(s.quantize);
  state.pixelPass?.setDither(s.dither);
  state.pixelPass?.setScanline(s.scanline);
  state.pixelPass?.setOutline(s.outline);
}
