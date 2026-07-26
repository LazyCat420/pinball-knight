/**
 * HOLO CARDS — the dungeon's weapon chips, painted as real trading cards.
 *
 * This is a port of the congress/senate card engine in
 * `trading-client/frontend/src/lib/holoCardEngine.js`, keeping its architecture
 * and its look, and swapping only the domain layer:
 *
 *   - Same 63:88 card ratio painted onto a 512×716 canvas (not DOM), so every
 *     region is placed by hand and the whole face can take composited foil
 *     passes that CSS simply cannot do.
 *   - Same anatomy: stage pill, name + power, energy emblem, bevelled art
 *     window, plaque, moves box, stats strip, rarity/set footers.
 *   - Same stacked rarity treatment: diagonal foil stripes → metallic wash →
 *     etched engraving → tiled reverse-holo, then ONE `overlay` foil pass over
 *     the whole face so an idle card still reads as holographic.
 *   - Same seeded LCG so a given card's speck field and backdrop are stable
 *     across repaints.
 *
 * The one deliberate divergence: the original swaps a shared three.js plane in
 * on hover for a GLSL tilt shader. This game already owns a WebGL context for
 * the dungeon itself, and a second one competing for it is a real hazard, so
 * the tilt here is a CSS 3D transform plus a pointer-tracked glare sheen —
 * visually the same trick, none of the context risk.
 */
import { CARDS, RARITY_HEX, type CardDef, type CardId, type CardRarity } from "../cards";
import { KIND_INFO } from "../bestiary";
import { monsterPortrait, portraitScale } from "./monster-portrait";

/** Real trading-card proportions (63mm × 88mm), same as the reference engine. */
export const CARD_W = 512;
export const CARD_H = 716;

/** Rarity → tier, the number every visual treatment below keys off. */
const TIER: Record<CardRarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };

const RARITY_FOOTER_COLOR = ["#d1d5db", "#93c5fd", "#e9d5ff", "#f3c93a", "#f0abfc"];

/** Per-element theming, chosen from what the card actually DOES. */
interface Theme {
  type: string;
  energy: string;
  frame: [string, string];
  accent: string;
}
function themeFor(c: CardDef): Theme {
  const m = c.modifier;
  if (m.bolt) return { type: "STORM", energy: "⚡", frame: ["#1e1b4b", "#4f46e5"], accent: "#a5b4fc" };
  if (m.onHit === "burn") return { type: "BLAZE", energy: "🔥", frame: ["#5e1c0b", "#d1541d"], accent: "#fb923c" };
  if (m.onHit === "chill") return { type: "FROST", energy: "❄️", frame: ["#0b3a5e", "#1d9fd1"], accent: "#7dd3fc" };
  if (m.pinballMult && m.pinballMult > 1) return { type: "MOMENTUM", energy: "🪩", frame: ["#5e4a0b", "#d1a01d"], accent: "#fcd34d" };
  if (m.cooldownMult && m.cooldownMult < 1) return { type: "SWIFT", energy: "⚡", frame: ["#0b5e4a", "#1dd1a0"], accent: "#5eead4" };
  if (m.durabilityMult && m.durabilityMult > 1) return { type: "GUARD", energy: "🛡️", frame: ["#334155", "#64748b"], accent: "#cbd5e1" };
  return { type: "POWER", energy: "⚔️", frame: ["#5e0b0b", "#d1341d"], accent: "#f87171" };
}

/** FNV-1a — the reference engine's hash, so seeding behaves identically. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded LCG so a card's foil specks and backdrop never shimmer between repaints. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The flavour "HP" — a single number summarising how strong the chip is. */
function cardPower(c: CardDef): number {
  const m = c.modifier;
  let p = 10;
  if (m.damageFlat) p += m.damageFlat * 15;
  if (m.damageMult) p += (m.damageMult - 1) * 100;
  if (m.pinballMult) p += (m.pinballMult - 1) * 40;
  if (m.cooldownMult) p += (1 - m.cooldownMult) * 80;
  if (m.durabilityMult) p += (m.durabilityMult - 1) * 20;
  if (m.bolt) p += 45;
  return Math.max(10, Math.round(p / 5) * 5);
}

/**
 * The card's effects as PLAIN STAT LINES.
 *
 * These used to be invented attack names — any card with `cooldownMult < 1`
 * became "Quickdraw", any with `durabilityMult > 1` became "Tempered Steel".
 * Two problems: the names were the loudest thing on a card whose actual identity
 * is the MONSTER it came from, and they read as skills, which is exactly the
 * thing cards are not (skills are the tree's job — see cards.ts). The stat IS
 * the text now, and the monster gets the headline.
 */
function movesFor(c: CardDef): Array<{ name: string; power: string; text: string }> {
  const m = c.modifier;
  const out: Array<{ name: string; power: string; text: string }> = [];
  const pct = (v: number): string => `${v > 1 ? "+" : "−"}${Math.round(Math.abs(v - 1) * 100)}%`;
  // Cooldown reads inverted from every other multiplier: BELOW 1 is the good
  // outcome (faster), so the raw `pct()` would print "−12%" for a speed-up and
  // "+15%" for a penalty — correct arithmetic, backwards as a player-facing
  // claim. These two rows say FASTER/SLOWER instead of signing a bare percent.
  const cdPct = (v: number): string => `${v < 1 ? "−" : "+"}${Math.round(Math.abs(1 - v) * 100)}%`;
  if (m.damageMult && m.damageMult !== 1) out.push({ name: "Damage", power: pct(m.damageMult), text: "" });
  if (m.damageFlat) out.push({ name: "Flat damage", power: `+${m.damageFlat}`, text: "" });
  if (m.bolt) out.push({ name: "Thunderbolt", power: "ON HIT", text: "" });
  if (m.onHit === "burn") out.push({ name: "Burn", power: "ON HIT", text: "" });
  if (m.onHit === "chill") out.push({ name: "Chill", power: "ON HIT", text: "" });
  if (m.critChance) out.push({ name: "Crit chance", power: `${Math.round(m.critChance * 100)}%`, text: "" });
  if (m.lifesteal) out.push({ name: "Lifesteal", power: `+${m.lifesteal} HP`, text: "" });
  if (m.pierce) out.push({ name: "Pierce", power: `+${m.pierce}`, text: "" });
  if (m.pinballMult && m.pinballMult > 1) out.push({ name: "On momentum", power: `×${m.pinballMult}`, text: "" });
  if (m.materialMult && m.materialMult > 1) out.push({ name: "On marble", power: `×${m.materialMult}`, text: "" });
  if (m.cooldownMult && m.cooldownMult !== 1) out.push({ name: m.cooldownMult < 1 ? "Attack speed" : "Slower swing", power: cdPct(m.cooldownMult), text: "" });
  if (m.durabilityMult && m.durabilityMult !== 1) out.push({ name: "Durability", power: pct(m.durabilityMult), text: "" });
  return out.slice(0, 2); // two rows is what the layout has room for
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

/** Shrink a label until it fits — long card names must never overflow the plate. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, basePx: number, weight = 700): void {
  let px = basePx;
  do {
    ctx.font = `${weight} ${px}px ui-monospace, Menlo, monospace`;
    if (ctx.measureText(text).width <= maxW) break;
    px -= 1;
  } while (px > 11);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) return lines;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

/** The seeded backdrop behind the emblem — 4 patterns, exactly as the original. */
function paintBackdrop(ctx: CanvasRenderingContext2D, pattern: number, ax: number, ay: number, aw: number, ah: number, rand: () => number, alpha = 0.18): void {
  ctx.save();
  rr(ctx, ax, ay, aw, ah, 10);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff";
  const cx = ax + aw / 2;
  const cy = ay + ah / 2;
  if (pattern === 0) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillRect(0, -7, aw, 14);
      ctx.restore();
    }
  } else if (pattern === 1) {
    for (let x = -ah; x < aw + ah; x += 52) {
      ctx.save();
      ctx.translate(ax + x, ay);
      ctx.rotate(Math.PI / 6);
      ctx.fillRect(0, -ah, 22, ah * 3);
      ctx.restore();
    }
  } else if (pattern === 2) {
    for (let r = 14; r < aw; r += 34) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 46; i++) {
      const sx = ax + rand() * aw;
      const sy = ay + rand() * ah;
      const sr = 2 + rand() * 5;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const rr2 = k % 2 ? sr : sr * 2.4;
        ctx.lineTo(sx + Math.cos(a) * rr2, sy + Math.sin(a) * rr2);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Paint one card onto a canvas. The canvas must already be CARD_W × CARD_H.
 * Everything is deterministic from the card id, so repainting is free of
 * visual churn.
 */
export function paintCard(canvas: HTMLCanvasElement, id: CardId): void {
  const c = CARDS[id];
  const ctx = canvas.getContext("2d");
  if (!c || !ctx) return;

  const tier = TIER[c.rarity];
  const theme = themeFor(c);
  const seed = hashString(c.id);
  const rand = lcg(seed);
  const W = CARD_W;
  const H = CARD_H;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  rr(ctx, 0, 0, W, H, 26);
  ctx.clip();

  // ── Frame: the element's two-stop gradient ──
  const frame = ctx.createLinearGradient(0, 0, W, H);
  frame.addColorStop(0, theme.frame[0]);
  frame.addColorStop(1, theme.frame[1]);
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, W, H);

  // ── Tier ≥1: diagonal rainbow foil stripes across the frame ──
  if (tier >= 1) {
    ctx.globalAlpha = 0.05 + tier * 0.02;
    for (let i = -H; i < W + H; i += 34) {
      const g = ctx.createLinearGradient(i, 0, i + 34, 34);
      g.addColorStop(0, "#ff5ec4");
      g.addColorStop(0.5, "#5efcff");
      g.addColorStop(1, "#f7ff5e");
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(i, 0);
      ctx.rotate(Math.PI / 5);
      ctx.fillRect(0, -H, 16, H * 2.5);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ── Tier ≥2: metallic wash — silver, then gold, then masterball purple ──
  if (tier >= 2) {
    const metal = ctx.createLinearGradient(0, 0, W, H);
    if (tier === 2) {
      metal.addColorStop(0, "#e2e8f0");
      metal.addColorStop(0.45, "#64748b");
      metal.addColorStop(0.55, "#f8fafc");
      metal.addColorStop(1, "#94a3b8");
    } else if (tier === 3) {
      metal.addColorStop(0, "#fff2b0");
      metal.addColorStop(0.45, "#b8860b");
      metal.addColorStop(0.55, "#f9e27a");
      metal.addColorStop(1, "#8a6508");
    } else {
      metal.addColorStop(0, "#a855f7");
      metal.addColorStop(0.4, "#4c1d95");
      metal.addColorStop(0.6, "#d946ef");
      metal.addColorStop(1, "#312e81");
    }
    ctx.globalAlpha = tier === 4 ? 0.7 : 0.55;
    ctx.fillStyle = metal;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // ── Tier ≥3: etched engraving lines ──
  if (tier >= 3) {
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = tier === 4 ? "#f0abfc" : "#fff7cc";
    ctx.lineWidth = 1;
    for (let i = -H; i < W + H; i += 7) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + H, H);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Tier 4: tiled reverse-holo sigil field (the Master Ball pass) ──
  if (tier === 4) {
    ctx.globalAlpha = 0.16;
    const step = 46;
    for (let row = 0; row * step < H + step; row++) {
      for (let col = 0; col * step < W + step; col++) {
        const bx = col * step + (row % 2 ? step / 2 : 0);
        const by = row * step + step / 2;
        ctx.beginPath();
        ctx.arc(bx, by, 11, Math.PI, 0);
        ctx.fillStyle = "#f0abfc";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx, by, 11, 0, Math.PI);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#312e81";
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Stage pill ──
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  rr(ctx, 24, 18, 190, 22, 11);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.font = "700 12px ui-monospace, Menlo, monospace";
  ctx.textAlign = "left";
  const fits = c.weaponKinds === "both" ? "ANY WEAPON" : `${c.weaponKinds.toUpperCase()} ONLY`;
  // "CHIP" was the old stat-chip vocabulary. A card is a monster's essence, so
  // the pill leads with the monster family and keeps the fit as the qualifier.
  const stage = c.source ? KIND_INFO[c.source].label.toUpperCase() : "CHASE";
  ctx.fillText(`${stage} · ${fits}`, 34, 33);

  // ── Name + power ──
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffffff";
  fitText(ctx, c.label, 320, 30);
  ctx.fillText(c.label, 24, 66);

  ctx.textAlign = "right";
  ctx.font = "700 13px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText("PWR", 400, 48);
  ctx.font = "800 32px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(cardPower(c)), 448, 64);
  ctx.shadowBlur = 0;

  // ── Energy emblem ──
  ctx.beginPath();
  ctx.arc(472, 58, 17, 0, Math.PI * 2);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = "18px ui-monospace, Menlo, monospace";
  ctx.fillText(theme.energy, 472, 65);

  // ── Art window, with its gold bevel drawn 3px proud behind it ──
  const ax = 28;
  const ay = 86;
  const aw = 456;
  const ah = 298;
  const bevel = ctx.createLinearGradient(ax, ay, ax + aw, ay + ah);
  bevel.addColorStop(0, "#f3e28a");
  bevel.addColorStop(0.5, "#b98a2f");
  bevel.addColorStop(1, "#f3e28a");
  ctx.fillStyle = bevel;
  rr(ctx, ax - 3, ay - 3, aw + 6, ah + 6, 12);
  ctx.fill();

  const art = ctx.createLinearGradient(ax, ay, ax, ay + ah);
  art.addColorStop(0, theme.frame[1]);
  art.addColorStop(1, "#0b0c10");
  ctx.fillStyle = art;
  rr(ctx, ax, ay, aw, ah, 10);
  ctx.fill();

  // Resolved BEFORE the backdrop so the backdrop can get out of its way: the
  // ray/ring patterns were authored to carry an otherwise-empty window, and at
  // full strength they read straight through a creature standing in front.
  const portrait = c.source ? monsterPortrait(c.source, c.subType) : null;
  paintBackdrop(ctx, seed % 4, ax, ay, aw, ah, rand, portrait ? 0.07 : 0.18);

  // ── THE MONSTER ITSELF ──
  // The card is a slain monster's power bottled, so the monster has to BE the
  // art. This paints the same cel the horde is drawn from (render/monster-
  // portrait.ts) rather than the 150px emoji that used to sit here — the emoji
  // rendered as a washed-out blob behind the speckle field and made every card
  // look like the anonymous stat chip the monster rework existed to kill.
  //
  // Sourceless mythics have no monster to draw, so they keep the emoji emblem:
  // that IS their identity (a chase card, not loot).
  ctx.save();
  rr(ctx, ax, ay, aw, ah, 10);
  ctx.clip();

  if (portrait) {
    // A floor pool under the feet, so the creature stands ON something instead
    // of floating in a gradient. Drawn before the sprite, inside the clip.
    const fy = ay + ah * 0.82;
    const fg = ctx.createRadialGradient(ax + aw / 2, fy, 4, ax + aw / 2, fy, aw * 0.34);
    fg.addColorStop(0, "rgba(0,0,0,0.55)");
    fg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(ax + aw / 2, fy, aw * 0.32, ah * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();

    // Backlight in the rarity colour — separates the silhouette from the
    // backdrop, which flat cel art badly needs at this size.
    const halo = ctx.createRadialGradient(ax + aw / 2, ay + ah * 0.5, 8, ax + aw / 2, ay + ah * 0.5, aw * 0.42);
    halo.addColorStop(0, `${RARITY_HEX[c.rarity]}55`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(ax, ay, aw, ah);

    // Cel art is authored at 128px and must scale with NEAREST sampling, or the
    // selout outlines blur into the mush this art style exists to avoid.
    ctx.imageSmoothingEnabled = false;
    // Sized off the window HEIGHT and then FITTED, never cropped. The cel is a
    // 128×128 box with the creature occupying roughly the lower ⅔, so the draw
    // is anchored on the FEET (the floor pool) and the box is capped so the
    // head cannot leave the frame — a decapitated portrait is worse than a
    // small one, and a 1.55× hulk hits that ceiling immediately.
    const feetY = ay + ah * 0.90;
    const want = ah * 1.18 * portraitScale(c.source!, c.subType);
    // The cel's figure sits inside ~86% of its box; keep that much above the
    // feet line within the window.
    const box = Math.min(want, (feetY - ay - 6) / 0.86);
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 12;
    ctx.drawImage(portrait, ax + (aw - box) / 2, feetY - box, box, box);
    ctx.shadowBlur = 0;
    ctx.imageSmoothingEnabled = true;
  } else {
    ctx.textAlign = "center";
    ctx.font = "150px ui-monospace, Menlo, monospace";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 18;
    ctx.fillText(c.icon, ax + aw / 2, ay + ah / 2 + 54);
    ctx.shadowBlur = 0;
  }

  // Cosmic sheen + speck field inside the art window (screen blend).
  // With a monster in the window the foil has to stay BEHIND the subject in
  // legibility terms — at full strength the sheen hazes the cel art and the
  // specks read as snow on top of the creature. Rarity still escalates, just
  // from a lower floor.
  const foilScale = portrait ? 0.45 : 1;
  ctx.globalCompositeOperation = "screen";
  const sheen = ctx.createLinearGradient(ax, ay + ah, ax + aw, ay);
  ["#ff5ec4", "#5efcff", "#f7ff5e", "#5eff8f", "#c05eff"].forEach((col, i, arr) => sheen.addColorStop(i / (arr.length - 1), col));
  ctx.globalAlpha = (0.08 + tier * 0.05) * foilScale;
  ctx.fillStyle = sheen;
  ctx.fillRect(ax, ay, aw, ah);

  ctx.globalAlpha = 0.9 * foilScale;
  const speckColors = ["#ffffff", "#9ffcff", "#ffb3f5", "#fff59f"];
  const speckCount = Math.round((18 + tier * 16) * (portrait ? 0.5 : 1));
  for (let i = 0; i < speckCount; i++) {
    const sx = ax + rand() * aw;
    const sy = ay + rand() * ah;
    const sr = 0.6 + rand() * 1.8;
    ctx.fillStyle = speckColors[Math.floor(rand() * speckColors.length)];
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();

  // Element tag in the art window's corner.
  ctx.textAlign = "right";
  ctx.font = "700 13px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(theme.type, ax + aw - 12, ay + ah - 12);

  // ── SOURCE MONSTER (CardDef.source) ──
  // A card is a slain monster's power bottled, so the card has to SAY whose. The
  // mythics are deliberately sourceless (Tavern chase cards, not loot) and just
  // keep the cosmic speckle field with nothing claiming to have dropped them.
  if (c.source) {
    const info = KIND_INFO[c.source];
    // The monster is the HEADLINE, not a footnote. It sits along the bottom of
    // the art window, tinted by rarity, so "which monster is this" is answerable
    // at a glance and from across the room.
    //
    // The name now rides a dark scrim rather than sitting bare on the art: with
    // a portrait behind it, unscrimmed text competed with the creature's own
    // outlines and neither won.
    const name = c.subType ? c.subType.toUpperCase() : info.label.toUpperCase();
    const label = portrait ? name : `${info.icon} ${name}`;
    const by = ay + ah - 44;
    const scrim = ctx.createLinearGradient(0, by, 0, ay + ah);
    scrim.addColorStop(0, "rgba(0,0,0,0)");
    scrim.addColorStop(0.45, "rgba(0,0,0,0.72)");
    scrim.addColorStop(1, "rgba(0,0,0,0.86)");
    ctx.fillStyle = scrim;
    ctx.fillRect(ax, by, aw, ah - (by - ay));

    ctx.textAlign = "center";
    ctx.fillStyle = RARITY_HEX[c.rarity];
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 6;
    fitText(ctx, label, aw - 24, 30, 800);
    ctx.fillText(label, ax + aw / 2, ay + ah - 14);
    ctx.shadowBlur = 0;
  }

  // ── Plaque ──
  const plaque = ctx.createLinearGradient(86, 396, 426, 422);
  plaque.addColorStop(0, "#cbd5e1");
  plaque.addColorStop(0.5, "#f8fafc");
  plaque.addColorStop(1, "#94a3b8");
  ctx.fillStyle = plaque;
  rr(ctx, 86, 396, 340, 26, 13);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.font = "700 13px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  // The plaque names WHAT YOU KILLED, not an invented chip class. A card is a
  // slain monster's power bottled; "COMMON · SWIFT CHIP" told the player nothing
  // about where it came from or what to farm for another one.
  const slain = c.source
    ? `SLAIN: ${(c.subType ? `${KIND_INFO[c.source].label} — ${c.subType}` : KIND_INFO[c.source].label).toUpperCase()}`
    : `${c.rarity.toUpperCase()} · CHASE CARD`;
  ctx.fillText(slain, 256, 414);

  // ── Moves box ──
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  rr(ctx, 24, 436, 464, 188, 12);
  ctx.fill();

  const moves = movesFor(c);
  moves.forEach((mv, i) => {
    const my = 452 + i * 92;
    ctx.beginPath();
    ctx.arc(50, my + 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = "14px ui-monospace, Menlo, monospace";
    ctx.fillText(theme.energy, 50, my + 21);

    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 21px ui-monospace, Menlo, monospace";
    ctx.fillText(mv.name, 76, my + 24);

    ctx.textAlign = "right";
    ctx.font = "800 26px ui-monospace, Menlo, monospace";
    ctx.fillText(mv.power, 476, my + 26);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "400 13px ui-monospace, Menlo, monospace";
    wrap(ctx, mv.text, 380, 2).forEach((line, k) => ctx.fillText(line, 76, my + 46 + k * 17));

    if (i === 0 && moves.length > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(44, my + 78);
      ctx.lineTo(468, my + 78);
      ctx.stroke();
    }
  });

  // ── Stats strip ──
  const m = c.modifier;
  // A SIGNED percentage, so a drawback reads as one. `−${1 - v}` hard-coded a
  // minus and then printed a negative number for any multiplier ABOVE 1 — the
  // Hulk Knuckle's +15% cooldown penalty rendered "−−15%", and Glass Cannon's
  // durability drawback looked like an upgrade. Cards with real downsides are a
  // design pillar here; the face has to tell the truth about them.
  const signed = (v: number): string => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}%`;
  // Damage folds the flat bonus in at ~10%/point purely so the strip has one
  // number; the moves box above lists flat and percent separately.
  const dmgPct = ((m.damageMult ?? 1) - 1) * 100 + (m.damageFlat ?? 0) * 10;
  // Cooldown is inverted: a multiplier BELOW 1 is faster, i.e. an improvement.
  const cdPct = m.cooldownMult ? (1 - m.cooldownMult) * 100 : 0;
  const durPct = m.durabilityMult ? (m.durabilityMult - 1) * 100 : 0;
  const good = "#4ade80";
  const bad = "#f87171";
  const stats: Array<[string, string, string]> = [
    ["DAMAGE", dmgPct ? signed(dmgPct) : "—", dmgPct >= 0 ? good : bad],
    ["COOLDOWN", m.cooldownMult ? signed(cdPct) : "—", cdPct >= 0 ? "#7dd3fc" : bad],
    ["DURABILITY", m.durabilityMult ? signed(durPct) : "—", durPct >= 0 ? "#fcd34d" : bad],
  ];
  stats.forEach(([label, value, col], i) => {
    const cx2 = 100 + i * 156;
    ctx.textAlign = "center";
    ctx.font = "700 11px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText(label, cx2, 644);
    ctx.font = "800 18px ui-monospace, Menlo, monospace";
    ctx.fillStyle = value === "—" ? "rgba(255,255,255,0.35)" : col;
    ctx.fillText(value, cx2, 666);
  });

  // ── Footers ──
  ctx.textAlign = "left";
  ctx.font = "italic 700 13px ui-monospace, Menlo, monospace";
  ctx.fillStyle = RARITY_FOOTER_COLOR[tier];
  ctx.fillText(`${"★".repeat(tier + 1)} ${c.rarity.toUpperCase()}`, 28, 696);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "700 12px ui-monospace, Menlo, monospace";
  ctx.fillText(`PINBALL KNIGHT · ${theme.type}`, 484, 696);

  // ── The baked foil pass: what makes an IDLE card still read as holo ──
  ctx.globalCompositeOperation = "overlay";
  const foil = ctx.createLinearGradient(0, H, W, 0);
  ["#ff5ec4", "#5efcff", "#f7ff5e", "#5eff8f", "#c05eff"].forEach((col, i, arr) => foil.addColorStop(i / (arr.length - 1), col));
  ctx.globalAlpha = 0.04 + tier * 0.055;
  ctx.fillStyle = foil;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  ctx.restore();

  // ── Outer border, weight + colour by tier ──
  const borderW = tier >= 4 ? 6 : tier >= 2 ? 5 : 4;
  ctx.lineWidth = borderW;
  if (tier === 4) {
    const rainbow = ctx.createLinearGradient(0, 0, W, H);
    ["#ff5ec4", "#5efcff", "#f7ff5e", "#5eff8f", "#c05eff"].forEach((col, i, arr) => rainbow.addColorStop(i / (arr.length - 1), col));
    ctx.strokeStyle = rainbow;
  } else if (tier === 3) {
    ctx.strokeStyle = "#f3c93a";
  } else if (tier === 2) {
    const silver = ctx.createLinearGradient(0, 0, W, H);
    silver.addColorStop(0, "#e2e8f0");
    silver.addColorStop(0.5, "#94a3b8");
    silver.addColorStop(1, "#e2e8f0");
    ctx.strokeStyle = silver;
  } else {
    ctx.strokeStyle = RARITY_HEX[c.rarity];
  }
  rr(ctx, borderW / 2, borderW / 2, W - borderW, H - borderW, 24);
  ctx.stroke();
}

/** Rarity tier of a card — exported so the DOM layer can scale its effects. */
export function cardTier(id: CardId): number {
  const c = CARDS[id];
  return c ? TIER[c.rarity] : 0;
}
