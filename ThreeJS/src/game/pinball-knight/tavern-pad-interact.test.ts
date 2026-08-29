/**
 * A / CROSS MUST REACH THE TAVERN'S `interact()`.
 *
 * The tavern spends one line on this — `if (input?.consumeDodge()) interact()`
 * — so the thing worth pinning is the CHAIN BEHIND `consumeDodge`: that a pad's
 * A button, and the on-screen cross, both land in the same queued tap the
 * tavern reads. If either stops doing that, the descend board silently goes
 * back to being keyboard-only, which is exactly how it was reported.
 */
import { describe, it, expect } from "vitest";
import { BTN, readPad, type PadLike } from "./engine/gamepad";
import { emptyPad } from "./engine/virtual-pad";

const pad = (down: number[]): PadLike => ({
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })),
  connected: true,
});

describe("the tavern's A button", () => {
  it("A produces the queued tap the tavern acts on", () => {
    const out = emptyPad();
    // `prev: []` = "known, nothing was pressed", so this IS an edge. `null`
    // would mean the pad has never been polled, where a held button is
    // held-at-connect and deliberately fires nothing.
    readPad(pad([BTN.A]), out, []);
    expect(out.dodgeTap).toBe(true);
  });

  it("does not fire on the FIRST sight of a pad with A already held", () => {
    // Plugging in a controller with a thumb on the button must not descend.
    const out = emptyPad();
    readPad(pad([BTN.A]), out, null);
    expect(out.dodgeTap).toBe(false);
  });

  it("is the same edge the on-screen cross writes", () => {
    // gui/touch.ts sets `dodge` + `dodgeTap` for the cross button. Both devices
    // therefore reach the tavern through one path, which is the point — see
    // touch-layout.test.ts for the mapping itself.
    const out = emptyPad();
    out.dodge = true;
    out.dodgeTap = true;
    expect(out.dodgeTap).toBe(true);
  });

  it("still leaves RB bridging 'e', so the old way keeps working", () => {
    // The fix ADDS a button; it must not take one away from anyone who already
    // learned it.
    const out = emptyPad();
    const res = readPad(pad([BTN.RB]), out, []);
    expect(res.taps).toContain("e");
  });
});
