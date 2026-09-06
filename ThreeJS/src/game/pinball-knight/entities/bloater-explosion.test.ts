import { describe, it, expect, beforeEach } from "vitest";
import { state, type Zombie } from "../state";
import { installGameplayWiring } from "../boot/wiring";
import { damageZombie, setReagentDropHandler, setCoinDropHandler } from "./combat";
import { BLOATER_BURST_RADIUS } from "../constants";
import { IMPORTED_FACINGS, hasAuthoredFacing } from "../boot/manifest-inventory";
import { IMPORTED_ART, sheetKeyForKind } from "../boot/sheets";
import { KIND_SKIN } from "../spawn/kind-skin";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { T_FLOOR } from "../engine/grid";

describe("Bloater Garbage Monster & Molten Explosion", () => {
  beforeEach(() => {
    state.scene = { add() {}, remove() {} } as any;
    state.dbgMaterialFloorFx = true;
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(T_FLOOR),
      shapes: new Uint8Array(400),
      arcs: [],
    } as any;
    state.floorFx = [];
    state.zombies = [];
    state.player = null;
    state.vfx = {
      burst: () => {},
      smoke: () => {},
      sparks: () => {},
      blood: () => {},
      ember: () => {},
      mote: () => {},
      dust: () => {},
      heal: () => {},
      steam: () => {},
      slash: () => {},
      slashCircle: () => {},
      sporeCloud: () => {},
      bolt: () => {},
      trail: () => {},
      damage: () => {},
    } as any;
  });

  it("registers bloater as a first-class native sprite sheet", () => {
    expect(hasAuthoredFacing("bloater", "S")).toBe(true);
    expect(IMPORTED_FACINGS.bloater).toEqual(["S"]);
    expect(IMPORTED_ART.bloater).toBe("bloater");
    expect(sheetKeyForKind("bloater")).toBe("bloater");

    // Must NOT borrow slime anymore
    expect((KIND_SKIN.bloater as any)?.sheetKey).toBeUndefined();
    expect(KIND_SKIN.bloater?.scale).toBe(1.1);

    // Has procedural fallback and portrait paints
    expect(SHEET_PAINTERS.bloater).toBeDefined();
    expect(KIND_PAINTS.bloater).toBeDefined();
  });

  it("spawns dual-layer molten magma and fire on burst, blasting surroundings", () => {
    installGameplayWiring({
      spawnReaper: () => {},
      dropBossReward: () => {},
      startLevel: () => {},
      descend: () => {},
      onPlayerDeath: () => {},
      exitDungeonGame: () => {},
    });
    setReagentDropHandler(() => {});
    setCoinDropHandler(() => {});

    const mockSprite = () => ({
      setBlobVisible: () => {},
      setTint: () => {},
      setSheet: () => {},
      mesh: { position: { set: () => {} } },
    });

    const mockAnim = () => ({
      play: () => {},
      getFacing: () => "S",
    });

    // Spawn 2 enemies: 1 close, 1 far
    const nearEnemy: Zombie = {
      x: 1.0,
      z: 0,
      hp: 10,
      bodyR: 0.4,
      burnT: 0,
      mode: "chase",
      kind: "goblin",
      sprite: mockSprite(),
      anim: mockAnim(),
    } as any;

    const farEnemy: Zombie = {
      x: 10.0,
      z: 10.0,
      hp: 10,
      bodyR: 0.4,
      burnT: 0,
      mode: "chase",
      kind: "goblin",
      sprite: mockSprite(),
      anim: mockAnim(),
    } as any;

    // Spawn a living bloater at origin (0, 0)
    const livingBloater: Zombie = {
      x: 0,
      z: 0,
      hp: 5,
      kind: "bloater",
      bodyR: 0.4,
      mode: "chase",
      sprite: mockSprite(),
      anim: mockAnim(),
    } as any;

    state.zombies = [livingBloater, nearEnemy, farEnemy];

    // Spawn player nearby
    state.player = {
      x: 0.5,
      z: 0.5,
      hp: 10,
      iframes: 0,
      shieldT: 0,
      sprite: mockSprite(),
    } as any;

    // Kill the bloater
    damageZombie(livingBloater, 10, 0, 0, 0);

    // 1. Dual-layer floor decals
    const molten = state.floorFx.find((f) => f.kind === "molten");
    const fire = state.floorFx.find((f) => f.kind === "fire");

    expect(molten, "molten magma decal must spawn").toBeDefined();
    expect(fire, "fire puddle decal must spawn").toBeDefined();
    expect(molten!.x).toBe(0);
    expect(molten!.z).toBe(0);
    expect(molten!.radius).toBeGreaterThanOrEqual(BLOATER_BURST_RADIUS);
    expect(molten!.hostile).toBe(true);

    // 2. Near enemy must take blast damage and be ignited
    expect(nearEnemy.hp).toBeLessThan(10);
    expect(nearEnemy.burnT).toBeGreaterThan(0);

    // 3. Far enemy outside blast radius must be completely unharmed
    expect(farEnemy.hp).toBe(10);
    expect(farEnemy.burnT).toBe(0);

    // 4. Player within burst radius must take chip damage
    expect(state.player).toBeDefined();
    expect(state.player!.hp).toBeLessThan(10);
  });
});
