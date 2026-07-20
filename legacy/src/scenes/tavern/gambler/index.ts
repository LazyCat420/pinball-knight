/**
 * THE GAMBLER — the casino cabinet you get when you walk up and press E.
 *
 * A DOM shell (purse, stake selector, round counter, game picker) wrapping a
 * pixel canvas that each game draws into. The shell owns everything about
 * MONEY — it is the only caller of `table.ts`, which is in turn the only thing
 * that touches the wallet — and the games own only their own outcome.
 *
 * That split is deliberate: a game can be wrong about its animation and it's a
 * cosmetic bug, but a game that could move gold directly would be able to
 * bypass the stake caps and the per-visit round limit.
 */
import { getBalance, spendGold, addGold } from "../../../utils/gold-wallet";
import { ensurePixelFonts, awaitPixelFonts } from "../../../pixel/pixel-font";
import {
  createTableState,
  placeBet,
  settle,
  stakeOptions,
  clampStake,
  canBet,
  roundsLeft,
  raiseBet,
  canRaise,
  ROUNDS_PER_VISIT,
  type TableState,
  type TableDeps,
  type GameId,
  type RoundResult,
} from "./table";
import { createSlotsGame } from "./slots-game";
import { createRouletteGame } from "./roulette-game";
import { createDartsGame } from "./darts-game";
import { createBlackjackGame } from "./blackjack-game";

const GOLD = "#f0c040";
const COLD = "#6fd0e8";
const INK = "#0d1018";

/** What the shell hands a game when a round starts. */
export interface PlayApi {
  /** Finish the round. Must be called exactly once. */
  resolve(r: RoundResult): void;
  /**
   * Take an extra wager mid-round (blackjack's double-down). Returns false if
   * the player can't cover it. Does NOT consume another round off the limit.
   */
  raise(extra: number): boolean;
  /**
   * Would `raise(extra)` succeed? Asks without taking the gold.
   *
   * For DISABLING an action rather than refusing it after the click. A game
   * cannot check this itself — the wallet is the shell's, deliberately (see the
   * header) — and `controls()` has no way to say "no" to the player: it returns
   * buttons, and `say()` is only reachable from the shell. So an unaffordable
   * option has to be greyed out at the point it is offered or it becomes a
   * button that does nothing.
   */
  canRaise(extra: number): boolean;
}

/** Every game implements this; the shell drives it. */
export interface CasinoGame {
  id: GameId;
  name: string;
  /** One-line rules blurb shown under the title. */
  blurb: string;
  /** Draw a frame. `dt` in seconds. */
  render(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number): void;
  /**
   * Begin a round for `stake`. The game animates, then calls `resolve` exactly
   * once with the result — the shell settles the payout from that.
   */
  play(stake: number, api: PlayApi): void;
  /** True while an animation is running — the shell locks the controls. */
  busy(): boolean;
  /** Player pressed the primary action mid-round (e.g. stop a reel). */
  poke?(): void;
  /**
   * Game-specific controls, rendered as a row of buttons in the cabinet.
   *
   * Needed because some games have a choice to make BEFORE committing — the bet
   * type in roulette, hit/stand in blackjack. The first attempt routed roulette's
   * bet selection through `poke()`, which only fires while the game is BUSY, so
   * the bet could never actually be changed.
   */
  controls?(): Array<{ id: string; label: string; on?: boolean; disabled?: boolean }>;
  onControl?(id: string): void;
  dispose?(): void;
}

const wallet: TableDeps = { getBalance, spendGold, addGold };

let el: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;
let last = 0;
let table: TableState = createTableState();
let game: CasinoGame | null = null;
let stake = 10;
let flash = "";
let flashT = 0;
let onClosed: (() => void) | null = null;
/**
 * Settles the in-flight round as a forfeit. Set while a round is live, null
 * otherwise. See `startRound` — this is what stops a teardown eating the stake.
 */
let forfeitRound: (() => void) | null = null;
/** Repaint guard for the game-control row — see the loop. */
let lastControlSig = "";

/** The games on offer. */
const GAMES: Array<{ id: GameId; name: string; make: () => CasinoGame }> = [
  { id: "slots", name: "SLOTS", make: createSlotsGame },
  { id: "roulette", name: "ROULETTE", make: createRouletteGame },
  { id: "darts", name: "DARTS", make: createDartsGame },
  { id: "blackjack", name: "BLACKJACK", make: createBlackjackGame },
];

export function isGamblerOpen(): boolean {
  return el !== null;
}

/** Reset the per-visit round limit. Called when the tavern opens. */
export function resetGamblerVisit(): void {
  table = createTableState();
}

/**
 * Show a message in the cabinet's flash line.
 *
 * Writes to the DOM here rather than leaving it to the caller. The first version
 * only set the variable, and the single caller that also happened to update the
 * element was the WIN path — so every refusal ("table limit", "not enough gold",
 * "that's enough from you tonight") was computed and then silently discarded.
 * A rejected bet that says nothing just reads as a dead button.
 */
function say(msg: string): void {
  flash = msg;
  flashT = 2.2;
  const f = el?.querySelector("#gb-flash");
  if (f) f.textContent = msg;
}

function refreshChrome(): void {
  if (!el) return;
  const purse = el.querySelector("#gb-purse");
  if (purse) purse.textContent = `${getBalance()}g`;
  const rounds = el.querySelector("#gb-rounds");
  if (rounds) rounds.textContent = `${roundsLeft(table)}/${ROUNDS_PER_VISIT}`;
  const net = el.querySelector("#gb-net") as HTMLElement | null;
  if (net) {
    const n = table.net;
    net.textContent = n === 0 ? "EVEN" : n > 0 ? `UP ${n}g` : `DOWN ${-n}g`;
    net.style.color = n > 0 ? "#55e0c0" : n < 0 ? "#c0455a" : "#8a8578";
  }
  // Re-render the stake row so unaffordable steps drop out as the purse changes.
  const row = el.querySelector("#gb-stakes");
  if (row) row.innerHTML = stakeRow();
  const ctrls = el.querySelector("#gb-controls");
  if (ctrls) ctrls.innerHTML = controlRow();
}

/** The current game's own buttons, if it has any. */
function controlRow(): string {
  const list = game?.controls?.() ?? [];
  if (list.length === 0) return "";
  return list
    .map(
      (c) =>
        `<button data-ctrl="${c.id}" ${c.disabled ? "disabled" : ""} style="font-family:'Press Start 2P',monospace;font-size:8px;padding:5px 7px;
          cursor:${c.disabled ? "default" : "pointer"};opacity:${c.disabled ? 0.4 : 1};
          background:${c.on ? COLD : "#12161f"};color:${c.on ? "#04141a" : "#c9c1ad"};
          border:2px solid ${c.on ? COLD : "#544e63"}">${c.label}</button>`,
    )
    .join("");
}

function stakeRow(): string {
  const opts = stakeOptions(getBalance());
  if (opts.length === 0) return `<span style="color:#c0455a">TOO POOR TO PLAY</span>`;
  stake = clampStake(stake, getBalance());
  return opts
    .map(
      (s) =>
        `<button data-stake="${s}" style="font-family:'Press Start 2P',monospace;font-size:9px;padding:6px 9px;cursor:pointer;
          background:${s === stake ? GOLD : "#1a1f2b"};color:${s === stake ? "#1a1206" : "#c9c1ad"};
          border:2px solid ${s === stake ? GOLD : "#544e63"}">${s}g</button>`,
    )
    .join("");
}

function loop(now: number): void {
  if (!el || !ctx || !canvas) return;
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;

  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) {
      flash = "";
      const f = el.querySelector("#gb-flash");
      if (f) f.textContent = "";
    }
  }

  game?.render(ctx, canvas.width, canvas.height, dt);

  // Blackjack's controls appear and disappear as the hand progresses (HIT/STAND
  // only exist while it's your turn), so the row has to track the game rather
  // than only refreshing on a click.
  const sig = JSON.stringify(game?.controls?.() ?? []);
  if (sig !== lastControlSig) {
    lastControlSig = sig;
    const ctrls = el.querySelector("#gb-controls");
    if (ctrls) ctrls.innerHTML = controlRow();
  }
}

function startRound(): void {
  if (!game || game.busy()) {
    game?.poke?.(); // mid-animation press: let the game use it (stop a reel, etc.)
    return;
  }
  const check = canBet(table, getBalance(), stake);
  if (!check.ok) {
    say(check.message ?? "NO BET");
    return;
  }
  const placed = placeBet(table, wallet, stake);
  if (!placed.ok) {
    say(placed.message ?? "NO BET");
    return;
  }
  refreshChrome(); // show the gold leaving IMMEDIATELY — that's the commitment

  const staked = stake;
  let settled = false;
  const gameId = game.id;

  // Park a forfeit for this round so a teardown can't strand the stake.
  //
  // The button guard above refuses to switch or leave while a game is busy, but
  // `closeGambler()` is also called straight from `closeTavern()`, which never
  // goes through it. Without this, ANY path that tears the cabinet down
  // mid-round loses the gold with no ledger entry at all.
  //
  // Settling as a 0-payout forfeit is deliberately not a refund: the bet was
  // placed and the round happened. What matters is that it goes through
  // `settle()` exactly once, so `roundsPlayed`, `table.net` and the log stay
  // consistent with the gold that actually moved.
  forfeitRound = () => {
    if (settled) return;
    settled = true;
    settle(table, wallet, { game: gameId, stake: staked, payout: 0, label: "WALKED AWAY" });
    forfeitRound = null;
  };

  game.play(staked, {
    resolve(result) {
      // Guard against a game resolving twice: that would pay twice AND burn two
      // rounds off the limit.
      if (settled) return;
      settled = true;
      forfeitRound = null;
      settle(table, wallet, result);
      say(result.label + (result.payout > 0 ? ` · +${result.payout}g` : ""));
      refreshChrome();
    },
    raise(extra) {
      const ok = raiseBet(table, wallet, extra);
      if (ok) refreshChrome(); // the extra gold must visibly leave, like the first
      return ok;
    },
    canRaise: (extra) => canRaise(wallet, extra),
  });
}

function selectGame(id: GameId): void {
  const def = GAMES.find((g) => g.id === id);
  if (!def) return;
  // Belt and braces: the click handler refuses a switch while busy, but this is
  // also reachable from `openGambler`'s initial `selectGame("slots")`, and a
  // future caller would otherwise silently drop a live stake.
  forfeitRound?.();
  forfeitRound = null;
  game?.dispose?.();
  game = def.make();
  if (!el) return;
  const title = el.querySelector("#gb-title");
  if (title) title.textContent = game.name;
  const blurb = el.querySelector("#gb-blurb");
  if (blurb) blurb.textContent = game.blurb;
  el.querySelectorAll("[data-game]").forEach((b) => {
    const on = (b as HTMLElement).dataset.game === id;
    (b as HTMLElement).style.borderColor = on ? COLD : "#544e63";
    (b as HTMLElement).style.color = on ? COLD : "#8a8578";
  });
  // Must refresh: the new game's own controls (roulette's bet buttons, and
  // later blackjack's hit/stand) live in #gb-controls, which only refreshChrome
  // populates. Without this the row stays empty and the game is unplayable.
  refreshChrome();
}

export function openGambler(host: HTMLElement, onClose: () => void): void {
  if (el) return;
  ensurePixelFonts();
  onClosed = onClose;

  el = document.createElement("div");
  el.id = "tavern-gambler";
  el.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:10007",
    "background:rgba(8,6,10,0.86)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font:400 13px ui-monospace,Menlo,monospace",
    "color:#e8e2d4",
    "user-select:none",
  ].join(";");

  const gameBtns = GAMES.map(
    (g) =>
      `<button data-game="${g.id}" style="font-family:'Press Start 2P',monospace;font-size:9px;padding:7px 10px;cursor:pointer;
        background:#12161f;color:#8a8578;border:2px solid #544e63">${g.name}</button>`,
  ).join("");

  el.innerHTML = `
    <div style="width:min(560px,94vw);background:${INK};border:2px solid ${GOLD};box-shadow:0 0 44px rgba(240,192,64,.16);padding:16px 18px">
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:10px">
        <b id="gb-title" style="font-family:'Press Start 2P',monospace;font-size:13px;color:${GOLD};letter-spacing:1px">SLOTS</b>
        <span style="flex:1"></span>
        <span style="font-family:'Press Start 2P',monospace;font-size:8px;color:#8a8578">PURSE</span>
        <b id="gb-purse" style="font-family:'Press Start 2P',monospace;font-size:10px;color:${GOLD}">0g</b>
      </div>
      <div id="gb-blurb" style="font-size:10px;color:#8a8578;margin-bottom:10px"></div>

      <canvas id="gb-canvas" width="520" height="200"
        style="width:100%;image-rendering:pixelated;display:block;background:#05070b;border:2px solid #2a3040"></canvas>

      <div id="gb-flash" style="height:16px;margin:8px 0;font-family:'Press Start 2P',monospace;font-size:9px;color:${GOLD};letter-spacing:1px"></div>

      <div id="gb-controls" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px"></div>

      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-family:'Press Start 2P',monospace;font-size:8px;color:#8a8578;margin-right:4px">STAKE</span>
        <span id="gb-stakes" style="display:flex;gap:6px">${stakeRow()}</span>
        <span style="flex:1"></span>
        <span style="font-family:'Press Start 2P',monospace;font-size:8px;color:#8a8578">ROUNDS</span>
        <b id="gb-rounds" style="font-family:'Press Start 2P',monospace;font-size:9px;color:#c9c1ad">-</b>
        <b id="gb-net" style="font-family:'Press Start 2P',monospace;font-size:9px;margin-left:8px">EVEN</b>
      </div>

      <div style="display:flex;gap:6px;align-items:center">
        <span style="display:flex;gap:6px">${gameBtns}</span>
        <span style="flex:1"></span>
        <button data-act="play" style="font-family:'Press Start 2P',monospace;font-size:10px;padding:9px 16px;cursor:pointer;
          background:${GOLD};color:#1a1206;border:2px solid ${GOLD}">PLAY</button>
        <button data-act="leave" style="font-family:'Press Start 2P',monospace;font-size:9px;padding:9px 12px;cursor:pointer;
          background:#1a1f2b;color:#c9c1ad;border:2px solid #544e63">LEAVE</button>
      </div>
    </div>`;

  el.addEventListener("click", (e) => {
    // NB: every clickable attribute must be listed here. `data-ctrl` was added to
    // the handler below but not to this selector, so every game-control click
    // (roulette's bet buttons) was silently dropped by closest() returning null.
    const t = (e.target as HTMLElement).closest("[data-act],[data-stake],[data-game],[data-ctrl]") as HTMLElement | null;
    if (!t) return;
    if (t.dataset.stake) {
      stake = clampStake(Number(t.dataset.stake), getBalance());
      refreshChrome();
      return;
    }
    // SWITCHING GAMES OR LEAVING MID-ROUND USED TO EAT THE STAKE.
    //
    // `placeBet` spends the gold the instant you press PLAY, and every game
    // calls `resolve()` from inside its own `render()`. Swapping the game (or
    // closing the cabinet) disposes the old one and stops its render loop — so
    // `resolve()` never fired, `settle()` never ran, and the stake was simply
    // gone: no payout, no round counted, no entry in the net ticker. Stake 100g
    // on roulette, click BLACKJACK while the wheel is turning, lose 100g to
    // nothing at all. Every game was exposed.
    //
    // Refuse the switch while a round is live rather than trying to unwind it.
    // A forfeit-refund would be kinder but it has to be exactly-once against
    // `settle()`, and a game that is mid-animation is the worst place to try to
    // prove that; "you can't leave the table mid-spin" is also just true of a
    // real casino.
    if (t.dataset.game || t.dataset.act === "leave") {
      if (game?.busy()) {
        say("FINISH THE ROUND FIRST");
        return;
      }
    }
    if (t.dataset.game) {
      selectGame(t.dataset.game as GameId);
      return;
    }
    if (t.dataset.ctrl) {
      game?.onControl?.(t.dataset.ctrl);
      refreshChrome();
      return;
    }
    if (t.dataset.act === "play") startRound();
    else if (t.dataset.act === "leave") closeGambler();
  });

  host.appendChild(el);
  canvas = el.querySelector("#gb-canvas");
  ctx = canvas?.getContext("2d") ?? null;
  if (ctx) ctx.imageSmoothingEnabled = false;

  selectGame("slots");
  refreshChrome();

  // WAIT FOR THE FONT before the first canvas frame.
  //
  // `pixel-font.ts` is explicit that injecting the @font-face is not enough for
  // canvas: `ctx.font = "12px 'Press Start 2P'"` before the face has loaded
  // falls back to a smooth system mono, silently. DOM users are fine because
  // font-display:swap repaints them — canvas users are not. `map-renderer.ts`
  // and `damage-text.ts` both await; the gambler was the only canvas in the
  // repo that didn't, so every cabinet opened with a few frames of the wrong
  // typeface in a game whose whole look is the pixel grid.
  //
  // This is the same class of bug `symbols.ts` records in its header, where the
  // slot glyphs silently fell back and rendered as smooth vector shapes.
  void awaitPixelFonts().then(() => {
    if (!el) return; // closed again while we were waiting
    last = performance.now();
    raf = requestAnimationFrame(loop);
  });
}

export function closeGambler(): void {
  if (!el) return;
  // Settle any live round BEFORE the game is disposed. `closeTavern()` calls
  // this directly, so it is not covered by the LEAVE button's busy guard.
  forfeitRound?.();
  forfeitRound = null;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  game?.dispose?.();
  game = null;
  el.remove();
  el = null;
  canvas = null;
  ctx = null;
  const done = onClosed;
  onClosed = null;
  done?.();
}
