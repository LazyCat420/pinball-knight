import { describe, expect, it, vi } from "vitest";
import { MOVE_KEYS, TURN_LEFT, TURN_RIGHT, createInput } from "./engine/input";

describe("dungeon input bindings", () => {
  /**
   * The regression this exists for:
   *
   * `arrowleft`/`arrowright` were bound in MOVE_KEYS *and* in
   * TURN_LEFT/TURN_RIGHT. Both are read from the same held-key set — `axis()`
   * for movement, `turnAxis()` for the FPS camera — so in FPS mode holding Left
   * strafed left and rotated the camera left on the same frame.
   *
   * That compound motion is the most likely source of the "control inversion"
   * suspicion carried in ROADMAP §6 and VERIFY_CHECKLIST §6 for several
   * revisions. There is no sign error in the movement or aim math; the arrows
   * were simply doing two jobs at once.
   */
  it("binds no key to both movement and turning", () => {
    const turnKeys = [...TURN_LEFT, ...TURN_RIGHT];
    const doubleBound = turnKeys.filter((k) => k in MOVE_KEYS);
    expect(doubleBound).toEqual([]);
  });

  it("keeps the arrows as a movement alias for WASD", () => {
    // Iso mode has no turn, so arrows must still move or arrow-key players lose
    // movement entirely.
    expect(MOVE_KEYS["arrowleft"]).toEqual(MOVE_KEYS["a"]);
    expect(MOVE_KEYS["arrowright"]).toEqual(MOVE_KEYS["d"]);
    expect(MOVE_KEYS["arrowup"]).toEqual(MOVE_KEYS["w"]);
    expect(MOVE_KEYS["arrowdown"]).toEqual(MOVE_KEYS["s"]);
  });

  it("keeps q/e as the FPS turn keys", () => {
    expect(TURN_LEFT.has("q")).toBe(true);
    expect(TURN_RIGHT.has("e")).toBe(true);
  });

  it("has opposing movement axes that cancel", () => {
    // Guards against a sign typo in the movement table itself.
    expect(MOVE_KEYS["a"][0]).toBe(-MOVE_KEYS["d"][0]);
    expect(MOVE_KEYS["w"][1]).toBe(-MOVE_KEYS["s"][1]);
  });

  /**
   * The regression this exists for: the window keydown listener keeps running
   * while a modal (card reader / menu) is up, so the Space that DISMISSED the
   * modal sits queued as a dodge and fires a roll the instant the sim resumes.
   * Modals call clearTransient() on close; it must drain queued taps without
   * releasing held state (a held plunger pull should survive a toast).
   */
  it("clearTransient drains queued taps but keeps held state", () => {
    // node test env has no window/DOM — stub just enough to capture handlers.
    const handlers: Record<string, (e: unknown) => void> = {};
    const g = globalThis as { window?: unknown };
    g.window = {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        handlers[type] = fn;
      },
      removeEventListener: () => {},
    };
    const surface = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
    try {
      const input = createInput(surface);
      handlers.keydown({ key: " ", repeat: false, preventDefault: () => {} });
      input.clearTransient();
      expect(input.consumeDodge()).toBe(false); // the queued tap is gone…
      expect(input.dodgeHeld()).toBe(true); // …but the key is still held
      handlers.keyup({ key: " " });
      expect(input.dodgeHeld()).toBe(false);
    } finally {
      delete g.window;
    }
  });

  /**
   * The regression this exists for: in the FPS rampage the camera turn read
   * `turnAxis()`, which was KEYBOARD-ONLY (q/e). The right stick filled `aimX`,
   * which only ranged aiming and the pinball steer ever read. So on a pad you
   * could walk and strafe in rampage but never turn — and with no turn, strafe
   * is the only lateral control, which is what "I can't go left or right"
   * actually was.
   */
  describe("turnAxis reads the right stick (FPS rampage)", () => {
    const withInput = (fn: (input: ReturnType<typeof createInput>, handlers: Record<string, (e: unknown) => void>) => void): void => {
      const handlers: Record<string, (e: unknown) => void> = {};
      const g = globalThis as { window?: unknown };
      g.window = {
        addEventListener: (type: string, fn2: (e: unknown) => void) => {
          handlers[type] = fn2;
        },
        removeEventListener: () => {},
      };
      const surface = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
      try {
        fn(createInput(surface), handlers);
      } finally {
        delete g.window;
      }
    };

    it("turns from the touch/aim pad with no keyboard held", () => {
      withInput((input) => {
        expect(input.turnAxis()).toBe(0);
        input.pad.aimX = 1;
        expect(input.turnAxis()).toBe(1); // stick right = turn right
        input.pad.aimX = -1;
        expect(input.turnAxis()).toBe(-1);
      });
    });

    it("is ANALOG — a half-pushed stick turns at half speed", () => {
      withInput((input) => {
        input.pad.aimX = 0.5;
        expect(input.turnAxis()).toBeCloseTo(0.5);
      });
    });

    it("takes the larger deflection rather than summing keyboard + stick", () => {
      withInput((input, handlers) => {
        handlers.keydown({ key: "e", repeat: false, preventDefault: () => {} }); // turn right, +1
        input.pad.aimX = 0.4;
        // Summing would give 1.4 — a faster-than-possible turn.
        expect(input.turnAxis()).toBe(1);
      });
    });

    it("does not turn from the stick's VERTICAL axis", () => {
      // aimY is pitch/aim, not yaw — feeding it into the turn would make pushing
      // the stick up spin the camera.
      withInput((input) => {
        input.pad.aimY = 1;
        expect(input.turnAxis()).toBe(0);
      });
    });

    /**
     * The whole chain a real controller takes, not just the last link: a physical
     * pad's axes[2] → readPad → the poller's VirtualPad → turnAxis. Asserting only
     * against `input.pad` (the TOUCH surface) would have passed even while the
     * hardware path stayed broken, because the poller writes a DIFFERENT pad
     * struct — the two are deliberately separate (see createInput).
     */
    /** A hardware pad reporting `axes`, seen through navigator.getGamepads. */
    const stubPad = (axes: number[]): void => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
      vi.stubGlobal("navigator", { getGamepads: () => [{ axes, buttons, connected: true }] });
    };

    it("turns from a HARDWARE pad, through poll()", () => {
      withInput((input) => {
        // axes = [leftX, leftY, rightX, rightY]; right stick pushed fully RIGHT.
        stubPad([0, 0, 1, 0]);
        try {
          input.poll();
          expect(input.turnAxis()).toBeCloseTo(1, 3);
          // …and the left stick still strafes, independently of the turn.
          expect(input.axis().x).toBeCloseTo(0, 3);
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });

    it("a hardware pad at REST does not drift the camera", () => {
      // A worn stick resting slightly off-centre must not spin the view forever;
      // the deadzone is what stops it, and it has to survive this path too.
      withInput((input) => {
        stubPad([0, 0, 0.08, 0.05]);
        try {
          input.poll();
          expect(input.turnAxis()).toBe(0);
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });
  });
});
