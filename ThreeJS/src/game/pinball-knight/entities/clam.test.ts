import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  CLAM_HP,
  CLAM_R,
  CLAM_SPEED_FACTOR,
  CLAM_FIRE_RANGE,
  CLAM_WINDUP,
  CLAM_COOLDOWN,
  CLAM_PEARL_DAMAGE,
  CLAM_PEARL_SPEED,
  CLAM_PEARL_BOUNCE_SPEED,
  CLAM_PEARL_BOUNCES,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import { spitPearl, pearlAssets, updateProjectiles } from "./projectiles";
import { MOVEMENT_BY_KIND, MOMENTUM_GATES } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { HP_BY_KIND } from "../spawn/factory";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeClamPaints } from "../render/monsters/clam";
import { damageZombie } from "./combat";
import { installSpriteTestDom } from "../testkit/atlas-census";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  const g: Grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
  g.t.fill(1); // walkable
  return g;
}

describe("Old Clam (Mustache & Sunglasses) Monster Mechanics, Pearl Spitting & Trajectory Deflection", () => {
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
    } as any;
  });

  it("publishes valid clam-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/clam-S.json");
    expect(existsSync(jsonPath), "public/sprites/clam-S.json must exist").toBe(true);

    const raw = readFileSync(jsonPath, "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("clam");
    expect(manifest.dir).toBe("S");

    const clips = manifest.rows.map((r: any) => r.clip);
    expect(clips).toContain("idle");
    expect(clips).toContain("walk");
    expect(clips).toContain("attack");
    expect(clips).toContain("death");

    for (const row of manifest.rows) {
      expect(row.cells.length).toBe(4);
    }
  });

  it("registers clam across all 9 compile-enforced core tables", () => {
    // 1. STATS
    expect(STATS.clam).toBeDefined();
    expect(STATS.clam.ranged).toBe(true);
    expect(STATS.clam.bodyR).toBe(CLAM_R);
    expect(STATS.clam.contactRange).toBe(CLAM_FIRE_RANGE);
    expect(STATS.clam.windup).toBe(CLAM_WINDUP);
    expect(STATS.clam.cooldown).toBe(CLAM_COOLDOWN);

    // 2. MOVEMENT_BY_KIND
    expect(MOVEMENT_BY_KIND.clam).toBe("kite");

    // 3. PAIN_BY_KIND
    expect(PAIN_BY_KIND.clam).toBe(0.35);

    // 4. HP_BY_KIND
    expect(HP_BY_KIND.clam).toBe(CLAM_HP);

    // 5. KIND_INFO (bestiary)
    expect(KIND_INFO.clam).toBeDefined();
    expect(KIND_INFO.clam.label).toBe("Old Clam");
    expect(KIND_INFO.clam.icon).toBe("🦪");

    // 6. ENEMY_DROPS (reagents)
    expect(ENEMY_DROPS.clam).toBeDefined();
    expect(ENEMY_DROPS.clam.length).toBeGreaterThan(0);

    // 7. KIND_SKIN
    expect(KIND_SKIN.clam).toBeDefined();
    expect(KIND_SKIN.clam?.scale).toBe(1.1);

    // 8. IMPORTED_FACINGS
    expect(IMPORTED_FACINGS.clam).toContain("S");

    // 9. SHEET_PAINTERS & KIND_PAINTS
    expect(SHEET_PAINTERS.clam).toBe(makeClamPaints);
    expect(KIND_PAINTS.clam).toBe(makeClamPaints);
  });

  it("spawns iridescent pearl projectile and sets initial trajectory", () => {
    spitPearl(5, 5, 1, 0); // Spitting East

    expect(state.projectiles.length).toBe(1);
    const pr = state.projectiles[0];
    expect(pr.kind).toBe("pearl");
    expect(pr.hostile).toBe(true);
    expect(pr.damage).toBe(CLAM_PEARL_DAMAGE);
    expect(pr.bounces).toBe(CLAM_PEARL_BOUNCES);
    expect(pr.vx).toBeCloseTo(CLAM_PEARL_SPEED, 2);
    expect(pr.vz).toBeCloseTo(0, 2);
  });

  it("deflects player trajectory and inflicts slight damage when pearl connects", () => {
    // Player at (6, 5) with zero initial momentum
    state.player = {
      x: 6.0,
      y: 0,
      z: 5.0,
      hp: 10,
      maxHp: 10,
      armor: 0,
      iframes: 0,
      momX: 0,
      momZ: 0,
      momSpeed: 0,
      bounceCombo: 0,
      sprite: {
        setTint: () => {},
        mesh: { position: { set: () => {} } },
      },
    } as unknown as Player;

    // Pearl spawned at (4.0, 5.0) moving East toward player at (6.0, 5.0)
    spitPearl(4.0, 5.0, 1, 0);
    expect(state.projectiles.length).toBe(1);

    // Step projectiles simulation until it connects with player (~0.2s)
    for (let s = 0; s < 15; s++) {
      if (state.projectiles.length === 0) break;
      updateProjectiles(0.016);
    }

    // Player should take slight damage
    expect(state.player.hp).toBe(10 - CLAM_PEARL_DAMAGE);

    // Trajectory must be violently deflected away from the pearl (Eastward)
    expect(state.player.momSpeed).toBeGreaterThanOrEqual(CLAM_PEARL_BOUNCE_SPEED);
    expect(state.player.momX).toBeGreaterThan(0.5); // deflected Eastward
    expect(state.player.bounceCombo).toBe(1);

    // Projectile should be despawned after connecting
    expect(state.projectiles.length).toBe(0);
  });

  it("mitigates damage through closed shell gate but takes full damage during attack windup", () => {
    const mockSprite = {
      flash: () => {},
      setTint: () => {},
      mesh: { position: { set: () => {} } },
    };

    const closedClam: Zombie = {
      kind: "clam",
      mode: "chase",
      x: 5,
      z: 5,
      hp: 10,
      maxHp: 10,
      speed: 1,
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      burnT: 0,
      aggro: true,
      sprite: mockSprite as any,
      anim: {} as any,
    } as unknown as Zombie;

    // Player strikes at standing speed (momentum 0)
    state.player = {
      x: 5,
      y: 0,
      z: 5,
      hp: 10,
      maxHp: 10,
      momSpeed: 0,
      sprite: mockSprite as any,
    } as unknown as Player;

    // Closed shell: below momentum bar, damage should be gated / chipped
    const hpBefore = closedClam.hp;
    damageZombie(closedClam, 4, 1, 0, 0.2, false, "steel");
    const dmgTakenClosed = hpBefore - closedClam.hp;
    expect(dmgTakenClosed).toBeLessThan(4); // Heavily reduced

    // Open shell: during windup, shell is wide open!
    const openClam: Zombie = {
      ...closedClam,
      hp: 10,
      mode: "windup",
    };
    damageZombie(openClam, 4, 1, 0, 0.2, false, "steel");
    expect(openClam.hp).toBe(10 - 4); // Full unmitigated 4 damage
  });
});
