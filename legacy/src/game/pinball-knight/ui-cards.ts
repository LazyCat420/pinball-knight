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
import { RARITY_HEX, cardDef, type CardId } from "./cards";
import { getBalance } from "../../utils/gold-wallet";
import { renderPaintIcon } from "./engine/render/sprite";
import { ITEM_PAINTS } from "./render/cel-painter";
import { paintCard, cardTier, cardStyle, CARD_W, CARD_H } from "./render/holo-card";

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

/**
 * HOVER, SCALED BY RARITY.
 *
 * The animation is itself a rarity tell — a stash of thirty commons must not be
 * thirty things demanding attention, and a mythic pull has to feel like one.
 * Each tier adds a layer and keeps the ones below it:
 *
 *   common (0)    tilt + lift
 *   rare (1)      + a soft glare that tracks the pointer
 *   epic (2)      + prismatic foil whose hue follows the cursor
 *   legendary (3) + parallax: the face shifts against the frame, so the card
 *                   has depth rather than being a flat tilted picture
 *   mythic (4)    + a drifting sparkle field, and the full rainbow sweep
 *
 * A SHINY is promoted one tier for effects only (never for its metal), because
 * a shiny common should still feel like the best thing in the stash.
 *
 * Everything is CSS transforms and gradients driven by pointer events. The
 * reference engine this card face descends from swapped a shared three.js plane
 * onto the hovered card for a GLSL tilt shader; this game already owns a WebGL
 * context for the dungeon itself, and a second one competing for it is a real
 * hazard for no visual gain at this size.
 */
const MAX_TILT_DEG = 11;

/** Effect tier for a card: rarity, promoted one step by shine, capped at 4. */
function fxTier(id: CardId, shiny: boolean): number {
  return Math.min(4, cardTier(id) + (shiny ? 1 : 0));
}

export function holoCard(id: CardId, opts: { act?: string; idx?: number; picked?: boolean; size?: "sm" | "md" | "lg" } = {}): string {
  const c = cardDef(id);
  if (!c) return "";
  const col = RARITY_HEX[c.rarity];
  const tier = cardTier(id);
  const level = c.level ?? 1;
  const attrs = opts.act ? `data-act="${opts.act}" data-idx="${opts.idx ?? ""}"` : "";
  const cls = ["hcard", `hc-${opts.size ?? "md"}`, tier >= 3 ? "hcard-gold" : "", tier >= 4 ? "hcard-myth" : "", c.shiny ? "hcard-shiny" : "", opts.picked ? "picked" : ""]
    .filter(Boolean)
    .join(" ");
  // The Lv corner pip is DOM rather than part of the painted face: at hc-sm
  // (74px) the face's own "Lv 4" plate downscales into mush, and the level is
  // exactly the thing you need to compare two otherwise-identical cards.
  const lvPip = level > 1 ? `<span class="hc-lv">${level}</span>` : "";
  // The face is PAINTED (render/holo-card.paintCard) onto this canvas by
  // paintHoloCards() after the innerHTML lands — the whole card, foil passes
  // and all, is one texture rather than a stack of DOM nodes. The shimmer and
  // glare sit above it as the only two live layers.
  const tip = `${c.shiny ? "✦ SHINY " : ""}${c.label}${level > 1 ? ` Lv${level}` : ""} — ${c.description}`;
  // The card's own material colour drives its hover glow, so a Golem card lights
  // slate-green and a Ghost card lights cold blue — the frame style and the
  // motion agree instead of every card throwing the same white light.
  const glow = cardStyle(id).glow;
  const fx = fxTier(id, !!c.shiny);
  // `hc-inner` is the layer that TILTS and carries the parallax; the outer
  // `.hcard` only lifts. Separating them is what lets the face shift against the
  // frame at legendary and above without the shadow shifting with it.
  return `<div ${attrs} class="${cls}" style="--rc:${col};--gc:${glow};--fx:${fx};cursor:${opts.act ? "pointer" : "default"}" title="${tip}">
    <div class="hc-inner">
      <canvas class="hc-face" data-card="${id}" width="${CARD_W}" height="${CARD_H}"></canvas>
      <span class="hc-foil"></span>
      <span class="hc-glare"></span>
      ${fx >= 4 ? `<span class="hc-motes"></span>` : ""}
    </div>
    <span class="hcard-shimmer"></span>
    ${lvPip}
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
  // Motion is a preference, not a given. Everything below degrades to a plain
  // lift, which still gives the "this is the one under my cursor" feedback the
  // interaction actually needs.
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  root.querySelectorAll<HTMLCanvasElement>("canvas.hc-face").forEach((cv) => {
    const id = cv.dataset.card;
    if (!id || cv.dataset.painted === id) return;
    // Cheap on a repeat: `paintCard` memoises the painted face by id and blits
    // it, so this guard only saves a `drawImage`. The guard cannot be relied on
    // for more than that — tavern.ts and menu.ts rebuild their stage with
    // `innerHTML = …` before calling here, which discards the very element the
    // flag was written on. That is why the cache lives in the painter and not
    // in this dataset attribute.
    paintCard(cv, id);
    cv.dataset.painted = id;

    // The canvas sits inside `.hc-inner` now, so the card is its grandparent.
    const inner = cv.parentElement as HTMLElement | null;
    const card = inner?.parentElement as HTMLElement | null;
    if (!inner || !card || card.dataset.tilt === "1") return;
    card.dataset.tilt = "1";

    const fx = Number(card.style.getPropertyValue("--fx")) || 0;
    if (still) return;

    const glare = card.querySelector<HTMLElement>(".hc-glare");
    const foil = card.querySelector<HTMLElement>(".hc-foil");
    const motes = card.querySelector<HTMLElement>(".hc-motes");

    // Parallax only from legendary up: the face shifts against its own frame, so
    // the card reads as having depth rather than as a flat tilted picture.
    const par = fx >= 3 ? 5 : 0;
    // Everything here is constant for the card's whole life — computing it per
    // pointer event was rebuilding the same strings ~60-120 times a second.
    const lift = `translateY(-${(2 + fx).toFixed(0)}px) scale(${(1.03 + fx * 0.008).toFixed(3)})`;
    const shadowBlur = 18 + fx * 4;
    const glowBlur = 10 + fx * 6;
    const glareOpacity = String(0.28 + fx * 0.1);
    const foilOpacity = String(0.3 + (fx - 2) * 0.14);

    // The card's geometry cannot change mid-hover, so the rect is measured ONCE
    // on entry rather than per move. `getBoundingClientRect` forces a layout
    // flush, and doing that on every pointermove — for every hovered card, while
    // the dungeon's three.js loop is running — is the single most expensive
    // thing this handler did.
    let rect: DOMRect | null = null;
    card.addEventListener("pointerenter", () => {
      rect = card.getBoundingClientRect();
      card.style.transform = lift;
      if (motes) motes.style.opacity = "1";
      if (glare && fx >= 1) glare.style.opacity = glareOpacity;
      if (foil && fx >= 2) foil.style.opacity = foilOpacity;
    });

    card.addEventListener("pointermove", (e) => {
      const r = (rect ??= card.getBoundingClientRect());
      const px = ((e.clientX - r.left) / r.width) * 2 - 1;
      const py = ((e.clientY - r.top) / r.height) * 2 - 1;

      inner.style.transform =
        `perspective(700px) rotateX(${(-py * MAX_TILT_DEG).toFixed(2)}deg) rotateY(${(px * MAX_TILT_DEG).toFixed(2)}deg)` +
        (par ? ` translate3d(${(px * par).toFixed(2)}px, ${(py * par).toFixed(2)}px, 0)` : "");

      // Cast shadow leans OPPOSITE the tilt, the way a real lit object's does.
      // (The lift itself is set on enter — it does not track the pointer.)
      card.style.boxShadow = `${(-px * 10).toFixed(1)}px ${(10 - py * 6).toFixed(1)}px ${shadowBlur}px rgba(0,0,0,.6), 0 0 ${glowBlur}px var(--gc)`;

      // rare+ : a soft glare tracking the pointer.
      if (glare && fx >= 1) {
        glare.style.background = `radial-gradient(circle at ${(50 + px * 42).toFixed(1)}% ${(50 + py * 42).toFixed(1)}%, rgba(255,255,255,.5), rgba(210,230,255,.16) 36%, transparent 64%)`;
      }
      // epic+ : prismatic foil whose HUE follows the cursor, so tilting the card
      // walks it through the spectrum the way real foil stock does. The opacity
      // ceiling is low on purpose: even in overlay, a full-strength prismatic
      // band over a dark card costs more legibility than it buys character.
      if (foil && fx >= 2) {
        foil.style.filter = `hue-rotate(${(px * 140).toFixed(0)}deg)`;
        foil.style.backgroundPosition = `${(50 + px * 50).toFixed(1)}% ${(50 + py * 50).toFixed(1)}%`;
      }
    });

    card.addEventListener("pointerleave", () => {
      rect = null;
      inner.style.transform = "";
      card.style.transform = "";
      card.style.boxShadow = "";
      if (glare) glare.style.opacity = "0";
      if (foil) foil.style.opacity = "0";
      // The mote drift is a CSS animation rather than a per-card rAF loop: a
      // stash of thirty cards would otherwise be thirty loops competing with
      // the dungeon's own frame budget. It is PAUSED in the stylesheet and only
      // runs while hovered — opacity:0 hides an animation, it does not stop it
      // ticking, so hiding alone would have left the work running.
      if (motes) motes.style.opacity = "0";
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
       the whole texture at once the way a real card catches light.

       The OUTER card lifts and casts; the INNER layer tilts and parallaxes.
       Splitting them is what keeps the drop shadow anchored while the face
       moves — a shadow that tilts along with its card reads as a sticker. */
    .hcard{position:relative;box-sizing:border-box;aspect-ratio:63/88;border-radius:8px;
      background:#08090c;margin:3px;flex:0 0 auto;
      box-shadow:0 6px 18px rgba(0,0,0,.55);
      transition:transform .2s cubic-bezier(.2,.9,.3,1),box-shadow .2s;
      will-change:transform}
    .hc-inner{position:absolute;inset:0;border-radius:8px;overflow:hidden;
      transform-style:preserve-3d;will-change:transform;
      transition:transform .2s cubic-bezier(.2,.9,.3,1)}
    .hcard:hover{z-index:5}
    .hc-face{display:block;width:100%;height:100%;border-radius:8px}
    .hc-glare{position:absolute;inset:0;border-radius:8px;pointer-events:none;opacity:0;
      mix-blend-mode:overlay;transition:opacity .2s}
    /* Prismatic foil (epic+). The gradient is 300% wide so the pointer can walk
       the sheen across it via background-position, and hue-rotate does the rest
       — no repaint, no second canvas.

       BLEND MODE MATTERS MORE THAN OPACITY HERE. The first cut used a DODGE
       blend, which divides by the inverse of the backdrop: over a near-black
       card that tends to infinity, so a hovered legendary rendered as a solid
       green-and-magenta smear with the portrait and every stat line gone. The
       card is DARK by design and dodge is the one mode that cannot cope with
       that. Overlay keeps the face's own values and only tints them, and the
       band is narrow so it reads as a sheen crossing the card rather than as a
       wash sitting on it. */
    .hc-foil{position:absolute;inset:0;border-radius:8px;pointer-events:none;opacity:0;
      mix-blend-mode:overlay;transition:opacity .2s;background-size:260% 260%;
      background-image:linear-gradient(115deg,transparent 34%,rgba(255,94,196,.75) 43%,rgba(94,252,255,.8) 50%,rgba(247,255,94,.7) 57%,transparent 66%)}
    /* Mythic mote drift. A CSS animation on one element, gated by opacity —
       NOT a per-card rAF loop, which in a stash of thirty cards would be thirty
       loops competing with the dungeon's own frame budget.

       The motes are placed INDIVIDUALLY, as a handful of non-repeating radial
       gradients on a background-size of 100%. The obvious version — three small
       repeating gradients at background-size:3px — tiles across the whole card
       and renders as a dense screen-door MESH, not as floating specks: at that
       size the gaps between tiles are the same order as the dots, so the eye
       reads the grid rather than the dots. Sparse and non-repeating is the only
       way this shape works. */
    .hc-motes{position:absolute;inset:0;border-radius:8px;pointer-events:none;opacity:0;
      transition:opacity .3s;animation:hc-drift 9s ease-in-out infinite alternate;
      animation-play-state:paused;
      background-repeat:no-repeat;background-size:100% 100%;
      background-image:
        radial-gradient(2.5px 2.5px at 18% 22%,rgba(255,255,255,.95),transparent),
        radial-gradient(2px 2px at 71% 16%,rgba(214,175,255,.9),transparent),
        radial-gradient(3px 3px at 42% 44%,rgba(255,255,255,.75),transparent),
        radial-gradient(2px 2px at 84% 52%,rgba(255,235,255,.8),transparent),
        radial-gradient(2.5px 2.5px at 26% 66%,rgba(200,160,255,.85),transparent),
        radial-gradient(2px 2px at 62% 78%,rgba(255,255,255,.7),transparent),
        radial-gradient(1.5px 1.5px at 12% 88%,rgba(230,200,255,.75),transparent),
        radial-gradient(2px 2px at 90% 84%,rgba(255,255,255,.65),transparent)}
    /* Drift is a slow vertical float with a breath of brightness — enough to
       read as alive, not enough to compete with the card's own art. It only
       TICKS while the card is hovered: an animation at opacity:0 is invisible
       but still composited every frame, which is not what "off" means. */
    .hcard:hover .hc-motes{animation-play-state:running}
    @keyframes hc-drift{
      from{transform:translateY(4px);filter:brightness(.8)}
      to{transform:translateY(-6px);filter:brightness(1.25)}}
    .hcard.picked{box-shadow:0 0 0 2px #f0a63c,0 0 14px var(--rc)}
    /* Display sizes. The face is painted at 512x716, so a card shown much
       under ~110px downscales its move text into mush — these are the sizes at
       which the anatomy is actually readable. */
    .hc-sm{width:74px}.hc-md{width:124px}.hc-lg{width:186px}
    /* Rarity AURAS. These used to be borders — a gold border-color and a
       conic-gradient rainbow ring — which fought the painted metal frame the
       face already draws and made the top rarities the brightest objects on a
       deliberately dark screen. They are outer glows now: the card's own printed
       edge stays the edge, and rarity shows as the light it throws. */
    .hcard-gold{box-shadow:0 4px 14px rgba(0,0,0,.6),0 0 14px rgba(240,190,90,.28)}
    .hcard-myth{box-shadow:0 4px 14px rgba(0,0,0,.6),0 0 18px rgba(170,110,255,.36)}
    /* SHINY — a slow prismatic pulse. Kept as an animation on the OUTER element
       so it survives the pointer handler overwriting box-shadow on hover, and
       readable at hc-sm (74px), which is what the stash and socket cells use. */
    .hcard-shiny{animation:hcard-shine 3.2s ease-in-out infinite}
    @keyframes hcard-shine{
      0%,100%{box-shadow:0 4px 14px rgba(0,0,0,.6),0 0 12px 2px rgba(124,249,255,.4)}
      50%{box-shadow:0 4px 16px rgba(0,0,0,.6),0 0 20px 5px rgba(255,94,219,.5)}}
    .hcard-shiny .hcard-shimmer::before{animation-duration:2.2s}
    /* Level pip — the face carries a "Lv N" plate too, but it downscales into
       mush at 74px and the level is what you compare two copies BY. */
    .hc-lv{position:absolute;left:5px;bottom:5px;pointer-events:none;z-index:2;
      min-width:15px;padding:0 3px;border-radius:4px;text-align:center;
      background:rgba(9,14,22,.92);border:1px solid #7dd3fc;color:#bfe6ff;
      font:800 10px ui-monospace,Menlo,monospace;line-height:14px;
      text-shadow:0 1px 0 #000;box-shadow:0 1px 4px rgba(0,0,0,.6)}
    .hcard-shiny .hc-lv{border-color:#ff9df0;color:#ffd6fb}
    /* The idle sweep: a single pass of light so a card at rest is not inert.
       Toned well down from the original — at the old strength it read as candy
       shine across a dark printed card, which is the look this whole rework
       exists to leave behind. */
    .hcard-shimmer{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:8px}
    .hcard-shimmer::before{content:'';position:absolute;top:-40%;bottom:-40%;left:0;width:45%;
      background:linear-gradient(100deg,transparent,rgba(255,255,255,.05),rgba(170,210,255,.09),transparent);
      transform:translateX(-160%) rotate(14deg);animation:hcard-sweep 5.5s ease-in-out infinite;
      animation-play-state:paused}
    /* The sweep runs on HOVER only. Left running always, a thirty-card stash is
       thirty permanently-compositing layers sitting behind a live three.js
       dungeon — a real frame cost to animate cards nobody is looking at. */
    .hcard:hover .hcard-shimmer::before{animation-play-state:running}
    @keyframes hcard-sweep{0%{transform:translateX(-160%) rotate(14deg)}60%,100%{transform:translateX(320%) rotate(14deg)}}
    /* Reduced motion. The JS reduced-motion check gates the pointer handler
       only, so without this block the CSS animations kept running for exactly
       the users who asked them not to. The shiny keeps its GLOW (a rarity tell,
       not motion) — it just stops pulsing.
       NOTE: no backticks in this stylesheet. It is a template literal, and one
       in a comment silently terminates it — that has broken the build twice. */
    @media (prefers-reduced-motion: reduce){
      .hcard,.hc-inner{transition:none}
      .hcard-shimmer::before,.hc-motes,.hcard-shiny{animation:none}
      .hcard-shiny{box-shadow:0 4px 14px rgba(0,0,0,.6),0 0 14px 3px rgba(124,249,255,.45)}}
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
