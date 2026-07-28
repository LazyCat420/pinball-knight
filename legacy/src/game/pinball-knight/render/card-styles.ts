/**
 * CARD STYLES — what a card is PRINTED ON, chosen by the monster it came from.
 *
 * The face used to be one treatment for every card: a bright two-stop gradient
 * keyed off the card's MODIFIER, plus rainbow foil stripes, plus a metallic
 * wash, plus a reverse-holo tile — candy colours stacked until the whole
 * anatomy was a pastel wash. Two things were wrong with it:
 *
 *   - It was BUBBLY, in a game whose art is a dark dungeon. A Golem card and a
 *     Ghost card were the same hot orange rectangle because both happen to add
 *     flat damage, which is the least interesting fact about either of them.
 *   - The treatment keyed off the MODIFIER, so the frame told you about a stat
 *     you can already read in the stat strip, and told you nothing about the
 *     monster — the thing the card actually IS.
 *
 * So the frame is now a MATERIAL, chosen by the monster's family: bone for the
 * undead, ink for the incorporeal, stone for the rooted, chitin for the
 * arthropods, iron for the wrought, void for the sourceless chase cards. A
 * player learns to recognise a Golem card by its slate before reading a word.
 *
 * Rarity still escalates, but INSIDE a style and only in the metal: pewter →
 * silver → tarnished gold → blackened. It never repaints the whole face, which
 * is what used to wash the stats into illegibility on every epic and above.
 *
 * DOM- and three-free: pure data plus small painters over a 2D context.
 */
import { CARDS, CARD_IDS } from "../cards";
import type { EnemyKind } from "../state";
import {
  glyphBlades,
  glyphBolt,
  glyphFang,
  glyphFlame,
  glyphFrost,
  glyphMomentum,
  glyphShield,
  glyphSwift,
  type Glyph,
} from "./card-glyphs";

export type StyleId = "bone" | "ink" | "stone" | "chitin" | "iron" | "void";

/**
 * A card's printed material.
 *
 * `ink` is the card stock itself, `panel` the text-box fill, `rule` the hairline
 * that separates regions, `accent` the one saturated colour the style is allowed
 * to use, and `grain` the texture painter that gives the stock its surface.
 */
export interface CardStyle {
  /** Human name, printed in the footer ("BONE RELIC", "IRON WORK"). */
  imprint: string;
  /** Card stock: the base fill, dark end first. */
  stock: [string, string];
  /** Text-box / plaque fill. */
  panel: string;
  /** Hairline rules and inset frame lines. */
  rule: string;
  /** The one saturated colour: headings, emblem, the rarity mark. */
  accent: string;
  /** Body text colour on `panel`. */
  ink: string;
  /** Light the art window takes, as a tint over the portrait's backdrop. */
  glow: string;
  /** Surface texture for the stock. */
  grain: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number) => void;
}

// ── GRAIN PAINTERS ────────────────────────────────────────────────────────────
// Each one paints a whole-card texture at low alpha. They are what stop a card
// from being a flat rectangle of colour, and they are the main reason the face
// reads as PRINTED rather than as a CSS gradient.

/** Bone: fine mottling plus a few hairline cracks. */
function grainBone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number): void {
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 220; i++) {
    const r = 2 + rand() * 9;
    ctx.fillStyle = rand() > 0.5 ? "#efe4cf" : "#6b5f4a";
    ctx.beginPath();
    ctx.ellipse(x + rand() * w, y + rand() * h, r, r * (0.4 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = "#3a3025";
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let cx = x + rand() * w;
    let cy = y + rand() * h;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let k = 0; k < 6; k++) {
      cx += (rand() - 0.5) * 60;
      cy += rand() * 42;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Ink: a smoky wash — soft blooms, no hard edges. */
function grainInk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number): void {
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 40 + rand() * 130;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rand() > 0.5 ? "rgba(120,140,200,0.055)" : "rgba(10,10,18,0.09)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Stone: chiselled facets and a scatter of pitting. */
function grainStone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number): void {
  ctx.save();
  ctx.globalAlpha = 0.055;
  for (let i = 0; i < 42; i++) {
    const cx = x + rand() * w;
    const cy = y + rand() * h;
    const r = 18 + rand() * 60;
    ctx.fillStyle = rand() > 0.5 ? "#b9c2c8" : "#1b2026";
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + rand() * 0.5;
      const rad = r * (0.55 + rand() * 0.5);
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = "#0a0d10";
  for (let i = 0; i < 160; i++) {
    ctx.beginPath();
    ctx.arc(x + rand() * w, y + rand() * h, 0.7 + rand() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Chitin: overlapping carapace scales, each with a lit ridge above it.
 *
 * ONE walk of the grid, not two. The first cut ran the identical nested loop
 * twice — once for the dark scale edge, once for the lighter ridge 2px above it
 * — which re-derived every `cx`/`cy` a second time for no reason and made the
 * chitin cards the most expensive faces in the game by a wide margin (~830
 * stroked arcs each, against ~130 for ink). Both arcs are drawn per cell now.
 */
function grainChitin(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number): void {
  ctx.save();
  ctx.lineWidth = 2;
  const step = 34;
  const r = step * 0.62;
  for (let row = 0; row * step < h + step; row++) {
    for (let col = -1; col * step < w + step; col++) {
      const cx = x + col * step + (row % 2 ? step / 2 : 0);
      const cy = y + row * step;
      // The scale's own edge.
      ctx.globalAlpha = 0.075;
      ctx.strokeStyle = "#0d1408";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.08, Math.PI * 0.92);
      ctx.stroke();
      // The ridge catching light just above it.
      ctx.globalAlpha = 0.05;
      ctx.strokeStyle = "#9fb46a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy - 2, r, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Iron: brushed metal streaks with rivets down the long edges. */
function grainIron(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number): void {
  ctx.save();
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 150; i++) {
    const cy = y + rand() * h;
    ctx.strokeStyle = rand() > 0.5 ? "#aab3bd" : "#14181e";
    ctx.lineWidth = 0.6 + rand() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, cy);
    ctx.lineTo(x + w, cy + (rand() - 0.5) * 6);
    ctx.stroke();
  }
  ctx.restore();
}

/** Void: a starless dark with faint arcane ruling. */
function grainVoid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number): void {
  ctx.save();
  // A slow radial fall-off from the centre, so the stock is not flat black.
  const g = ctx.createRadialGradient(x + w / 2, y + h * 0.42, 10, x + w / 2, y + h * 0.42, w * 0.95);
  g.addColorStop(0, "rgba(96,52,150,0.20)");
  g.addColorStop(0.6, "rgba(40,20,70,0.10)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Concentric arcane rules, off-centre so they read as an engraved seal rather
  // than as a target.
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = "#c9a3ff";
  ctx.lineWidth = 1;
  for (let r = 40; r < w * 1.1; r += 26) {
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.4, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#e9dbff";
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.1 + rand() * 0.35;
    ctx.beginPath();
    ctx.arc(x + rand() * w, y + rand() * h, 0.5 + rand() * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── PER-CARD VARIATION ────────────────────────────────────────────────────────
//
// Six materials is six palettes, and that is not enough. A dealer counter shows
// three cards at once and a stash shows thirty; when two of them share a family
// they were rendering as literally the same colour, so a row of cards read as
// one repeated swatch. The material was doing its job — "this is a bone card" —
// and then stopping.
//
// So every CARD gets its own hue and value shift INSIDE its family. Two bone
// cards become cold ash and warm ochre; two chitin cards become olive and teal.
// The family still reads at a glance (all bone cards are recognisably bone) but
// no two cards are the same colour, which is what makes a row of them look like
// a collection rather than a repeated tile.
//
// The shift is derived from the card id, so it is stable: a Hobbler Brace is
// always the same ash-grey, on every screen, forever.

/** #rrggbb → [r,g,b] 0-255. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** RGB 0-255 → HSL with h in turns [0,1), s and l in [0,1]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/**
 * Rotate a colour's hue and nudge its saturation/lightness.
 *
 * Hue is rotated in TURNS, and the rotation is deliberately small (the caller
 * passes ±0.055 at most, ~20°): past that a bone card stops looking like bone
 * and the material system loses its meaning. The point is variety WITHIN a
 * family, not six families becoming thirty.
 *
 * Near-greyscale colours (the card stocks are almost black) barely respond to a
 * hue rotation, so `sat` lifts saturation a little first — otherwise the shift
 * would be invisible on exactly the colours that most need it.
 */
function shift(hex: string, hue: number, sat: number, lum: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  // LIGHTNESS IS APPLIED PROPORTIONALLY, not absolutely.
  //
  // These stocks live at lightness 0.12-0.16, so an absolute ±0.043 step is a
  // 30-36% relative change — enough to carry a card most of the way to another
  // material. Scaling by the base lightness makes "one step" mean the same
  // amount of visible change on a near-black bone stock as on a lighter one,
  // which is what the caller actually intends when it asks for a spread.
  const nl = Math.max(0.02, Math.min(1, l * (1 + lum)));
  const [nr, ng, nb] = hslToRgb((h + hue + 1) % 1, Math.max(0, Math.min(1, s + sat)), nl);
  return rgbToHex(nr, ng, nb);
}

/**
 * Which slot a card occupies among the cards that share its material, and how
 * many there are.
 *
 * Built lazily from the catalogue on first use and then memoised: the roster is
 * static, so a card's slot is fixed for the life of the process — the tint it
 * produces is as stable as a hash would be, without a hash's collisions.
 *
 * An unknown id (a levelled instance whose base was passed, or a card that is
 * not in the catalogue at all) falls back to a hash-derived slot, so the
 * function is total.
 */
let _slots: Map<string, { slot: number; count: number }> | null = null;

function familySlot(source: EnemyKind | undefined, id: string): { slot: number; count: number } {
  if (!_slots) {
    _slots = new Map();
    const byFamily = new Map<StyleId, string[]>();
    for (const cid of CARD_IDS) {
      const sid = CARDS[cid].source ? KIND_STYLE[CARDS[cid].source!] : "void";
      byFamily.set(sid, [...(byFamily.get(sid) ?? []), cid]);
    }
    for (const ids of byFamily.values()) {
      ids.forEach((cid, i) => _slots!.set(cid, { slot: i, count: ids.length }));
    }
  }
  const hit = _slots.get(id);
  if (hit) return hit;
  // Not in the catalogue: derive a slot from the id so the card still gets a
  // stable tint rather than the family's flat default.
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const count = source ? 8 : 5;
  return { slot: (h >>> 0) % count, count };
}

/**
 * A style, tinted for one specific card.
 *
 * LIGHTNESS separates (evenly across the family, so the minimum gap between two
 * cards is guaranteed by construction), HUE and SATURATION supply character in
 * small amounts. See the body for why that division is the way round it is.
 *
 * The accent and glow take a MATCHING rotation, so a card's frame, its type line
 * and the light in its art window all agree — a cold bone card glows cold, a
 * warm one glows warm. Tinting the stock alone would leave every card in a
 * family throwing identical light.
 */
export function styleForCard(source: EnemyKind | undefined, id: string): CardStyle {
  const base = styleFor(source);
  // SPREAD, not hash.
  //
  // Hashing the id gave a random point in the tint range, and random points
  // collide: `hobblerbrace` and `runnersinew` — both bone cards, both commonly
  // on screen together — landed 1.4/255 apart, which is to say identical. The
  // whole purpose of the tint is that two cards of one family look different, so
  // "usually different" is not good enough.
  //
  // Instead each card takes a fixed SLOT in its family's tint range, from the
  // card's position among its family's members. N cards in a family are spread
  // evenly across the range, so the minimum separation is a property of the
  // construction rather than a hope about the hash. Still fully deterministic:
  // the roster is a static catalogue, so a card's slot never moves at runtime.
  const { slot, count } = familySlot(source, id);
  // LIGHTNESS IS THE PRIMARY AXIS, and it is monotonic in the slot.
  //
  // Golden-ratio strides on all three axes looked well-distributed in HSL and
  // still rendered collisions (midgetclaw and brutecleaver landed 2.2/255
  // apart). The reason is that these stocks are near-black: at that end of the
  // scale a big hue rotation and a saturation change both compress into almost
  // no RGB movement, so two "different" HSL triples resolve to the same colour.
  // Only lightness reliably survives.
  //
  // So lightness walks the family evenly — slot 0 is the darkest card of its
  // family, the last slot the lightest — which guarantees a minimum separation
  // by construction. Hue and saturation then ride golden-ratio strides ON TOP,
  // giving each card its own character (ash vs ochre vs rust) without being
  // relied on to do the separating.
  const span = Math.max(1, count - 1);
  const step = count > 1 ? slot / span : 0.5;
  // The spread is CENTRED on the family's base, so the family's own colour is
  // the middle of its range rather than its dark end, and it is expressed as a
  // FRACTION of that base lightness (see `shift`). ±30% of a near-black stock is
  // a clearly visible step without being enough to reach another material — six
  // dark stocks cannot all be far apart, and the closest pair of families sits
  // about 13/255 away no matter how they are authored.
  const lum = (step - 0.5) * 0.62;
  const t = count > 1 ? (slot * 0.618034) % 1 : 0.5;
  // HUE IS THE SMALL AXIS — ±11°, not ±34°.
  //
  // A wider rotation was tried and rendered beautifully varied cards that no
  // longer read as a SET: at ±34° the bone family ran from crimson through
  // magenta to olive, so Brute Cleaver and Shambler Hide shared an imprint and
  // nothing else. The tint exists to distinguish cards WITHIN a family, and it
  // is worthless if it costs the family its identity — a player has to be able
  // to recognise a bone card across the room, which was the entire argument for
  // materials over the old per-modifier colouring.
  //
  // Lightness above does the separating; hue only supplies character.
  const hue = (t - 0.5) * 0.06;
  // Saturation is CENTRED on zero too. An earlier cut used `0.06 + p * 0.16`,
  // i.e. it only ever ADDED saturation — so every card was more colourful than
  // its own family's base and the whole family drifted together, on top of the
  // lightness spread. That made saturation the dominant term rather than the
  // decorative one, and pushed cards (crystalshard, golemcore) far enough to sit
  // nearer a different material than their own.
  const sat = (((slot * 0.381966) % 1) - 0.5) * 0.14;
  return {
    ...base,
    // The stock carries most of the variation — it is the largest area on the
    // card and therefore the thing that reads from across a counter.
    stock: [shift(base.stock[0], hue, sat * 0.5, lum * 0.45), shift(base.stock[1], hue, sat, lum)],
    panel: shift(base.panel, hue, sat * 0.55, lum * 0.4),
    rule: shift(base.rule, hue, sat * 0.3, 0),
    accent: shift(base.accent, hue, sat * 0.3, lum * 0.5),
    ink: shift(base.ink, hue, sat * 0.15, 0),
    glow: shift(base.glow, hue, sat * 0.3, lum * 0.5),
  };
}

/** The six printed materials. */
export const STYLES: Record<StyleId, CardStyle> = {
  bone: {
    imprint: "BONE RELIC",
    // Cool, dark, but NOT desaturated to grey. An early cut ran to #2e2519,
    // which under the card's centre-lit vignette rendered as SEPIA — bone cards
    // read as warm parchment rather than as something dug out of a dungeon. The
    // over-correction was worse: at #211f1c the stock is only 8% saturated, so
    // the darker half of the per-card tint flattened it to literal grey
    // (#151515) and those cards lost their family identity altogether. A stock
    // needs enough colour in it to still HAVE a hue after being darkened.
    stock: ["#100d0a", "#282019"],
    panel: "#161311",
    rule: "#786a55",
    accent: "#c0472f",
    ink: "#d6cfc0",
    glow: "#a8482f",
    grain: grainBone,
  },
  ink: {
    imprint: "INK BOUND",
    stock: ["#080a10", "#161c2c"],
    panel: "#0c1018",
    rule: "#5c6b8c",
    accent: "#7ea6d8",
    ink: "#c3cee0",
    glow: "#6d8fd0",
    grain: grainInk,
  },
  stone: {
    imprint: "CARVED SLATE",
    // Deliberately COOLER and greener than iron. These two started 1.4/255
    // apart — slate and iron are both "dark grey", so writing them from
    // intuition produced two families that were the same colour and a Golem card
    // was indistinguishable from a Goblin card. Slate leans mineral-green here;
    // iron leans blue-steel. Six materials only work if all six are separable.
    stock: ["#0b1211", "#1d2b27"],
    panel: "#0f1615",
    rule: "#5f7a72",
    accent: "#68b39a",
    ink: "#c2d0cb",
    glow: "#5fae94",
    grain: grainStone,
  },
  chitin: {
    imprint: "CHITIN PLATE",
    stock: ["#0b0f08", "#1e2812"],
    panel: "#0e1309",
    rule: "#6d7f47",
    accent: "#a8c85a",
    ink: "#cbd6ac",
    glow: "#9dc257",
    grain: grainChitin,
  },
  iron: {
    imprint: "IRON WORK",
    // Blue-steel, pulled away from slate's mineral green (see the note there).
    stock: ["#0c0f15", "#212a38"],
    panel: "#0f1319",
    rule: "#78828e",
    accent: "#d8862f",
    ink: "#cbd2da",
    glow: "#c8792a",
    grain: grainIron,
  },
  void: {
    imprint: "UNMADE",
    // Pushed deeper into violet, away from ink's blue. The two started close
    // enough that a lightness-tinted ink card could land nearer void than its
    // own family — the chase cards have to read as something else entirely.
    stock: ["#0a0616", "#22103f"],
    panel: "#0b0814",
    rule: "#8b6bc4",
    accent: "#c08bff",
    ink: "#ddd0f2",
    glow: "#a86bff",
    grain: grainVoid,
  },
};

/**
 * Which material a monster's card is printed on.
 *
 * EXHAUSTIVE by EnemyKind on purpose, the same discipline KIND_INFO and
 * KIND_PORTRAIT keep: adding a monster should be a compile error here rather
 * than a card that silently falls back to a default stock.
 */
export const KIND_STYLE: Record<EnemyKind, StyleId> = {
  // The undead and the meat — bone stock, oxblood accents.
  zombie: "bone",
  brute: "bone",
  reaper: "bone",
  chomper: "bone",
  bloater: "bone",
  hound: "bone",

  // The incorporeal — ink stock, cold blue.
  ghost: "ink",
  wisp: "ink",
  bat: "ink",
  necromancer: "ink",

  // The rooted and the mineral — carved slate.
  golem: "stone",
  crystalback: "stone",
  pin: "stone",
  mimic: "stone",

  // The arthropods and the ooze — chitin plate.
  spider: "chitin",
  webspinner: "chitin",
  slime: "chitin",
  spitter: "chitin",

  // The wrought and the warlike — iron work.
  goblin: "iron",
  warden: "iron",
  sapper: "iron",
  magnet: "iron",
};

/**
 * The base material for a monster — its family's palette, untinted.
 *
 * Callers painting a specific card want `styleForCard`, which tints this for
 * that card. This is the family lookup underneath.
 */
export function styleFor(source: EnemyKind | undefined): CardStyle {
  return STYLES[source ? KIND_STYLE[source] : "void"];
}

// ── RARITY METAL ──────────────────────────────────────────────────────────────

/**
 * The frame metal per rarity tier. This is the ONLY place rarity changes the
 * card's colour — it edges the frame and the emblem ring, and never repaints
 * the face. The old treatment washed a 55–70%-alpha metallic gradient over the
 * WHOLE card at epic and above, which is what made every legendary's stat strip
 * unreadable.
 */
export interface Metal {
  name: string;
  /** Stops for the frame edge, light → dark → light so it reads as a bevel. */
  stops: [string, string, string];
  /** Glow colour when the metal catches light. */
  glow: string;
}

export const METALS: Metal[] = [
  { name: "PEWTER", stops: ["#8b8d90", "#4b4e52", "#9a9ca0"], glow: "#9a9ca0" },
  { name: "SILVER", stops: ["#d6dde4", "#767e88", "#e7edf3"], glow: "#cfd8e2" },
  { name: "BRONZE", stops: ["#d8a45c", "#7a5320", "#e8bd76"], glow: "#d9a557" },
  { name: "TARNISHED GOLD", stops: ["#f0d489", "#8a6413", "#ffe9a8"], glow: "#f2cf74" },
  { name: "BLACKENED", stops: ["#c79bff", "#3d1f6e", "#efdcff"], glow: "#b985ff" },
];

/** The metal for a rarity tier (0..4), clamped. */
export function metalFor(tier: number): Metal {
  return METALS[Math.max(0, Math.min(METALS.length - 1, tier))];
}

// ── ELEMENT MARK ──────────────────────────────────────────────────────────────

/**
 * The mark a card wears for what it DOES — storm, blaze, frost, savage,
 * momentum, swift, guard, or plain power.
 *
 * This is the surviving half of the old `themeFor`. The element still deserves
 * a mark; it just no longer gets to repaint the entire card in hot orange, and
 * the mark is a PATH rather than the emoji it used to be.
 */
export function elementFor(m: {
  bolt?: boolean;
  onHit?: "chill" | "burn";
  pinballMult?: number;
  cooldownMult?: number;
  durabilityMult?: number;
  critChance?: number;
}): Glyph {
  if (m.bolt) return glyphBolt;
  if (m.onHit === "burn") return glyphFlame;
  if (m.onHit === "chill") return glyphFrost;
  if (m.critChance) return glyphFang;
  if (m.pinballMult && m.pinballMult > 1) return glyphMomentum;
  if (m.cooldownMult && m.cooldownMult < 1) return glyphSwift;
  if (m.durabilityMult && m.durabilityMult > 1) return glyphShield;
  return glyphBlades;
}
