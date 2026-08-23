/**
 * ROULETTE — the playable wheel. Pricing lives in `roulette.ts`, the ball's
 * physics in `roulette-physics.ts`, the rasteriser in `roulette-art.ts`.
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────
 * Same contract as slots: the pocket is drawn the INSTANT you commit, before a
 * single frame is rendered, and the animation is then obliged to show it. An
 * animation that lands somewhere and pays something else is the worst bug a
 * gambling game can have, and here it would also make the deceleration curve
 * part of the odds — which is not something a test can pin down.
 *
 * What makes this version different from the usual way of honouring that rule
 * is that the ball is NOT steered. `planSpin` runs the full physical model over
 * a sweep of physically plausible launch speeds and returns the first
 * trajectory that lands in the pocket already drawn. So the ball really does
 * orbit, really does fall off the track when centripetal support gives out,
 * really does scatter off a diamond and rattle across the frets — and it was
 * always going to end up where the game had already decided. The croupier's
 * launch is the free variable, exactly as it is at a real table.
 *
 * The trajectory is BAKED at plan time into fixed-rate frames and then replayed
 * against wall-clock time. That matters for the invariant too: a variable frame
 * rate cannot integrate a chaotic system reproducibly, so replaying a baked
 * trajectory is the only way the picture is guaranteed to match the payout on a
 * slow machine as well as a fast one.
 *
 * Sound is wired to the SAME baked frames via `hitsBetween`, so a dropped
 * animation frame can never drop a fret click, and the audio can never drift
 * out of sync with the picture.
 */
import { spinWheel, settleBet, BETS, type BetDef } from "./roulette";
import { planSpin, frameAt, hitsBetween, type Spin, type BallFrame } from "./roulette-physics";
import { drawWheel, drawPanel, clearTable, buildWheelLayers, type WheelLayers } from "./roulette-art";
import type { CanvasFactory } from "./offscreen";
import {
  sfxWheelSpin,
  sfxBallLaunch,
  sfxBallDrop,
  sfxDeflector,
  sfxFret,
  sfxSeat,
  sfxRouletteWin,
  sfxRouletteLose,
  type RouletteSound,
} from "./roulette-audio";
import type { CasinoGame } from "./index";
import type { RoundResult } from "./table";

/** Seconds the result holds before controls unlock. */
const SETTLE_HOLD = 1.9;
/** Flashes per second on the winning pocket. */
const FLASH_HZ = 5;
/** Pockets kept on the history board. */
const HISTORY = 8;

/** The wheel's resting state, so the idle screen is still a turning wheel. */
function idleFrame(rotor: number): BallFrame {
  return { theta: 0, rotor, radius: 1, height: 1, omega: 0, phase: "seated", hit: "none" };
}

export interface RouletteOpts {
  /** Injected by tests so the wheel bake runs under node-canvas. */
  canvasFactory?: CanvasFactory;
}

export function createRouletteGame(opts: RouletteOpts = {}): CasinoGame {
  let spinning = false;
  let settleT = 0;
  let pocket = 0;
  let stakeNow = 0;
  let resolveFn: ((r: RoundResult) => void) | null = null;
  let bet: BetDef = BETS[0];

  /** The baked trajectory, and how far into it we are. */
  let spin: Spin | null = null;
  let t = 0;

  /** Idle rotor angle, so the wheel is never a still photograph. */
  let idleRotor = 0;
  let sound: RouletteSound | null = null;
  let fretCount = 0;
  let lastResult: { pocket: number; won: boolean; text: string } | null = null;
  const history: number[] = [];

  /**
   * The baked static wheel art. Built on the first frame rather than here so a
   * cabinet that is opened and never switched to roulette pays nothing for it.
   */
  let layers: WheelLayers | null = null;

  /** Kill the bed. Called from every exit path, including a mid-spin unmount. */
  const hush = (): void => {
    if (sound) {
      sound.stop();
      sound = null;
    }
  };

  return {
    id: "roulette",
    name: "ROULETTE",
    // Describes ONLY the bets `controls()` actually offers. It used to advertise
    // "a number 18x", but `BETS` has never contained a straight-up — the player
    // was told they could back a number and then handed nine chips, none of
    // which was one. See `roulette.ts` for why the straight-up stays off the
    // table.
    blurb: "0-18, single zero · colour/parity/half pay 2x · thirds 3x",

    busy: () => spinning || settleT > 0,

    controls: () => BETS.map((b) => ({ id: b.id, label: b.label, on: b.id === bet.id, disabled: spinning })),

    /** Leaving the cabinet mid-spin must not leave the wheel humming. */
    dispose(): void {
      hush();
    },

    onControl(id): void {
      if (spinning) return;
      const found = BETS.find((b) => b.id === id);
      if (found) bet = found;
    },

    play(stake, api): void {
      // ── The outcome, decided here and nowhere else. ──
      // Through `spinWheel` rather than an inlined `Math.floor(rand * POCKETS)`,
      // so the draw lives in the rules module next to the pricing it has to
      // agree with.
      pocket = spinWheel();
      // ...and a trajectory that genuinely arrives at it.
      spin = planSpin(pocket);

      stakeNow = stake;
      resolveFn = api.resolve;
      spinning = true;
      settleT = 0;
      t = 0;
      fretCount = 0;
      lastResult = null;
      hush();
      sound = sfxWheelSpin();
      sfxBallLaunch();
    },

    render(ctx, w, h, dt): void {
      // Clamp: a backgrounded tab hands back a huge dt, and stepping the whole
      // spin in one frame would skip the entire animation the invariant exists
      // to protect.
      const step = Math.min(dt, 0.1);

      let frame: BallFrame;
      if (spinning && spin) {
        const prev = t;
        t += step;

        // Audio off the baked frames, so nothing is lost to a dropped frame.
        for (const hit of hitsBetween(spin, prev, t)) {
          if (hit === "deflector") sfxDeflector();
          else if (hit === "fret") sfxFret(fretCount++);
          else if (hit === "seat") sfxSeat();
        }
        if (prev < dropTime(spin) && t >= dropTime(spin)) sfxBallDrop();

        frame = frameAt(spin, t);
        if (sound) {
          const revs = Math.abs(frame.omega) / (Math.PI * 2);
          sound.setBall(revs, Math.min(1, Math.abs(frame.omega) / 18));
        }

        if (t >= spin.duration) {
          spinning = false;
          settleT = SETTLE_HOLD;
          hush();
          history.unshift(pocket);
          if (history.length > HISTORY) history.pop();
          const out = settleBet(bet, pocket);
          const payout = Math.round(stakeNow * out.multiplier);
          lastResult = {
            pocket,
            won: out.multiplier > 0,
            text: out.multiplier > 0 ? `${bet.label} PAYS ${payout}` : `${bet.label} LOSES`,
          };
          if (out.multiplier > 0) sfxRouletteWin(out.multiplier);
          else sfxRouletteLose();
          if (resolveFn) {
            resolveFn({ game: "roulette", stake: stakeNow, payout, label: out.label });
            resolveFn = null;
          }
        }
      } else if (settleT > 0 && spin) {
        settleT -= step;
        // Hold on the last baked frame — the rotor stops with it, which is what
        // lets the player read the pocket the ball is sitting in.
        frame = frameAt(spin, spin.duration);
        if (settleT <= 0) spin = null;
      } else {
        // Idle: the wheel turns slowly with no ball on it, the way a real one is
        // left between spins.
        idleRotor -= 0.35 * step;
        frame = idleFrame(idleRotor);
      }

      clearTable(ctx, w, h);

      if (!layers) layers = buildWheelLayers(opts.canvasFactory);

      const settling = !spinning && settleT > 0;
      drawWheel(
        ctx,
        {
          frame,
          highlight: settling ? pocket : -1,
          flash: settling ? (Math.floor(settleT * FLASH_HZ * 2) % 2 === 0 ? 1 : 0.4) : 0,
          showBall: spinning || settling,
        },
        layers,
      );

      drawPanel(ctx, {
        // `pays` straight off the BetDef — the chip prints what settleBet pays.
        bets: BETS.map((b) => ({ id: b.id, label: b.label, selected: b.id === bet.id, pays: b.pays })),
        pays: bet.pays,
        stake: stakeNow,
        history,
        result: settling ? lastResult : null,
        spinning,
      });
    },
  };
}

/** Time the ball leaves the track, cached on the spin the first time it is asked. */
const DROP_AT = new WeakMap<Spin, number>();
function dropTime(spin: Spin): number {
  const hit = DROP_AT.get(spin);
  if (hit !== undefined) return hit;
  const i = spin.frames.findIndex((f) => f.phase !== "track");
  const at = i < 0 ? spin.duration : (i / spin.frames.length) * spin.duration;
  DROP_AT.set(spin, at);
  return at;
}
