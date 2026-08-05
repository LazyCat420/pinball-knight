/**
 * THE LAST FRAME OF RICOCHET FORM — a crash that only the final frame reaches.
 *
 * `updateRicochet` and `ricochetSpec` disagree for exactly one frame, and the
 * player's update loop used to assert they could not:
 *
 *   updateRicochet(dt)  returns TRUE on the frame it decrements ricochetT to
 *                       zero — it still owes the exit speed and the burst
 *   ricochetSpec()      is gated on ricochetT > 0, so it is already NULL
 *
 * `p.anim.play(ricochetSpec()!.clip)` therefore threw `Cannot read properties
 * of null (reading 'clip')` once per use of the form, killing the rest of that
 * frame's player update (the mesh sync and the animator tick after it). It
 * surfaced in a profiled 1080p playtest run, not in the suite, because nothing
 * had ever driven the form to its last frame.
 *
 * ⚠️ The load-bearing test is the FIRST one: it drives the real `updatePlayer`
 * across the boundary, so it fails if the non-null assertion comes back. A test
 * that only asserted the disagreement is reachable would pass either way.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { state } from "../state";
import { updatePlayer } from "./player";
import { enterRicochetForm, updateRicochet, ricochetSpec } from "./ricochet-form";
import { setTile, type Grid } from "../engine/grid";
import { T_WALL, T_FLOOR } from "../maze/generator";
import type { InputHandle } from "../engine/input";

function makeGrid(size: number, fill: number = T_FLOOR): Grid {
  return { w: size, h: size, t: new Uint8Array(size * size).fill(fill), shapes: new Uint8Array(size * size) };
}

/** A dead controller — same Proxy trick as trapdoor-ride.test.ts. */
const INPUT = new Proxy(
  {},
  {
    get: (_t, k) => {
      if (k === "move" || k === "aim" || k === "mouseAim") return () => ({ x: 0, z: 0 });
      if (k === "pad") return () => ({ buttons: [], axes: [0, 0, 0, 0] });
      if (k === "axis") return () => 0;
      return () => false;
    },
  },
) as unknown as InputHandle;

/** Clips the animator was asked to play, in order. */
let played: string[];

beforeEach(() => {
  const g = makeGrid(21);
  for (let i = 0; i < 21; i++) {
    setTile(g, i, 0, T_WALL);
    setTile(g, i, 20, T_WALL);
    setTile(g, 0, i, T_WALL);
    setTile(g, 20, i, T_WALL);
  }
  state.grid = g;
  state.maze = null;
  state.vfx = null;
  state.zombies = [];
  state.pinballParts = [];
  state.groundItems = [];
  state.stairs = null;
  state.plungerArmed = false;
  state.fpsActive = false;
  played = [];
  state.player = {
    ...(state.player ?? {}),
    x: 10, z: 10, hp: 6, iframes: 0, cooldown: 0,
    oilT: 0, webbedT: 0, flashT: 0,
    momX: 1, momZ: 0, momSpeed: 0,
    ricochetT: 0, ricochetFlavor: "laser", ricochetTickT: 0, bounceCombo: 0,
    material: null, materialT: 0,
    facing: "S", dropT: -1, rideT: -1, rideDur: 0, ridePts: [],
    hopT: -1, wallMoveT: -1, rollT: -1, attackT: -1, chargeT: -1, move: null,
    sprite: {
      mesh: {
        visible: true,
        position: { x: 0, y: 0, z: 0, set: () => {} },
        scale: { x: 1, y: 1, z: 1, set: () => {} },
        rotation: { x: 0, y: 0, z: 0, set: () => {} },
      },
      setElevation: () => {}, setTint: () => {}, setBlobVisible: () => {},
    },
    anim: {
      play: (c: string) => played.push(c),
      setRate: () => {}, setFacing: () => {}, update: () => {},
      getClip: () => "ball", getRate: () => 1,
    },
  } as unknown as typeof state.player;
});

describe("the frame ricochet form ends", () => {
  it("does not throw when the form's spec goes null while it still owns the player", () => {
    enterRicochetForm("laser");
    const p = state.player!;
    // Drive the REAL player update until the form lets go. The frame that used
    // to throw is the one where ricochetT lands on 0 — before the fix this loop
    // died with "Cannot read properties of null (reading 'clip')".
    let frames = 0;
    expect(() => {
      // Stop ON the zero frame, not past it. That frame is the whole test: the
      // ricochet branch still claims the player and returns early, so this
      // never reaches the ordinary locomotion path (which would want maze
      // state this fixture deliberately does not build).
      for (; frames < 3000; frames++) {
        updatePlayer(1 / 60, INPUT);
        if (p.ricochetT === 0) break;
      }
    }).not.toThrow();
    expect(frames, "the form never ran out — the loop bailed before the boundary").toBeLessThan(3000);
    expect(p.ricochetT).toBe(0);
    // It played the form's clip while the form was running, which is the
    // behaviour the assertion was there to guarantee in the first place.
    expect(played.length).toBeGreaterThan(0);
  });

  it("still owns the player on the frame its spec is already gone", () => {
    // The precondition, stated on its own: if this ever stops being true the
    // non-null assertion could be restored — and the test above would say so.
    enterRicochetForm("laser");
    let sawOwnedWithoutSpec = false;
    for (let i = 0; i < 3000; i++) {
      const owned = updateRicochet(1 / 60);
      if (owned && ricochetSpec() === null) { sawOwnedWithoutSpec = true; break; }
      if (!owned) break;
    }
    expect(sawOwnedWithoutSpec).toBe(true);
  });

  it("hands back the exit speed rather than a dead stop", () => {
    enterRicochetForm("laser");
    const p = state.player!;
    for (let i = 0; i < 3000; i++) if (!updateRicochet(1 / 60)) break;
    expect(p.ricochetT).toBe(0);
    // A zero here is the "frozen in place the instant it ends" regression the
    // exit block exists to prevent.
    expect(p.momSpeed).toBeGreaterThan(0);
  });
});
