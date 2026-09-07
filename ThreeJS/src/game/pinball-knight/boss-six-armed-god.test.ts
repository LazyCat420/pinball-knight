import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { BOSSES } from "./boss-kinds";
import {
  freshDaggerVolley,
  updateDaggerVolley,
  disposeDaggerVolley,
  freshMouthFire,
  updateMouthFire,
  disposeMouthFire,
  type DaggerVolleyRt,
  type MouthFireRt,
  type MoveCtx,
  type BossShot,
} from "./boss-moves";
import { state } from "./state";

describe("The Six-Armed Indian God Boss (Mahadeva Asura) Suite", () => {
  let daggerRt: DaggerVolleyRt;
  let mouthRt: MouthFireRt;
  const spec = BOSSES.six_armed_god.moves;
  const daggerSpec = spec.daggerVolley!;
  const mouthSpec = spec.mouthFire!;
  const p2Spec = BOSSES.six_armed_god.phase2.moves;

  let hits: Array<{ x: number; z: number; damage: number; launch: number }>;
  let bossPos: { x: number; z: number };
  let targetPos: { x: number; z: number };
  let shots: BossShot[];

  beforeEach(() => {
    state.scene = new THREE.Scene();
    hits = [];
    shots = [];
    bossPos = { x: 10, z: 10 };
    targetPos = { x: 16, z: 10 }; // Target is 6 units East (+X)

    daggerRt = freshDaggerVolley(daggerSpec);
    mouthRt = freshMouthFire(mouthSpec);
  });

  function makeCtx(dt: number): MoveCtx {
    return {
      dt,
      x: bossPos.x,
      z: bossPos.z,
      target: targetPos,
      grid: null,
      bodyR: 0.9,
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
    };
  }

  describe("Six-Armed Dagger Volley", () => {
    it("initializes in idle phase with full interval", () => {
      expect(daggerRt.phase).toBe("idle");
      expect(daggerRt.t).toBe(daggerSpec.interval);
      expect(daggerRt.daggers.length).toBe(0);
      expect(daggerRt.tell).toBeNull();
    });

    it("enters windup and displays sacred mandala tell at telegraph threshold", () => {
      const dt = daggerSpec.interval - daggerSpec.telegraph;
      updateDaggerVolley(daggerRt, daggerSpec, makeCtx(dt));

      expect(daggerRt.phase).toBe("windup");
      expect(daggerRt.tell).not.toBeNull();
      expect(daggerRt.aimX).toBe(targetPos.x);
      expect(daggerRt.aimZ).toBe(targetPos.z);
    });

    it("launches 6 daggers in calibrated spread fan on windup expiration", () => {
      // Advance to windup
      updateDaggerVolley(daggerRt, daggerSpec, makeCtx(daggerSpec.interval - daggerSpec.telegraph));
      expect(daggerRt.phase).toBe("windup");

      // Advance past windup
      updateDaggerVolley(daggerRt, daggerSpec, makeCtx(daggerSpec.telegraph + 0.01));
      expect(daggerRt.phase).toBe("active");
      expect(daggerRt.tell).toBeNull();
      expect(daggerRt.daggers.length).toBe(6);

      // Verify each dagger's attributes
      for (const d of daggerRt.daggers) {
        expect(d.damage).toBe(daggerSpec.damage);
        expect(d.launch).toBe(daggerSpec.launch);
        expect(Math.hypot(d.vx, d.vz)).toBeCloseTo(daggerSpec.speed, 1);
      }
    });

    it("travels outward and damages player upon contact with knockback", () => {
      // Advance to active
      updateDaggerVolley(daggerRt, daggerSpec, makeCtx(daggerSpec.interval - daggerSpec.telegraph));
      updateDaggerVolley(daggerRt, daggerSpec, makeCtx(daggerSpec.telegraph + 0.01));

      // Tick flight outward toward target (target is 6 units away, speed is 15)
      for (let i = 0; i < 10; i++) {
        updateDaggerVolley(daggerRt, daggerSpec, makeCtx(0.05));
        if (hits.length > 0) break;
      }

      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].damage).toBe(daggerSpec.damage);
      expect(hits[0].launch).toBe(daggerSpec.launch);
    });

    it("fires a double wave (12 daggers total) in Phase 2", () => {
      const p2DaggerSpec = p2Spec.daggerVolley!;
      const p2Rt = freshDaggerVolley(p2DaggerSpec);

      targetPos = { x: 50, z: 10 }; // Far away so daggers remain in flight
      // Advance to windup and fire wave 1
      updateDaggerVolley(p2Rt, p2DaggerSpec, makeCtx(p2DaggerSpec.interval - p2DaggerSpec.telegraph));
      updateDaggerVolley(p2Rt, p2DaggerSpec, makeCtx(p2DaggerSpec.telegraph + 0.01));

      expect(p2Rt.daggers.length).toBe(6);
      expect(p2Rt.secondWavePending).toBe(true);

      // Tick until second wave fires (stagger 0.28s)
      updateDaggerVolley(p2Rt, p2DaggerSpec, makeCtx(0.35));
      expect(p2Rt.secondWavePending).toBe(false);
      // Total daggers in flight is 12 (6 from wave 1 + 6 from wave 2)
      expect(p2Rt.daggers.length).toBe(12);

      disposeDaggerVolley(p2Rt);
    });

    it("disposes tell and dagger meshes cleanly", () => {
      updateDaggerVolley(daggerRt, daggerSpec, makeCtx(daggerSpec.interval - daggerSpec.telegraph));
      expect(daggerRt.tell).not.toBeNull();

      disposeDaggerVolley(daggerRt);
      expect(daggerRt.tell).toBeNull();
      expect(daggerRt.daggers.length).toBe(0);
    });
  });

  describe("Mouth Fire Breath", () => {
    it("initializes in idle phase with mouth fire spec interval", () => {
      expect(mouthRt.phase).toBe("idle");
      expect(mouthRt.t).toBe(mouthSpec.interval);
      expect(mouthRt.tell).toBeNull();
    });

    it("enters telegraph phase with ground tell ring", () => {
      const dt = mouthSpec.interval - mouthSpec.telegraph;
      updateMouthFire(mouthRt, mouthSpec, makeCtx(dt), shots);

      expect(mouthRt.phase).toBe("telegraph");
      expect(mouthRt.tell).not.toBeNull();
    });

    it("unleashes fire breath projectile stream on telegraph completion", () => {
      // Windup
      updateMouthFire(mouthRt, mouthSpec, makeCtx(mouthSpec.interval - mouthSpec.telegraph), shots);
      // Trigger spray
      updateMouthFire(mouthRt, mouthSpec, makeCtx(mouthSpec.telegraph + 0.01), shots);

      expect(mouthRt.phase).toBe("spray");
      expect(mouthRt.tell).toBeNull();

      // Tick through fire duration to emit shots
      const step = mouthSpec.fireDuration / mouthSpec.shotCount;
      for (let i = 0; i < mouthSpec.shotCount; i++) {
        updateMouthFire(mouthRt, mouthSpec, makeCtx(step), shots);
      }

      expect(shots.length).toBeGreaterThanOrEqual(mouthSpec.shotCount);
      expect(shots[0].damage).toBe(mouthSpec.damage);
    });

    it("disposes mouth fire tell cleanly", () => {
      updateMouthFire(mouthRt, mouthSpec, makeCtx(mouthSpec.interval - mouthSpec.telegraph), shots);
      expect(mouthRt.tell).not.toBeNull();

      disposeMouthFire(mouthRt);
      expect(mouthRt.tell).toBeNull();
    });
  });
});
