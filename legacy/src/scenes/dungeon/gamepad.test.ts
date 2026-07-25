/**
 * Gamepad mapping + deadzone. Pure by design: a physical pad cannot be plugged
 * into CI, so if this is not testable it is not tested, and a mis-mapped button
 * would only ever be found by a person holding a controller.
 */
import { describe, it, expect } from "vitest";
import { readPad, BTN, STICK_DEADZONE, AIM_DEADZONE, type PadLike } from "./gamepad";
import { emptyPad, applyDeadzone } from "./virtual-pad";

/** A pad with everything at rest; `set` flips the bits a case cares about. */
function pad(set: Partial<{ axes: number[]; down: number[] }> = {}): PadLike {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  for (const b of set.down ?? []) buttons[b] = { pressed: true };
  return { axes: set.axes ?? [0, 0, 0, 0], buttons };
}

describe("applyDeadzone", () => {
  it("kills drift inside the threshold", () => {
    expect(applyDeadzone(0.1, 0.1, 0.25)).toEqual({ x: 0, y: 0 });
  });

  it("RESCALES past it, so the slowest walk is near zero and not a quarter-run", () => {
    // Without the rescale, the first step past a 0.25 deadzone would map to
    // 0.25 magnitude — a visible jump from standing to a brisk walk.
    const just = applyDeadzone(0.26, 0, 0.25);
    expect(Math.hypot(just.x, just.y)).toBeLessThan(0.05);
    const full = applyDeadzone(1, 0, 0.25);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 6);
  });

  it("never exceeds magnitude 1, even on an over-range stick", () => {
    const over = applyDeadzone(1.4, 1.4, 0.2);
    expect(Math.hypot(over.x, over.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("readPad — sticks", () => {
  it("moves from the left stick and aims from the right", () => {
    const out = emptyPad();
    readPad(pad({ axes: [1, 0, 0, -1] }), out, []);
    expect(out.moveX).toBeCloseTo(1, 3);
    expect(out.moveZ).toBeCloseTo(0, 3);
    expect(out.aimY).toBeCloseTo(-1, 3);
  });

  it("ignores resting-stick drift on both sticks", () => {
    const out = emptyPad();
    readPad(pad({ axes: [STICK_DEADZONE * 0.9, 0, AIM_DEADZONE * 0.9, 0] }), out, []);
    expect(out.moveX).toBe(0);
    expect(out.aimX).toBe(0);
  });

  it("takes the LARGER deflection rather than summing two sources", () => {
    // A keyboard already wrote a full-speed axis; a half-pushed stick must not
    // add to it and produce a faster-than-possible move.
    const out = emptyPad();
    out.moveX = 1;
    readPad(pad({ axes: [0.5, 0, 0, 0] }), out, []);
    expect(out.moveX).toBe(1);
    // …and the other way round: a full stick beats a half-written axis.
    const out2 = emptyPad();
    out2.moveX = 0.3;
    readPad(pad({ axes: [1, 0, 0, 0] }), out2, []);
    expect(out2.moveX).toBeCloseTo(1, 3);
  });
});

describe("readPad — buttons", () => {
  it("maps attack to X and RT, dodge to A, sprint to LT", () => {
    const x = emptyPad();
    readPad(pad({ down: [BTN.X] }), x, []);
    expect(x.attack).toBe(true);

    const rt = emptyPad();
    readPad(pad({ down: [BTN.RT] }), rt, []);
    expect(rt.attack).toBe(true);

    const a = emptyPad();
    readPad(pad({ down: [BTN.A] }), a, []);
    expect(a.dodge).toBe(true);

    const lt = emptyPad();
    readPad(pad({ down: [BTN.LT] }), lt, []);
    expect(lt.sprint).toBe(true);
  });

  it("HOLDS dodge, which is what makes the plunger pull work on a pad", () => {
    const out = emptyPad();
    const held = pad({ down: [BTN.A] });
    let prev: boolean[] | null = [];
    for (let f = 0; f < 5; f++) {
      out.dodge = false; // the merge re-ORs each frame
      prev = readPad(held, out, prev).buttons;
      expect(out.dodge).toBe(true);
    }
  });

  it("fires a discrete tap only on the rising edge, not every frame held", () => {
    const out = emptyPad();
    const held = pad({ down: [BTN.LB] });
    const first = readPad(held, out, []);
    expect(first.taps).toEqual(["q"]);
    const second = readPad(held, out, first.buttons);
    expect(second.taps).toEqual([]); // still held → no repeat
  });

  it("does NOT fire a phantom tap for a button already down when the pad appears", () => {
    // `prev: null` means "never polled this pad". A button held at connect time
    // is held, not freshly pressed — firing here would cast a skill the player
    // never asked for the instant they plug in. (`[]` is different: that is
    // "known, nothing was down", so anything down now IS an edge.)
    const out = emptyPad();
    const res = readPad(pad({ down: [BTN.A] }), out, null);
    expect(out.dodgeTap).toBe(false);
    expect(res.taps).toEqual([]);
  });

  it("binds the shoulders to the two skills and the d-pad to the belt", () => {
    const seen = (btn: number): string[] => readPad(pad({ down: [btn] }), emptyPad(), []).taps;
    expect(seen(BTN.LB)).toEqual(["q"]);
    expect(seen(BTN.RB)).toEqual(["e"]);
    expect(seen(BTN.DUP)).toEqual(["1"]);
    expect(seen(BTN.DRIGHT)).toEqual(["2"]);
    expect(seen(BTN.DDOWN)).toEqual(["3"]);
    expect(seen(BTN.DLEFT)).toEqual(["4"]);
    expect(seen(BTN.Y)).toEqual(["r"]);
  });

  it("is a no-op for a missing or disconnected pad", () => {
    const out = emptyPad();
    expect(readPad(null, out, []).taps).toEqual([]);
    expect(readPad({ axes: [1, 1], buttons: [], connected: false }, out, []).taps).toEqual([]);
    expect(out.moveX).toBe(0);
  });

  it("survives a pad that reports fewer axes/buttons than standard", () => {
    // Cheap third-party pads under-report; reading past the end must not throw.
    const out = emptyPad();
    expect(() => readPad({ axes: [0.5], buttons: [{ pressed: true }] }, out, [])).not.toThrow();
  });
});
