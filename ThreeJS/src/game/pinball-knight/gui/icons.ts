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
import { crushToGrid, renderPaintCanvas } from "../engine/render/sprite";
import { monsterPortrait } from "../render/monster-portrait";
import { ABILITIES, type AbilityId } from "../abilities";
import type { EnemyKind } from "../state";
import { UI } from "./theme";

const itemCache = new Map<string, HTMLCanvasElement | null>();
const monsterCache = new Map<string, HTMLCanvasElement | null>();

/** Every icon this module hands out is square and this many pixels on a side. */
export const ICON_PX = 72;

/**
 * Re-frame a sprite so the SUBJECT fills the icon.
 *
 * ── WHY AN ICON OF A SPRITE IS NOT THE SPRITE ──
 * A sprite's frame is an ACTOR BOX. It is sized for the tallest thing that can
 * stand in it and its origin is the creature's feet, so a bat, a coin and a
 * sword each occupy some small, differently-placed part of a mostly empty
 * square. Blitting that square into a 20px chip spends most of the chip on
 * transparency: measured on this roster the painted content is 25-45% of the
 * frame's width, so a "20px icon" was drawing a 6-9px creature. That is the
 * literal cause of "the icons just look like dots" — not the box size, the
 * FRAMING inside it.
 *
 * So: find the opaque bounding box, pad it slightly, and fit that square into
 * `ICON_PX`. Subjects then fill their chips and — because the crop is square
 * and centred — a bat and a brute still read at the same scale relative to one
 * another, which is what stops the roster looking like a ransom note.
 *
 * The fit is a FILTERED resample (smoothing on), which is the one place in this
 * UI that is deliberately not nearest-neighbour. It happens ONCE per icon, into
 * a cache, from a source with more detail than the destination — the same trade
 * `crushToGrid` already makes for every in-world sprite. What must stay
 * nearest is the final blit to the screen, and that is `drawIcon`'s job, at an
 * exact integer ratio off this canvas.
 */
function reframe(src: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (!src || typeof document === "undefined") return null;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;

  let x0 = src.width;
  let y0 = src.height;
  let x1 = -1;
  let y1 = -1;
  const { data } = sctx.getImageData(0, 0, src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      // 8 rather than 0: the crush leaves a halo of near-zero alpha around
      // every silhouette, and cropping to THAT is cropping to the whole frame.
      if (data[(y * src.width + x) * 4 + 3] < 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null; // nothing painted

  // Square the crop around the subject's centre, so nothing is stretched.
  const pad = 2;
  const side = Math.max(x1 - x0, y1 - y0) + 1 + pad * 2;
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;

  const out = document.createElement("canvas");
  out.width = ICON_PX;
  out.height = ICON_PX;
  const g = out.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, ICON_PX, ICON_PX);
  return out;
}

/** The game's actual sprite for an item id, re-framed as an icon. */
export function itemIcon(id: string): HTMLCanvasElement | null {
  let c = itemCache.get(id);
  if (c === undefined) {
    const paint = ITEM_PAINTS[id];
    c = paint ? reframe(renderPaintCanvas(paint)) : null;
    itemCache.set(id, c);
  }
  return c;
}

/**
 * The monster itself, as an icon — the same cel the horde is drawn from.
 *
 * `monsterPortrait` hands back the painter's native 128px actor box. That goes
 * through `crushToGrid` first — the same alpha-weighted area downscale every
 * in-world sprite gets — and then through `reframe`, so the creature fills the
 * chip. Both steps matter: without the crush a 128px cel nearest-sampled to 18
 * is confetti, and without the reframe an 18px chip is mostly the empty air a
 * standing monster leaves above its own head.
 *
 * The chain is deliberately the same one `itemIcon` uses, so weapons, potions
 * and monsters arrive at the UI on one grid, at one apparent scale.
 */
export function monsterIcon(kind: EnemyKind): HTMLCanvasElement | null {
  let c = monsterCache.get(kind);
  if (c === undefined) {
    const portrait = monsterPortrait(kind);
    c = portrait ? reframe(crushToGrid(portrait)) : null;
    monsterCache.set(kind, c);
  }
  return c;
}

/** Test seam & sheet-load invalidator: drop cached monster chip canvases. */
export function _clearMonsterIconCache(): void {
  monsterCache.clear();
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
  | "chevron" // generic marker
  // ── The dev console's vocabulary. Abstract verbs with no item behind them,
  //    so they are geometry like the rest of the set above. ──
  | "heart" // heal
  | "plus" // grant points
  | "flame" // rage / rampage
  | "burst" // kill everything
  | "erase" // clear the room
  | "stairs" // teleport to the stairs
  | "descend" // next floor
  | "crown" // boss
  | "scythe" // the reaper
  | "circle" // spawn a ring
  | "layers" // jump to a depth
  // ── ONE PER ABILITY ──
  // Not decoration. The HUD's two cast slots drew `spark` for EVERY ability, so
  // both slots showed the same mark and the only thing telling Flipper Charge
  // from Time Crawl was the mana number underneath. A slot is meant to be read
  // at a glance mid-fight; a shared glyph makes that impossible by construction.
  //
  // `AbilityDef.icon` already held an emoji per ability and has been dead since
  // the DOM menu was deleted — it cannot come back, for the reason at the top of
  // this file. These are its replacement, and `ABILITY_GLYPH` below is the
  // compile-enforced mapping so a new ability cannot ship without a mark.
  | "launch" // flippercharge — a chevron shoved forward off a flipper bar
  | "burstRing" // arcanepulse — concentric rings going out
  | "magnet" // magnetaura — a horseshoe with poles
  | "hourglass" // timecrawl
  | "blades" // bladestorm — crescents orbiting a hub
  | "droplet"; // slickfield — a spill

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
    case "heart":
      // Two shoulders and a wedge, in blocks. A bezier heart at 16px resolves
      // to a lump; stacked bars keep the notch at the top readable.
      bar(0.14, 0.24, 0.28, 0.2);
      bar(0.58, 0.24, 0.28, 0.2);
      bar(0.14, 0.44, 0.72, 0.16);
      bar(0.24, 0.6, 0.52, 0.14);
      bar(0.38, 0.74, 0.24, 0.14);
      break;
    case "plus":
      bar(0.42, 0.14, 0.16, 0.72);
      bar(0.14, 0.42, 0.72, 0.16);
      break;
    case "flame":
      bar(0.42, 0.08, 0.16, 0.24);
      bar(0.3, 0.3, 0.4, 0.2);
      bar(0.2, 0.48, 0.6, 0.3);
      bar(0.32, 0.78, 0.36, 0.12);
      break;
    case "burst":
      // A star of rays — "everything, at once".
      bar(0.46, 0.02, 0.08, 0.96);
      bar(0.02, 0.46, 0.96, 0.08);
      for (const [x, y] of [
        [0.16, 0.16],
        [0.72, 0.16],
        [0.16, 0.72],
        [0.72, 0.72],
      ]) {
        bar(x, y, 0.12, 0.12);
      }
      break;
    case "erase":
      // A box with its contents struck through: the room, emptied.
      g.strokeRect(u(0.14) + 0.5, u(0.14) + 0.5, u(0.72), u(0.72));
      g.beginPath();
      g.moveTo(u(0.24), u(0.24));
      g.lineTo(u(0.76), u(0.76));
      g.moveTo(u(0.76), u(0.24));
      g.lineTo(u(0.24), u(0.76));
      g.stroke();
      break;
    case "stairs":
      bar(0.1, 0.68, 0.28, 0.14);
      bar(0.32, 0.48, 0.28, 0.14);
      bar(0.54, 0.28, 0.28, 0.14);
      bar(0.76, 0.12, 0.16, 0.14);
      break;
    case "descend":
      bar(0.42, 0.06, 0.16, 0.5);
      g.beginPath();
      g.moveTo(u(0.2), u(0.52));
      g.lineTo(u(0.8), u(0.52));
      g.lineTo(u(0.5), u(0.92));
      g.closePath();
      g.fill();
      break;
    case "crown":
      bar(0.1, 0.62, 0.8, 0.2);
      g.beginPath();
      g.moveTo(u(0.1), u(0.62));
      g.lineTo(u(0.1), u(0.2));
      g.lineTo(u(0.3), u(0.42));
      g.lineTo(u(0.5), u(0.12));
      g.lineTo(u(0.7), u(0.42));
      g.lineTo(u(0.9), u(0.2));
      g.lineTo(u(0.9), u(0.62));
      g.closePath();
      g.fill();
      break;
    case "scythe":
      g.beginPath();
      g.arc(u(0.6), u(0.34), u(0.34), Math.PI, Math.PI * 1.75);
      g.stroke();
      g.beginPath();
      g.moveTo(u(0.6), u(0.3));
      g.lineTo(u(0.34), u(0.94));
      g.stroke();
      break;
    case "circle":
      g.beginPath();
      g.arc(u(0.5), u(0.5), u(0.34), 0, Math.PI * 2);
      g.stroke();
      bar(0.44, 0.44, 0.12, 0.12);
      break;
    case "layers":
      bar(0.12, 0.2, 0.76, 0.12);
      bar(0.12, 0.44, 0.76, 0.12);
      bar(0.12, 0.68, 0.76, 0.12);
      break;

    // ── The ability set ──
    // Each is drawn to be told apart by SILHOUETTE at 16px, not by detail: a
    // slot is read in peripheral vision while something is trying to kill you.
    // So one is a wedge, one is rings, one is a horseshoe, one is an hourglass,
    // one is crescents, one is a teardrop — no two share an outline.
    case "launch":
      // A wedge shoved off a bar: the flipper, and the direction it throws you.
      bar(0.08, 0.72, 0.84, 0.16);
      g.beginPath();
      g.moveTo(u(0.5), u(0.08));
      g.lineTo(u(0.86), u(0.5));
      g.lineTo(u(0.62), u(0.5));
      g.lineTo(u(0.62), u(0.68));
      g.lineTo(u(0.38), u(0.68));
      g.lineTo(u(0.38), u(0.5));
      g.lineTo(u(0.14), u(0.5));
      g.closePath();
      g.fill();
      break;
    case "burstRing": {
      // Two rings and a core — the 360° tell. Rings, not a star, so it cannot be
      // confused with `spark` or `burst` in the dev console.
      const core = Math.max(1, Math.round(s * 0.12));
      g.beginPath();
      g.arc(u(0.5), u(0.5), Math.max(1, core), 0, Math.PI * 2);
      g.fill();
      for (const r of [0.26, 0.42]) {
        g.beginPath();
        g.arc(u(0.5), u(0.5), u(r), 0, Math.PI * 2);
        g.stroke();
      }
      break;
    }
    case "magnet":
      // A horseshoe, poles DOWN, with the two tips capped — the cap is what
      // stops it reading as a plain arch at this size.
      g.beginPath();
      g.arc(u(0.5), u(0.52), u(0.32), Math.PI, 0);
      g.stroke();
      bar(0.18, 0.52, 0.14, 0.3);
      bar(0.68, 0.52, 0.14, 0.3);
      bar(0.18, 0.76, 0.14, 0.12);
      bar(0.68, 0.76, 0.14, 0.12);
      break;
    case "hourglass":
      bar(0.16, 0.08, 0.68, 0.1);
      bar(0.16, 0.82, 0.68, 0.1);
      g.beginPath();
      g.moveTo(u(0.22), u(0.18));
      g.lineTo(u(0.78), u(0.18));
      g.lineTo(u(0.5), u(0.5));
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(u(0.5), u(0.5));
      g.lineTo(u(0.78), u(0.82));
      g.lineTo(u(0.22), u(0.82));
      g.closePath();
      g.fill();
      break;
    case "blades": {
      // Three crescents around a hub, matching the orbiting blades actually
      // drawn in the world — the slot's mark and the effect should be the same
      // shape, or the glow is teaching the wrong thing.
      g.beginPath();
      g.arc(u(0.5), u(0.5), Math.max(1, Math.round(s * 0.1)), 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 3; i++) {
        const a0 = (i * 2 * Math.PI) / 3;
        g.beginPath();
        g.arc(u(0.5), u(0.5), u(0.34), a0, a0 + 1.1);
        g.stroke();
      }
      break;
    }
    case "droplet":
      // A teardrop over a puddle — the spill, not the barrel. A barrel at 16px
      // is a rectangle and reads as a crate.
      g.beginPath();
      g.moveTo(u(0.5), u(0.06));
      g.lineTo(u(0.76), u(0.44));
      g.arc(u(0.5), u(0.5), u(0.28), -0.35, Math.PI + 0.35);
      g.closePath();
      g.fill();
      bar(0.1, 0.82, 0.8, 0.1);
      break;
  }
}

/**
 * The mark for each ability, exhaustive over `AbilityId`.
 *
 * `Record<AbilityId, GlyphId>` on purpose: adding an ability without giving it a
 * mark becomes a COMPILE ERROR rather than a slot that silently falls back to a
 * generic symbol — which is precisely the state this table was written to end,
 * and the same rule the nine other `Record<EnemyKind, …>` tables enforce for
 * monsters.
 */
export const ABILITY_GLYPH: Record<AbilityId, GlyphId> = {
  flippercharge: "launch",
  arcanepulse: "burstRing",
  magnetaura: "magnet",
  timecrawl: "hourglass",
  bladestorm: "blades",
  slickfield: "droplet",
};

/**
 * An ability's mark, in the ability's OWN colour.
 *
 * `AbilityDef.color` has been carried on every ability all along and documented
 * as "the glow colour for the skill slot" — it was simply never read once the
 * DOM menu went. Using it is what makes the two slots distinguishable by colour
 * as well as by silhouette, at zero cost.
 *
 * `disabled` overrides the colour rather than dimming it: a slot you cannot
 * cast has to be legible as OFF at a glance, and a darkened tint of six
 * different hues is six different shades of ambiguous.
 */
export function abilityIcon(id: AbilityId, size = 16, disabled = false): HTMLCanvasElement | null {
  return glyph(ABILITY_GLYPH[id], size, disabled ? UI.textFaint : ABILITIES[id].color);
}

/**
 * Blitting lives in `im.ts` and is re-exported here.
 *
 * It is a pure canvas operation with no dependency on this file's art sources,
 * and `button()` needs it — so putting it here would have meant either a cycle
 * or a second copy of the divisor rule. One implementation, two names for it.
 */
export { drawIcon, exactIconSize } from "./im";
