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
import { isPanelOpen } from "./core";

const realDoc = (globalThis as { document?: unknown }).document;
const realStorage = (globalThis as { localStorage?: unknown }).localStorage;

let store: Record<string, string> = {};

function ensureDocAndStorage(): void {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
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
}

beforeAll(() => {
  ensureDocAndStorage();
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
  (globalThis as { localStorage?: unknown }).localStorage = realStorage;
});

describe("tavern character select and sprite update", () => {
  beforeEach(() => {
    store = {};
    ensureDocAndStorage();
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
});
