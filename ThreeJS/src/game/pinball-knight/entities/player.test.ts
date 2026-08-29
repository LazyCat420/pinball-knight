/**
 * Pure-logic tests for the movement/combat additions: the dodge-roll's
 * distance/i-frame math, the sprint spool, wall moves and the pinball/Sonic
 * momentum. Rendering is not tested (house rule) — these cover the numbers that
 * gameplay balance depends on. NB stamina was DELETED 2026-07-16 (Sonic/pinball
 * rework), so every move is free — there is no resource economy to test.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import { updatePlunger } from "./player";
import type { InputHandle } from "../engine/input";
import { emptyPad } from "../engine/virtual-pad";
import {
  ROLL_DISTANCE,
  ROLL_DURATION,
  ROLL_IFRAMES,
  ROLL_MIN_SPEED,
  PLUNGER_SPEED,
  PLUNGER_MIN_SPEED,
  PLUNGER_AIM_MAX,
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
  PINBALL_WALL_RESTITUTION,
  PINBALL_CORNER_RESTITUTION,
  PINBALL_CORNER_ADD,
  PINBALL_MAX_SPEED,
  PINBALL_FRICTION,
  PINBALL_EXIT_MULT,
  BALL_SPEED_MULT,
  BUMPER_KICK_MULT,
  BUMPER_KICK_ADD,
  BUMPER_MIN_EXIT,
  SPRING_SPEED,
  RAMP_SPEED,
  DEFLECTOR_BOOST,
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

describe("the plunger launch (a floor opens PARKED in the chute)", () => {
  function armPlunger(): void {
    state.player = {
      x: 0,
      z: 0,
      // facing comes from the freshPlayerFields() spread below (same "S").
      anim: { setFacing() {}, play() {}, setRate() {} },
      sprite: { mesh: { position: { set() {} } } },
      ...freshPlayerFields(),
    } as unknown as typeof state.player;
    state.plungerArmed = true;
    state.plungerCharging = false;
    state.plungerPower = 0;
    state.plungerAim = 0;
    state.plungerBaseX = 1; // base launch line = world +x
    state.plungerBaseZ = 0;
    state.plungerSkill = null;
    state.shakeT = 0;
    state.vfx = null as unknown as typeof state.vfx;
  }

  /** A fake input: `held` drives the plunger pull, `ax` the ←/→ aim steer. */
  function input(held: boolean, ax = 0): InputHandle {
    return {
      axis: () => ({ x: ax, z: 0 }),
      consumeAttack: () => false,
      attackHeldNow: () => false,
      consumeAttackTap: () => false,
      sprintHeld: () => false,
      consumeDodge: () => false,
      dodgeHeld: () => held,
      consumeFlip: () => false,
      flipHeld: () => false,
      turnAxis: () => 0,
      consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
      aimScreen: () => null,
      aimStick: () => null,
      poll: () => {},
      pad: emptyPad(),
      debug: () => ({}),
      clearTransient: () => {},
      dispose: () => {},
    };
  }

  beforeEach(armPlunger);

  it("keeps the ball parked and unfired until the plunger is actually pulled", () => {
    // Two full seconds of NOT touching the plunger — it must just wait, never
    // auto-launch and never soft-lock the floor.
    for (let i = 0; i < 120; i++) updatePlunger(1 / 60, input(false));
    expect(state.plungerArmed).toBe(true);
    expect(state.plungerPower).toBe(0);
    expect(state.player!.momSpeed).toBe(0);
  });

  it("charges while held, then FIRES on release into pinball momentum", () => {
    for (let i = 0; i < 300; i++) updatePlunger(1 / 60, input(true));
    expect(state.plungerCharging).toBe(true);
    expect(state.plungerPower).toBe(1); // a long hold tops out at full power
    updatePlunger(1 / 60, input(false)); // release → launch
    const p = state.player!;
    expect(state.plungerArmed).toBe(false);
    expect(p.momSpeed).toBeCloseTo(PLUNGER_SPEED, 5); // full pull = max launch
    expect(Math.hypot(p.momX, p.momZ)).toBeCloseTo(1, 5); // a real unit heading
  });

  it("launch speed scales with the pull — a tap is soft, a full draw is a cannon", () => {
    updatePlunger(1 / 60, input(true)); // a one-frame tap…
    updatePlunger(1 / 60, input(false)); // …then release
    const soft = state.player!.momSpeed;
    expect(soft).toBeGreaterThanOrEqual(PLUNGER_MIN_SPEED);
    expect(soft).toBeLessThan(PLUNGER_SPEED);
    armPlunger();
    for (let i = 0; i < 300; i++) updatePlunger(1 / 60, input(true)); // a full draw
    updatePlunger(1 / 60, input(false));
    expect(state.player!.momSpeed).toBeGreaterThan(soft);
  });

  it("←/→ steer the launch line but stay clamped to ±PLUNGER_AIM_MAX", () => {
    for (let i = 0; i < 600; i++) updatePlunger(1 / 60, input(false, 1)); // hold right
    expect(state.plungerAim).toBeGreaterThan(0);
    expect(state.plungerAim).toBeLessThanOrEqual(PLUNGER_AIM_MAX + 1e-9);
    expect(state.plungerArmed).toBe(true); // steering never fires the ball
  });
});

describe("the dodge-roll is a momentum move", () => {
  it("the roll min-speed gate sits in (0, walk speed): running arms it, standing does not", () => {
    // You can't dodge-cannon from a dead stop (e.g. straight off the plunger
    // park), but a beat of running clears the gate.
    expect(ROLL_MIN_SPEED).toBeGreaterThan(0);
    expect(ROLL_MIN_SPEED).toBeLessThan(PLAYER_SPEED);
  });
});

describe("sprint ramp (the quick spool-up)", () => {
  it("reaches full charge in ~SPRINT_RAMP_TIME and gates the wall-ride at halfway", () => {
    // Charge integrates dt/RAMP each frame; after RAMP_TIME of holding it's full.
    let c = 0;
    const dt = 1 / 60;
    for (let t = 0; t < SPRINT_RAMP_TIME; t += dt) c = Math.min(1, c + dt / SPRINT_RAMP_TIME);
    expect(c).toBeCloseTo(1, 2);
    // Playtest 07-23: the original 3s spool read as "shift does nothing" — the
    // ramp is now 1.5s. Keep it SHORT (≤2s) and the ride gate at halfway.
    expect(SPRINT_RAMP_TIME).toBeLessThanOrEqual(2);
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

  it("SKILL-GATED: flat walls preserve speed but NEVER add it (no infinite loop)", () => {
    // The exploit fix: ping-ponging two parallel walls must not gain speed.
    expect(PINBALL_WALL_RESTITUTION).toBeLessThan(1);
    expect(PINBALL_WALL_RESTITUTION).toBeGreaterThan(0.9); // …but you keep your line
    // 20 flat bounces from the cap: speed only ever goes DOWN.
    let speed = PINBALL_MAX_SPEED;
    for (let i = 0; i < 20; i++) {
      const next = speed * PINBALL_WALL_RESTITUTION;
      expect(next).toBeLessThan(speed);
      speed = next;
    }
  });

  it("CORNER hits accelerate — chained corners climb to the cap", () => {
    // The aimed diagonal slam is the skill move: multiply up + a kick, capped.
    expect(PINBALL_CORNER_RESTITUTION).toBeGreaterThan(1);
    expect(PINBALL_CORNER_ADD).toBeGreaterThan(0);
    expect(PINBALL_MAX_SPEED).toBeGreaterThan(PLAYER_SPEED * SPRINT_SPEED_MULT);
    let speed = PLAYER_SPEED; // modest entry
    for (let i = 0; i < 12; i++) {
      speed = Math.min(PINBALL_MAX_SPEED, speed * PINBALL_CORNER_RESTITUTION + PINBALL_CORNER_ADD);
    }
    expect(speed).toBeCloseTo(PINBALL_MAX_SPEED, 5);
  });

  it("parts are the machine's accelerators: bumper > any flat bounce, springs/ramps set real floors", () => {
    // A bumper touch always leaves you flying, even from a standstill…
    expect(BUMPER_MIN_EXIT).toBeGreaterThan(PLAYER_SPEED * PINBALL_EXIT_MULT);
    // …and a bumper hit at speed beats the same speed off a flat wall.
    const v = 10;
    expect(v * BUMPER_KICK_MULT + BUMPER_KICK_ADD).toBeGreaterThan(v * PINBALL_WALL_RESTITUTION);
    // Springs and ramps launch above the momentum-exit gate (they START rides).
    expect(SPRING_SPEED).toBeGreaterThan(PLAYER_SPEED * PINBALL_EXIT_MULT);
    expect(RAMP_SPEED).toBeGreaterThan(PLAYER_SPEED * PINBALL_EXIT_MULT);
    // A banked deflector keeps (slightly sweetens) your speed — never a tax.
    expect(DEFLECTOR_BOOST).toBeGreaterThanOrEqual(1);
    // Friction stays gentle — a good line keeps its speed.
    expect(PINBALL_FRICTION).toBeGreaterThan(0);
    expect(PINBALL_FRICTION).toBeLessThan(2);
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
