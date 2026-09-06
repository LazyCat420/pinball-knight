/**
 * CARD FACES — a slain monster, printed on the material it came from.
 *
 * WHAT THIS REPLACED, and why. The previous face was a port of a trading-app
 * "holo card" engine: a bright two-stop gradient keyed off the card's MODIFIER,
 * then diagonal rainbow foil stripes, then a 55–70%-alpha metallic wash over
 * the WHOLE card, then etched hatching, then a tiled reverse-holo sigil field,
 * then one more rainbow `overlay` pass across everything. Rendered and looked
 * at, it had four concrete faults:
 *
 *   1. THE WASH ATE THE TEXT. Those full-face `fillRect` passes ran over the
 *      stats and the move rows as readily as over the border, so every epic and
 *      above had a milky lower half — the Hulk Knuckle's "+60%" was very nearly
 *      invisible against its own frame. Treatment now clips to the FRAME and
 *      text panels are painted after it, never under it.
 *   2. THE EMBLEMS WERE EMOJI. `⚔️ ⚡ 🔥 ❄️ 🛡️` drawn with `fillText`, which is
 *      font-dependent: a headless render drew a ✗-in-a-circle where the emblem
 *      belonged on nearly every card, and any client without an emoji font hits
 *      the same hole. Every mark is a PATH now — see render/card-glyphs.ts.
 *   3. THE MYTHICS HAD NO ART. A sourceless chase card fell back to
 *      `CardDef.icon` at 150px, so the five rarest cards in the game were the
 *      only ones showing a stock emoji sticker. They have hand-drawn sigils now.
 *   4. IT WAS BUBBLY. Candy foil in a dark dungeon game, and the colour keyed
 *      off the modifier, so a Golem card and a Ghost card were the same hot
 *      orange because both add flat damage.
 *
 * The organising idea now: a card is PRINTED ON A MATERIAL that its monster
 * chose. Bone stock for the undead, ink for the incorporeal, carved slate for
 * the rooted, chitin for the arthropods, iron for the wrought, void for the
 * chase cards (render/card-styles.ts). Rarity escalates only in the frame
 * METAL, so it can never wash out the anatomy again.
 *
 * The layout is a real card's anatomy rather than a stat sheet: title bar with
 * the name and cost, an art window with an inset bevel, a type line naming the
 * monster, a text box on panel stock, then a footer. Everything is placed by
 * hand on a 512×716 face (63:88, real trading-card proportions) and the whole
 * thing is one canvas texture, so the DOM layer can tilt and light it as a
 * single surface — see ui-cards.ts.
 *
 * Deterministic: every seeded flourish comes from the card's BASE id, so a card
 * never shimmers between repaints and every copy of a card looks like the same
 * card.
 */
import { RARITY_HEX, cardDef, cardPower, modifierRows, type CardDef, type CardId, type CardRarity, type ModifierRow } from "../cards";
import { KIND_INFO } from "../bestiary";
import { monsterPortrait, portraitScale } from "./monster-portrait";
import { getCardArtImage } from "./card-art-loader";
import { drawGlyph, glyphPip, glyphSparkle, sigilFor, type Glyph } from "./card-glyphs";
import { elementFor, metalFor, styleForCard, type CardStyle, type Metal } from "./card-styles";
import { mulberry32 } from "../../../utils/rng";

/** Real trading-card proportions (63mm × 88mm). */
export const CARD_W = 512;
export const CARD_H = 716;

/** Rarity → tier, the number the frame metal keys off. */
const TIER: Record<CardRarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };

// ── LAYOUT ────────────────────────────────────────────────────────────────────
// One table, so the regions are checkable against each other instead of being
// scattered as magic numbers through 400 lines of painting. The previous face
// had a fixed 188px text box regardless of content, which left one-stat cards
// (Spider Silk, Wisp Spark) with a 40%-of-the-card empty black rectangle.
const PAD = 22; // card edge → frame content
const TITLE_Y = 30;
const TITLE_H = 46;
const ART_Y = 88;
const ART_H = 320;
const TYPE_Y = ART_Y + ART_H + 10; // type line, directly under the art
const TYPE_H = 30;
const BOX_Y = TYPE_Y + TYPE_H + 10; // text box top
const FOOT_H = 34; // footer band at the bottom

/** FNV-1a — stable seeding for the grain and flourishes. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// The seeded stream for a card's grain is `mulberry32` from utils/rng — that
// module exists because three byte-identical private copies of it had already
// drifted apart once, and a fourth here would be the same mistake. It also
// matters for the ART: a bare LCG's low bits are famously non-random, and the
// grain painters consume the stream in tight loops (`rand() * w, rand() * h`),
// which is exactly the pattern where LCG lattice structure shows up as visible
// banding in the card stock.

/**
 * The card's effects as stat rows, capped at what the text box can hold.
 *
 * The WALK and the FORMATTING both live in cards.ts (`modifierRows`) next to
 * the schema they read — this used to be a second, independent enumeration of
 * every `CardModifier` field, and it drifted from the prose one exactly as you
 * would expect: the same crit-rounding fix had to be applied in both files, and
 * the two disagreed about which effects were even worth printing.
 *
 * What is left here is a RENDER decision: how many rows fit on a card.
 */
function movesFor(c: CardDef): ModifierRow[] {
  return modifierRows(c.modifier).slice(0, 4);
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The card's type faces. One serif for display, one mono for data. */
const DISPLAY = `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
const DATA = `ui-monospace, Menlo, Consolas, monospace`;

/** Shrink a label until it fits — long card names must never overflow. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, basePx: number, weight: number, family: string): number {
  let px = basePx;
  do {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
    px -= 1;
  } while (px > 10);
  return px;
}

/** Letter-spaced small caps, the type line's voice. */
function tracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: "left" | "center" | "right" = "left"): void {
  const chars = [...text];
  const total = chars.reduce((w, ch) => w + ctx.measureText(ch).width + spacing, 0) - spacing;
  let cx = align === "left" ? x : align === "center" ? x - total / 2 : x - total;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  for (const ch of chars) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = prev;
}

/** A metal gradient across a box — the bevel look, light→dark→light. */
function metalGrad(ctx: CanvasRenderingContext2D, m: Metal, x: number, y: number, w: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, m.stops[0]);
  g.addColorStop(0.5, m.stops[1]);
  g.addColorStop(1, m.stops[2]);
  return g;
}

/**
 * A corner filigree — a short double-rule with a turned end, mirrored into each
 * corner of a box. This is what makes the frame read as PRINTED rather than as
 * a rounded rectangle, and it costs four strokes.
 */
function filigree(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, len: number): void {
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const cx = sx > 0 ? x : x + w;
      const cy = sy > 0 ? y : y + h;
      ctx.beginPath();
      ctx.moveTo(cx + sx * len, cy);
      ctx.lineTo(cx + sx * 7, cy);
      ctx.quadraticCurveTo(cx, cy, cx, cy + sy * 7);
      ctx.lineTo(cx, cy + sy * len);
      ctx.stroke();
    }
  }
}

/**
 * PAINTED-FACE CACHE, keyed by card id.
 *
 * A face is expensive — ~1,900 canvas ops for an average card and ~3,700 for a
 * chitin one, whose grain painter alone strokes 828 arcs — and it is perfectly
 * DETERMINISTIC: `paintFace` derives everything from the id, including the
 * level and shine that the id itself encodes (`spidersilk#4s`). So the id is a
 * complete cache key.
 *
 * This matters because the consumers all rebuild their DOM wholesale.
 * `tavern.ts` and `menu.ts` assign `stage.innerHTML = …` and then call
 * `paintHoloCards`, which means the per-canvas `dataset.painted` guard in
 * ui-cards.ts can never survive to a second read — the element carrying it was
 * just discarded. Every buy, pick, reroll, forge and tab switch therefore
 * repainted the entire visible stash from scratch to produce a pixel-identical
 * result. At a 30-card stash that is ~56,000 canvas ops and ~30 discarded
 * offscreen canvases per click.
 *
 * With the cache, the first paint of a given card is the only real one; every
 * later one is a single `drawImage`. It also takes `paintCard` off the gameplay
 * hot path — `pickup-toast.ts` paints a face inline, mid-run, while the
 * dungeon's three.js loop is running.
 */
const _faceCache = new Map<CardId, HTMLCanvasElement>();

/** Bounded so a long session with many card instances cannot grow without end. */
const FACE_CACHE_MAX = 80;

/**
 * Paint one card onto a canvas, which must already be CARD_W × CARD_H.
 *
 * Cached: the face is painted once per card id and blitted thereafter.
 */
export function paintCard(canvas: HTMLCanvasElement, id: CardId): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let face = _faceCache.get(id);
  if (!face) {
    if (typeof document === "undefined") {
      // No DOM to build an offscreen face in (unit tests import this module):
      // fall back to painting straight onto the caller's canvas.
      paintFace(canvas, id);
      return;
    }
    face = document.createElement("canvas");
    face.width = CARD_W;
    face.height = CARD_H;
    paintFace(face, id);
    // Simple FIFO eviction — cards are re-requested in bursts (a stash render),
    // so anything fancier buys nothing over an 80-entry window.
    if (_faceCache.size >= FACE_CACHE_MAX) {
      const oldest = _faceCache.keys().next().value;
      if (oldest !== undefined) _faceCache.delete(oldest);
    }
    _faceCache.set(id, face);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(face, 0, 0, canvas.width, canvas.height);
}

/** Test seam: drop the memoised faces. */
export function _clearFaceCache(): void {
  _faceCache.clear();
}

/**
 * Paint a card face from scratch. Deterministic from the card id.
 *
 * Not exported: callers go through `paintCard`, which caches.
 */
function paintFace(canvas: HTMLCanvasElement, id: CardId): void {
  // cardDef, not CARDS — this id may carry a LEVEL and a SHINY flag (see the
  // instance section of cards.ts), and the face must print the stats this copy
  // actually has rather than the catalogue's level-1 ones.
  const c = cardDef(id);
  const ctx = canvas.getContext("2d");
  if (!c || !ctx) return;

  const level = c.level ?? 1;
  const shiny = !!c.shiny;
  const tier = TIER[c.rarity];
  // The card's own tint of its material, not the family's flat palette — see
  // styleForCard. Two bone cards side by side were rendering the same colour.
  const st = styleForCard(c.source, c.base ?? c.id);
  const metal = metalFor(tier);
  const el = elementFor(c.modifier); // the element MARK (a path, never an emoji)
  // Seeded off the BASE, so every copy of a card shares one grain: the level is
  // a badge on a known face, not a different card.
  const rand = mulberry32(hashString(c.base ?? c.id));
  const W = CARD_W;
  const H = CARD_H;
  const rarityCol = RARITY_HEX[c.rarity];

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  rr(ctx, 0, 0, W, H, 26);
  ctx.clip();

  // ── CARD STOCK ──
  // The material, tinted for THIS card (styleForCard). No rainbow and no
  // element gradient: the stock says which monster family this is, and the
  // per-card tint keeps two cards of one family from being the same swatch.
  //
  // FIVE stops, not two. A two-stop ramp across a card this size is read by the
  // eye as a flat field — the whole complaint that "the cards are just solid
  // colours" was, mechanically, this gradient. Alternating the light and dark
  // ends along the diagonal gives the surface somewhere to turn, so the stock
  // has visible structure everywhere instead of only at its two corners.
  const stock = ctx.createLinearGradient(0, 0, W * 0.75, H);
  stock.addColorStop(0, st.stock[1]);
  stock.addColorStop(0.28, st.stock[0]);
  stock.addColorStop(0.52, st.stock[1]);
  stock.addColorStop(0.78, st.stock[0]);
  stock.addColorStop(1, st.stock[1]);
  ctx.fillStyle = stock;
  ctx.fillRect(0, 0, W, H);

  // A broad cross-light from the upper left, at right angles to the ramp above.
  // Two gradients crossing is what stops the card reading as a single sheet of
  // colour — it is the difference between "printed stock" and "a fill".
  const cross = ctx.createLinearGradient(0, 0, W, H * 0.35);
  cross.addColorStop(0, "rgba(255,255,255,0.055)");
  cross.addColorStop(0.45, "rgba(255,255,255,0.012)");
  cross.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = cross;
  ctx.fillRect(0, 0, W, H);

  st.grain(ctx, 0, 0, W, H, rand);

  // A vignette, so the card has a lit centre and dark edges like a printed
  // object rather than a flat fill.
  const vig = ctx.createRadialGradient(W / 2, H * 0.38, H * 0.2, W / 2, H * 0.45, H * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  // The art window is painted AFTER this and carries its own lighting, so the
  // vignette must not also be spent darkening it — three subtractive passes over
  // one region is how the portraits ended up nearly invisible.

  // ── FRAME RULES ──
  // A double hairline just inside the card edge, in the rarity metal. This is
  // the ONLY place tier repaints anything, and it is 2px wide.
  ctx.strokeStyle = metalGrad(ctx, metal, 0, 0, W, H);
  ctx.lineWidth = 2;
  rr(ctx, 11, 11, W - 22, H - 22, 18);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  rr(ctx, 16, 16, W - 32, H - 32, 14);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Corner filigree in the same metal — printed furniture, not a border-radius.
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.75;
  filigree(ctx, 16, 16, W - 32, H - 32, 34);
  ctx.globalAlpha = 1;

  // ── TITLE BAR ──
  // Name on the left, power on the right, separated by a rule. Sits on a panel
  // so a long name never fights the stock's grain for legibility.
  const titleW = W - PAD * 2;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  rr(ctx, PAD, TITLE_Y - 26, titleW, TITLE_H, 7);
  ctx.fill();
  ctx.strokeStyle = st.rule;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  rr(ctx, PAD, TITLE_Y - 26, titleW, TITLE_H, 7);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The power number claims the right end of the bar, so the name is measured
  // against what is actually left over.
  const pwr = String(cardPower(c));
  ctx.font = `700 30px ${DATA}`;
  const pwrW = ctx.measureText(pwr).width;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = st.ink;
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 4;
  fitText(ctx, c.label, titleW - pwrW - 44, 29, 600, DISPLAY);
  ctx.fillText(c.label, PAD + 14, TITLE_Y + 6);
  ctx.shadowBlur = 0;

  ctx.textAlign = "right";
  ctx.font = `700 30px ${DATA}`;
  ctx.fillStyle = metal.glow;
  ctx.fillText(pwr, W - PAD - 14, TITLE_Y + 6);

  // ── ART WINDOW ──
  const ax = PAD + 8;
  const aw = W - (PAD + 8) * 2;
  const ay = ART_Y;
  const ah = ART_H;

  // The window is set INTO the card: a metal bevel proud of it, then a dark
  // recess. That inset is most of what sells a card as an object.
  ctx.fillStyle = metalGrad(ctx, metal, ax - 4, ay - 4, aw + 8, ah + 8);
  rr(ctx, ax - 4, ay - 4, aw + 8, ah + 8, 9);
  ctx.fill();
  // A shadow line along the top/left inside the bevel — the recess.
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  rr(ctx, ax - 2, ay - 2, aw + 4, ah + 4, 8);
  ctx.fill();

  ctx.save();
  rr(ctx, ax, ay, aw, ah, 6);
  ctx.clip();

  const portrait = c.source ? monsterPortrait(c.source, c.subType) : null;

  // Backdrop: a lit floor and a dark sky in the STYLE's glow colour, so the
  // creature stands in a place rather than on a gradient. The old face painted
  // one of four seeded ray/ring patterns here, which at any usable strength
  // read straight THROUGH the creature standing in front of it.
  const sky = ctx.createLinearGradient(0, ay, 0, ay + ah);
  sky.addColorStop(0, "#0a0c12");
  sky.addColorStop(0.5, st.stock[1]);
  sky.addColorStop(1, "#07080c");
  ctx.fillStyle = sky;
  ctx.fillRect(ax, ay, aw, ah);

  // A shaft of light from behind the subject: the one thing that separates flat
  // cel art from its background at this size.
  //
  // This carries most of the window's LIGHT BUDGET, and the first cut set it far
  // too low (`44`/`14` hex alpha) — stacked under the card vignette and the
  // ground haze, the Goblin and Crystalback windows came out very nearly black
  // and their portraits disappeared. Read the three passes together, not one at
  // a time: the backdrop is the only one adding light and two are taking it away.
  const shaft = ctx.createRadialGradient(ax + aw / 2, ay + ah * 0.48, 6, ax + aw / 2, ay + ah * 0.48, aw * 0.62);
  shaft.addColorStop(0, `${st.glow}96`);
  shaft.addColorStop(0.45, `${st.glow}3c`);
  shaft.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shaft;
  ctx.fillRect(ax, ay, aw, ah);

  const customArt = getCardArtImage(c.id);
  if (customArt) {
    ctx.drawImage(customArt, ax, ay, aw, ah);
  } else if (portrait) {
    paintPortrait(ctx, portrait, c, ax, ay, aw, ah, st, rarityCol);
  } else {
    paintSigil(ctx, sigilFor(c.base ?? c.id), ax, ay, aw, ah, st, metal, rand);
  }

  // Ground haze along the bottom of the window, tying the subject to the floor.
  const haze = ctx.createLinearGradient(0, ay + ah * 0.8, 0, ay + ah);
  haze.addColorStop(0, "rgba(0,0,0,0)");
  haze.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = haze;
  ctx.fillRect(ax, ay + ah * 0.8, aw, ah * 0.2);

  // SHINY / HOLOGRAPHIC — Pokémon-style iridescent rainbow foil wash + galaxy sparkles.
  if (shiny) {
    // 1. Rainbow iridescent gradient wash across the art window
    const foilGrad = ctx.createLinearGradient(ax, ay, ax + aw, ay + ah);
    foilGrad.addColorStop(0.00, "rgba(255, 60, 60, 0.22)");
    foilGrad.addColorStop(0.20, "rgba(255, 180, 40, 0.22)");
    foilGrad.addColorStop(0.40, "rgba(255, 255, 60, 0.22)");
    foilGrad.addColorStop(0.60, "rgba(40, 255, 140, 0.22)");
    foilGrad.addColorStop(0.80, "rgba(40, 160, 255, 0.22)");
    foilGrad.addColorStop(1.00, "rgba(220, 60, 255, 0.22)");
    ctx.fillStyle = foilGrad;
    ctx.fillRect(ax, ay, aw, ah);

    // 2. Galaxy cosmic four-point star glints
    for (let i = 0; i < 15; i++) {
      const sx = ax + 14 + rand() * (aw - 28);
      const sy = ay + 14 + rand() * (ah - 28);
      const r = 5 + rand() * 12;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.8);
      g.addColorStop(0, "rgba(255,255,255,0.92)");
      g.addColorStop(0.5, "rgba(255,240,200,0.45)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(sx - r * 1.8, sy - r * 1.8, r * 3.6, r * 3.6);
      ctx.fillStyle = "#ffffff";
      drawGlyph(ctx, glyphSparkle, sx, sy, r);
    }
  }

  ctx.restore();

  // The element mark, bottom-right inside the art window: a small metal disc
  // with the element's PATH glyph struck into it. This is the emblem that used
  // to be an emoji.
  const ex = ax + aw - 30;
  const ey = ay + ah - 30;
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.beginPath();
  ctx.arc(ex, ey, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = metalGrad(ctx, metal, ex - 17, ey - 17, 34, 34);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(ex, ey, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = st.accent;
  ctx.strokeStyle = st.accent;
  ctx.lineWidth = 1.8;
  drawGlyph(ctx, el, ex, ey, 9.5);

  // ── TYPE LINE ──
  // Names the monster. A card is a slain monster's power bottled, so this is the
  // line that says whose — and it is set in the display face at real size,
  // tracked out, the way a card's type line reads.
  // A sourceless chase card has no monster, so it names its own nature instead.
  // Printing one shared "UNBOUND RELIC" on all five wasted the most prominent
  // line on the card saying the same nothing five times.
  // A sourced card names its monster; a sourceless chase card names its own
  // nature, which cards.ts authors alongside its label (`typeLine`).
  const typeText = (c.typeLine ?? (c.source ? (c.subType ?? KIND_INFO[c.source].label) : "Unbound Relic")).toUpperCase();
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  rr(ctx, PAD, TYPE_Y, W - PAD * 2, TYPE_H, 6);
  ctx.fill();
  ctx.strokeStyle = st.rule;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  rr(ctx, PAD, TYPE_Y, W - PAD * 2, TYPE_H, 6);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.font = `700 15px ${DATA}`;
  ctx.fillStyle = st.accent;
  ctx.textAlign = "left";
  tracked(ctx, typeText, PAD + 14, TYPE_Y + 20, 1.6);

  // Right end of the type line: the fit qualifier.
  ctx.font = `700 11px ${DATA}`;
  ctx.fillStyle = st.ink;
  ctx.globalAlpha = 0.62;
  const fits = c.weaponKinds === "both" ? "ANY WEAPON" : `${c.weaponKinds.toUpperCase()} ONLY`;
  tracked(ctx, fits, W - PAD - 14, TYPE_Y + 20, 1.2, "right");
  ctx.globalAlpha = 1;

  // ── TEXT BOX ──
  // Height DERIVES from the row count, so a one-effect card does not print a
  // 188px empty rectangle the way the old fixed-height box did.
  const moves = movesFor(c);
  const ROW_H = 40;
  const boxH = Math.max(84, moves.length * ROW_H + 30);
  const boxY = BOX_Y;
  const boxW = W - PAD * 2;

  ctx.fillStyle = st.panel;
  rr(ctx, PAD, boxY, boxW, boxH, 7);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = st.rule;
  ctx.lineWidth = 1;
  rr(ctx, PAD, boxY, boxW, boxH, 7);
  ctx.stroke();
  ctx.globalAlpha = 1;

  moves.forEach((mv, i) => {
    const my = boxY + 18 + i * ROW_H;
    // The element mark again at bullet size, in the row's own valence colour —
    // a path, so it stays a mark and never becomes a tofu box.
    const col = mv.good ? st.accent : "#e0574a";
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    drawGlyph(ctx, el, PAD + 24, my + 10, 7);

    ctx.textAlign = "left";
    ctx.fillStyle = st.ink;
    ctx.font = `500 19px ${DISPLAY}`;
    ctx.fillText(mv.name, PAD + 42, my + 16);

    ctx.textAlign = "right";
    ctx.font = `700 20px ${DATA}`;
    ctx.fillStyle = col;
    ctx.fillText(mv.value, W - PAD - 16, my + 16);

    if (i < moves.length - 1) {
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = st.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD + 18, my + 28);
      ctx.lineTo(W - PAD - 18, my + 28);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });

  // ── FLAVOUR ──
  // The gap between the text box and the footer, if any, carries the monster's
  // blurb in italic — the line that makes the card feel written rather than
  // generated. Only drawn when there is real room for it.
  const footY = H - PAD - FOOT_H;
  const gap = footY - (boxY + boxH);
  // Same rule as the type line: the card's own authored flavour if it has one,
  // otherwise its monster's blurb.
  const blurb = c.flavour ?? (c.source ? KIND_INFO[c.source].blurb : undefined);
  if (gap > 40 && blurb) {
    ctx.globalAlpha = 0.55;
    ctx.textAlign = "center";
    ctx.fillStyle = st.ink;
    const px = fitText(ctx, blurb, boxW - 40, 15, 400, DISPLAY);
    ctx.font = `italic ${px}px ${DISPLAY}`;
    ctx.fillText(blurb, W / 2, boxY + boxH + gap / 2 + 5);
    ctx.globalAlpha = 1;
  }

  // ── FOOTER ──
  // A rule, then rarity pips + name on the left and the imprint on the right.
  ctx.strokeStyle = st.rule;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, footY);
  ctx.lineTo(W - PAD, footY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Rarity as PIPS — glyphs, replacing the "★★★" text run, which was one more
  // font-dependent mark on a face that is meant to have none.
  ctx.fillStyle = metal.glow;
  for (let i = 0; i <= tier; i++) drawGlyph(ctx, glyphPip, PAD + 8 + i * 15, footY + 19, 5.5);

  ctx.textAlign = "left";
  ctx.font = `700 11px ${DATA}`;
  ctx.fillStyle = metal.glow;
  tracked(ctx, c.rarity.toUpperCase(), PAD + 12 + (tier + 1) * 15, footY + 23, 1.4);

  ctx.textAlign = "right";
  ctx.fillStyle = st.ink;
  ctx.globalAlpha = 0.5;
  ctx.font = `700 10px ${DATA}`;
  // A shiny claims the footer: it is the single most interesting fact about the
  // copy in your hand, and it outranks set dressing.
  if (shiny) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffe9fb";
    ctx.shadowColor = "rgba(255,140,240,0.9)";
    ctx.shadowBlur = 9;
    drawGlyph(ctx, glyphSparkle, W - PAD - 62, footY + 19, 6);
    ctx.font = `800 12px ${DATA}`;
    tracked(ctx, "SHINY", W - PAD - 10, footY + 23, 1.6, "right");
    ctx.shadowBlur = 0;
  } else {
    tracked(ctx, st.imprint, W - PAD - 10, footY + 23, 1.2, "right");
  }
  ctx.globalAlpha = 1;

  // ── LEVEL SEAL ──
  // A struck metal disc in the title bar's left margin, drawn only from level 2:
  // a "Lv 1" plate on every common is noise, not information.
  if (level > 1) {
    const lx = W - PAD - 20;
    const ly = TITLE_Y + 44;
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.beginPath();
    ctx.arc(lx, ly, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = metalGrad(ctx, metal, lx - 17, ly - 17, 34, 34);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(lx, ly, 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = metal.glow;
    ctx.font = `800 15px ${DATA}`;
    ctx.textAlign = "center";
    ctx.fillText(String(level), lx, ly + 5);
  }

  ctx.restore();

  // ── OUTER EDGE ──
  // The card's physical edge, in the rarity metal. A SHINY takes a prismatic
  // edge whatever its rarity — that ring is what makes the pull identifiable
  // across the room and at thumbnail size.
  const bw = shiny || tier >= 3 ? 5 : 4;
  ctx.lineWidth = bw;
  if (shiny) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    ["#ffd9f4", "#9fe8ff", "#fff6c4", "#c9a3ff", "#ffd9f4"].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
    ctx.strokeStyle = g;
  } else {
    ctx.strokeStyle = metalGrad(ctx, metal, 0, 0, W, H);
  }
  rr(ctx, bw / 2, bw / 2, W - bw, H - bw, 24);
  ctx.stroke();
}

/**
 * The monster, painted into the art window.
 *
 * The cel art is authored at 128px and MUST scale with nearest-neighbour, or the
 * selout outlines blur into exactly the mush the art style exists to avoid.
 */
function paintPortrait(
  ctx: CanvasRenderingContext2D,
  portrait: HTMLCanvasElement,
  c: CardDef,
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  st: CardStyle,
  rarityCol: string,
): void {
  // Contact shadow under the feet, so the creature stands ON something.
  const fy = ay + ah * 0.85;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.filter = "blur(6px)";
  ctx.beginPath();
  ctx.ellipse(ax + aw / 2, fy, aw * 0.2, ah * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Sized off the window height and FITTED, never cropped: the cel is a 128×128
  // box with the creature in roughly the lower ⅔, so the draw is anchored on the
  // FEET and the box is capped so the head cannot leave the frame. A decapitated
  // portrait is worse than a small one, and a 1.55× hulk hits that ceiling
  // immediately.
  const feetY = ay + ah * 0.88;
  const want = ah * 1.24 * portraitScale(c.source!, c.subType);
  const box = Math.min(want, (feetY - ay - 8) / 0.86);
  const bx = ax + (aw - box) / 2;
  const by = feetY - box;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // RIM LIGHT: the sprite's own silhouette, drawn offset behind the subject so a
  // sliver of lit edge shows past it. Flat cel art carries no lighting of its
  // own, so without this it sits ON the backdrop rather than IN the scene.
  //
  // Kept DELIBERATELY faint. The first cut used `lighter` at α 0.5 with four
  // offsets, which is additive light stacked four deep: every zombie came out
  // wearing a red neon outline and the Brute's arms glowed. `source-over` at
  // low alpha, offset DOWN-LEFT only (one light, from the upper right), reads as
  // a lit edge instead of as a halo.
  const rim = document.createElement("canvas");
  rim.width = portrait.width;
  rim.height = portrait.height;
  const rctx = rim.getContext("2d");
  if (rctx) {
    rctx.drawImage(portrait, 0, 0);
    // Tint the silhouette: fill the glow colour, then clip to the sprite alpha.
    // Through a SEPARATE layer — doing it in place tints the transparent
    // background too and paints the sprite as a solid rectangle.
    rctx.globalCompositeOperation = "source-in";
    rctx.fillStyle = st.glow;
    rctx.fillRect(0, 0, rim.width, rim.height);
    const o = Math.max(2, box * 0.016);
    ctx.globalAlpha = 0.34;
    ctx.drawImage(rim, bx - o, by + o * 0.6, box, box);
    ctx.globalAlpha = 1;
  }

  // The creature itself, over a drop shadow that grounds it against the glow.
  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.drawImage(portrait, bx, by, box, box);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // A soft key light from upper-left across the subject, in the rarity colour at
  // low strength — enough to model the form without recolouring the creature.
  ctx.globalCompositeOperation = "overlay";
  const key = ctx.createLinearGradient(bx, by, bx + box, by + box);
  key.addColorStop(0, `${rarityCol}40`);
  key.addColorStop(0.5, "rgba(0,0,0,0)");
  key.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = key;
  ctx.fillRect(ax, ay, aw, ah);
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

/**
 * A sourceless chase card's art: its hand-drawn sigil, struck as an engraving.
 *
 * These cards used to fall back to `CardDef.icon` at 150px — the five rarest
 * cards in the game were the only ones whose art was a stock emoji.
 */
function paintSigil(
  ctx: CanvasRenderingContext2D,
  sigil: Glyph,
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  st: CardStyle,
  metal: Metal,
  rand: () => number,
): void {
  const cx = ax + aw / 2;
  const cy = ay + ah / 2;
  const r = Math.min(aw, ah) * 0.38;

  // A halo behind the mark, so the engraving has something to sit against.
  const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, r * 2.1);
  halo.addColorStop(0, `${st.glow}3a`);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(ax, ay, aw, ah);

  // Motes drifting around the sigil — the void stock's own weather.
  ctx.save();
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.1 + rand() * 0.4;
    ctx.fillStyle = st.accent;
    ctx.beginPath();
    ctx.arc(ax + rand() * aw, ay + rand() * ah, 0.6 + rand() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The engraving itself: a dark plate strike offset down-right, then the lit
  // mark over it. That two-pass strike is what makes a line read as CUT INTO
  // the card rather than drawn on top of it.
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = 4.2;
  drawGlyph(ctx, sigil, cx + 2, cy + 3, r);

  ctx.shadowColor = metal.glow;
  ctx.shadowBlur = 16;
  ctx.strokeStyle = metalGrad(ctx, metal, cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = metalGrad(ctx, metal, cx - r, cy - r, r * 2, r * 2);
  ctx.lineWidth = 3.6;
  drawGlyph(ctx, sigil, cx, cy, r);
  ctx.restore();
}

/** Rarity tier of a card — exported so the DOM layer can scale its effects. */
export function cardTier(id: CardId): number {
  const c = cardDef(id);
  return c ? TIER[c.rarity] : 0;
}

/** The card's printed style — the DOM layer keys its hover glow off this. */
export function cardStyle(id: CardId): CardStyle {
  const c = cardDef(id);
  return styleForCard(c?.source, c?.base ?? id);
}
