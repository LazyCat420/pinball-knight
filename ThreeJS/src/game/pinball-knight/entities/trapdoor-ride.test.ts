/**
 * THE TRAPDOOR RUN — hatch → tunnel → pop-out.
 *
 * The bug these pin: the ride used to fly the knight OVER the maze at
 * TRAPDOOR_HEIGHT, in plain sight, which reads as "he floated across the room"
 * rather than "a trapdoor swallowed him". The fix is that the whole transit
 * happens BELOW the floor with the billboard switched off, and he comes back up
 * through the flagstones at the far end.
 *
 * That makes two properties load-bearing, and both are invisible to every other
 * test in the suite:
 *
 *  1. WHILE TRAVELLING HE IS NOT ON SCREEN. Sprite hidden AND silhouette
 *     hidden — the silhouette is a GreaterDepth pass whose whole job is to draw
 *     him through anything that occludes him, so leaving it on would paint a
 *     blue knight sliding over the floor and the fix would be cosmetic only.
 *     He must also never be ABOVE the floor mid-transit: that is the original
 *     bug, stated as an assertion.
 *  2. HE COMES BACK. An invisible knight is a lost run, so the reveal is
 *     checked both on the normal landing and on the self-heal path (a ride
 *     cancelled from outside — a grave pit, a death — only clears rideT).
 *
 * The drop is driven by setting `dropT`, which is exactly what `startDrop`
 * does; `pinball-collide.test.ts` already covers the hatch deciding to fire.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { state } from "../state";
import { updatePlayer } from "./player";
import type { InputHandle } from "../engine/input";
import { emptyPad } from "../engine/virtual-pad";
import { T_FLOOR } from "../maze/generator";
import type { Grid } from "../engine/grid";
import { TRAPDOOR_DROP, TRAPDOOR_DROP_DEPTH, TRAPDOOR_BURST, TRAPDOOR_POP, TRAPDOOR_EXIT_SPEED } from "../constants";

function makeGrid(size: number, fill: number = T_FLOOR): Grid {
  return { w: size, h: size, t: new Uint8Array(size * size).fill(fill), shapes: new Uint8Array(size * size) };
}

/** What the sprite layer looks like from here: a height, a visibility, a shadow. */
interface SpriteSpy {
  mesh: { position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }; visible: boolean };
  elevation: number;
}

function spriteSpy(): SpriteSpy {
  const spy: SpriteSpy = {
    mesh: {
      position: {
        x: 0,
        y: 0,
        z: 0,
        set(x: number, y: number, z: number) {
          spy.mesh.position.x = x;
          spy.mesh.position.y = y;
          spy.mesh.position.z = z;
        },
      },
      visible: true,
    },
    elevation: 0,
  };
  return spy;
}

/**
 * A dead controller. Everything defaults to "not pressed" / zero: the sequence
 * hands control back on touchdown and the ordinary walking path then reads a
 * dozen input methods this test has no opinion about, so a Proxy is both
 * shorter and immune to InputHandle growing a method.
 */
const INPUT = new Proxy(
  {},
  {
    get: (_t, k) => {
      if (k === "move" || k === "aim" || k === "mouseAim") return () => ({ x: 0, z: 0 });
      if (k === "pad") return () => emptyPad();
      if (k === "axis") return () => 0;
      return () => false;
    },
  },
) as unknown as InputHandle;

let sprite: SpriteSpy;
let silhouette: { mesh: { visible: boolean } };

/** A knight parked on a hatch, mid-fall — i.e. one frame after `startDrop`. */
function knightOnAHatch(): void {
  sprite = spriteSpy();
  silhouette = { mesh: { visible: true } };
  state.grid = makeGrid(40);
  state.maze = null;
  state.vfx = null;
  state.zombies = [];
  state.pinballParts = [];
  state.groundItems = [];
  state.stairs = null;
  state.plungerArmed = false;
  state.fpsActive = false;
  state.player = {
    ...(state.player ?? {}),
    x: 10,
    z: 10,
    hp: 6,
    iframes: 0,
    cooldown: 0,
    oilT: 0,
    webbedT: 0,
    flashT: 0,
    momX: 0,
    momZ: 0,
    momSpeed: 0,
    ricochetT: 0,
    facing: "south",
    dropT: 0,
    dropX: 10,
    dropZ: 10,
    rideT: -1,
    rideDur: 0,
    ridePts: [],
    hopT: -1,
    wallMoveT: -1,
    rollT: -1,
    attackT: -1,
    chargeT: -1,
    move: null,
    sprite: {
      mesh: sprite.mesh,
      setElevation: (h: number) => {
        sprite.elevation = h;
      },
      setTint: () => {},
      setBlobVisible: () => {},
    },
    silhouette,
    anim: {
      play: () => {},
      setRate: () => {},
      setFacing: () => {},
      update: () => {},
      getClip: () => "ball",
    },
  } as unknown as typeof state.player;
}

/** Run the sequence, sampling the sprite every frame. */
function runSequence(seconds: number, dt = 1 / 60): Array<{ t: number; y: number; visible: boolean; sil: boolean; rideT: number; dropT: number }> {
  const frames = [];
  for (let t = 0; t < seconds; t += dt) {
    updatePlayer(dt, INPUT);
    const p = state.player!;
    frames.push({ t, y: sprite.mesh.position.y, visible: sprite.mesh.visible, sil: silhouette.mesh.visible, rideT: p.rideT, dropT: p.dropT });
    if (p.rideT < 0 && p.dropT < 0 && t > TRAPDOOR_DROP) break; // landed
  }
  return frames;
}

beforeEach(knightOnAHatch);

describe("the hatch drop", () => {
  it("sinks him below the floor and hands off to the tunnel", () => {
    const frames = runSequence(TRAPDOOR_DROP + 0.05);
    const last = frames[frames.length - 1];
    expect(last.y).toBeLessThan(0);
    // The hand-off is continuous: the tunnel picks him up at the depth the fall
    // left him at, so there is no frame where he pops back to floor level.
    expect(last.y).toBeGreaterThanOrEqual(-TRAPDOOR_DROP_DEPTH - 1e-6);
    expect(state.player!.rideT).toBeGreaterThanOrEqual(0);
  });
});

describe("the tunnel run", () => {
  it("takes him OFF SCREEN — sprite and silhouette both — for the whole transit", () => {
    runSequence(TRAPDOOR_DROP + 0.05);
    const dur = state.player!.rideDur;
    const frames = runSequence(dur - 0.1);
    const transit = frames.filter((f) => f.rideT >= 0 && f.rideT < dur);
    expect(transit.length).toBeGreaterThan(10);
    for (const f of transit) {
      expect(f.visible, `visible at rideT=${f.rideT.toFixed(2)}`).toBe(false);
      expect(f.sil, `silhouette at rideT=${f.rideT.toFixed(2)}`).toBe(false);
    }
  });

  it("REGRESSION: never flies him ABOVE the floor on the way — that was the bug", () => {
    runSequence(TRAPDOOR_DROP + 0.05);
    const dur = state.player!.rideDur;
    const frames = runSequence(dur - 0.1);
    const peak = Math.max(...frames.filter((f) => f.rideT >= 0 && f.rideT < dur).map((f) => f.y));
    expect(peak).toBeLessThanOrEqual(0);
  });

  it("moves him somewhere else — a tunnel that goes nowhere is not a teleport", () => {
    const from = { x: state.player!.x, z: state.player!.z };
    runSequence(TRAPDOOR_DROP + 0.05);
    runSequence(state.player!.rideDur - 0.1);
    expect(Math.hypot(state.player!.x - from.x, state.player!.z - from.z)).toBeGreaterThan(1);
  });
});

describe("the pop-out", () => {
  it("brings him back up through the floor, apex above it, landing on it", () => {
    runSequence(TRAPDOOR_DROP + 0.05);
    const frames = runSequence(state.player!.rideDur + TRAPDOOR_BURST + 0.2);
    // A tolerance, not `> rideDur`: the sampled rideT is the post-increment value,
// and the frame that lands exactly ON rideDur (to a float epsilon) is still the
// last transit frame, not the first burst one.
const burst = frames.filter((f) => f.rideT >= 0 && f.rideT > state.player!.rideDur + 1e-6);
    // He is on screen again for the climb (the floor plane clips the part of it
    // that is still underground — that is what sells the hole).
    expect(burst.every((f) => f.visible)).toBe(true);
    const peak = Math.max(...frames.map((f) => f.y));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(TRAPDOOR_POP + 1e-6);
  });

  it("lands him ON the floor with his silhouette back and the launch armed", () => {
    runSequence(TRAPDOOR_DROP + 0.05);
    runSequence(state.player!.rideDur + TRAPDOOR_BURST + 0.5);
    const p = state.player!;
    expect(p.rideT).toBe(-1);
    expect(sprite.mesh.position.y).toBe(0);
    expect(sprite.elevation).toBe(0);
    expect(sprite.mesh.visible).toBe(true);
    expect(silhouette.mesh.visible).toBe(true);
    expect(p.momSpeed).toBeCloseTo(TRAPDOOR_EXIT_SPEED);
  });
});

describe("he always comes back", () => {
  it("SELF-HEALS a ride cancelled from outside — an invisible knight is a lost run", () => {
    runSequence(TRAPDOOR_DROP + 0.05);
    runSequence(0.3);
    expect(sprite.mesh.visible).toBe(false); // under the floor

    // Exactly what fallInPit / fallInGravePit / a floor change do: clear the
    // ride and leave. Nothing in those paths knows about the billboard.
    state.player!.rideT = -1;
    state.player!.ridePts = [];

    updatePlayer(1 / 60, INPUT);
    expect(sprite.mesh.visible).toBe(true);
    expect(silhouette.mesh.visible).toBe(true);
  });

  it("does not fight the rampage, which hides the same two meshes for its own reason", () => {
    runSequence(TRAPDOOR_DROP + 0.05);
    runSequence(0.3);
    state.fpsActive = true; // first person: we ARE the knight, the billboard stays off
    state.player!.rideT = -1;
    state.player!.ridePts = [];

    updatePlayer(1 / 60, INPUT);
    expect(sprite.mesh.visible).toBe(false);
    expect(silhouette.mesh.visible).toBe(false);
    state.fpsActive = false;
  });
});
