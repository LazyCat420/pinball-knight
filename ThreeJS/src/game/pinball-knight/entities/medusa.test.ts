import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  MEDUSA_HP,
  MEDUSA_R,
  MEDUSA_SPEED_FACTOR,
  MEDUSA_GAZE_WIDTH,
  MEDUSA_GAZE_LENGTH,
  MEDUSA_GAZE_DURATION,
  MEDUSA_WINDUP,
  MEDUSA_ACTIVE_GAZE,
  MEDUSA_COOLDOWN,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { HP_BY_KIND } from "../spawn/factory";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeMedusaPaints } from "../render/monsters/medusa";
import { isPointInScanBox, isPlayerLookingAtMedusa, updateMedusaGaze } from "./medusa";
import { updatePlayer } from "./player";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { worldDirToScreen } from "../engine/camera";
import { facingFromVelocity } from "../engine/render/animator";
import type { InputHandle } from "../engine/input";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  const g: Grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
  g.t.fill(1); // walkable
  return g;
}

describe("Gorgon Medusa ('The Petrifier') Monster Mechanics & Petrifying Gaze", () => {
  let restoreDom: () => void;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    resetState();
    state.grid = makeGrid();
    state.scene = {
      add: () => {},
      remove: () => {},
    } as unknown as typeof state.scene;
    state.projectiles = [];
    state.zombies = [];
    state.vfx = {
      burst: () => {},
      smoke: () => {},
      sparks: () => {},
      blood: () => {},
      damage: () => {},
      dust: () => {},
    } as unknown as typeof state.vfx;

    state.player = {
      x: 10,
      z: 10,
      hp: 10,
      maxHp: 10,
      facing: "S",
      momSpeed: 0,
      flattenT: 0,
      petrifiedT: 0,
      cooldown: 0,
      iframes: 0,
      oilT: 0,
      webbedT: 0,
      squashT: 0,
      bounceCombo: 0,
      bounceComboT: 0,
      attackT: -1,
      didHit: false,
      rideT: -1,
      chomperGrabT: 0,
      handGrabT: 0,
      cerberusGrabT: 0,
      anim: {
        play: () => {},
        setFacing: () => {},
      },
      sprite: {
        setTint: () => {},
        mesh: {
          scale: {
            x: 1,
            y: 1,
            z: 1,
            set: () => {},
          },
          position: { set: () => {} },
        },
      },
    } as unknown as Player;
  });

  it("registers Medusa across all roster tables with correct stats and values", () => {
    expect(MEDUSA_HP).toBe(14);
    expect(MEDUSA_R).toBe(0.45);
    expect(MEDUSA_SPEED_FACTOR).toBe(0.85);
    expect(MEDUSA_GAZE_DURATION).toBe(5.0);

    expect(STATS.medusa.bodyR).toBe(MEDUSA_R);
    expect(STATS.medusa.windup).toBe(MEDUSA_WINDUP);
    expect(STATS.medusa.cooldown).toBe(MEDUSA_COOLDOWN);
    expect(STATS.medusa.ranged).toBe(true);

    expect(HP_BY_KIND.medusa).toBe(MEDUSA_HP);
    expect(MOVEMENT_BY_KIND.medusa).toBe("kite");
    expect(PAIN_BY_KIND.medusa).toBe(0.35);

    expect(KIND_INFO.medusa.label).toBe("Gorgon Medusa");
    expect(KIND_INFO.medusa.icon).toBe("🐍");

    expect(ENEMY_DROPS.medusa).toBeDefined();
    expect(ENEMY_DROPS.medusa.some((d) => d.id === "venomsac")).toBe(true);

    expect(KIND_SKIN.medusa?.scale).toBe(1.15);
    expect(IMPORTED_FACINGS.medusa).toEqual(["S"]);
    expect(SHEET_PAINTERS.medusa).toBe(makeMedusaPaints);
    expect(KIND_PAINTS.medusa).toBe(makeMedusaPaints);
  });

  it("correctly identifies whether a point is inside the forward scan box", () => {
    const mx = 10;
    const mz = 10;
    const dirX = 0;
    const dirZ = 1; // Facing South (+Z)

    // Directly in front at 3 tiles distance (inside)
    expect(isPointInScanBox(10, 13, mx, mz, dirX, dirZ, 3.6, 6.5)).toBe(true);

    // Behind Medusa (z = 8, negative forward) -> false
    expect(isPointInScanBox(10, 8, mx, mz, dirX, dirZ, 3.6, 6.5)).toBe(false);

    // Beyond max forward reach (> 6.5 tiles, z = 18) -> false
    expect(isPointInScanBox(10, 18, mx, mz, dirX, dirZ, 3.6, 6.5)).toBe(false);

    // Laterally outside the 3.6 width (> 1.8 from center line, x = 12.5) -> false
    expect(isPointInScanBox(12.5, 13, mx, mz, dirX, dirZ, 3.6, 6.5)).toBe(false);

    // Laterally inside (x = 11.2, offset 1.2 <= 1.8) -> true
    expect(isPointInScanBox(11.2, 13, mx, mz, dirX, dirZ, 3.6, 6.5)).toBe(true);
  });

  it("correctly checks if player is looking towards Medusa (Perseus angle check)", () => {
    const p = state.player!;
    p.x = 10;
    p.z = 14;

    const mx = 10;
    const mz = 10; // Medusa is at (10, 10)

    const sDir = worldDirToScreen(mx - p.x, mz - p.z);

    // Player facing toward Medusa in screen space -> true
    p.facing = facingFromVelocity(sDir.x, sDir.z, "S");
    expect(isPlayerLookingAtMedusa(p, mx, mz)).toBe(true);

    // Player facing directly away from Medusa in screen space -> false
    p.facing = facingFromVelocity(-sDir.x, -sDir.z, "S");
    expect(isPlayerLookingAtMedusa(p, mx, mz)).toBe(false);
  });

  it("petrifies player for 5.0 seconds when caught in active gaze while looking", () => {
    const p = state.player!;
    p.x = 10;
    p.z = 13;
    const sDir = worldDirToScreen(10 - p.x, 10 - p.z);
    p.facing = facingFromVelocity(sDir.x, sDir.z, "S"); // Looking at Medusa

    const medusa = {
      x: 10,
      z: 10,
      hp: 14,
      mode: "chase",
      kind: "medusa",
      medusaGazeT: 0.05,
      medusaGazeActive: false,
      anim: { play: () => {} },
      sprite: { setTint: () => {} },
    } as unknown as Zombie;

    // Tick into active gaze
    updateMedusaGaze(medusa, p, 0.1);
    expect(medusa.medusaGazeActive).toBe(true);

    // Tick active gaze: player is inside box and looking -> petrified!
    updateMedusaGaze(medusa, p, 0.1);
    expect(p.petrifiedT).toBe(MEDUSA_GAZE_DURATION);
  });

  it("does NOT petrify player when player turns back to Medusa in the scan box", () => {
    const p = state.player!;
    p.x = 10;
    p.z = 13;
    const sDir = worldDirToScreen(10 - p.x, 10 - p.z);
    p.facing = facingFromVelocity(-sDir.x, -sDir.z, "S"); // Back turned away from Medusa

    const medusa = {
      x: 10,
      z: 10,
      hp: 14,
      mode: "chase",
      kind: "medusa",
      medusaGazeT: 0.1,
      medusaGazeActive: true,
      anim: { play: () => {} },
      sprite: { setTint: () => {} },
    } as unknown as Zombie;

    updateMedusaGaze(medusa, p, 0.05);
    expect(p.petrifiedT).toBe(0); // Immune because back is turned!
  });

  function makeMockInput(opts: { attack?: boolean; dodge?: boolean; ax?: number; az?: number } = {}): InputHandle {
    let attackConsumed = false;
    let dodgeConsumed = false;
    return {
      axis: () => ({ x: opts.ax ?? 0, z: opts.az ?? 0 }),
      consumeAttack: () => {
        if (opts.attack && !attackConsumed) {
          attackConsumed = true;
          return true;
        }
        return false;
      },
      attackHeldNow: () => false,
      consumeAttackTap: () => false,
      sprintHeld: () => false,
      consumeDodge: () => {
        if (opts.dodge && !dodgeConsumed) {
          dodgeConsumed = true;
          return true;
        }
        return false;
      },
      dodgeHeld: () => false,
      consumeFlip: () => false,
      flipHeld: () => false,
      turnAxis: () => 0,
      consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
      aimScreen: () => null,
      aimStick: () => null,
      poll: () => {},
      padConnected: () => false,
    } as unknown as InputHandle;
  }

  it("handles input mashing to break out of stone early in updatePlayer", () => {
    const p = state.player!;
    p.petrifiedT = 5.0;

    const mockInputNoSpam = makeMockInput();

    // Ordinary time step (dt = 0.1) reduces by 0.1
    updatePlayer(0.1, mockInputNoSpam);
    expect(p.petrifiedT).toBeCloseTo(4.9, 2);

    const mockInputSpam = makeMockInput({ ax: 1, attack: true });

    // Mashing attack and movement keys accelerates breakout (dt + 1.5*dt)
    updatePlayer(0.1, mockInputSpam);
    expect(p.petrifiedT).toBeLessThan(4.7);
  });

  it("verifies procedural cel-painter returns complete 3-facing animation clips", () => {
    const paints = makeMedusaPaints();
    for (const dir of ["S", "N", "E"] as const) {
      const clips = paints[dir];
      expect(clips).toBeDefined();
      expect(clips?.idle?.length).toBe(4);
      expect(clips?.walk?.length).toBe(4);
      expect(clips?.attack?.length).toBe(4);
      expect(clips?.death?.length).toBe(4);
    }
  });
});
