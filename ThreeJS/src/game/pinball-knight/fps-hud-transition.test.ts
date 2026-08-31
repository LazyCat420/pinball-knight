import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { createCanvas } from "canvas";
import * as THREE from "three";
import { state } from "./state";
import { enterRampage, exitRampage, canRampage } from "./fps";
import { createDungeonCamera, aimCamera } from "./engine/camera";
import { generateMaze } from "./maze/generator";
import { createFog } from "./fog";
import { mountHUDs } from "./hud";
import { isOpen, screens, push } from "./gui/stack";
import { drawUiFrame } from "./gui/root";
import { onPlayerDeath } from "./run/death";
import { descend } from "./run/descend";
import * as inputModule from "./gui/input";

const realDoc = (globalThis as { document?: unknown }).document;
const realStorage = (globalThis as { localStorage?: unknown }).localStorage;
const realWin = (globalThis as { window?: unknown }).window;
beforeAll(() => {
  const MockAudioContext = class {
    state = "running";
    createGain() { return { gain: { value: 1, setValueAtTime: () => {} }, connect: () => {} }; }
    createBufferSource() { return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} }; }
    createOscillator() { return { type: "sine", frequency: { setValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    createBiquadFilter() { return { type: "lowpass", frequency: { setValueAtTime: () => {} }, connect: () => {} }; }
    createBuffer() { return { getChannelData: () => new Float32Array(100) }; }
    destination = {};
    currentTime = 0;
    resume() { return Promise.resolve(); }
  };
  (globalThis as { window?: unknown }).window = {
    innerWidth: 1600,
    innerHeight: 900,
    addEventListener: () => {},
    removeEventListener: () => {},
    AudioContext: MockAudioContext,
    webkitAudioContext: MockAudioContext,
    location: { hostname: "localhost", protocol: "https:", search: "" },
  };

  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  (globalThis as { document?: unknown }).document = {
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    createElement: (t: string) => {
      if (t === "canvas") {
        const c = createCanvas(1, 1);
        (c as any).style = {};
        return c;
      }
      return { style: {}, appendChild: () => {} };
    },
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
  (globalThis as { localStorage?: unknown }).localStorage = realStorage;
  (globalThis as { window?: unknown }).window = realWin;
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
      sprite: { mesh: new THREE.Mesh(), setBlobVisible: () => {}, setTint: () => {} },
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

  it("never pops non-pausing HUD or toasts when input.cancel is triggered in drawUiFrame", () => {
    mountHUDs();
    expect(isOpen("hud")).toBe(true);
    expect(isOpen("toasts")).toBe(true);

    const mockSizing = { renderW: 600, renderH: 338, outW: 600, outH: 338, cssScale: 1, scale: 1 };
    const pass = {
      sizing: () => mockSizing,
      setUiEnabled: () => {},
    } as any;

    // Spy on takeFrame to return cancel: true
    vi.spyOn(inputModule, "takeFrame").mockReturnValue({
      ...inputModule.takeFrame(mockSizing, 600, 338, 0),
      cancel: true,
    });

    // Run drawUiFrame with cancel: true
    drawUiFrame(pass);

    // Neither toasts nor hud should have been popped
    expect(isOpen("toasts")).toBe(true);
    expect(isOpen("hud")).toBe(true);

    // But a pausing modal screen SHOULD be popped on cancel
    push({ id: "test-modal", pauses: true, focus: 0, scroll: 0, paint: () => {} });
    expect(isOpen("test-modal")).toBe(true);

    drawUiFrame(pass);
    expect(isOpen("test-modal")).toBe(false);
    expect(isOpen("toasts")).toBe(true);
    expect(isOpen("hud")).toBe(true);

    vi.spyOn(inputModule, "takeFrame").mockRestore();
  });

  it("exits rampage cleanly when player dies during rampage mode", () => {
    mountHUDs();
    enterRampage();
    expect(state.fpsActive).toBe(true);
    expect(state.hudMode).toBe("wolf");

    onPlayerDeath();

    expect(state.fpsActive).toBe(false);
    expect(state.hudMode).toBe("diablo");
    expect(isOpen("game-over")).toBe(true);
  });

  it("exits rampage cleanly when player descends stairs during rampage mode", () => {
    mountHUDs();
    enterRampage();
    expect(state.fpsActive).toBe(true);
    expect(state.hudMode).toBe("wolf");

    descend();

    expect(state.fpsActive).toBe(false);
    expect(state.hudMode).toBe("diablo");
  });

  it("safely handles invalid weapon or ability items without crashing paint", () => {
    mountHUDs();
    const screen = screens().find((s) => s.id === "hud")!;
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

    // Inject potentially invalid weapon and ability
    (state.weaponSlots as any)[state.activeSlot] = { id: "unknown_blade_xyz", durability: 10 };
    (state.abilitySlots as any)[0] = "unknown_ability_xyz";

    expect(() => screen.paint(frame as any, screen)).not.toThrow();
  });
});


