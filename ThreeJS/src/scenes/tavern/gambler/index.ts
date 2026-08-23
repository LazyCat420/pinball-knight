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
import { UI, ROW_H } from "../../../game/pinball-knight/gui/theme";
import { button, cutTop, fillRect, rect, scrim, sheet, strokeRect, text } from "../../../game/pinball-knight/gui/im";
import { close, isOpen, push } from "../../../game/pinball-knight/gui/stack";
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

/** The games on offer. */
const GAMES: Array<{ id: GameId; name: string; make: () => CasinoGame }> = [
  { id: "slots", name: "SLOTS", make: createSlotsGame },
  { id: "roulette", name: "ROULETTE", make: createRouletteGame },
  { id: "darts", name: "DARTS", make: createDartsGame },
  { id: "blackjack", name: "BLACKJACK", make: createBlackjackGame },
];

export function isGamblerOpen(): boolean {
  return isOpen("gambler");
}

/** Reset the per-visit round limit. Called when the tavern opens. */
export function resetGamblerVisit(): void {
  table = createTableState();
}

/**
 * Show a message in the cabinet's flash line.
 *
 * The DOM version had to WRITE the element here, because an earlier cut only set
 * the variable and the one caller that also updated the element was the WIN
 * path — so every refusal ("table limit", "not enough gold", "that's enough
 * from you tonight") was computed and silently discarded, and a rejected bet
 * read as a dead button. Immediate mode removes the whole hazard: the painter
 * reads `flash` every frame, so setting it IS showing it.
 */
function say(msg: string): void {
  flash = msg;
  flashT = 2.2;
}

/**
 * Kept as a NO-OP so the call sites read the same.
 *
 * In the DOM cabinet this re-rendered the purse, the round counter, the net
 * ticker, the stake row and the control row, and every one of those was a place
 * to forget a call — the control row was in fact forgotten, which is why the
 * loop below grew a signature check to catch what `refreshChrome` missed. The
 * painter now reads all five from live state every frame.
 */
function refreshChrome(): void {}

// ── THE CABINET, painted ─────────────────────────────────────────────────────
//
// The DOM cabinet was a fixed overlay holding a title, a purse, a blurb, a
// canvas, a flash line and four rows of buttons, driven by its own
// `requestAnimationFrame`. All of it is one screen now, and the games render
// straight into a detached canvas that gets blitted into the UI layer — so the
// cabinet goes through the pixel pass like everything else, and the separate
// RAF is gone (the UI driver already runs per frame).

/** The games' render target. Detached — a pixel buffer, never parented. */
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let lastPaint = 0;
const GAME_W = 520;
const GAME_H = 200;

function gameCanvas(): HTMLCanvasElement | null {
  if (canvas) return canvas;
  if (typeof document === "undefined") return null;
  canvas = document.createElement("canvas");
  canvas.width = GAME_W;
  canvas.height = GAME_H;
  ctx = canvas.getContext("2d");
  if (ctx) ctx.imageSmoothingEnabled = false;
  return canvas;
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
  // Nothing to poke: the painter reads `game.name`, `game.blurb`, the selected
  // id and `game.controls()` live. The DOM version had to remember to refresh
  // the control row here or roulette's bet buttons never appeared.
}

export function openGambler(_host: HTMLElement | null, onClose: () => void): void {
  if (isOpen("gambler")) return;
  ensurePixelFonts();
  onClosed = onClose;
  selectGame("slots");
  lastPaint = performance.now();

  push({
    id: "gambler",
    pauses: true,
    focus: 0,
    scroll: 0,
    onCancel() {
      // Leaving mid-round used to EAT THE STAKE: `placeBet` spends the instant
      // PLAY is pressed and every game calls `resolve()` from its own render, so
      // disposing mid-animation meant no payout, no round counted, no ticker
      // entry. Refuse rather than try to unwind — proving an exactly-once
      // forfeit against `settle()` mid-animation is the worst place to try.
      if (game?.busy()) {
        say("FINISH THE ROUND FIRST");
        return true;
      }
      return false;
    },
    onClose() {
      forfeitRound?.();
      forfeitRound = null;
      game?.dispose?.();
      game = null;
      const done = onClosed;
      onClosed = null;
      done?.();
    },
    paint(f, self) {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastPaint) / 1000 || 0);
      lastPaint = now;
      if (flashT > 0 && (flashT -= dt) <= 0) flash = "";

      scrim(f);
      const body = sheet(f, 600, 420);

      // ── Header: title, purse ──
      const head = cutTop(body, 30);
      text(f, game?.name ?? "", head.x, head.y, { size: 16, colour: UI.gold });
      text(f, `PURSE ${getBalance()}g`, head.x + head.w, head.y + 8, { size: 8, colour: UI.gold, align: "right" });
      const blurbRow = cutTop(body, 16);
      text(f, game?.blurb ?? "", blurbRow.x, blurbRow.y, { size: 8, colour: UI.textDim, max: blurbRow.w });

      // ── The game's own frame, blitted ──
      const cv = gameCanvas();
      if (cv && ctx) {
        game?.render(ctx, GAME_W, GAME_H, dt);
        const view = cutTop(body, GAME_H + 8);
        const box = rect(view.x + (view.w - GAME_W) / 2, view.y, GAME_W, GAME_H);
        fillRect(f, box, UI.well);
        f.g.imageSmoothingEnabled = false;
        f.g.drawImage(cv, Math.round(box.x), Math.round(box.y));
        strokeRect(f, box, UI.wellEdge, 2);
      }

      const flashRow = cutTop(body, 16);
      if (flash) text(f, flash, flashRow.x, flashRow.y, { size: 8, colour: UI.gold });

      // ── The game's own controls ──
      const ctrls = game?.controls?.() ?? [];
      if (ctrls.length) {
        const row = cutTop(body, 26);
        let cx = row.x;
        for (const c of ctrls) {
          const w = Math.max(56, c.label.length * 9 + 12);
          if (button(f, rect(cx, row.y, w, 22), c.label, { disabled: c.disabled, good: c.on })) {
            game?.onControl?.(c.id);
          }
          cx += w + 5;
        }
      }

      // ── Stake ──
      const stakeRow_ = cutTop(body, 26);
      text(f, "STAKE", stakeRow_.x, stakeRow_.y + 7, { size: 8, colour: UI.textDim });
      const opts = stakeOptions(getBalance());
      if (!opts.length) {
        text(f, "TOO POOR TO PLAY", stakeRow_.x + 56, stakeRow_.y + 7, { size: 8, colour: UI.danger });
      } else {
        stake = clampStake(stake, getBalance());
        let sx = stakeRow_.x + 56;
        for (const s_ of opts) {
          if (button(f, rect(sx, stakeRow_.y, 52, 22), `${s_}g`, { good: s_ === stake })) {
            stake = clampStake(s_, getBalance());
          }
          sx += 57;
        }
      }
      const n = table.net;
      text(
        f,
        `${roundsLeft(table)}/${ROUNDS_PER_VISIT}   ${n === 0 ? "EVEN" : n > 0 ? `UP ${n}g` : `DOWN ${-n}g`}`,
        stakeRow_.x + stakeRow_.w,
        stakeRow_.y + 7,
        { size: 8, colour: n > 0 ? UI.good : n < 0 ? UI.danger : UI.textDim, align: "right" },
      );

      // ── Game picker + PLAY / LEAVE ──
      const foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
      let gx = foot.x;
      for (const g of GAMES) {
        if (button(f, rect(gx, foot.y, 92, ROW_H), g.name, { good: g.id === game?.id })) {
          if (game?.busy()) say("FINISH THE ROUND FIRST");
          else selectGame(g.id);
        }
        gx += 95;
      }
      if (button(f, rect(foot.x + foot.w - 168, foot.y, 80, ROW_H), "PLAY", { good: true })) startRound();
      if (button(f, rect(foot.x + foot.w - 84, foot.y, 84, ROW_H), "LEAVE")) {
        if (game?.busy()) say("FINISH THE ROUND FIRST");
        else close("gambler");
      }
      self.focus = f.focus;
    },
  });

  // WAIT FOR THE FONT before the first frame that draws text.
  //
  // `pixel-font.ts` is explicit that injecting the @font-face is not enough for
  // canvas: setting `ctx.font` before the face has loaded falls back to a smooth
  // system mono, silently. The gambler was the only canvas in the repo that did
  // not await, so every cabinet opened with a few frames of the wrong typeface
  // in a game whose whole look is the pixel grid. The UI layer awaits the same
  // promise for its own text; this keeps the GAMES' internal text honest too.
  void awaitPixelFonts();
}

export function closeGambler(): void {
  close("gambler");
}
