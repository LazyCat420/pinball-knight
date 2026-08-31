import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import * as THREE from "three";
import { state } from "./state";
import { enterRampage, exitRampage, canRampage } from "./fps";
import { createDungeonCamera, aimCamera } from "./engine/camera";
import { generateMaze } from "./maze/generator";
import { createFog } from "./fog";
import { mountHUDs } from "./hud";
import { isOpen, screens } from "./gui/stack";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => {
      if (t === "canvas") {
        const c = createCanvas(1, 1);
        (c as any).style = {};
        return c;
      }
      return { style: {} };
    },
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

describe("Doom / Rampage mode HUD and Camera transitions", () => {
  beforeEach(() => {
    state.active = true;
    state.gameOver = false;
    state.ultCharge = 1;
    state.fpsActive = false;
    state.hudMode = "diablo";
    state.grid = generateMaze(10, 10, () => 0.5);
    state.fog = createFog(state.grid);
    state.camera = createDungeonCamera();
    aimCamera(state.camera, 10, 0.5, 10);
    state.player = {
      x: 10,
      z: 10,
      facing: "S",
      hp: 100,
      mana: 100,
      sprite: { mesh: new THREE.Mesh(), setBlobVisible: () => {} },
      silhouette: { mesh: new THREE.Mesh() },
      anim: { play: () => {}, setRate: () => {} },
    } as any;
    state.zombies = [];
  });

  it("can enter and exit rampage mode cleanly", () => {
    expect(canRampage()).toBe(true);
    enterRampage();
    expect(state.fpsActive).toBe(true);
    expect(state.hudMode).toBe("wolf");
    expect(state.player?.sprite.mesh.visible).toBe(false);

    exitRampage();
    expect(state.fpsActive).toBe(false);
    expect(state.hudMode).toBe("diablo");
    expect(state.player?.sprite.mesh.visible).toBe(true);
  });

  it("keeps HUD mounted across rampage transitions", () => {
    mountHUDs();
    expect(isOpen("hud")).toBe(true);
    expect(isOpen("toasts")).toBe(true);

    enterRampage();
    expect(isOpen("hud")).toBe(true);
    expect(state.hudMode).toBe("wolf");

    exitRampage();
    expect(isOpen("hud")).toBe(true);
    expect(state.hudMode).toBe("diablo");
  });

  it("paints both wolf HUD and diablo HUD without errors", () => {
    const screen = (screens().find((s) => s.id === "hud") ?? (mountHUDs(), screens().find((s) => s.id === "hud")))!;
    const canvas = createCanvas(600, 338);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    const frame = {
      g: ctx,
      w: 600,
      h: 338,
      focus: 0,
      count: 0,
      fonts: false,
      scale: 1,
      input: {
        pointer: { x: 0, y: 0, inside: false, down: false, pressed: false, released: false },
        moved: false,
        left: 0,
        right: 0,
        up: 0,
        down: 0,
        accept: false,
        cancel: false,
        scroll: 0,
      },
    };

    // Test diablo HUD paint
    state.hudMode = "diablo";
    state.fpsActive = false;
    expect(() => screen.paint(frame as any, screen)).not.toThrow();

    // Test wolf HUD paint
    enterRampage();
    expect(state.hudMode).toBe("wolf");
    expect(() => screen.paint(frame as any, screen)).not.toThrow();

    // Test transition back to diablo HUD paint
    exitRampage();
    expect(state.hudMode).toBe("diablo");
    expect(() => screen.paint(frame as any, screen)).not.toThrow();
  });

  it("snaps camera position to player location on exitRampage", () => {
    enterRampage();
    // Simulate player navigating 15 units away during rampage
    state.player!.x = 25;
    state.player!.z = 25;

    exitRampage();

    // Verify camera position was snapped to new player location (approx 38.37) rather than old (23.37)
    expect(state.camera).toBeDefined();
    expect(state.camera!.position.x).toBeCloseTo(38.37, 1);
    expect(state.camera!.position.z).toBeCloseTo(38.37, 1);
  });
});
