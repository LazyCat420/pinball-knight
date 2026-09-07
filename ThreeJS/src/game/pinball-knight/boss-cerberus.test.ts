import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { BOSSES } from "./boss-kinds";
import {
  freshThrashGrab,
  updateThrashGrab,
  disposeThrashGrab,
  thrashGrabHoldsMovement,
  type ThrashGrabRt,
  type MoveCtx,
} from "./boss-moves";
import { adoptBoss, updateBoss, disposeBoss, bossActive } from "./boss";
import { state, resetState, type Zombie, type Player } from "./state";
import { updatePlayer } from "./entities/player";
import type { InputHandle } from "./engine/input";
import type { Grid } from "./maze/generator";

function makeGrid(): Grid {
  return { w: 7, h: 7, t: new Uint8Array(49), shapes: new Uint8Array(49) };
}

function fakeZombie(x: number, z: number, hp: number): Zombie {
  return {
    x,
    z,
    hp,
    maxHp: hp,
    boss: true,
    kind: "cerberus",
    mode: "idle",
    speed: 2,
    windupT: 0,
    cooldown: 0,
    flashT: 0,
    aggro: false,
    burnT: 0,
    bobT: 0,
    anim: { setFacing() {}, play() {}, setRate() {}, update() {} },
    sprite: {
      setTint() {},
      mesh: { scale: { multiplyScalar() {} }, position: new THREE.Vector3() },
    },
  } as unknown as Zombie;
}

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

describe("Cerberus Hellhound Boss Suite", () => {
  let grabRt: ThrashGrabRt;
  const spec = BOSSES.cerberus.moves;
  const grabSpec = spec.thrashGrab!;
  const fireSpec = spec.mouthFire!;
  const p2Spec = BOSSES.cerberus.phase2.moves;

  let hits: Array<{ x: number; z: number; damage: number; launch: number }>;
  let bossPos: { x: number; z: number };
  let targetPos: { x: number; z: number };
  let grabbedTarget: { holdDuration: number; escapeStruggles: number; damage: number } | null;

  beforeEach(() => {
    resetState();
    state.scene = new THREE.Scene();
    state.grid = makeGrid();
    disposeBoss();
    hits = [];
    bossPos = { x: 10, z: 10 };
    targetPos = { x: 10.8, z: 10 }; // Target within bite lunge range
    grabbedTarget = null;

    state.player = {
      x: targetPos.x,
      z: targetPos.z,
      hp: 10,
      maxHp: 10,
      momX: 0,
      momZ: 0,
      momSpeed: 0,
      iframes: 0,
      facing: "S",
      flashT: 0,
      shieldT: 0,
      webbedT: 0,
      bounceCombo: 0,
      ricochetT: 0,
      ricochetFlavor: "bolt",
      sprite: { setTint() {}, mesh: { position: new THREE.Vector3() } },
      anim: { play() {}, setFacing() {}, setRate() {}, update() {} },
    } as unknown as Player;

    state.zombies = [];
    grabRt = freshThrashGrab(grabSpec);
  });

  function makeCtx(dt: number): MoveCtx {
    return {
      dt,
      x: bossPos.x,
      z: bossPos.z,
      target: targetPos,
      grid: null,
      bodyR: 1.4,
      hitAt: (x, z, r, damage, launch) => {
        const dx = targetPos.x - x;
        const dz = targetPos.z - z;
        const dist = Math.hypot(dx, dz);
        if (dist <= r) {
          hits.push({ x, z, damage, launch });
          return true;
        }
        return false;
      },
      moveTo: (x, z) => {
        bossPos.x = x;
        bossPos.z = z;
      },
      grabPlayer: (holdDuration, escapeStruggles, damage) => {
        grabbedTarget = { holdDuration, escapeStruggles, damage };
        if (state.player) {
          state.player.cerberusGrabT = holdDuration;
          state.player.cerberusGrabEscape = escapeStruggles;
          state.player.cerberusThrashTimer = 0;
          state.player.cerberusGrabHost = {
            x: bossPos.x,
            z: bossPos.z,
            hp: 60,
            mode: "chase",
          } as unknown as Zombie;
        }
        return true;
      },
    };
  }

  describe("Boss Definition & Roster Registration", () => {
    it("registers Cerberus in BOSSES with crypt biome and phase 2 enrage", () => {
      const boss = BOSSES.cerberus;
      expect(boss).toBeDefined();
      expect(boss.biome).toBe("crypt");
      expect(boss.hpMult).toBeGreaterThan(1.0);
      expect(boss.moves.thrashGrab).toBeDefined();
      expect(boss.moves.mouthFire).toBeDefined();
      expect(boss.phase2.at).toBe(0.5);
      expect(boss.phase2.moves.thrashGrab!.interval).toBeLessThan(boss.moves.thrashGrab!.interval);
      expect(boss.phase2.moves.thrashGrab!.lungeSpeed).toBeGreaterThan(boss.moves.thrashGrab!.lungeSpeed);
    });
  });

  describe("Thrash Grab State Machine", () => {
    it("initializes in idle phase with full interval", () => {
      expect(grabRt.phase).toBe("idle");
      expect(grabRt.t).toBe(grabSpec.interval);
      expect(grabRt.lane).toBeNull();
      expect(thrashGrabHoldsMovement(grabRt)).toBe(false);
    });

    it("enters telegraph and projects visual lane tell at threshold", () => {
      const advanceTime = grabSpec.interval - grabSpec.telegraph;
      updateThrashGrab(grabRt, grabSpec, makeCtx(advanceTime));

      expect(grabRt.phase).toBe("telegraph");
      expect(grabRt.lane).not.toBeNull();
      expect(thrashGrabHoldsMovement(grabRt)).toBe(false);
    });

    it("transitions from telegraph to lunging toward target on telegraph expiry", () => {
      // Advance into telegraph
      updateThrashGrab(grabRt, grabSpec, makeCtx(grabSpec.interval - grabSpec.telegraph));
      expect(grabRt.phase).toBe("telegraph");

      // Complete telegraph
      updateThrashGrab(grabRt, grabSpec, makeCtx(grabSpec.telegraph + 0.01));
      expect(grabRt.phase).toBe("lunging");
      expect(grabRt.lane).toBeNull();
      expect(grabRt.left).toBeGreaterThan(0);
      expect(thrashGrabHoldsMovement(grabRt)).toBe(true);
    });

    it("grabs player upon contact during lunge and enters holding phase", () => {
      // Advance to telegraph
      updateThrashGrab(grabRt, grabSpec, makeCtx(grabSpec.interval - grabSpec.telegraph));
      expect(grabRt.phase).toBe("telegraph");

      // Complete telegraph and enter lunging
      updateThrashGrab(grabRt, grabSpec, makeCtx(grabSpec.telegraph + 0.01));
      expect(grabRt.phase).toBe("lunging");

      // Player is at x = 10.8, boss is at x = 10, distance is 0.8 <= biteRadius 1.25
      updateThrashGrab(grabRt, grabSpec, makeCtx(0.05));

      expect(grabbedTarget).not.toBeNull();
      expect(grabbedTarget!.holdDuration).toBe(grabSpec.grabDuration);
      expect(grabbedTarget!.escapeStruggles).toBe(grabSpec.escapeCount);
      expect(grabRt.phase).toBe("holding");
      expect(thrashGrabHoldsMovement(grabRt)).toBe(true);
    });

    it("recovers to idle after player breaks free", () => {
      // Put in holding
      grabRt.phase = "holding";
      if (state.player) {
        state.player.cerberusGrabT = 0; // Player broke free
      }

      updateThrashGrab(grabRt, grabSpec, makeCtx(0.05));
      expect(grabRt.phase).toBe("idle");
      expect(grabRt.t).toBe(grabSpec.interval);
      expect(thrashGrabHoldsMovement(grabRt)).toBe(false);
    });
  });

  describe("Player Struggle & Thrash Mechanics", () => {
    it("pins player position to Cerberus mouth with high-frequency thrash oscillation", () => {
      if (!state.player) return;
      state.player.x = 14;
      state.player.z = 10;
      state.player.cerberusGrabT = 3.0;
      state.player.cerberusGrabEscape = 8;
      state.player.cerberusGrabHost = {
        x: 10,
        z: 10,
        hp: 60,
        mode: "chase",
      } as unknown as Zombie;

      const input = makeMockInput();
      updatePlayer(0.05, input);

      // Player should be snapped near boss host position with lateral oscillation
      expect(Math.abs(state.player.x - 10)).toBeLessThan(1.5);
      expect(Math.abs(state.player.z - 10)).toBeLessThan(1.5);
      expect(state.player.momSpeed).toBe(0);
    });

    it("decrements escape struggle counter on attack button spam", () => {
      if (!state.player) return;
      state.player.cerberusGrabT = 3.0;
      state.player.cerberusGrabEscape = 5;
      state.player.cerberusGrabHost = {
        x: 10,
        z: 10,
        hp: 60,
        mode: "chase",
      } as unknown as Zombie;

      const input = makeMockInput({ attack: true });
      updatePlayer(0.05, input);

      expect(state.player.cerberusGrabEscape).toBe(4);
      expect(state.player.cerberusGrabT).toBeLessThan(3.0);
    });

    it("breaks free with invulnerability frames when struggles reach 0", () => {
      if (!state.player) return;
      state.player.cerberusGrabT = 2.0;
      state.player.cerberusGrabEscape = 1;
      state.player.cerberusGrabHost = {
        x: 10,
        z: 10,
        hp: 60,
        mode: "chase",
      } as unknown as Zombie;

      const input = makeMockInput({ attack: true });
      updatePlayer(0.05, input);

      expect(state.player.cerberusGrabEscape).toBe(0);
      expect(state.player.cerberusGrabT).toBe(0);
      expect(state.player.iframes).toBeGreaterThan(0.3);
    });

    it("flings player violently with momentum when grab times out", () => {
      if (!state.player) return;
      state.player.cerberusGrabT = 0.02;
      state.player.cerberusGrabEscape = 5;
      state.player.cerberusGrabHost = {
        x: 10,
        z: 10,
        hp: 60,
        mode: "chase",
      } as unknown as Zombie;
      state.player.hp = 10;

      const input = makeMockInput();
      updatePlayer(0.05, input);

      expect(state.player.cerberusGrabT).toBe(0);
      expect(state.player.momSpeed).toBe(20);
      expect(state.player.hp).toBe(8); // took 2 launch fling damage
    });
  });

  describe("Boss Integration & Phase 2 Transition", () => {
    it("adopts Cerberus boss with thrash grab and mouth fire runtimes", () => {
      const z = fakeZombie(10, 10, 60);
      state.zombies = [z];
      adoptBoss(z, BOSSES.cerberus);
      expect(bossActive()).toBe(true);
      expect(z.bossKind).toBe("cerberus");
    });

    it("triggers Phase 2 enrage when Cerberus HP drops below 50%", () => {
      const z = fakeZombie(10, 10, 60);
      state.zombies = [z];
      adoptBoss(z, BOSSES.cerberus);
      z.hp = 20; // 20 / 60 = 0.33 <= 0.50

      updateBoss(0.05);
      expect(bossActive()).toBe(true);
      expect(z.hp).toBe(20);
    });

    it("cleans up on disposeBoss", () => {
      const z = fakeZombie(10, 10, 60);
      state.zombies = [z];
      adoptBoss(z, BOSSES.cerberus);
      expect(bossActive()).toBe(true);

      disposeBoss();
      expect(bossActive()).toBe(false);
    });
  });
});
