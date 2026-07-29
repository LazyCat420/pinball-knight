/**
 * THE RICOCHET TRAIL — the streak that carries the form's direction.
 *
 * The bug this exists to prevent shipped once already: both forms were drawn as
 * a beam lying along the sprite's x axis, and an actor sprite is a
 * camera-facing billboard whose art cannot rotate. So the "laser" pointed east
 * while the ball travelled north-west, every time. The fix moves direction out
 * of the art and into the PATH, which means these are now the tests that keep
 * the heading honest.
 *
 * What matters here:
 *   1. the trail is fed per SUBSTEP (a once-a-frame sample cuts corners off
 *      bounces and draws a straight line through the wall the ball just hit),
 *   2. the points follow the ball's ACTUAL path,
 *   3. a new form does not inherit the previous one's tail.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { state } from "../state";
import { enterRicochetForm, updateRicochet, RICOCHET_FLAVORS } from "./ricochet-form";
import { setTile, type Grid } from "../engine/grid";
import { T_WALL, T_FLOOR } from "../maze/generator";

function makeGrid(size: number, fill: number = T_FLOOR): Grid {
  return { w: size, h: size, t: new Uint8Array(size * size).fill(fill), shapes: new Uint8Array(size * size) };
}

/** Records every trail point pushed, so the path can be inspected. */
function fakeVfx() {
  const points: Array<{ x: number; z: number; color: number }> = [];
  let clears = 0;
  return {
    points,
    clears: () => clears,
    vfx: {
      trail: (x: number, _y: number, z: number, color: number) => points.push({ x, z, color }),
      trailClear: () => {
        clears++;
        points.length = 0;
      },
      sparks: () => {},
      burst: () => {},
      ghost: () => {},
    },
  };
}

let rec: ReturnType<typeof fakeVfx>;

beforeEach(() => {
  const g = makeGrid(11);
  for (let i = 0; i < 11; i++) {
    setTile(g, i, 0, T_WALL);
    setTile(g, i, 10, T_WALL);
    setTile(g, 0, i, T_WALL);
    setTile(g, 10, i, T_WALL);
  }
  state.grid = g;
  state.zombies = [];
  state.dbgMaterialEnabled = true;
  rec = fakeVfx();
  state.vfx = rec.vfx as unknown as typeof state.vfx;
  state.player = {
    ...(state.player ?? {}),
    x: 0,
    z: 0,
    momX: 1,
    momZ: 0,
    momSpeed: 0,
    hp: 5,
    iframes: 0,
    material: null,
    materialT: 0,
    ricochetT: 0,
    ricochetFlavor: "laser",
    ricochetTickT: 0,
    bounceCombo: 0,
  } as typeof state.player;
});

describe("the ricochet trail carries the direction the sprite cannot", () => {
  it("pushes a point per SUBSTEP, not per frame", () => {
    enterRicochetForm("laser");
    rec.points.length = 0;
    updateRicochet(1 / 60);
    // Sub-stepping is not a detail: at laser speed one 60Hz step is several
    // tiles, so a single sample per frame would draw the path as a straight
    // line through whatever it bounced off mid-step.
    expect(rec.points.length).toBeGreaterThan(1);
  });

  it("traces the ball's ACTUAL path, not a fixed axis", () => {
    enterRicochetForm("laser");
    // Send it north-west; the old bug drew the beam along +x regardless.
    state.player!.momX = -0.7;
    state.player!.momZ = -0.7;
    state.player!.x = 0;
    state.player!.z = 0;
    rec.points.length = 0;
    updateRicochet(1 / 60);
    const first = rec.points[0];
    const last = rec.points[rec.points.length - 1];
    expect(last.x).toBeLessThan(first.x);
    expect(last.z).toBeLessThan(first.z);
    // …and every recorded point is where the ball actually was.
    expect(last.x).toBeCloseTo(state.player!.x, 5);
    expect(last.z).toBeCloseTo(state.player!.z, 5);
  });

  it("keeps the corner when it bounces mid-step", () => {
    enterRicochetForm("bolt");
    // Park it hard against the east wall heading into it, so a bounce is
    // guaranteed inside the frame.
    state.player!.x = 4.2;
    state.player!.z = 0;
    state.player!.momX = 1;
    state.player!.momZ = 0;
    rec.points.length = 0;
    for (let i = 0; i < 8; i++) updateRicochet(1 / 60);
    const xs = rec.points.map((p) => p.x);
    // The path must REVERSE somewhere: a straight run of increasing x would
    // mean the samples skipped over the wall contact.
    const turned = xs.some((x, i) => i > 0 && x < xs[i - 1]);
    expect(turned, "the trail never turned — it tunnelled through the bounce").toBe(true);
  });

  it("tints the trail with the flavour, so bolt and laser read apart", () => {
    enterRicochetForm("bolt");
    updateRicochet(1 / 60);
    expect(rec.points[0].color).toBe(RICOCHET_FLAVORS.bolt.tint);
    enterRicochetForm("laser");
    updateRicochet(1 / 60);
    expect(rec.points[rec.points.length - 1].color).toBe(RICOCHET_FLAVORS.laser.tint);
    expect(RICOCHET_FLAVORS.bolt.tint).not.toBe(RICOCHET_FLAVORS.laser.tint);
  });

  it("clears the tail on entry — a new cast never inherits the last one's path", () => {
    enterRicochetForm("laser");
    for (let i = 0; i < 5; i++) updateRicochet(1 / 60);
    expect(rec.points.length).toBeGreaterThan(0);
    enterRicochetForm("bolt");
    // The ribbon is a keep-alive object, not a per-cast one: without an explicit
    // clear the new form would start with a streak leading back to wherever the
    // previous one ended.
    expect(rec.points.length).toBe(0);
    expect(rec.clears()).toBeGreaterThanOrEqual(2);
  });

  it("stops feeding the trail once the form lapses", () => {
    enterRicochetForm("laser");
    for (let i = 0; i < 60 * 5; i++) updateRicochet(1 / 60);
    rec.points.length = 0;
    updateRicochet(1 / 60);
    // Nothing more is pushed; the ribbon fades on its own from here.
    expect(rec.points.length).toBe(0);
  });
});
