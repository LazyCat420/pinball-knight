/**
 * KNIGHT PORTRAIT — the paperdoll: one big pixel-crisp render of YOUR knight
 * with the current weapon and gear, painted on demand for the menu's Equipment
 * tab (and anywhere else that wants a mirror — the armorer counter, later).
 *
 * Reuses the exact in-game pipeline — `makeKnightPaints` for the pose,
 * `crushToGrid` for the pixel snap — so the portrait IS the sprite, only
 * bigger: what you see here is pixel-for-pixel what walks the dungeon.
 */
import { makeKnightPaints } from "./cel-painter";
import { crushToGrid } from "./sprite";
import { SPRITE_PX } from "../constants";
import type { WeaponId } from "../items";
import type { KnightLook } from "./knight-look";

export function renderKnightPortrait(canvas: HTMLCanvasElement, weapon: WeaponId, look: KnightLook): void {
  const out = canvas.getContext("2d");
  if (!out) return;

  // Paint the south-facing idle stance at author resolution…
  const scratch = document.createElement("canvas");
  scratch.width = SPRITE_PX;
  scratch.height = SPRITE_PX;
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.imageSmoothingEnabled = true;
  const idle = makeKnightPaints(weapon, look).S.idle;
  if (!idle || !idle[0]) return;
  idle[0](sctx);

  // …then the same crush the in-world sheets get, upscaled with hard pixels.
  const crushed = crushToGrid(scratch);
  out.clearRect(0, 0, canvas.width, canvas.height);
  out.imageSmoothingEnabled = false;
  const scale = Math.min(canvas.width / crushed.width, canvas.height / crushed.height);
  const w = Math.floor(crushed.width * scale);
  const h = Math.floor(crushed.height * scale);
  out.drawImage(crushed, Math.floor((canvas.width - w) / 2), Math.floor((canvas.height - h) / 2), w, h);
}
