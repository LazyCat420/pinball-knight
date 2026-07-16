/**
 * Pure-logic tests for the movement/combat additions: the dodge-roll's
 * distance/i-frame math, the sprint spool, wall moves and the pinball/Sonic
 * momentum. Rendering is not tested (house rule) — these cover the numbers that
 * gameplay balance depends on. NB stamina was DELETED 2026-07-16 (Sonic/pinball
 * rework), so every move is free — there is no resource economy to test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import {
  ROLL_DISTANCE,
  ROLL_DURATION,
  ROLL_IFRAMES,
  PLAYER_IFRAMES,
  LIGHT_1,
  LIGHT_2,
  COMBO_FINISH,
  HEAVY,
  COMBO_WINDOW,
  CHARGE_TIME,
  SPRINT_RAMP_TIME,
  SPRINT_DECAY_TIME,
  SPRINT_GRACE,
  SPRINT_RIDE_THRESHOLD,
  SPRINT_SPEED_MULT,
  SPRINT_BASE_MULT,
  WALLKICK,
  WALLKICK_IFRAMES,
  WALLKICK_DURATION,
  WALLRIDE,
  POUNCE,
  POUNCE_IFRAMES,
  POUNCE_DURATION,
  PLAYER_SPEED,
  OVERCHARGE_TIME,
  OVERCHARGE_DECAY,
  PINBALL_RESTITUTION,
  PINBALL_BOUNCE_ADD,
  PINBALL_MAX_SPEED,
  PINBALL_FRICTION,
  PINBALL_EXIT_MULT,
  BALL_SPEED_MULT,
} from "../constants";

/** A bare player stub — the fields the roll math reads. */
function stubPlayer(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
}

describe("moves are free (no stamina)", () => {
  beforeEach(stubPlayer);

  it("the player state carries no stamina fields anymore", () => {
    // Stamina was deleted in the Sonic/pinball rework — a fresh player has
    // neither a stamina pool nor a regen-delay field.
    const p = state.player as unknown as Record<string, unknown>;
    expect("stamina" in p).toBe(false);
    expect("staminaRegenDelay" in p).toBe(false);
  });

  it("no melee move carries a stamina cost field", () => {
    for (const m of [LIGHT_1, LIGHT_2, COMBO_FINISH, HEAVY]) {
      expect("staminaCost" in (m as unknown as Record<string, unknown>)).toBe(false);
    }
  });
});

describe("dodge-roll math", () => {
  it("the eased velocity profile covers exactly ROLL_DISTANCE", () => {
    // v(tau) = v0 * (1 - tau); integral over the roll = v0 * DURATION / 2.
    // With v0 = 2*DIST/DURATION that integral is exactly DIST. Verify by
    // numeric integration (matches how player.ts steps it each frame).
    const v0 = (2 * ROLL_DISTANCE) / ROLL_DURATION;
    const steps = 600;
    const dt = ROLL_DURATION / steps;
    let dist = 0;
    for (let i = 0; i < steps; i++) {
      const tau = (i * dt) / ROLL_DURATION;
      dist += v0 * (1 - tau) * dt;
    }
    expect(dist).toBeCloseTo(ROLL_DISTANCE, 1);
  });

  it("i-frames cover only the front half of the roll, never the whole thing", () => {
    // The verified Gungeon rule: partial coverage. Front window < full roll.
    expect(ROLL_IFRAMES).toBeGreaterThan(0);
    expect(ROLL_IFRAMES).toBeLessThan(ROLL_DURATION);
    expect(ROLL_IFRAMES / ROLL_DURATION).toBeLessThan(0.6); // ~52%, not all of it
  });

  it("roll i-frames never exceed the damage-hit i-frame window (no double-stack)", () => {
    // The single-guard fix tops up p.iframes to at most (ROLL_IFRAMES - rollT).
    // That peak (at rollT=0) must not exceed the normal damage i-frames, or a
    // roll would grant a LONGER invuln than getting hit — the stacking bug.
    expect(ROLL_IFRAMES).toBeLessThanOrEqual(PLAYER_IFRAMES);
  });
});

describe("melee move timings", () => {
  const total = (m: typeof LIGHT_1) => m.windup + m.active + m.recovery;

  it("windup scales with weight: light < finisher < heavy", () => {
    expect(LIGHT_1.windup).toBeLessThan(COMBO_FINISH.windup);
    expect(COMBO_FINISH.windup).toBeLessThan(HEAVY.windup);
  });

  it("damage scales up the chain, heavy hits hardest", () => {
    expect(LIGHT_1.damageMul).toBeLessThanOrEqual(LIGHT_2.damageMul);
    expect(LIGHT_2.damageMul).toBeLessThan(COMBO_FINISH.damageMul);
    expect(COMBO_FINISH.damageMul).toBeLessThan(HEAVY.damageMul);
  });

  it("a light chain can link: the combo window outlasts a light's recovery", () => {
    // The verified rule: a link is possible only if the follow-up can be pressed
    // before the chain closes. The window must at least cover a light's recovery
    // so a natural double-tap during recovery chains.
    expect(COMBO_WINDOW).toBeGreaterThan(LIGHT_1.recovery);
  });

  it("charge threshold sits above a light's full duration (a tap can't accidentally heavy)", () => {
    expect(CHARGE_TIME).toBeGreaterThan(total(LIGHT_1));
  });
});

describe("sprint ramp (the 3-second spool-up)", () => {
  it("reaches full charge in ~SPRINT_RAMP_TIME and gates the wall-ride at halfway", () => {
    // Charge integrates dt/RAMP each frame; after RAMP_TIME of holding it's full.
    let c = 0;
    const dt = 1 / 60;
    for (let t = 0; t < SPRINT_RAMP_TIME; t += dt) c = Math.min(1, c + dt / SPRINT_RAMP_TIME);
    expect(c).toBeCloseTo(1, 2);
    // The 3s ask, and the >50% ride gate reached at ~half the ramp.
    expect(SPRINT_RAMP_TIME).toBeCloseTo(3, 5);
    expect(SPRINT_RIDE_THRESHOLD).toBe(0.5);
  });

  it("the ride threshold is crossed strictly before full sprint (ride ⊂ sprinting)", () => {
    // At the threshold you are past walk but not yet at top speed — a real 'fast
    // enough' gate rather than 'must be maxed'.
    expect(SPRINT_RIDE_THRESHOLD).toBeGreaterThan(0);
    expect(SPRINT_RIDE_THRESHOLD).toBeLessThan(1);
    const speedAtRide = SPRINT_BASE_MULT + (SPRINT_SPEED_MULT - SPRINT_BASE_MULT) * SPRINT_RIDE_THRESHOLD;
    expect(speedAtRide).toBeGreaterThan(SPRINT_BASE_MULT); // faster than the instant gear
    expect(speedAtRide).toBeLessThan(SPRINT_SPEED_MULT); // not yet full sprint
  });

  it("Shift is felt IMMEDIATELY: the base gear beats a walk before any spool", () => {
    // The 2026-07-15 playtest bug — a spool that starts at 1.0× reads as
    // "shift does nothing". The instant gear must be a real, noticeable boost,
    // but clearly below the spooled top speed so the ramp still matters.
    expect(SPRINT_BASE_MULT).toBeGreaterThanOrEqual(1.15);
    expect(SPRINT_BASE_MULT).toBeLessThan(SPRINT_SPEED_MULT - 0.3);
  });

  it("charge decays faster than it builds (a stumble kills sprint, a run must be earned)", () => {
    expect(SPRINT_DECAY_TIME).toBeLessThan(SPRINT_RAMP_TIME);
  });

  it("the grace window outlasts a light swing (combat doesn't erase the spool)", () => {
    // A light is windup+active+recovery ≈ 0.27s; the charge must hold through
    // it so attacking mid-run doesn't dump 3 seconds of spool.
    expect(SPRINT_GRACE).toBeGreaterThan(LIGHT_1.windup + LIGHT_1.active + LIGHT_1.recovery);
    // ...but not so long that sprint feels sticky after you genuinely stop.
    expect(SPRINT_GRACE).toBeLessThan(1);
  });
});

describe("wall moves (Mortal-Kombat specials off a wall)", () => {
  it("wall-kick i-frames cover only the front of the launch, never the whole hop", () => {
    expect(WALLKICK_IFRAMES).toBeGreaterThan(0);
    expect(WALLKICK_IFRAMES).toBeLessThan(WALLKICK_DURATION);
    // ...and never longer than a damage-hit's i-frames (the no-double-stack rule).
    expect(WALLKICK_IFRAMES).toBeLessThanOrEqual(PLAYER_IFRAMES);
  });

  it("pounce is airborne (untouchable) for most of its arc but is still finite", () => {
    expect(POUNCE_IFRAMES).toBeGreaterThan(WALLKICK_IFRAMES); // a bigger commit, more invuln
    expect(POUNCE_IFRAMES).toBeLessThanOrEqual(POUNCE_DURATION);
    expect(POUNCE_IFRAMES).toBeLessThanOrEqual(PLAYER_IFRAMES);
  });

  it("every wall move hits harder than a plain light (they're all free now)", () => {
    for (const m of [WALLKICK, WALLRIDE, POUNCE]) {
      expect(m.damageMul).toBeGreaterThan(1); // hits harder than a plain light
    }
    // The pounce is the biggest hammer of the three.
    expect(POUNCE.damageMul).toBeGreaterThan(WALLKICK.damageMul);
    expect(POUNCE.damageMul).toBeGreaterThan(WALLRIDE.damageMul);
    // The wall-ride sweeps the widest arc (it's the crowd-clearing slide).
    expect(WALLRIDE.arcMul).toBeGreaterThan(WALLKICK.arcMul);
  });
});

describe("pinball / Sonic momentum (run-fast-enough-and-it-bounces)", () => {
  it("overcharge fills over OVERCHARGE_TIME and decays no slower than it fills", () => {
    // Fills at dt/OVERCHARGE_TIME per frame: OVERCHARGE_TIME of full sprint = 1.
    let o = 0;
    const dt = 1 / 60;
    for (let t = 0; t < OVERCHARGE_TIME; t += dt) o = Math.min(1, o + dt / OVERCHARGE_TIME);
    expect(o).toBeCloseTo(1, 2);
    // It bleeds in a comparable time once fully stopped (a fleeting super-state).
    expect(OVERCHARGE_DECAY).toBeLessThanOrEqual(OVERCHARGE_TIME);
  });

  it("a bounce ACCELERATES you (Sonic): restitution > 1, plus a flat kick, capped", () => {
    // The whole point of the rework: chaining wall hits speeds you UP, not down.
    expect(PINBALL_RESTITUTION).toBeGreaterThan(1);
    expect(PINBALL_BOUNCE_ADD).toBeGreaterThan(0);
    expect(PINBALL_MAX_SPEED).toBeGreaterThan(PLAYER_SPEED * SPRINT_SPEED_MULT);
    // Friction is gentle now — a good line keeps its speed.
    expect(PINBALL_FRICTION).toBeGreaterThan(0);
    expect(PINBALL_FRICTION).toBeLessThan(2);
  });

  it("chained bounces climb toward — and hold at — the speed cap", () => {
    // Model the exact bounce update: speed = min(CAP, speed*R + ADD). From even a
    // slow entry it should ramp UP over a few bounces and never exceed the cap.
    let speed = PLAYER_SPEED; // a modest entry
    const seen: number[] = [speed];
    for (let i = 0; i < 12; i++) {
      speed = Math.min(PINBALL_MAX_SPEED, speed * PINBALL_RESTITUTION + PINBALL_BOUNCE_ADD);
      seen.push(speed);
    }
    // Monotonic non-decreasing, ends at the cap, and genuinely faster than entry.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] - 1e-9);
    expect(seen[seen.length - 1]).toBeCloseTo(PINBALL_MAX_SPEED, 5);
    expect(seen[seen.length - 1]).toBeGreaterThan(PLAYER_SPEED * 2);
  });

  it("momentum only exits once it has bled below a walk (never freezes mid-arena)", () => {
    // With NO bounces, gentle friction still eventually drops you under the exit
    // gate — but it takes a while (you keep your speed on a good line).
    expect(PINBALL_EXIT_MULT).toBeGreaterThan(1);
    let speed = PINBALL_MAX_SPEED;
    const exit = PLAYER_SPEED * PINBALL_EXIT_MULT;
    let t = 0;
    const dt = 1 / 60;
    while (speed >= exit && t < 60) {
      speed = Math.max(0, speed - PINBALL_FRICTION * dt);
      t += dt;
    }
    expect(t).toBeGreaterThan(1); // Sonic coasts — a real ride, not an instant stop
    expect(t).toBeLessThan(40); // but it does end if you stop bouncing
  });

  it("ball form is faster than the momentum cap (the payoff for maxing overcharge)", () => {
    expect(BALL_SPEED_MULT).toBeGreaterThan(1);
    expect(PINBALL_MAX_SPEED * BALL_SPEED_MULT).toBeGreaterThan(PINBALL_MAX_SPEED);
  });
});
