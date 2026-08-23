/**
 * Pinball part COLLISION tests — the layer that had zero coverage while the
 * placement layer (maze/decorate.test.ts) had plenty, which is how a part kind
 * shipped with no handler at all.
 *
 * The old implementation dispatched with an if/else chain whose final `else`
 * was a catch-all applying DEFLECTOR physics. `glove` — a self-firing hazard
 * owned by entities/hazards.ts — had no branch, so every glove contact ran the
 * corner-bank using dir2 = (0,0), overwriting the launch hazards.ts had just
 * applied with a zero heading. These tests pin that shut.
 *
 * Rendering and audio are not tested (house rule); sfx are fail-silent without
 * an AudioContext and state.vfx is left undefined so the optional-chained VFX
 * calls no-op. Handlers that surface DOM toasts (pit) are covered only for the
 * parts of their contract that don't reach entities/ui.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields, type PinballPart, type PinballPartKind } from "../state";
import { PART_HANDLERS, touchPinballParts, type PinballDeps } from "./pinball-collide";
import { SPRING_SPEED, PINBALL_MAX_SPEED, DEFLECTOR_GRAB_TIME, DEFLECTOR_THROW_SPEED, DEFLECTOR_THROW_BOOST, BOOSTER_SPEED, BOOSTER_JAM_HITS, BOOSTER_JAM_COOLDOWN, FLIPPER_SPEED, GRAVEPIT_RADIUS } from "../constants";

/** Every kind the game can place. Kept literal so adding one fails here too. */
const ALL_KINDS: PinballPartKind[] = [
  "bumper",
  "spring",
  "ramp",
  "booster",
  "boostcorner",
  "boostcurve",
  "jumppad",
  "deflector",
  "glove",
  "oil",
  "spinpad",
  "slingshot",
  "target",
  "trapdoor",
  "flipper",
  "mirror",
  "pit",
  "gravepit",
  "electric",
  "firevent",
  "magstrip",
  "rollover",
  "lamp",
];

function stubPlayer(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
}

/** A part sitting exactly under the player, ready to fire. */
function part(kind: PinballPartKind, over: Partial<PinballPart> = {}): PinballPart {
  return {
    kind,
    i: 0,
    j: 0,
    x: 0,
    z: 0,
    dirX: 1,
    dirZ: 0,
    dir2X: 0,
    dir2Z: 0,
    cooldownT: 0,
    hitT: -1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mesh: undefined as any,
    ...over,
  };
}

let deps: PinballDeps;
let rampHops: number;
let drops: number;
let steerLock: number;

beforeEach(() => {
  stubPlayer();
  state.pinballParts = [];
  state.vfx = null; // the optional-chained VFX calls all no-op
  state.partComboHits = 0;
  state.frenzyPaid = false;
  state.goldRun = 0;
  state.shakeT = 0;
  state.hitstopT = 0;
  state.bumpersLit = 0;
  state.zombies = [];
  rampHops = 0;
  drops = 0;
  steerLock = 0;
  deps = {
    startRampHop: () => {
      rampHops += 1;
    },
    startDrop: () => {
      drops += 1;
    },
    setSteerLock: (t) => {
      steerLock = t;
    },
    raiseSteerLock: (t) => {
      steerLock = Math.max(steerLock, t);
    },
  };
});

describe("dispatch is exhaustive", () => {
  it("every PinballPartKind has a handler", () => {
    for (const kind of ALL_KINDS) {
      expect(PART_HANDLERS[kind], `no handler for "${kind}"`).toBeTypeOf("function");
    }
  });

  it("has no handlers for kinds that don't exist (table matches the union)", () => {
    expect(Object.keys(PART_HANDLERS).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("no kind falls through to another kind's physics", () => {
    // The regression in one line: dispatch is a lookup, so a kind can only ever
    // run its OWN handler. Two kinds sharing a function is fine (the self-firing
    // hazards do), but a kind must never be absent.
    for (const kind of ALL_KINDS) expect(kind in PART_HANDLERS).toBe(true);
  });
});

describe("gravepit — the lethal hole a departing knight leaves", () => {
  /** The grave pit writes hp and syncs the sprite, so the stub needs a mesh. */
  function lethalStub(): void {
    stubPlayer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state.player as any).sprite = { mesh: { position: { set: () => {} } } };
    state.player!.hp = 6;
  }

  beforeEach(() => {
    lethalStub();
    state.godMode = false;
  });

  it("KILLS outright — hp to zero, not a scratch", () => {
    PART_HANDLERS.gravepit({ part: part("gravepit"), p: state.player!, dx: 0, dz: 0, d2: 0, inMomentum: true, curSpeed: 0, deps });
    expect(state.player!.hp).toBe(0);
  });

  it("kills THROUGH i-frames, a shield and stoneskin", () => {
    // Every one of these nullifies normal damage. A hole that respects them
    // would silently fail to kill anyone who arrived at speed — and arriving at
    // speed is how you arrive. See fallInGravePit's comment.
    const p = state.player!;
    p.iframes = 5;
    p.shieldT = 5;
    p.stoneT = 5;
    PART_HANDLERS.gravepit({ part: part("gravepit"), p, dx: 0, dz: 0, d2: 0, inMomentum: true, curSpeed: 0, deps });
    expect(p.hp).toBe(0);
  });

  it("stops the ball dead rather than flinging the corpse onward", () => {
    const p = state.player!;
    p.momSpeed = 18;
    p.momX = 12;
    p.momZ = -9;
    PART_HANDLERS.gravepit({ part: part("gravepit"), p, dx: 0, dz: 0, d2: 0, inMomentum: true, curSpeed: 0, deps });
    expect(p.momSpeed).toBe(0);
    expect(p.momX).toBe(0);
    expect(p.momZ).toBe(0);
  });

  it("returns 'stop' so no later part re-reads a stale position", () => {
    // The fall relocates the player, exactly like the ordinary pit.
    const r = PART_HANDLERS.gravepit({ part: part("gravepit"), p: state.player!, dx: 0, dz: 0, d2: 0, inMomentum: true, curSpeed: 0, deps });
    expect(r).toBe("stop");
  });

  it("does nothing outside its radius", () => {
    const far = GRAVEPIT_RADIUS * GRAVEPIT_RADIUS + 1;
    PART_HANDLERS.gravepit({ part: part("gravepit"), p: state.player!, dx: 0, dz: 0, d2: far, inMomentum: true, curSpeed: 0, deps });
    expect(state.player!.hp).toBe(6);
  });

  it("lets a RIDE carry you across, like the ordinary pit", () => {
    // A coaster is explicitly above the floor; swallowing a rider would make an
    // unrelated mechanic feel broken.
    const p = state.player!;
    p.rideT = 0.5;
    PART_HANDLERS.gravepit({ part: part("gravepit"), p, dx: 0, dz: 0, d2: 0, inMomentum: true, curSpeed: 0, deps });
    expect(p.hp).toBe(6);
  });

  it("spares a god-mode player — that is a debug switch, not a mechanic", () => {
    state.godMode = true;
    PART_HANDLERS.gravepit({ part: part("gravepit"), p: state.player!, dx: 0, dz: 0, d2: 0, inMomentum: true, curSpeed: 0, deps });
    expect(state.player!.hp).toBe(6);
    state.godMode = false;
  });

  it("is idempotent on an already-dead player", () => {
    const p = state.player!;
    p.hp = 0;
    expect(() => PART_HANDLERS.gravepit({ part: part("gravepit"), p, dx: 0, dz: 0, d2: 0, inMomentum: true, curSpeed: 0, deps })).not.toThrow();
    expect(p.hp).toBe(0);
  });
});

describe("self-firing hazards are inert on contact", () => {
  // glove / electric / firevent fire on their own clock and sweep a lane;
  // entities/hazards.ts owns the launch and the damage. Touching one must do
  // NOTHING here — the glove bug was this contract being violated.
  for (const kind of ["glove", "electric", "firevent"] as const) {
    it(`${kind} contact leaves the player's momentum untouched`, () => {
      const p = state.player!;
      // Momentum must OPPOSE the part's facing (dot ≥ 0.3 against -dir), which
      // is the only geometry the old catch-all's deflector guard let through.
      // Approaching along the axis grazes past and would pass trivially.
      p.momX = -1;
      p.momZ = 0;
      p.momSpeed = 9;
      const q = part(kind, { dirX: 1, dirZ: 0, dir2X: 0, dir2Z: 0 });
      state.pinballParts = [q];

      touchPinballParts(true, 0, deps);

      expect(p.momX).toBe(-1);
      expect(p.momZ).toBe(0);
      expect(p.momSpeed).toBe(9);
    });

    it(`${kind} contact does not stamp cooldownT/hitT (would break its fire clock)`, () => {
      const p = state.player!;
      p.momX = -1;
      p.momZ = 0;
      p.momSpeed = 9;
      const q = part(kind, { dirX: 1, dirZ: 0, dir2X: 0, dir2Z: 0, hitT: 0.1, cooldownT: 0 });
      state.pinballParts = [q];

      touchPinballParts(true, 0, deps);

      expect(q.cooldownT).toBe(0);
      expect(q.hitT).toBe(0.1);
    });
  }

  it("a glove never zeroes the heading hazards.ts just set (the original bug)", () => {
    // A glove is placed with dir2 = (0,0) (maze/decorate.ts spotForKind), so the
    // old catch-all's `p.momX = part.dir2X` produced a zero-vector heading at
    // full speed — an intermittent "my momentum died" the moment the punch
    // connected at an angle.
    const p = state.player!;
    // The knight enters the lane moving INTO the fist's facing — an angled
    // entry or a knockback, which is when this actually bit in play.
    p.momX = 0;
    p.momZ = -1;
    p.momSpeed = 12;
    state.pinballParts = [part("glove", { dirX: 0, dirZ: 1, dir2X: 0, dir2Z: 0 })];

    touchPinballParts(true, 0, deps);

    // The old catch-all produced (0,0) here: a zero-vector heading at speed 12.
    expect(Math.hypot(p.momX, p.momZ)).toBeGreaterThan(0);
    expect(p.momSpeed).toBe(12);
  });
});

describe("launchers", () => {
  it("a spring fires along its direction at SPRING_SPEED", () => {
    const p = state.player!;
    p.momSpeed = 0;
    const q = part("spring", { dirX: 0, dirZ: -1 });
    state.pinballParts = [q];

    touchPinballParts(false, 0, deps);

    expect(p.momX).toBe(0);
    expect(p.momZ).toBe(-1);
    expect(p.momSpeed).toBe(SPRING_SPEED);
    expect(q.cooldownT).toBeGreaterThan(0);
  });

  it("a spring never SLOWS a faster ball", () => {
    const p = state.player!;
    p.momSpeed = PINBALL_MAX_SPEED;
    state.pinballParts = [part("spring")];

    touchPinballParts(true, 0, deps);

    expect(p.momSpeed).toBe(PINBALL_MAX_SPEED);
  });

  it("a ramp sets the steer lock and launches the hop arc", () => {
    const p = state.player!;
    p.momSpeed = 0;
    state.pinballParts = [part("ramp", { dirX: 1, dirZ: 0 })];

    touchPinballParts(true, 0, deps);

    expect(rampHops).toBe(1);
    expect(steerLock).toBeGreaterThan(0);
  });

  it("a booster snaps the heading and floors the speed", () => {
    const p = state.player!;
    p.momX = -1;
    p.momZ = 0;
    p.momSpeed = 1;
    state.pinballParts = [part("booster", { dirX: 0, dirZ: 1 })];

    touchPinballParts(true, 0, deps);

    expect(p.momX).toBe(0);
    expect(p.momZ).toBe(1);
    expect(p.momSpeed).toBe(BOOSTER_SPEED);
  });

  // ── The corner-clip trap ────────────────────────────────────────────────
  // Live bug: a booster aimed into a SHARP CORNER fires the knight at the wall,
  // the wall throws him straight back onto the pad, and the pad fires again.
  // The pocket-rattle damp in player.ts cannot break it — it scrubs momSpeed and
  // the booster's speed FLOOR immediately restores it, so the loop is stable and
  // the player cannot steer out (every re-fire re-arms the steer lock).
  describe("booster jam guard (corner clip)", () => {
    /** One rebound onto the same pad: the ball comes back to where it started. */
    function refire(pad: PinballPart): void {
      const p = state.player!;
      p.x = 0;
      p.z = 0; // bounced back onto the pad
      pad.cooldownT = 0; // the short booster cooldown has elapsed
      touchPinballParts(true, 0, deps);
    }

    it("stands the pad down after repeated re-fires at the same spot", () => {
      const p = state.player!;
      const pad = part("booster", { dirX: 0, dirZ: 1 });
      state.pinballParts = [pad];

      // The trap: fire, bounce back, fire, bounce back…
      for (let i = 0; i < BOOSTER_JAM_HITS; i++) refire(pad);
      expect(p.momSpeed).toBe(BOOSTER_SPEED); // still boosting — a chain is legal

      // …until the pad notices it is the one doing the trapping.
      p.momSpeed = 2; // whatever the wall left him after the damp
      refire(pad);

      expect(p.momSpeed).toBe(2); // NOT re-floored — the ball keeps its own speed
      expect(pad.cooldownT).toBe(BOOSTER_JAM_COOLDOWN); // dark long enough to roll clear
    });

    it("leaves the heading alone when jammed, so the knight can steer out", () => {
      const p = state.player!;
      const pad = part("booster", { dirX: 0, dirZ: 1 });
      state.pinballParts = [pad];

      for (let i = 0; i < BOOSTER_JAM_HITS; i++) refire(pad);
      // The rebound heading: away from the wall the pad keeps firing him into.
      p.momX = 0;
      p.momZ = -1;
      steerLock = 0;
      refire(pad);

      expect(p.momZ).toBe(-1); // not snapped back into the corner
      expect(steerLock).toBe(0); // and no fresh steer lock to fight
    });

    it("does NOT trip on a legitimate chain — each pad catches you further along", () => {
      const p = state.player!;
      const pad = part("booster", { dirX: 0, dirZ: 1 });
      state.pinballParts = [pad];

      // A real booster lane: the ball is somewhere NEW on each contact, so the
      // streak never accumulates and the pad keeps flooring the speed.
      for (let i = 0; i < BOOSTER_JAM_HITS + 3; i++) {
        p.x = 0;
        p.z = 0;
        p.momSpeed = 1;
        pad.cooldownT = 0;
        touchPinballParts(true, 0, deps);
        expect(p.momSpeed).toBe(BOOSTER_SPEED);
        // …then travel on, the way an un-trapped ball does.
        pad.jamX = -99;
        pad.jamZ = -99;
      }
    });
  });

  it("a flipper catapults a walking player too", () => {
    const p = state.player!;
    p.momSpeed = 0;
    state.pinballParts = [part("flipper", { dirX: 1, dirZ: 0 })];

    touchPinballParts(false, 0, deps);

    expect(p.momSpeed).toBe(FLIPPER_SPEED);
  });

  it("a trapdoor hands off to the drop, and only once", () => {
    state.pinballParts = [part("trapdoor")];

    touchPinballParts(true, 0, deps);

    expect(drops).toBe(1);
  });

  it("a trapdoor is ignored while a ride is already in progress", () => {
    const p = state.player!;
    p.rideT = 0.5;
    state.pinballParts = [part("trapdoor")];

    touchPinballParts(true, 0, deps);

    expect(drops).toBe(0);
  });
});

describe("deflector", () => {
  it("GRABS leg→leg: pins the knight and arms a throw along the exit leg", () => {
    const p = state.player!;
    // Travelling +x into a corner whose legs are +x and +z: we came IN along
    // leg 1, so the throw is armed along leg 2. The catch does NOT redirect
    // momentum yet — that fires when the wind-up releases (updatePinball).
    p.momX = 1;
    p.momZ = 0;
    p.momSpeed = 10;
    p.grabT = 0;
    state.pinballParts = [part("deflector", { dirX: -1, dirZ: 0, dir2X: 0, dir2Z: 1 })];

    touchPinballParts(true, 0, deps);

    // Caught: pinned for the wind-up, throw armed along the exit leg (+z).
    expect(p.grabT).toBeCloseTo(DEFLECTOR_GRAB_TIME, 5);
    expect(p.throwDirX).toBe(0);
    expect(p.throwDirZ).toBe(1);
    // Throw speed floors at a real hurl (max(10·boost, 19) = 19), clamped.
    expect(p.throwSpeed).toBeCloseTo(Math.min(PINBALL_MAX_SPEED, Math.max(10 * DEFLECTOR_THROW_BOOST, DEFLECTOR_THROW_SPEED)), 5);
    // Momentum is untouched during the catch — the throw hasn't fired.
    expect(p.momX).toBe(1);
    expect(p.momZ).toBe(0);
    expect(p.momSpeed).toBe(10);
  });

  it("does not re-grab while already held (grabT > 0)", () => {
    const p = state.player!;
    p.momX = 1;
    p.momZ = 0;
    p.momSpeed = 12;
    p.grabT = 0.05; // mid wind-up
    p.throwSpeed = 42; // sentinel — must not be overwritten
    state.pinballParts = [part("deflector", { dirX: -1, dirZ: 0, dir2X: 0, dir2Z: 1 })];

    touchPinballParts(true, 0, deps);

    expect(p.throwSpeed).toBe(42);
  });

  it("ignores a walking player (momentum-only part)", () => {
    const p = state.player!;
    p.momX = 1;
    p.momZ = 0;
    p.momSpeed = 0;
    state.pinballParts = [part("deflector", { dirX: -1, dirZ: 0, dir2X: 0, dir2Z: 1 })];

    touchPinballParts(false, 0, deps);

    expect(p.momSpeed).toBe(0);
  });

  it("ignores a graze that isn't a cornering entry", () => {
    const p = state.player!;
    // heading away from both legs — nothing to bank
    p.momX = -1;
    p.momZ = 0;
    p.momSpeed = 10;
    state.pinballParts = [part("deflector", { dirX: -1, dirZ: 0, dir2X: 0, dir2Z: 1 })];

    touchPinballParts(true, 0, deps);

    expect(p.momX).toBe(-1);
    expect(p.momSpeed).toBe(10);
  });
});

describe("the sweep itself", () => {
  it("skips parts still on cooldown", () => {
    const p = state.player!;
    p.momSpeed = 0;
    state.pinballParts = [part("spring", { cooldownT: 0.5 })];

    touchPinballParts(true, 0, deps);

    expect(p.momSpeed).toBe(0);
  });

  it("skips parts out of range", () => {
    const p = state.player!;
    p.momSpeed = 0;
    state.pinballParts = [part("spring", { x: 50, z: 50 })];

    touchPinballParts(true, 0, deps);

    expect(p.momSpeed).toBe(0);
  });

  it("is a no-op with no player", () => {
    state.player = null;
    state.pinballParts = [part("spring")];
    expect(() => touchPinballParts(true, 0, deps)).not.toThrow();
  });

  it("processes every ready part in one sweep", () => {
    // two rollovers, both light
    const a = part("rollover", { lane: 0, laneSeq: 0 });
    const b = part("rollover", { lane: 0, laneSeq: 1 });
    state.pinballParts = [a, b];

    touchPinballParts(true, 0, deps);

    expect(a.cooldownT).toBeGreaterThan(0);
    expect(b.cooldownT).toBeGreaterThan(0);
  });
});

describe("magstrip", () => {
  it("caps a fast ball down to the strip's speed cap", () => {
    const p = state.player!;
    p.momSpeed = PINBALL_MAX_SPEED;
    p.magBootsT = 0;
    state.pinballParts = [part("magstrip")];

    touchPinballParts(true, 0, deps);

    expect(p.momSpeed).toBeLessThan(PINBALL_MAX_SPEED);
  });

  it("magnet boots invert the drag into a launch", () => {
    const p = state.player!;
    p.momSpeed = 1;
    p.magBootsT = 5;
    state.pinballParts = [part("magstrip")];

    touchPinballParts(true, 0, deps);

    expect(p.momSpeed).toBeGreaterThan(1);
  });
});
