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

/** The six printed materials. */
export const STYLES: Record<StyleId, CardStyle> = {
  bone: {
    imprint: "BONE RELIC",
    // Cool, near-black stock with only a hint of warmth. An earlier cut ran to
    // #2e2519, which under the card's own centre-lit vignette rendered as SEPIA
    // — the bone cards read as warm brown parchment rather than as something
    // dug out of a dungeon. Bone is grey; the oxblood accent supplies the warmth.
    stock: ["#0e0d0c", "#211f1c"],
    panel: "#141312",
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
    stock: ["#0e1114", "#242b31"],
    panel: "#12161a",
    rule: "#69757e",
    accent: "#68b39a",
    ink: "#c6ced3",
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
    stock: ["#0d0f12", "#232a31"],
    panel: "#101317",
    rule: "#78828e",
    accent: "#d8862f",
    ink: "#cbd2da",
    glow: "#c8792a",
    grain: grainIron,
  },
  void: {
    imprint: "UNMADE",
    stock: ["#08060e", "#1a1030"],
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

/** The style for a card: its monster's material, or `void` for a chase card. */
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
