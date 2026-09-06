/**
 * CARD INSPECTOR MODAL — Interactive Pokémon-style 3D tilt & holographic foil.
 *
 * Provides a showcase view for any card in the game:
 *   - Real-time mouse-tracked perspective tilt.
 *   - Shifting rainbow iridescence (spectral dispersion across art window).
 *   - Twinkling galaxy/cosmic star glints that flare with angle changes.
 *   - Pointer-tracked glossy specular sheen sweep.
 *   - Complete monster essence lore, art style classification, and stat breakdown.
 *
 * Click anywhere, press Space, or press Escape to dismiss.
 */
import { cardBase, cardDef, isShinyCard, type CardId } from "../../cards";
import { KIND_INFO } from "../../bestiary";
import { UI } from "../theme";
import { rect, scrim, text, strokeRect } from "../im";
import { cardFace, CARD_W, CARD_H } from "../card-face";
import { pop, type UiScreen } from "../stack";
import { drawGlyph, glyphSparkle } from "../../render/card-glyphs";
import { state } from "../../state";

export function cardInspectScreen(id: CardId, onDone?: () => void): UiScreen {
  const def = cardDef(id);
  const base = cardBase(id);
  const shiny = isShinyCard(id);

  // Determine art style for this card
  const styleTag = getCardArtStyleTag(base);

  let smoothedTiltX = 0;
  let smoothedTiltY = 0;

  return {
    id: `inspect-${id}`,
    pauses: true,
    focus: 0,
    scroll: 0,
    design: { w: 720, h: 420, max: 2 },
    onClose: onDone,
    paint(f, self) {
      scrim(f);

      const W = f.w;
      const H = f.h;

      // Detect pointer relative to card center for tilt
      const cardCenterNormX = 0.32;
      const cardCenterNormY = 0.50;
      const cardCenterX = W * cardCenterNormX;
      const cardCenterY = H * cardCenterNormY;

      const pointerX = f.input.pointer?.x ?? cardCenterX;
      const pointerY = f.input.pointer?.y ?? cardCenterY;

      const rawTiltX = Math.max(-1, Math.min(1, (pointerX - cardCenterX) / (W * 0.35)));
      const rawTiltY = Math.max(-1, Math.min(1, (pointerY - cardCenterY) / (H * 0.35)));

      // Smooth inertia
      smoothedTiltX += (rawTiltX - smoothedTiltX) * 0.18;
      smoothedTiltY += (rawTiltY - smoothedTiltY) * 0.18;

      // ── LEFT: 3D HOLOGRAPHIC TILT CARD ──
      const cardDispW = 230;
      const cardDispH = Math.round((CARD_H / CARD_W) * cardDispW); // ~321 px
      const cardX = Math.round(cardCenterX - cardDispW / 2);
      const cardY = Math.round(cardCenterY - cardDispH / 2);

      const face = cardFace(id);
      const g = f.g;

      g.save();

      // Shadow behind the floating card
      const shadowOffX = smoothedTiltX * 16;
      const shadowOffY = smoothedTiltY * 16 + 12;
      g.fillStyle = "rgba(0, 0, 0, 0.65)";
      g.beginPath();
      g.roundRect(cardX + shadowOffX, cardY + shadowOffY, cardDispW, cardDispH, 12);
      g.fill();

      // Apply 3D perspective simulated transform
      g.translate(cardCenterX, cardCenterY);
      const skewX = smoothedTiltX * 0.08;
      const skewY = smoothedTiltY * 0.08;
      g.transform(1, skewY, skewX, 1, 0, 0);
      g.translate(-cardCenterX, -cardCenterY);

      if (face) {
        g.drawImage(face, cardX, cardY, cardDispW, cardDispH);
      }

      // ── POKÉMON HOLOGRAPHIC FOIL SHINE PASS ──
      if (shiny || (def && def.rarity === "mythic")) {
        g.save();
        g.beginPath();
        g.roundRect(cardX + 13, cardY + 39, cardDispW - 26, cardDispH * 0.44, 6);
        g.clip();

        // 1. Iridescent rainbow wave wash
        const time = state.elapsed;
        const angle = Math.PI / 4 + smoothedTiltX * 0.5 + smoothedTiltY * 0.5;
        const gradLen = cardDispW * 1.6;
        const gx0 = cardX + cardDispW / 2 - Math.cos(angle) * gradLen * 0.5;
        const gy0 = cardY + cardDispH * 0.25 - Math.sin(angle) * gradLen * 0.5;
        const gx1 = cardX + cardDispW / 2 + Math.cos(angle) * gradLen * 0.5;
        const gy1 = cardY + cardDispH * 0.25 + Math.sin(angle) * gradLen * 0.5;

        const foil = g.createLinearGradient(gx0, gy0, gx1, gy1);
        const shift = ((time * 0.2 + smoothedTiltX * 0.8 + smoothedTiltY * 0.8) % 1 + 1) % 1;
        const alpha = shiny ? 0.36 : 0.22;

        foil.addColorStop(((0.00 + shift) % 1), `rgba(255, 60, 60, ${alpha})`);
        foil.addColorStop(((0.18 + shift) % 1), `rgba(255, 180, 40, ${alpha})`);
        foil.addColorStop(((0.36 + shift) % 1), `rgba(255, 255, 60, ${alpha})`);
        foil.addColorStop(((0.54 + shift) % 1), `rgba(40, 255, 140, ${alpha})`);
        foil.addColorStop(((0.72 + shift) % 1), `rgba(40, 160, 255, ${alpha})`);
        foil.addColorStop(((0.90 + shift) % 1), `rgba(220, 60, 255, ${alpha})`);
        foil.addColorStop(((1.00 + shift) % 1), `rgba(255, 60, 60, ${alpha})`);

        g.fillStyle = foil;
        g.fillRect(cardX + 13, cardY + 39, cardDispW - 26, cardDispH * 0.44);

        // 2. Cosmic galaxy sparkle points that glint with tilt angle
        const seedBase = hash(base);
        for (let i = 0; i < 16; i++) {
          const randSeed = (seedBase * (i + 1) * 9301 + 49297) % 233280 / 233280;
          const spX = cardX + 18 + ((randSeed * 1000) % (cardDispW - 36));
          const spY = cardY + 44 + ((randSeed * 2500) % (cardDispH * 0.40));
          const phase = Math.sin(time * 3.5 + i * 1.8 + smoothedTiltX * 8 + smoothedTiltY * 8);
          if (phase > 0.3) {
            const sparkleSize = 3 + phase * 6;
            const glintAlpha = (phase - 0.3) / 0.7;
            g.fillStyle = `rgba(255, 255, 255, ${glintAlpha.toFixed(2)})`;
            drawGlyph(g, glyphSparkle, spX, spY, sparkleSize);
          }
        }

        g.restore();
      }

      // 3. Pointer-tracked glossy specular glare sweep across entire card
      const glareGrad = g.createLinearGradient(
        cardX + cardDispW * (smoothedTiltX * 0.5 + 0.2),
        cardY,
        cardX + cardDispW * (smoothedTiltX * 0.5 + 0.8),
        cardY + cardDispH,
      );
      glareGrad.addColorStop(0.0, "rgba(255, 255, 255, 0.0)");
      glareGrad.addColorStop(0.48, "rgba(255, 255, 255, 0.18)");
      glareGrad.addColorStop(0.52, "rgba(255, 255, 255, 0.35)");
      glareGrad.addColorStop(0.56, "rgba(255, 255, 255, 0.18)");
      glareGrad.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");

      g.fillStyle = glareGrad;
      g.beginPath();
      g.roundRect(cardX, cardY, cardDispW, cardDispH, 8);
      g.fill();

      g.restore();

      // ── RIGHT: CARD SHOWCASE DETAILS & LORE ──
      const panelX = Math.round(W * 0.52);
      const panelY = Math.round(H * 0.10);
      const panelW = Math.round(W * 0.44);
      const panelH = Math.round(H * 0.80);

      const body = rect(panelX, panelY, panelW, panelH);
      g.fillStyle = "rgba(10, 12, 18, 0.88)";
      g.beginPath();
      g.roundRect(body.x, body.y, body.w, body.h, 8);
      g.fill();
      strokeRect(f, body, UI.gold, 1);

      // Header: Name & Rarity
      const title = def ? def.label.toUpperCase() : id.toUpperCase();
      text(f, title, body.x + 16, body.y + 16, { size: 16, colour: UI.gold });

      const rarityCol = def?.rarity === "mythic" ? "#ff77e9" : def?.rarity === "legendary" ? "#f0a63c" : def?.rarity === "epic" ? "#a46fe8" : def?.rarity === "rare" ? "#4f8fdb" : "#9aa4b4";
      const rarityLabel = (def?.rarity ?? "common").toUpperCase() + (shiny ? " · ★ SHINY HOLOGRAPHIC" : "");
      text(f, rarityLabel, body.x + 16, body.y + 38, { size: 8, colour: rarityCol });

      // Art Style badge
      text(f, `ART STYLE: ${styleTag}`, body.x + 16, body.y + 54, { size: 8, colour: UI.arcane });

      // Source Monster / Relic
      const sourceMonster = def?.source
        ? `ESSENCE OF: ${def.subType ? def.subType.toUpperCase() + " " : ""}${KIND_INFO[def.source]?.label.toUpperCase() ?? def.source.toUpperCase()}`
        : `TYPE: ${def?.typeLine?.toUpperCase() ?? "UNBOUND MYTHIC RELIC"}`;
      text(f, sourceMonster, body.x + 16, body.y + 70, { size: 8, colour: UI.textDim });

      // Divider line
      g.fillStyle = "rgba(255, 255, 255, 0.15)";
      g.fillRect(body.x + 16, body.y + 86, body.w - 32, 1);

      // Stat modifier rows
      text(f, "SOCKET ATTRIBUTES:", body.x + 16, body.y + 100, { size: 8, colour: UI.heading });
      text(f, def?.description ?? "No description", body.x + 20, body.y + 118, { size: 8, colour: UI.text });

      // Flavour lore
      if (def?.flavour) {
        g.fillStyle = "rgba(255, 255, 255, 0.15)";
        g.fillRect(body.x + 16, body.y + 144, body.w - 32, 1);
        text(f, "FLAVOUR LORE:", body.x + 16, body.y + 158, { size: 8, colour: UI.textDim });
        text(f, `“${def.flavour}”`, body.x + 20, body.y + 174, { size: 8, colour: UI.textFaint });
      }

      // 3D tilt instruction banner
      text(f, "✦ MOVE MOUSE TO TILT 3D CARD & SHIFT HOLOGRAPHIC FOIL ✦", body.x + body.w / 2, body.y + body.h - 40, {
        size: 8,
        colour: shiny ? UI.gold : UI.arcane,
        align: "center",
      });
      text(f, "CLICK ANYWHERE OR PRESS ESC / SPACE TO CLOSE", body.x + body.w / 2, body.y + body.h - 22, {
        size: 8,
        colour: UI.textDim,
        align: "center",
      });

      // Dismiss on click, space, or escape
      if (f.input.accept || f.input.cancel || f.input.pointer.pressed) {
        pop();
      }
    },
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function getCardArtStyleTag(id: string): string {
  switch (id) {
    case "runnersinew":
    case "goblintooth":
    case "flailerjaw":
    case "grimscythe":
    case "timeripper":
      return "ANIME / KINETIC MANGA";
    case "midgetclaw":
    case "batwingchip":
    case "venomgland":
    case "ectoplasmcore":
    case "brutecleaver":
      return "1950S RUBBERHOSE CARTOON";
    case "shamblerhide":
    case "wispspark":
    case "crystalshard":
    case "necrosigil":
    case "gladeath":
      return "RETRO 80S SYNTHWAVE / DARK ARCADE";
    case "hobblerbrace":
    case "spidersilk":
    case "crawlergrip":
    case "golemcore":
    case "worldbreaker":
      return "60S/70S PSYCHEDELIC HIPPIE / ART NOUVEAU";
    case "lurcherspine":
    case "hulkknuckle":
    case "webspinnersilk":
    case "tempestcrown":
    case "bloodpact":
    default:
      return "GOTHIC DARK FANTASY OIL";
  }
}
