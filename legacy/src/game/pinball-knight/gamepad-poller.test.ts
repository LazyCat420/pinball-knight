/**
 * The POLLER, as opposed to `readPad` (gamepad.test.ts).
 *
 * `readPad` was fully covered and passing while gamepad buttons were dead in the
 * real game, which is the whole reason this file exists: the fault was never in
 * the mapping, it was in what the poller does BETWEEN frames — how it stores
 * `prev`, and what a live `navigator.getGamepads()` actually hands back.
 *
 * These tests stub `navigator.getGamepads` and drive `poll()` frame by frame,
 * asserting on dispatched keydowns, because that is the only layer where the
 * bookkeeping bug could live.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createGamepadPoller, BTN, type PadLike } from "./engine/gamepad";
import { emptyPad } from "./engine/virtual-pad";

/** Buttons a fresh pad reports, standard mapping. */
const REST = () => Array.from({ length: 17 }, () => ({ pressed: false }));

/**
 * Collect keys dispatched via `pressKey`.
 *
 * The suite runs in the node environment (no jsdom in this repo, and none of
 * the other tests need one), so rather than pull in a DOM just for this we stub
 * the two things `pressKey` actually touches: `window.dispatchEvent` and the
 * `KeyboardEvent` constructor. Keys land in the returned array in dispatch
 * order — `pressKey` sends keydown then keyup, so we record only keydown.
 */
function captureKeys(): { keys: string[]; stop(): void } {
  const keys: string[] = [];
  const win = globalThis as unknown as { window?: { dispatchEvent(e: { type: string; key: string }): boolean } };
  const prevWindow = win.window;
  win.window = {
    dispatchEvent(e: { type: string; key: string }) {
      if (e.type === "keydown") keys.push(e.key);
      return true;
    },
  };
  return {
    keys,
    stop: () => {
      win.window = prevWindow;
    },
  };
}

let pads: (PadLike | null)[] = [];

beforeEach(() => {
  pads = [];
  vi.stubGlobal("navigator", { getGamepads: () => pads });
  // `pressKey` constructs a real KeyboardEvent; node has no such global.
  vi.stubGlobal(
    "KeyboardEvent",
    class {
      type: string;
      key: string;
      constructor(type: string, init: { key: string }) {
        this.type = type;
        this.key = init.key;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGamepadPoller", () => {
  it("dispatches the bound key on a press that ARRIVES after the pad is known", () => {
    // The realistic sequence: pad appears at rest, player presses LB later.
    const cap = captureKeys();
    const poller = createGamepadPoller(emptyPad());

    pads = [{ axes: [0, 0, 0, 0], buttons: REST() }];
    poller.poll(); // frame 1: pad seen at rest, prev recorded
    expect(cap.keys).toEqual([]);

    const down = REST();
    down[BTN.LB] = { pressed: true };
    pads = [{ axes: [0, 0, 0, 0], buttons: down }];
    poller.poll(); // frame 2: rising edge → "q"

    expect(cap.keys).toEqual(["q"]);
    cap.stop();
  });

  it("does not repeat the key while the button stays held", () => {
    const cap = captureKeys();
    const poller = createGamepadPoller(emptyPad());
    pads = [{ axes: [0, 0, 0, 0], buttons: REST() }];
    poller.poll();

    const down = REST();
    down[BTN.RB] = { pressed: true };
    pads = [{ axes: [0, 0, 0, 0], buttons: down }];
    for (let f = 0; f < 10; f++) poller.poll();

    expect(cap.keys).toEqual(["e"]); // exactly one, not ten
    cap.stop();
  });

  it("fires again after a release — press, release, press is two taps", () => {
    const cap = captureKeys();
    const poller = createGamepadPoller(emptyPad());
    const rest: PadLike = { axes: [0, 0, 0, 0], buttons: REST() };
    const held = REST();
    held[BTN.Y] = { pressed: true };
    const downPad: PadLike = { axes: [0, 0, 0, 0], buttons: held };

    pads = [rest];
    poller.poll();
    pads = [downPad];
    poller.poll();
    pads = [rest];
    poller.poll();
    pads = [downPad];
    poller.poll();

    expect(cap.keys).toEqual(["r", "r"]);
    cap.stop();
  });

  it("REGRESSION: a pad whose object identity is reused across polls still edges", () => {
    // Chrome hands back a fresh Gamepad snapshot each call; some drivers and
    // every naive test double hand back the SAME object with mutated buttons.
    // The poller must key off the stored `prev` array, never off object
    // identity, or a mutating pad never produces an edge.
    const cap = captureKeys();
    const poller = createGamepadPoller(emptyPad());
    const buttons = REST();
    const stable: PadLike = { axes: [0, 0, 0, 0], buttons };
    pads = [stable];

    poller.poll();
    buttons[BTN.DUP] = { pressed: true }; // mutate in place
    poller.poll();

    expect(cap.keys).toEqual(["1"]);
    cap.stop();
  });

  it("suppresses a button ALREADY held on the very first poll, then edges normally", () => {
    // This is the documented `prev === null` rule, at the poller level — and it
    // is also the trap that made a fake pad look like a broken poller: a stub
    // that reports a button pressed from poll 1 and never releases it can NEVER
    // produce a tap. The suppression is correct; a harness must start at rest.
    const cap = captureKeys();
    const poller = createGamepadPoller(emptyPad());
    const held = REST();
    held[BTN.LB] = { pressed: true };
    pads = [{ axes: [0, 0, 0, 0], buttons: held }];

    for (let f = 0; f < 50; f++) poller.poll();
    expect(cap.keys).toEqual([]); // held-at-connect never fires, however long

    // …but once it is released and pressed again, it behaves.
    pads = [{ axes: [0, 0, 0, 0], buttons: REST() }];
    poller.poll();
    pads = [{ axes: [0, 0, 0, 0], buttons: held }];
    poller.poll();
    expect(cap.keys).toEqual(["q"]);
    cap.stop();
  });

  it("re-arms suppression when a pad disconnects and comes back", () => {
    // prev is dropped when nothing is connected, so a pad reconnected with a
    // button down must not fire that button either.
    const cap = captureKeys();
    const poller = createGamepadPoller(emptyPad());
    pads = [{ axes: [0, 0, 0, 0], buttons: REST() }];
    poller.poll();

    pads = []; // unplugged
    poller.poll();
    expect(poller.connected()).toBe(false);

    const held = REST();
    held[BTN.LB] = { pressed: true };
    pads = [{ axes: [0, 0, 0, 0], buttons: held }]; // replugged, button down
    poller.poll();

    expect(cap.keys).toEqual([]);
    cap.stop();
  });

  it("re-arms suppression per SLOT when one of two pads is unplugged", () => {
    // The all-pads-gone reset is not enough. With a second pad still connected,
    // slot 0 going away must still forget slot 0 — otherwise a pad replugged
    // there with a button held is compared against the OLD pad's last frame and
    // fires an action nobody pressed.
    const cap = captureKeys();
    const poller = createGamepadPoller(emptyPad());
    const other: PadLike = { axes: [0, 0, 0, 0], buttons: REST() };

    pads = [{ axes: [0, 0, 0, 0], buttons: REST() }, other];
    poller.poll(); // both known, at rest

    pads = [null, other]; // pad 0 unplugged, pad 1 stays
    poller.poll();

    const held = REST();
    held[BTN.Y] = { pressed: true };
    pads = [{ axes: [0, 0, 0, 0], buttons: held }, other]; // replugged, Y down
    poller.poll();

    expect(cap.keys).toEqual([]); // must NOT rampage on plug-in
    cap.stop();
  });

  it("reports polls, connection and last taps through debug()", () => {
    const poller = createGamepadPoller(emptyPad());
    pads = [{ axes: [0, 0, 0, 0], buttons: REST() }];
    poller.poll();
    const down = REST();
    down[BTN.BACK] = { pressed: true };
    pads = [{ axes: [0, 0, 0, 0], buttons: down }];
    poller.poll();

    const d = poller.debug() as { polls: number; connected: boolean; lastTaps: string[] };
    expect(d.polls).toBe(2);
    expect(d.connected).toBe(true);
    expect(d.lastTaps).toEqual(["m"]);
  });
});
