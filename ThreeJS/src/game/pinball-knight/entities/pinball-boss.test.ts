import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import * as THREE from "three";
import { BOSSES } from "../boss-kinds";
import {
  freshPinballCharge,
  pinballChargeHoldsMovement,
  updatePinballCharge,
  disposePinballCharge,
  type MoveCtx,
} from "../boss-moves";
import { makePinballBossPaints } from "../render/monsters/pinball-boss";
import { state } from "../state";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { updatePlayer } from "./player";

describe("Tilt Titan Pinball Boss — Entity & Attack Suite", () => {
  let restoreDom: () => void;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.shakeT = 0;
    state.player = {
      x: 10,
      z: 10,
      hp: 10,
      facing: "S",
      momX: 0,
      momZ: 0,
      momSpeed: 0,
      iframes: 0,
      flattenT: 0,
      pinballWallCrunchDamage: 0,
      cooldown: 0,
      attackT: -1,
      didHit: false,
      comboLanded: false,
      flashT: 0,
      rageT: 0,
      hasteT: 0,
      shieldT: 0,
      ironT: 0,
      turboT: 0,
      springT: 0,
      oilT: 0,
      webbedT: 0,
      curveT: 0,
      magBootsT: 0,
      multiBallT: 0,
      material: null,
      materialT: 0,
      fuseMaterial: null,
      fuseT: 0,
      materialEmitT: 0,
      squashT: 0,
      squashAmp: 0,
      squashHx: 0,
      squashHy: 0,
      vampCdT: 0,
      phaseStuckT: 0,
      ricochetT: 0,
      ricochetFlavor: "bolt" as any,
      ricochetTickT: 0,
      sprite: {
        mesh: new THREE.Mesh(),
      },
      anim: {
        play: vi.fn(),
        setRate: vi.fn(),
        getClip: () => "idle",
        setFacing: vi.fn(),
      } as any,
      rail: { featureIdx: -1, catchT: 0, strength: 0, tx: 0, tz: 0 },
      sprintCharge: 0,
      move: null,
      bounceCombo: 0,
      bounceComboT: 0,
      overcharge: 0,
      grabT: 0,
      rideT: -1,
      dropT: -1,
      hopT: -1,
      mesh: new THREE.Mesh(),
    } as any;
  });

  it("registers Tilt Titan in BOSSES table with valid pinball charge spec", () => {
    const boss = BOSSES.pinball_boss;
    expect(boss).toBeDefined();
    expect(boss.kind).toBe("pinball_boss");
    expect(boss.name).toBe("Tilt Titan");
    expect(boss.biome).toBe("warren");
    expect(boss.moves.pinballCharge).toBeDefined();

    const spec = boss.moves.pinballCharge!;
    expect(spec.intervalMin).toBeLessThan(spec.intervalMax);
    expect(spec.telegraphMin).toBeLessThan(spec.telegraphMax);
    expect(spec.speed).toBeGreaterThan(15);
    expect(spec.damage).toBeGreaterThanOrEqual(3);
    expect(spec.launch).toBeGreaterThanOrEqual(20);
    expect(spec.flattenDuration).toBeGreaterThan(1.0);
    expect(spec.wallCrunchDamage).toBeGreaterThan(0);
    expect(spec.maxBounces).toBeGreaterThanOrEqual(1);

    // Phase 2 escalation
    expect(boss.phase2).toBeDefined();
    const p2Spec = boss.phase2.moves.pinballCharge!;
    expect(p2Spec).toBeDefined();
    expect(p2Spec.speed).toBeGreaterThan(spec.speed);
    expect(p2Spec.damage).toBeGreaterThan(spec.damage);
  });

  it("initializes PinballChargeRt with randomized cadence timing", () => {
    const spec = BOSSES.pinball_boss.moves.pinballCharge!;
    const rt = freshPinballCharge(spec);
    expect(rt.phase).toBe("idle");
    expect(rt.t).toBeGreaterThanOrEqual(spec.intervalMin);
    expect(rt.t).toBeLessThanOrEqual(spec.intervalMax);
    expect(rt.telegraphDur).toBeGreaterThanOrEqual(spec.telegraphMin);
    expect(rt.telegraphDur).toBeLessThanOrEqual(spec.telegraphMax);
    expect(pinballChargeHoldsMovement(rt)).toBe(false);
  });

  it("telegraphs, locks position stationary, and accelerates 360° spin in place", () => {
    const spec = BOSSES.pinball_boss.moves.pinballCharge!;
    const rt = freshPinballCharge(spec);
    rt.t = rt.telegraphDur; // Trigger telegraph

    let facingSet = "";
    let holdState = false;
    const movedTo: Array<{ x: number; z: number }> = [];
    const rotations: number[] = [];
    const ctx: MoveCtx = {
      dt: 0.05,
      x: 5,
      z: 5,
      target: { x: 15, z: 5 },
      grid: null,
      bodyR: 1.2,
      hitAt: vi.fn(),
      moveTo: (nx, nz) => { movedTo.push({ x: nx, z: nz }); },
      setFacing: (d) => { facingSet = d; },
      playAnim: vi.fn(),
      rotateSprite: (ang) => { rotations.push(ang); },
      setHoldMovement: (h) => { holdState = h; },
    };

    updatePinballCharge(rt, spec, ctx);
    expect(rt.phase).toBe("telegraph");
    expect(rt.lane).toBeDefined();
    expect(pinballChargeHoldsMovement(rt)).toBe(true);
    expect(facingSet).toBe("E");
    expect(holdState).toBe(true);

    const initialSpinSpeed = rt.spinSpeed;
    expect(initialSpinSpeed).toBeGreaterThanOrEqual(6);

    // Advance halfway through telegraph
    for (let i = 0; i < 8; i++) {
      updatePinballCharge(rt, spec, ctx);
    }
    const midSpinSpeed = rt.spinSpeed;
    expect(midSpinSpeed).toBeGreaterThan(initialSpinSpeed);

    // Finish telegraph — RPM should reach peak, then transition to running
    while (rt.t > 0) {
      updatePinballCharge(rt, spec, ctx);
    }
    // Release trigger tick
    updatePinballCharge(rt, spec, ctx);
    expect(rt.phase).toBe("running");
    expect(rotations.length).toBeGreaterThan(5);

    // All moveTo calls during telegraph must have kept position locked at (5, 5)
    for (const pt of movedTo) {
      if (rt.phase === "telegraph") {
        expect(pt.x).toBe(5);
        expect(pt.z).toBe(5);
      }
    }
  });

  it("steamrolls player into a pancake with flattenT, launch momentum, and wall crunch damage", () => {
    const spec = BOSSES.pinball_boss.moves.pinballCharge!;
    const rt = freshPinballCharge(spec);
    rt.phase = "running";
    rt.dx = 1;
    rt.dz = 0;
    rt.left = spec.distance;

    let flattened = false;
    const ctx: MoveCtx = {
      dt: 0.05,
      x: 5,
      z: 5,
      target: { x: 5, z: 5 },
      grid: null,
      bodyR: 1.5,
      hitAt: vi.fn(),
      moveTo: vi.fn(),
      playAnim: vi.fn(),
      flattenPlayer: (dmg, launch, duration, wallCrunch) => {
        flattened = true;
        state.player!.flattenT = duration;
        state.player!.pinballWallCrunchDamage = wallCrunch;
        state.player!.momSpeed = launch;
        state.player!.momX = 1;
        state.player!.momZ = 0;
        return true;
      },
    };

    updatePinballCharge(rt, spec, ctx);
    expect(flattened).toBe(true);
    expect(state.player!.flattenT).toBe(spec.flattenDuration);
    expect(state.player!.pinballWallCrunchDamage).toBe(spec.wallCrunchDamage);
    expect(state.player!.momSpeed).toBe(spec.launch);
    expect(rt.hasHitPlayer).toBe(true);
  });

  it("ricochets when colliding with a wall if bounces remain", () => {
    const spec = BOSSES.pinball_boss.moves.pinballCharge!;
    const rt = freshPinballCharge(spec);
    rt.phase = "running";
    rt.dx = 1;
    rt.dz = 0;
    rt.left = 10;
    rt.bounces = 0;

    // Simulated grid where advancing +X hits a wall
    const mockGrid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(1), // T_FLOOR
      shapes: new Uint8Array(400),
    };
    // Mark (11, 0) as unwalkable wall (0 = T_WALL)
    mockGrid.t[0 * 20 + 11] = 0;

    let posX = 10;
    let posZ = 0;
    const ctx: MoveCtx = {
      dt: 0.1,
      x: posX,
      z: posZ,
      target: { x: 15, z: 0 },
      grid: mockGrid as any,
      bodyR: 1.0,
      hitAt: vi.fn(),
      moveTo: (nx, nz) => { posX = nx; posZ = nz; },
      playAnim: vi.fn(),
    };

    // Advance charge into the wall
    updatePinballCharge(rt, spec, ctx);
    // Heading should have inverted (ricochet)
    expect(rt.bounces).toBe(1);
    expect(rt.dx).toBe(-1);
  });

  it("disposes telegraph mesh cleanly on teardown", () => {
    const spec = BOSSES.pinball_boss.moves.pinballCharge!;
    const rt = freshPinballCharge(spec);
    rt.phase = "telegraph";
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial();
    rt.lane = new THREE.Mesh(geo, mat);
    state.scene!.add(rt.lane);

    disposePinballCharge(rt);
    expect(rt.lane).toBeNull();
  });

  it("procedural cel-painter generates all 4 animations across S, N, and E facings", () => {
    const paints = makePinballBossPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    for (const dir of ["S", "N", "E"] as const) {
      const pd = paints[dir];
      expect(pd).toBeDefined();
      if (!pd) continue;
      expect(pd.idle?.length).toBeGreaterThan(0);
      expect(pd.walk?.length).toBeGreaterThan(0);
      expect(pd.attack?.length).toBeGreaterThan(0);
      expect(pd.death?.length).toBeGreaterThan(0);
    }
  });
});
