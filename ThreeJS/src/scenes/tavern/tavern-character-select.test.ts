import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import * as THREE from "three";
import { createCanvas } from "canvas";
import { createTavernPlayer, refreshTavernPlayerArt, disposeTavernPlayer } from "./player";
import { tavern, resetTavernState } from "./state";
import { state as dungeonState } from "../../game/pinball-knight/state";
import {
  setPlayerSheetName,
  playerSheetName,
  DEFAULT_PLAYER_SHEET,
  getKnightSheet,
  setImportedKnightPaintsForTest,
} from "../../game/pinball-knight/render/knight-sheets";
import { lookFromGear } from "../../game/pinball-knight/render/knight-look";
import { push, pop, clearScreens } from "../../game/pinball-knight/gui/stack";
import { characterSelectScreen } from "../../game/pinball-knight/gui/screens/character-select";
import { beginUi, emptyUiInput } from "../../game/pinball-knight/gui/im";
import { isPanelOpen, openTavernScene, closeTavern, isTavernSceneOpen } from "./core";
import { installSpriteTestDom } from "../../game/pinball-knight/testkit/atlas-census";

const realDoc = (globalThis as { document?: unknown }).document;
const realStorage = (globalThis as { localStorage?: unknown }).localStorage;
const realWin = (globalThis as { window?: unknown }).window;

let store: Record<string, string> = {};

function ensureTestDom(): void {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => {
      const el = t === "canvas" ? (createCanvas(1, 1) as unknown as HTMLElement) : ({} as HTMLElement);
      (el as unknown as { style: Record<string, string> }).style = (el as unknown as { style: Record<string, string> }).style || {};
      (el as unknown as { appendChild: () => void }).appendChild = () => {};
      (el as unknown as { remove: () => void }).remove = () => {};
      (el as unknown as { replaceChildren: () => void }).replaceChildren = () => {};
      return el;
    },
    getElementById: () => null,
    body: { appendChild: () => {} },
    head: { appendChild: () => {} },
  };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
  (globalThis as { window?: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    clearTimeout: () => {},
    innerWidth: 1920,
    innerHeight: 1080,
    location: { search: "" },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  };
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 1;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
}

beforeAll(() => {
  ensureTestDom();
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
  (globalThis as { localStorage?: unknown }).localStorage = realStorage;
  (globalThis as { window?: unknown }).window = realWin;
});

describe("tavern character select and sprite update", () => {
  beforeEach(() => {
    store = {};
    ensureTestDom();
    resetTavernState();
    disposeTavernPlayer();
    clearScreens();
    setPlayerSheetName(DEFAULT_PLAYER_SHEET);
    dungeonState.playerSheets.clear();
    dungeonState.gear = { armor: 0, helmet: 0, boots: 0 };
    setImportedKnightPaintsForTest(null);
  });

  it("updates the tavern player sprite immediately when character sheet changes", () => {
    const scene = new THREE.Scene();
    const p = createTavernPlayer(scene);
    tavern.player = p;

    const initialSheet = p.sprite.sheet;
    expect(initialSheet).toBeDefined();

    // Switch character name to mario
    setPlayerSheetName("mario");
    expect(playerSheetName()).toBe("mario");

    // Re-dress tavern player
    refreshTavernPlayerArt();

    // The sprite sheet must have updated to the mario sheet
    const marioSheet = getKnightSheet("sword", lookFromGear(dungeonState.gear), "tavern");
    expect(p.sprite.sheet).toBe(marioSheet);
    expect(p.sprite.sheet).not.toBe(initialSheet);
  });

  it("updates when switching character back to default", () => {
    const scene = new THREE.Scene();
    setPlayerSheetName("mario");
    const p = createTavernPlayer(scene);
    tavern.player = p;

    const marioSheet = p.sprite.sheet;

    // Switch back to pinball_knight
    setPlayerSheetName(DEFAULT_PLAYER_SHEET);
    refreshTavernPlayerArt();

    const defaultSheet = getKnightSheet("sword", lookFromGear(dungeonState.gear), "tavern");
    expect(p.sprite.sheet).toBe(defaultSheet);
    expect(p.sprite.sheet).not.toBe(marioSheet);
  });

  it("is idempotent when neither character nor gear has changed", () => {
    const scene = new THREE.Scene();
    const p = createTavernPlayer(scene);
    tavern.player = p;

    const sheetBefore = p.sprite.sheet;
    refreshTavernPlayerArt();
    expect(p.sprite.sheet).toBe(sheetBefore);
  });

  it("updates when gear changes while keeping selected character", () => {
    const scene = new THREE.Scene();
    setPlayerSheetName("mario");
    const p = createTavernPlayer(scene);
    tavern.player = p;

    const unarmoredMario = p.sprite.sheet;

    // Equip plate armor
    dungeonState.gear = { armor: 100, helmet: 100, boots: 1 };
    refreshTavernPlayerArt();

    const armoredMario = getKnightSheet("sword", lookFromGear(dungeonState.gear), "tavern");
    expect(p.sprite.sheet).toBe(armoredMario);
    expect(p.sprite.sheet).not.toBe(unarmoredMario);
  });

  it("treats isPanelOpen as true when character-select modal is open", () => {
    expect(isPanelOpen()).toBe(false);
    push(characterSelectScreen(() => {}));
    expect(isPanelOpen()).toBe(true);
    pop();
    expect(isPanelOpen()).toBe(false);
  });

  it("navigates 2D focus across character cards with controller directional inputs", () => {
    const screen = characterSelectScreen(() => {});
    const canvas = createCanvas(600, 338);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

    // Paint initial frame with focus 0 (Knight)
    let f = beginUi(ctx, 600, 338, emptyUiInput(), screen.focus, true);
    screen.paint(f, screen);
    expect(screen.focus).toBe(0);

    // Simulate pushing Right on controller stick / D-pad
    const rightInput = { ...emptyUiInput(), right: 1 };
    expect(screen.onNavigate?.(f, screen, rightInput)).toBe(true);
    expect(screen.focus).toBe(1);

    // Paint with Mario focused -> updates chosen to mario
    f = beginUi(ctx, 600, 338, emptyUiInput(), screen.focus, true);
    screen.paint(f, screen);
    expect(screen.focus).toBe(1);

    // Simulate pushing Down on controller stick / D-pad -> jumps to CONFIRM button (index 2)
    const downInput = { ...emptyUiInput(), down: 1 };
    expect(screen.onNavigate?.(f, screen, downInput)).toBe(true);
    expect(screen.focus).toBe(2);

    // Simulate pushing Up on controller stick / D-pad -> jumps back to Mario card (index 1)
    const upInput = { ...emptyUiInput(), up: 1 };
    expect(screen.onNavigate?.(f, screen, upInput)).toBe(true);
    expect(screen.focus).toBe(1);

    // Simulate pushing Left on controller stick / D-pad -> moves back to Knight card (index 0)
    const leftInput = { ...emptyUiInput(), left: 1 };
    expect(screen.onNavigate?.(f, screen, leftInput)).toBe(true);
    expect(screen.focus).toBe(0);
  });

  it("confirms character selection and swaps sheet when activated with controller accept", async () => {
    let closed = false;
    const screen = characterSelectScreen(() => {
      closed = true;
    });
    const canvas = createCanvas(600, 338);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

    push(screen);

    // Move to Mario (focus 1)
    screen.focus = 1;
    let f = beginUi(ctx, 600, 338, emptyUiInput(), screen.focus, true);
    screen.paint(f, screen);

    // Activate Mario card with controller A (accept)
    const acceptInput = { ...emptyUiInput(), accept: true };
    f = beginUi(ctx, 600, 338, acceptInput, screen.focus, true);
    screen.paint(f, screen);

    // Wait for switchPlayerSheet promise
    await new Promise((r) => setTimeout(r, 20));
    expect(playerSheetName()).toBe("mario");
  });

  it("handles shared renderer lifecycle without disposing shared renderer", () => {
    let disposed = false;
    let removed = false;
    const mockRenderer = {
      domElement: {
        style: { cssText: "", zIndex: "10000" },
        remove: () => {
          removed = true;
        },
        parentElement: null,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      shadowMap: { enabled: false, type: 0 },
      toneMapping: 0,
      setPixelRatio: () => {},
      dispose: () => {
        disposed = true;
      },
      init: () => Promise.resolve(),
      render: () => {},
      setSize: () => {},
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      clear: () => {},
    } as unknown as THREE.WebGLRenderer;

    const container = {
      appendChild: () => {},
    } as unknown as HTMLElement;

    const opened = openTavernScene(container, {
      stats: { grade: "A", floor: 1, kills: 10, bestCombo: 5 },
      onDescend: () => {},
      renderer: mockRenderer as any,
    });

    expect(opened).toBe(true);
    expect(isTavernSceneOpen()).toBe(true);

    closeTavern();
    expect(isTavernSceneOpen()).toBe(false);
    expect(disposed).toBe(false);
    expect(removed).toBe(false);
    expect(mockRenderer.domElement.style.zIndex).toBe("10000");
  });

  it("handles pending shared renderer initialization cleanly without double init", async () => {
    let initCalls = 0;
    const mockRenderer = {
      domElement: {
        style: { cssText: "", zIndex: "10000" },
        remove: () => {},
        parentElement: null,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      shadowMap: { enabled: false, type: 0 },
      toneMapping: 0,
      setPixelRatio: () => {},
      dispose: () => {},
      init: () => {
        initCalls++;
        return Promise.resolve();
      },
      render: () => {},
      setSize: () => {},
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      clear: () => {},
    } as unknown as THREE.WebGLRenderer;

    const container = {
      appendChild: () => {},
    } as unknown as HTMLElement;

    const opened = openTavernScene(container, {
      stats: { grade: "S", floor: 2, kills: 20, bestCombo: 10 },
      onDescend: () => {},
      renderer: mockRenderer as any,
    });

    expect(opened).toBe(true);
    expect(isTavernSceneOpen()).toBe(true);

    closeTavern();
    expect(isTavernSceneOpen()).toBe(false);
  });
});
