import * as THREE from "three";
import { describe, expect, it, beforeEach, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { createVfx } from "./system";
import { state } from "../state";
import { applyPotion } from "../economy/shop";
import { killZombie, setSporelingBurstHandler } from "../entities/combat";
import type { Zombie } from "../state";

describe("VFX Enhancements", () => {
  let scene: THREE.Scene;
  const realDoc = (globalThis as { document?: unknown }).document;

  beforeAll(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: (t: string) => (t === "canvas" ? createCanvas(128, 128) : {}),
      head: { appendChild: () => {} },
    };
  });

  afterAll(() => {
    (globalThis as { document?: unknown }).document = realDoc;
  });

  beforeEach(() => {
    scene = new THREE.Scene();
    state.scene = scene;
    state.vfx = createVfx(scene);
    state.player = {
      x: 5,
      y: 0,
      z: 5,
      hp: 3,
      facing: "S",
      rageT: 0,
      hasteT: 0,
      shieldT: 0,
      ironT: 0,
      turboT: 0,
      springT: 0,
      freezeT: 0,
      multiBallT: 0,
      curveT: 0,
      magBootsT: 0,
      regenT: 0,
      regenTickT: 0,
      venomCoatT: 0,
      stoneT: 0,
      staticT: 0,
      greedT: 0,
      sprite: {
        mesh: new THREE.Mesh(),
        setTint: () => {},
      } as any,
    } as any;
  });

  it("provides vfx.heal() with rising motes and expanding ring", () => {
    expect(() => {
      state.vfx?.heal(5, 0.6, 5);
      state.vfx?.heal(5, 0.6, 5, 0x8fd46b, 16);
    }).not.toThrow();
  });

  it("provides vfx.sporeCloud() with toxic puffs and rings", () => {
    expect(() => {
      state.vfx?.sporeCloud(5, 0.4, 5, 1.8);
    }).not.toThrow();
  });

  it("provides vfx.slashCircle() for 360 crowd weapons", () => {
    expect(() => {
      state.vfx?.slashCircle(5, 0.6, 5, 0xffffff, 1.5);
    }).not.toThrow();
  });

  it("provides vfx.mote() with optional color tint for gold shimmer", () => {
    expect(() => {
      state.vfx?.mote(5, 0.5, 5, 0xffd98a);
    }).not.toThrow();
  });

  it("applyPotion('health') calls vfx.heal and does not call vfx.blood", () => {
    let healCalled = false;
    let bloodCalled = false;
    if (state.vfx) {
      state.vfx.heal = () => { healCalled = true; };
      state.vfx.blood = () => { bloodCalled = true; };
    }
    applyPotion("health");
    expect(healCalled, "Health potion must trigger vfx.heal").toBe(true);
    expect(bloodCalled, "Health potion must NOT trigger vfx.blood").toBe(false);
  });

  it("applyPotion('rage' / 'haste' / 'shield' / 'elixir') triggers visual bursts and auras", () => {
    let burstCount = 0;
    let healCount = 0;
    if (state.vfx) {
      state.vfx.burst = () => { burstCount++; };
      state.vfx.heal = () => { healCount++; };
    }
    applyPotion("rage");
    applyPotion("haste");
    applyPotion("shield");
    applyPotion("elixir");
    expect(burstCount).toBeGreaterThanOrEqual(3);
    expect(healCount).toBeGreaterThanOrEqual(1);
  });

  it("killZombie(sporeling) triggers onSporelingBurst handler", () => {
    let burstFired = false;
    setSporelingBurstHandler((x, z) => {
      burstFired = true;
      expect(x).toBe(10);
      expect(z).toBe(12);
    });

    const sporeling: Zombie = {
      kind: "sporeling",
      x: 10,
      y: 0,
      z: 12,
      hp: 0,
      mode: "chase",
      anim: {
        getFacing: () => "S",
        play: () => {},
      } as any,
      sprite: {
        setTint: () => {},
        setBlobVisible: () => {},
      } as any,
    } as any;

    killZombie(sporeling);
    expect(burstFired, "Sporeling death must trigger registered burst handler (OPEN_WORK 2.1)").toBe(true);
  });
});
