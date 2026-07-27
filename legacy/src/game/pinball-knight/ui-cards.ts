/**
 * SHARED HOLO-CARD DOM RENDERER — the pieces the Tavern counters and the
 * in-game menu both draw: painted-face card frames, pixel item icons, the
 * weapon panel with its socket cells, and the small gold-styled button.
 *
 * Extracted from tavern.ts when the menu became a second consumer. The rule
 * that motivated it (see card-popup.ts's header): tavern styles are injected
 * only when the tavern OPENS, so any other surface that borrowed `.hcard`
 * classes rendered unstyled from a cold run. This module owns the card
 * stylesheet (`injectCardStyles`, idempotent) and every consumer calls it.
 *
 * The face itself is painted by render/holo-card.ts's `paintCard` — one
 * painter for every card face in the game.
 */
import { state } from "./state";
import { WEAPONS, weaponSlotCount, type WeaponState } from "./items";
import { CARDS, RARITY_HEX, type CardId } from "./cards";
import { getBalance } from "../../utils/gold-wallet";
import { renderPaintIcon } from "./render/sprite";
import { ITEM_PAINTS } from "./render/cel-painter";
import { paintCard, cardTier, CARD_W, CARD_H } from "./render/holo-card";

export const GOLD = "#f0a63c";

/** The game's actual pixel-art for a weapon/gear/potion id, as a DOM icon URL. */
const _iconCache = new Map<string, string>();
export function itemIcon(id: string): string {
  let url = _iconCache.get(id);
  if (url === undefined) {
    const paint = ITEM_PAINTS[id];
    url = paint ? renderPaintIcon(paint) : "";
    _iconCache.set(id, url);
  }
  return url;
}

/** A pixel-art icon img (falls back to an emoji when no sprite exists). */
export function iconTag(id: string, emoji: string, px = 30): string {
  const url = itemIcon(id);
  return url ? `<img src="${url}" class="tv-icon" style="width:${px}px;height:${px}px" alt="">` : `<span style="font-size:${px - 6}px">${emoji}</span>`;
}

/** Max card tilt in degrees — the reference engine uses 0.33 rad (~19°). */
const MAX_TILT_DEG = 12;

export function holoCard(id: CardId, opts: { act?: string; idx?: number; picked?: boolean; size?: "sm" | "md" | "lg" } = {}): string {
  const c = CARDS[id];
  if (!c) return "";
  const col = RARITY_HEX[c.rarity];
  const tier = cardTier(id);
  const attrs = opts.act ? `data-act="${opts.act}" data-idx="${opts.idx ?? ""}"` : "";
  const cls = ["hcard", `hc-${opts.size ?? "md"}`, tier >= 3 ? "hcard-gold" : "", tier >= 4 ? "hcard-myth" : "", opts.picked ? "picked" : ""]
    .filter(Boolean)
    .join(" ");
  // The face is PAINTED (render/holo-card.paintCard) onto this canvas by
  // paintHoloCards() after the innerHTML lands — the whole card, foil passes
  // and all, is one texture rather than a stack of DOM nodes. The shimmer and
  // glare sit above it as the only two live layers.
  return `<div ${attrs} class="${cls}" style="--rc:${col};cursor:${opts.act ? "pointer" : "default"}" title="${c.description}">
    <canvas class="hc-face" data-card="${id}" width="${CARD_W}" height="${CARD_H}"></canvas>
    <span class="hc-glare"></span>
    <span class="hcard-shimmer"></span>
  </div>`;
}

/**
 * Paint every card canvas the last render emitted, and wire the pointer tilt.
 *
 * The reference engine swaps a shared three.js plane onto the hovered card for
 * a GLSL tilt shader. This game already owns a WebGL context for the dungeon
 * itself, so rather than fight it for a second one, the tilt is a CSS 3D
 * transform and the glare is a pointer-tracked radial sheen — the same feel,
 * none of the context-arbitration risk.
 */
export function paintHoloCards(root: ParentNode): void {
  root.querySelectorAll<HTMLCanvasElement>("canvas.hc-face").forEach((cv) => {
    const id = cv.dataset.card;
    if (!id || cv.dataset.painted === id) return;
    paintCard(cv, id);
    cv.dataset.painted = id;

    const card = cv.parentElement as HTMLElement | null;
    if (!card || card.dataset.tilt === "1") return;
    card.dataset.tilt = "1";
    const glare = card.querySelector<HTMLElement>(".hc-glare");
    const tierScale = 0.5 + cardTier(id) * 0.16; // rarer cards throw more light
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * 2 - 1;
      const py = ((e.clientY - r.top) / r.height) * 2 - 1;
      card.style.transform = `perspective(620px) rotateX(${(-py * MAX_TILT_DEG).toFixed(2)}deg) rotateY(${(px * MAX_TILT_DEG).toFixed(2)}deg) scale(1.06)`;
      if (glare) {
        glare.style.opacity = String(0.35 + 0.4 * tierScale);
        glare.style.background = `radial-gradient(circle at ${(50 + px * 42).toFixed(1)}% ${(50 + py * 42).toFixed(1)}%, rgba(255,255,255,.55), rgba(190,240,255,.22) 34%, transparent 62%)`;
      }
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
      if (glare) glare.style.opacity = "0";
    });
  });
}

/** Inject the shared card/icon stylesheet once (idempotent). */
export function injectCardStyles(): void {
  if (document.getElementById("dungeon-card-ui-style")) return;
  const s = document.createElement("style");
  s.id = "dungeon-card-ui-style";
  s.textContent = `
    /* The face is a painted canvas (render/holo-card.ts), so the card itself is
       just a positioned frame: no inner DOM anatomy, and the tilt applies to
       the whole texture at once the way a real card catches light. */
    .hcard{position:relative;box-sizing:border-box;aspect-ratio:63/88;border-radius:8px;overflow:hidden;
      background:#0b0c10;margin:3px;flex:0 0 auto;
      box-shadow:0 6px 18px rgba(0,0,0,.55);
      transform-style:preserve-3d;will-change:transform;
      transition:transform .16s cubic-bezier(.2,.9,.3,1),box-shadow .16s}
    .hcard:hover{box-shadow:0 12px 28px rgba(0,0,0,.65),0 0 18px var(--rc)}
    .hc-face{display:block;width:100%;height:100%;border-radius:8px}
    .hc-glare{position:absolute;inset:0;border-radius:8px;pointer-events:none;opacity:0;
      mix-blend-mode:overlay;transition:opacity .18s}
    .hcard.picked{box-shadow:0 0 0 2px #f0a63c,0 0 14px var(--rc)}
    /* Display sizes. The face is painted at 512x716, so a card shown much
       under ~110px downscales its move text into mush — these are the sizes at
       which the anatomy is actually readable. */
    .hc-sm{width:74px}.hc-md{width:124px}.hc-lg{width:186px}
    .hcard-gold{border-color:#ffd76a;box-shadow:0 0 0 1px #fff3c0 inset,0 3px 12px rgba(0,0,0,.55),0 0 12px rgba(255,215,106,.35)}
    .hcard-myth{border:2px solid transparent;
      background:linear-gradient(#12100c,#12100c) padding-box,conic-gradient(from 0deg,#ff5edb,#7cf9ff,#f5f36e,#ff8a5e,#ff5edb) border-box;
      animation:hcard-rainbow 5s linear infinite}
    @keyframes hcard-rainbow{to{filter:hue-rotate(360deg)}}
    .hcard-shimmer{position:absolute;inset:0;overflow:hidden;pointer-events:none}
    .hcard-shimmer::before{content:'';position:absolute;top:-40%;bottom:-40%;left:0;width:45%;
      background:linear-gradient(100deg,transparent,rgba(255,255,255,.10),rgba(120,220,255,.16),rgba(255,150,255,.12),transparent);
      transform:translateX(-160%) rotate(14deg);animation:hcard-sweep 3.4s ease-in-out infinite}
    @keyframes hcard-sweep{0%{transform:translateX(-160%) rotate(14deg)}60%,100%{transform:translateX(320%) rotate(14deg)}}
    .tavern-slot{display:inline-flex;align-items:center;justify-content:center;width:74px;height:103px;margin:3px;
      border:1px dashed #6c5a3e;border-radius:8px;color:#6c5a3e;font-size:20px}
    .tv-icon{image-rendering:pixelated;object-fit:contain;vertical-align:middle;flex:0 0 auto;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}`;
  document.head.appendChild(s);
}

/**
 * One weapon's panel: name, kind, durability, socket cells. The socket cells
 * carry the SAME data-act contract everywhere ("unsocket" with data-w/data-idx,
 * "slot" with data-w) so the tavern's handler and the menu's handler both work
 * against markup produced here.
 */
export function weaponPanel(w: WeaponState, slotIdx: number): string {
  const def = WEAPONS[w.id];
  const slots = weaponSlotCount(w);
  const cards = w.cards ?? [];
  const isActive = slotIdx === state.activeSlot;
  const cells: string[] = [];
  for (let s = 0; s < slots; s++) {
    const cid = cards[s];
    if (cid) {
      cells.push(`<span data-act="unsocket" data-w="${slotIdx}" data-idx="${s}" title="un-socket (drops one rarity tier)" style="cursor:pointer">${holoCard(cid, { size: "sm" })}</span>`);
    } else {
      cells.push(`<span data-act="slot" data-w="${slotIdx}" class="tavern-slot" style="cursor:pointer">＋</span>`);
    }
  }
  if (slots === 0) cells.push(`<span style="color:#6c5a3e;font-size:10px">no card slots</span>`);
  const durTxt = Number.isFinite(w.durability) ? `${w.durability}/${def.maxDurability}` : "∞";
  return `<div style="border:1px solid ${isActive ? GOLD : "#4a3d28"};border-radius:7px;padding:8px;margin:5px 0;background:#00000033">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
      ${iconTag(w.id, def.icon, 28)}
      <b style="color:#e8dcc0">${def.label}</b>
      <span style="color:#9a8f77;font-size:10px">${def.kind} · dur ${durTxt} · ${slots} slot${slots === 1 ? "" : "s"}</span>
      ${isActive ? `<span style="color:${GOLD};font-size:9px;border:1px solid ${GOLD};border-radius:3px;padding:1px 4px">EQUIPPED</span>` : ""}
    </div>
    <div style="display:flex;flex-wrap:wrap;align-items:center">${cells.join("")}</div>
  </div>`;
}

/** The gold-styled action button used by every counter and menu tab. */
export function btn(act: string, label: string, cost?: number, disabled = false): string {
  const afford = cost === undefined || getBalance() >= cost;
  const off = disabled || !afford;
  const col = off ? "#5a4d34" : GOLD;
  return `<button data-act="${act}" ${off ? "disabled" : ""} style="cursor:${off ? "not-allowed" : "pointer"};background:#171208;color:${col};border:1px solid ${col};border-radius:5px;padding:5px 9px;margin:3px 3px 3px 0;font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.5px">
    ${label}${cost !== undefined ? ` · ${cost}g` : ""}</button>`;
}
