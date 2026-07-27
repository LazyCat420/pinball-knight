/**
 * CARD PICKUP PREVIEW — the brief flourish when you walk over a card on the
 * dungeon floor.
 *
 * The Tavern already shows the beautifully painted 512x716 face (render/holo-card.ts)
 * but the dungeon's own pickup path was silent: you'd find a mythic mid-fight and
 * nothing would happen on screen. This is that missing beat.
 *
 * DESIGN CONSTRAINTS, because this fires MID-COMBAT:
 *  - it must never need a click to dismiss (your hands are on WASD),
 *  - it must never pause or gate the sim — it's `pointer-events:none` DOM sitting
 *    over the canvas, entirely outside the game loop,
 *  - and it must not stack. Rapid pickups REPLACE, they don't queue: one live
 *    element, one live timer, both torn down before the next is built.
 *
 * The face is painted by `paintCard` — the same single painter the Tavern uses.
 * Rarity is read through the exported `cardTier`, and drives size, duration,
 * glow and whether the mythic conic-rainbow border animates: a common pull is a
 * quiet blip, a mythic pull lands.
 *
 * Note on CSS reuse: tavern.ts's `.hcard-*` rules are injected by its own
 * PRIVATE `injectTavernStyles()`, which only runs when the Tavern is opened —
 * so from a cold dungeon run those classes are NOT reachable and can't simply be
 * borrowed. This module injects its own small, separately-namespaced sheet
 * (`dungeon-cardpop-style`) rather than exporting and firing the Tavern's whole
 * room stylesheet as a side effect of picking up a card.
 */
import { paintCard, cardTier, CARD_W, CARD_H } from "./render/holo-card";
import { CARDS, RARITY_HEX, type CardId } from "./cards";
import { state } from "./state";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "./pixel-fonts";

/** Display width in px by tier — a mythic is physically bigger on screen. */
const TIER_WIDTH = [124, 138, 152, 170, 190];
/** Seconds the card holds before it starts leaving, by tier. */
const TIER_HOLD_MS = [900, 1000, 1150, 1350, 1600];

const STYLE_ID = "dungeon-cardpop-style";
const IN_MS = 260;
const OUT_MS = 320;

/** The one live popup, if any. Kept module-level so a new pull can evict it. */
let live: HTMLElement | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];

/**
 * Tear down whatever is on screen right now, immediately. Idempotent, and safe
 * to call when nothing is showing — which is what makes rapid pickups leak-free:
 * every path that creates an element clears the previous one first.
 */
export function dismissCardPickup(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  live?.remove();
  live = null;
}

function injectStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .cardpop{position:fixed;left:50%;top:44%;z-index:10003;pointer-events:none;user-select:none;
      transform:translate(-50%,-50%) scale(.72) translateY(26px);opacity:0;
      transition:transform ${IN_MS}ms cubic-bezier(.18,.9,.28,1.25),opacity ${IN_MS}ms ease-out;
      will-change:transform,opacity}
    /* .in and .out are toggled on the element; the transition above carries both. */
    .cardpop.in{transform:translate(-50%,-50%) scale(1) translateY(0);opacity:1}
    .cardpop.out{transform:translate(-50%,-50%) scale(1.04) translateY(-34px);opacity:0;
      transition:transform ${OUT_MS}ms ease-in,opacity ${OUT_MS}ms ease-in}
    .cardpop-face{display:block;width:100%;height:auto;border-radius:8px;
      image-rendering:auto;box-shadow:0 10px 30px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.6)}
    .cardpop-frame{position:relative;border-radius:10px;padding:2px}
    /* Rarity glow — the halo strength IS the rarity read at a glance. */
    .cardpop-t0 .cardpop-face{box-shadow:0 8px 22px rgba(0,0,0,.65)}
    .cardpop-t1 .cardpop-face{box-shadow:0 8px 22px rgba(0,0,0,.65),0 0 14px rgba(79,143,219,.5)}
    .cardpop-t2 .cardpop-face{box-shadow:0 10px 26px rgba(0,0,0,.7),0 0 20px rgba(164,111,232,.6)}
    .cardpop-t3 .cardpop-face{box-shadow:0 10px 28px rgba(0,0,0,.7),0 0 26px rgba(240,166,60,.75)}
    .cardpop-t4 .cardpop-face{box-shadow:0 12px 34px rgba(0,0,0,.75),0 0 34px rgba(255,119,233,.85)}
    /* Mythic gets the animated conic border — the same trick as .hcard-myth. */
    .cardpop-t4 .cardpop-frame{background:conic-gradient(from 0deg,#ff5edb,#7cf9ff,#f5f36e,#ff8a5e,#ff5edb);
      animation:cardpop-rainbow 3.2s linear infinite}
    @keyframes cardpop-rainbow{to{filter:hue-rotate(360deg)}}
    /* A one-shot light sweep across the face on entry (legendary+ only). */
    .cardpop-shine{position:absolute;inset:2px;border-radius:8px;overflow:hidden;pointer-events:none}
    .cardpop-shine::before{content:'';position:absolute;top:-40%;bottom:-40%;left:0;width:45%;
      background:linear-gradient(100deg,transparent,rgba(255,255,255,.16),rgba(190,240,255,.28),transparent);
      transform:translateX(-180%) rotate(14deg);animation:cardpop-sweep 1.1s ease-out .18s 1 both}
    @keyframes cardpop-sweep{to{transform:translateX(340%) rotate(14deg)}}
    .cardpop-name{margin-top:8px;text-align:center;font:10px ${PIXEL_FONT_LABEL},ui-monospace,monospace;
      letter-spacing:1px;text-shadow:1px 1px 0 #0b0d12,0 0 8px rgba(0,0,0,.9)}
    @media (prefers-reduced-motion:reduce){
      .cardpop,.cardpop.in,.cardpop.out{transition-duration:1ms}
      .cardpop-shine::before,.cardpop-t4 .cardpop-frame{animation:none}
    }
  `;
  document.head.appendChild(s);
}

/**
 * Flash the painted face of a just-picked-up card. Fire-and-forget: returns
 * immediately, cleans itself up, and replaces any popup already on screen.
 *
 * No-ops safely when there's no container (headless / test harness) or the id
 * isn't a real card.
 */
export function showCardPickup(id: CardId): void {
  if (typeof document === "undefined" || !state.container) return;
  const def = CARDS[id];
  if (!def) return;

  dismissCardPickup(); // one at a time — a fast double-pickup replaces, never stacks
  ensurePixelFonts();
  injectStyles();

  const tier = Math.max(0, Math.min(4, cardTier(id)));

  const el = document.createElement("div");
  el.className = `cardpop cardpop-t${tier}`;
  el.style.width = `${TIER_WIDTH[tier]}px`;

  const frame = document.createElement("div");
  frame.className = "cardpop-frame";

  const canvas = document.createElement("canvas");
  // paintCard REQUIRES the backing store to be exactly CARD_W x CARD_H; CSS
  // scales it down to the display width above.
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  canvas.className = "cardpop-face";
  paintCard(canvas, id);
  frame.appendChild(canvas);

  // The sweep is a rarity reward, not decoration on everything.
  if (tier >= 3) {
    const shine = document.createElement("span");
    shine.className = "cardpop-shine";
    frame.appendChild(shine);
  }
  el.appendChild(frame);

  const name = document.createElement("div");
  name.className = "cardpop-name";
  name.textContent = def.label.toUpperCase();
  name.style.color = RARITY_HEX[def.rarity];
  el.appendChild(name);

  state.container.appendChild(el);
  live = el;

  // Next frame, so the browser has a chance to apply the pre-transition state
  // and actually animate into `.in` instead of snapping.
  requestAnimationFrame(() => {
    if (live === el) el.classList.add("in");
  });

  const hold = TIER_HOLD_MS[tier];
  timers.push(
    setTimeout(() => {
      if (live !== el) return;
      el.classList.remove("in");
      el.classList.add("out");
      timers.push(
        setTimeout(() => {
          if (live === el) dismissCardPickup();
          else el.remove(); // evicted mid-exit — still make sure it's gone
        }, OUT_MS),
      );
    }, IN_MS + hold),
  );
}
