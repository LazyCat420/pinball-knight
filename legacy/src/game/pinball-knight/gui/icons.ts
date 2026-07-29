/**
 * ICONS — no emoji, ever.
 *
 * The DOM sheets leaned on emoji for almost every mark: tabs (`🗡️ 🃏 ✨ 📖 📜
 * ⚙️`), every ability, skill, reagent and perk. Inside the pixel pass that is
 * not merely off-style, it is unreliable. `render/holo-card.ts` documents what
 * happened the last time this game drew emoji with `fillText`: a headless
 * render produced a ✗-in-a-circle where the emblem belonged on nearly every
 * card, because emoji rendering is a property of the machine's font stack, not
 * of the code. A UI that composites into the frame cannot have marks that
 * appear on some machines and not others.
 *
 * So there are exactly two sources of truth here, and both are ours:
 *
 *  1. THE GAME'S OWN PIXEL ART, for anything that exists as an item. Weapons,
 *     armour and potions already have `FramePaint` painters in
 *     `render/cel-painter.ts`; `renderPaintCanvas` rasterises one through the
 *     same palette crush the in-world sprites get. A sword in the menu is now
 *     literally the sword sprite, not a picture of a different sword.
 *  2. PROCEDURAL GLYPHS, for the abstract marks that never had art — skill
 *     branches, abilities, stat rows. These are drawn from paths on the same
 *     8px grid, in palette colours, in the spirit of `render/card-glyphs.ts`.
 *
 * Both are cached as canvases, because the crush is not free and an
 * immediate-mode UI would otherwise redo it sixty times a second.
 *
 * ── ON THE PROCEDURAL SET BEING PLAIN ──
 * These glyphs are geometry: rings, chevrons, blades, flasks. They are legible
 * at 16px and they are honest, but they are not the hand-drawn sigils the cards
 * got. Bespoke art per ability is worth doing and is NOT done here; this is the
 * floor, not the ceiling.
 */
import { ITEM_PAINTS } from "../render/cel-painter";
import { renderPaintCanvas } from "../engine/render/sprite";
import { UI } from "./theme";

const itemCache = new Map<string, HTMLCanvasElement | null>();

/** The game's actual sprite for an item id, or null if it has no painter. */
export function itemIcon(id: string): HTMLCanvasElement | null {
  let c = itemCache.get(id);
  if (c === undefined) {
    const paint = ITEM_PAINTS[id];
    c = paint ? renderPaintCanvas(paint) : null;
    itemCache.set(id, c);
  }
  return c;
}

/** The abstract marks. Kept small and nameable — one per concept, not per item. */
export type GlyphId =
  | "sword" // equipment tab, melee
  | "card" // cards tab
  | "spark" // skills tab, arcana
  | "book" // bestiary tab
  | "scroll" // stats tab
  | "gear" // settings tab
  | "shield" // plate / armour
  | "coin" // gold
  | "flask" // potions / reagents
  | "steel" // steel branch
  | "flipper" // flipper branch
  | "skull" // kills / danger
  | "chevron"; // generic marker

const glyphCache = new Map<string, HTMLCanvasElement>();

/**
 * Rasterise a glyph once at `size` and cache it.
 *
 * Cached BY SIZE as well as id: these are pixel marks, so drawing a 16px glyph
 * scaled to 24 would resample it into mush. Each size is drawn at its own
 * native resolution.
 */
export function glyph(id: GlyphId, size = 16, colour: string = UI.text): HTMLCanvasElement | null {
  const key = `${id}:${size}:${colour}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;

  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  drawGlyph(g, id, size, colour);
  glyphCache.set(key, c);
  return c;
}

/**
 * Every glyph is drawn in a 0..1 unit box and scaled, so one definition serves
 * every size. Strokes are snapped to whole pixels — a 1.5px line on this grid
 * antialiases into two grey rows, and grey does not survive the palette snap
 * as grey; it picks whichever of two entries is nearer, per pixel, which reads
 * as a ragged edge rather than a soft one.
 */
function drawGlyph(g: CanvasRenderingContext2D, id: GlyphId, s: number, colour: string): void {
  const u = (v: number): number => Math.round(v * s);
  const w = Math.max(1, Math.round(s / 8)); // stroke weight, always whole px
  g.fillStyle = colour;
  g.strokeStyle = colour;
  g.lineWidth = w;

  const bar = (x: number, y: number, bw: number, bh: number): void =>
    void g.fillRect(u(x), u(y), Math.max(1, u(bw)), Math.max(1, u(bh)));

  switch (id) {
    case "sword":
      bar(0.44, 0.06, 0.12, 0.6); // blade
      bar(0.25, 0.62, 0.5, 0.1); // guard
      bar(0.46, 0.72, 0.08, 0.22); // grip
      break;
    case "card":
      g.strokeRect(u(0.22) + 0.5, u(0.12) + 0.5, u(0.56), u(0.76));
      bar(0.34, 0.28, 0.32, 0.06);
      bar(0.34, 0.44, 0.32, 0.24);
      break;
    case "spark":
      bar(0.46, 0.04, 0.08, 0.92);
      bar(0.04, 0.46, 0.92, 0.08);
      bar(0.2, 0.2, 0.14, 0.14);
      bar(0.66, 0.66, 0.14, 0.14);
      break;
    case "book":
      g.strokeRect(u(0.12) + 0.5, u(0.18) + 0.5, u(0.76), u(0.64));
      bar(0.48, 0.18, 0.04, 0.64); // spine
      bar(0.22, 0.32, 0.2, 0.05);
      bar(0.58, 0.32, 0.2, 0.05);
      break;
    case "scroll":
      g.strokeRect(u(0.22) + 0.5, u(0.1) + 0.5, u(0.56), u(0.8));
      bar(0.32, 0.28, 0.36, 0.05);
      bar(0.32, 0.44, 0.36, 0.05);
      bar(0.32, 0.6, 0.24, 0.05);
      break;
    case "gear": {
      // A ring with four teeth. Cheaper and crisper than a real cog outline,
      // and at 16px a real cog is indistinguishable from a blob anyway.
      g.beginPath();
      g.arc(u(0.5), u(0.5), u(0.28), 0, Math.PI * 2);
      g.stroke();
      bar(0.46, 0.04, 0.08, 0.14);
      bar(0.46, 0.82, 0.08, 0.14);
      bar(0.04, 0.46, 0.14, 0.08);
      bar(0.82, 0.46, 0.14, 0.08);
      break;
    }
    case "shield":
      g.beginPath();
      g.moveTo(u(0.5), u(0.06));
      g.lineTo(u(0.88), u(0.24));
      g.lineTo(u(0.72), u(0.86));
      g.lineTo(u(0.5), u(0.96));
      g.lineTo(u(0.28), u(0.86));
      g.lineTo(u(0.12), u(0.24));
      g.closePath();
      g.stroke();
      break;
    case "coin":
      g.beginPath();
      g.arc(u(0.5), u(0.5), u(0.36), 0, Math.PI * 2);
      g.fill();
      break;
    case "flask":
      bar(0.4, 0.06, 0.2, 0.16); // neck
      g.beginPath();
      g.moveTo(u(0.4), u(0.22));
      g.lineTo(u(0.18), u(0.8));
      g.lineTo(u(0.82), u(0.8));
      g.lineTo(u(0.6), u(0.22));
      g.closePath();
      g.stroke();
      break;
    case "steel":
      bar(0.16, 0.44, 0.68, 0.12);
      bar(0.16, 0.22, 0.28, 0.12);
      bar(0.56, 0.66, 0.28, 0.12);
      break;
    case "flipper":
      g.beginPath();
      g.arc(u(0.5), u(0.5), u(0.34), 0, Math.PI * 2);
      g.stroke();
      bar(0.46, 0.16, 0.08, 0.34);
      break;
    case "skull":
      g.beginPath();
      g.arc(u(0.5), u(0.42), u(0.3), Math.PI, 0);
      g.fill();
      bar(0.2, 0.42, 0.6, 0.2);
      bar(0.34, 0.66, 0.32, 0.16);
      break;
    case "chevron":
      g.beginPath();
      g.moveTo(u(0.32), u(0.2));
      g.lineTo(u(0.66), u(0.5));
      g.lineTo(u(0.32), u(0.8));
      g.stroke();
      break;
  }
}

/**
 * Draw an icon into the UI layer, letterboxed into a square box.
 *
 * Item sprites are 72px native and menu boxes are 16-32px, so they are always
 * MINIFIED. `imageSmoothingEnabled = false` on the destination keeps that a
 * nearest-sample rather than a blur — the same rule `renderPaintIcon`'s comment
 * fought over for the DOM icons, and the reason sizes here should stay near
 * integer divisors of 72 where it matters.
 */
export function drawIcon(
  g: CanvasRenderingContext2D,
  icon: HTMLCanvasElement | null,
  x: number,
  y: number,
  size: number,
): void {
  if (!icon) return;
  g.imageSmoothingEnabled = false;
  g.drawImage(icon, Math.round(x), Math.round(y), size, size);
}
