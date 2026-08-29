/**
 * THE FLIPPER BUTTON — command and clock.
 *
 * The other half of the feature (what a contact is WORTH: passive vs timed vs
 * cradled) is pinned in entities/pinball-collide.test.ts, next to every other
 * part's contact rule. This file covers the half that decides WHICH paddle a
 * press reaches and HOW a swing ages, because those are the two things that
 * make the timing window real rather than decorative.
 *
 * No rendering and no audio (house rule): `state.vfx` is left null so the
 * optional-chained VFX calls no-op, and sfx are fail-silent without an
 * AudioContext.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields, type PinballPart, type PinballPartKind } from "../state";
import { emptyPad } from "../engine/virtual-pad";
import type { InputHandle } from "../engine/input";
import { swingNearest, updateFlippers, swingIsLive, isHeldUp, releaseCradle } from "./flippers";
import { FLIPPER_REACH, FLIPPER_ACTIVE, FLIPPER_SWING, FLIPPER_COOLDOWN } from "../constants";

/** A fake input: `tap` fires once when consumed, `held` is the button state. */
function input(tap: boolean, held = false): InputHandle {
  let pending = tap;
  return {
    axis: () => ({ x: 0, z: 0 }),
    consumeAttack: () => false,
    attackHeldNow: () => false,
    consumeAttackTap: () => false,
    sprintHeld: () => false,
    consumeDodge: () => false,
    dodgeHeld: () => false,
    consumeFlip: () => {
      const want = pending;
      pending = false;
      return want;
    },
    flipHeld: () => held,
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

function paddle(x: number, z = 0, over: Partial<PinballPart> = {}): PinballPart {
  return {
    kind: "flipper" as PinballPartKind,
    i: 0,
    j: 0,
    x,
    z,
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

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
  state.pinballParts = [];
  state.vfx = null as unknown as typeof state.vfx;
});

describe("which paddle the button reaches", () => {
  it("swings the NEAREST paddle and leaves the rest alone", () => {
    // A button that flipped every paddle in the room would be a panic button:
    // mash it and something eventually throws you somewhere. One press, one
    // paddle, and it is the one you walked up to.
    const near = paddle(1);
    const far = paddle(2.5);
    state.pinballParts = [far, near];

    expect(swingNearest()).toBe(near);
    expect(near.swingT).toBe(0);
    expect(far.swingT).toBeUndefined();
  });

  it("reaches nothing beyond FLIPPER_REACH", () => {
    const out = paddle(FLIPPER_REACH + 0.1);
    state.pinballParts = [out];

    expect(swingNearest()).toBeNull();
    expect(out.swingT).toBeUndefined();
  });

  it("will not re-command a paddle that is already swinging", () => {
    // THE AUTO-REPEAT GUARD. Without it, a held key restarts the window every
    // frame and `swingIsLive` is true forever — the timed launch would be free
    // and the whole skill would evaporate into "hold F".
    const f = paddle(0.5, 0, { swingT: FLIPPER_SWING });
    state.pinballParts = [f];

    expect(swingNearest()).toBeNull();
    expect(f.swingT).toBe(FLIPPER_SWING); // untouched, not reset to 0
  });

  it("will not command a paddle still cooling down from its last shot", () => {
    const f = paddle(0.5, 0, { cooldownT: FLIPPER_COOLDOWN });
    state.pinballParts = [f];

    expect(swingNearest()).toBeNull();
  });

  it("ignores every part that is not a flipper", () => {
    const bumper = paddle(0.2, 0, { kind: "bumper" as PinballPartKind });
    state.pinballParts = [bumper];

    expect(swingNearest()).toBeNull();
    expect(bumper.swingT).toBeUndefined();
  });
});

describe("how a swing ages", () => {
  it("is LIVE inside FLIPPER_ACTIVE and dead the instant it is past it", () => {
    const f = paddle(0.5);
    state.pinballParts = [f];
    updateFlippers(0, input(true));
    expect(swingIsLive(f)).toBe(true);

    // Step to just inside the window, then just past it. The boundary is the
    // feature: everything after it is follow-through and must not pay.
    updateFlippers(FLIPPER_ACTIVE - 0.01, input(false));
    expect(swingIsLive(f)).toBe(true);

    updateFlippers(0.02, input(false));
    expect(swingIsLive(f)).toBe(false);
  });

  it("returns to rest once the whole arc has run untouched", () => {
    const f = paddle(0.5);
    state.pinballParts = [f];
    updateFlippers(0, input(true));

    updateFlippers(FLIPPER_SWING + 0.01, input(false));

    expect(f.swingT).toBeUndefined();
    expect(isHeldUp(f)).toBe(false);
  });

  it("a HELD button parks the paddle at the top, and the hold is not a live window", () => {
    // A hold is a cradle, not an infinite timed launch. If `swingIsLive` stayed
    // true while held, holding the button would be strictly better than timing
    // it and the tap would be pointless.
    const f = paddle(0.5);
    state.pinballParts = [f];
    updateFlippers(0, input(true, true));

    for (let k = 0; k < 60; k++) updateFlippers(1 / 60, input(false, true));

    expect(isHeldUp(f)).toBe(true);
    expect(f.swingT).toBe(FLIPPER_ACTIVE); // frozen, not accumulating
    expect(swingIsLive(f)).toBe(false);
  });

  it("releasing a held paddle that caught nobody just drops it", () => {
    const f = paddle(0.5);
    state.pinballParts = [f];
    updateFlippers(0, input(true, true));
    updateFlippers(0.3, input(false, true));
    expect(isHeldUp(f)).toBe(true);

    updateFlippers(1 / 60, input(false, false));

    expect(isHeldUp(f)).toBe(false);
    expect(f.swingT).toBeUndefined();
  });

  it("releasing a held paddle that IS holding someone keeps the swing for the handler", () => {
    // The release does not launch — PART_HANDLERS.flipper does, on the contact
    // sweep later in the same frame. Clearing `swingT` here would delete the
    // cradle before anything could fire it.
    const f = paddle(0.5);
    state.pinballParts = [f];
    updateFlippers(0, input(true, true));
    updateFlippers(0.3, input(false, true));
    f.cradled = true;

    updateFlippers(1 / 60, input(false, false));

    expect(isHeldUp(f)).toBe(false);
    expect(f.cradled).toBe(true);
    expect(f.swingT).not.toBeUndefined();
  });
});

describe("paddles age without a player", () => {
  it("a knight who dies mid-cradle does not leave the paddle up forever", () => {
    // `held` is latched state on the PART, and updateFlippers is its only
    // writer. Ticking it behind the `p.hp <= 0` guard in updatePlayer would
    // strand a raised paddle on the floor: the next knight walks into a flipper
    // nobody is holding and is caught by it. So the tick loop reads
    // `state.player` nowhere, and this is the test that says so.
    const f = paddle(0.5);
    state.pinballParts = [f];
    updateFlippers(0, input(true, true));
    updateFlippers(0.3, input(false, true));
    expect(isHeldUp(f)).toBe(true);

    state.player = null; // the knight died

    updateFlippers(1 / 60, input(false, false));

    expect(isHeldUp(f)).toBe(false);
    expect(f.swingT).toBeUndefined();
  });
});

describe("releaseCradle", () => {
  it("stamps the cooldown only when the knight was actually launched", () => {
    // A cradle the player walked out of is not a shot, and charging it the
    // full FLIPPER_COOLDOWN would punish them for escaping.
    const fired = paddle(0, 0, { cradled: true, held: true, swingT: FLIPPER_ACTIVE });
    releaseCradle(fired, true);
    expect(fired.cooldownT).toBe(FLIPPER_COOLDOWN);

    const escaped = paddle(0, 0, { cradled: true, held: true, swingT: FLIPPER_ACTIVE });
    releaseCradle(escaped, false);
    expect(escaped.cooldownT).toBe(0);

    for (const f of [fired, escaped]) {
      expect(f.cradled).toBe(false);
      expect(f.held).toBe(false);
      expect(f.swingT).toBeUndefined();
    }
  });
});
