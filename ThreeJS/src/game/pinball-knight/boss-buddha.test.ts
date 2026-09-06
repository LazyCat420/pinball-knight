import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { BOSSES } from "./boss-kinds";
import {
  freshFanBoomerang,
  updateFanBoomerang,
  disposeFanBoomerang,
  freshSlam,
  updateSlam,
  type FanBoomerangRt,
  type SlamRt,
  type MoveCtx,
} from "./boss-moves";
import { state } from "./state";

describe("The Jade Buddha Boss & Chinese Fan Boomerang Suite", () => {
  let rt: FanBoomerangRt;
  const spec = BOSSES.jade_buddha.moves.fanBoomerang!;
  const p2Spec = BOSSES.jade_buddha.phase2.moves.fanBoomerang!;

  let hits: Array<{ x: number; z: number; damage: number; launch: number }>;
  let bossPos: { x: number; z: number };
  let targetPos: { x: number; z: number };

  beforeEach(() => {
    state.scene = new THREE.Scene();
    hits = [];
    bossPos = { x: 10, z: 10 };
    targetPos = { x: 18, z: 10 }; // Target is 8 units East (+X)

    rt = freshFanBoomerang(spec);
  });

  function makeCtx(dt: number): MoveCtx {
    return {
      dt,
      x: bossPos.x,
      z: bossPos.z,
      target: targetPos,
      grid: null,
      bodyR: 0.8,
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

  it("initializes with full cooldown interval in idle phase", () => {
    expect(rt.phase).toBe("idle");
    expect(rt.t).toBe(spec.interval);
    expect(rt.fans.length).toBe(0);
    expect(rt.tell).toBeNull();
  });

  it("enters windup and displays tell mesh when interval reaches telegraph threshold", () => {
    const ctx = makeCtx(spec.interval - spec.telegraph);
    updateFanBoomerang(rt, spec, ctx);

    expect(rt.phase).toBe("windup");
    expect(rt.tell).not.toBeNull();
    expect(rt.aimX).toBe(targetPos.x);
    expect(rt.aimZ).toBe(targetPos.z);
  });

  it("launches fan on windup expiration and transitions to active flight", () => {
    // Tick to windup
    updateFanBoomerang(rt, spec, makeCtx(spec.interval - spec.telegraph));
    expect(rt.phase).toBe("windup");

    // Complete windup
    updateFanBoomerang(rt, spec, makeCtx(spec.telegraph + 0.01));
    expect(rt.phase).toBe("active");
    expect(rt.tell).toBeNull();
    expect(rt.fans.length).toBe(1);

    const fan = rt.fans[0];
    expect(fan.state).toBe("outward");
    expect(fan.startX).toBe(bossPos.x);
    expect(fan.startZ).toBe(bossPos.z);
    expect(fan.damage).toBe(spec.damage);
    expect(fan.launch).toBe(spec.launch);
  });

  it("travels along curved outward trajectory and damages player on outward contact", () => {
    // Advance to active
    updateFanBoomerang(rt, spec, makeCtx(spec.interval - spec.telegraph));
    updateFanBoomerang(rt, spec, makeCtx(spec.telegraph + 0.01));

    const fan = rt.fans[0];

    // Tick outward flight until player position is reached
    // Speed is 13 units/s, reachDist is 9.5. Up to 16 steps of 0.05s (0.8s)
    for (let step = 0; step < 16; step++) {
      updateFanBoomerang(rt, spec, makeCtx(0.05));
      if (hits.length > 0) break;
    }

    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].damage).toBe(spec.damage);
    expect(hits[0].launch).toBe(spec.launch);
    expect(fan.hasHitOutward).toBe(true);
  });

  it("reaches apex, hovers for apexPause, and dynamically returns to live boss position", () => {
    // Launch fan
    updateFanBoomerang(rt, spec, makeCtx(spec.interval - spec.telegraph));
    updateFanBoomerang(rt, spec, makeCtx(spec.telegraph + 0.01));

    const fan = rt.fans[0];

    // Fly all the way to apex
    const timeToApex = spec.reachDist / spec.speed;
    updateFanBoomerang(rt, spec, makeCtx(timeToApex + 0.05));
    expect(fan.state).toBe("apex");
    expect(fan.dist).toBeGreaterThanOrEqual(spec.reachDist);

    // Apex pause countdown
    updateFanBoomerang(rt, spec, makeCtx(spec.apexPause + 0.01));
    expect(fan.state).toBe("returning");

    // MOVE THE BOSS to test dynamic homing!
    bossPos.x = 10;
    bossPos.z = 15; // Boss shifted South (+Z)

    // Tick returning flight
    updateFanBoomerang(rt, spec, makeCtx(0.2));
    // The fan must be heading towards (10, 15), so its Z coordinate must be moving towards 15
    expect(fan.z).toBeGreaterThan(10);
  });

  it("executes double-hit damage on return flight and resets to idle upon catch", () => {
    // Launch fan
    updateFanBoomerang(rt, spec, makeCtx(spec.interval - spec.telegraph));
    updateFanBoomerang(rt, spec, makeCtx(spec.telegraph + 0.01));

    const fan = rt.fans[0];
    // Fast forward to returning state
    fan.state = "returning";
    fan.x = targetPos.x + 0.2;
    fan.z = targetPos.z;
    fan.hasHitOutward = true; // Outward hit already consumed

    // Return tick near player
    updateFanBoomerang(rt, spec, makeCtx(0.05));
    expect(hits.length).toBe(1);
    expect(fan.hasHitReturn).toBe(true);

    // Fast forward to boss catch
    fan.x = bossPos.x + 0.3;
    fan.z = bossPos.z + 0.1;
    updateFanBoomerang(rt, spec, makeCtx(0.05));

    expect(rt.fans.length).toBe(0);
    expect(rt.phase).toBe("idle");
  });

  it("spawns dual boomerang fans along mirrored crossing curves in Phase 2", () => {
    const p2Rt = freshFanBoomerang(p2Spec);
    expect(p2Spec.dual).toBe(true);

    // Trigger windup & launch
    updateFanBoomerang(p2Rt, p2Spec, makeCtx(p2Spec.interval - p2Spec.telegraph));
    updateFanBoomerang(p2Rt, p2Spec, makeCtx(p2Spec.telegraph + 0.01));

    expect(p2Rt.phase).toBe("active");
    expect(p2Rt.fans.length).toBe(2);

    const [fan1, fan2] = p2Rt.fans;
    // Mirrored rotation and curve directions
    expect(fan1.rotSpeed).toBe(-fan2.rotSpeed);
    expect(fan1.perpZ).toBe(-fan2.perpZ);

    // Advance flight
    updateFanBoomerang(p2Rt, p2Spec, makeCtx(0.2));
    // One fan curved North (-Z), the other curved South (+Z)
    expect(fan1.z).not.toBe(fan2.z);
  });

  it("disposes tell and all active fan meshes cleanly without memory leaks", () => {
    updateFanBoomerang(rt, spec, makeCtx(spec.interval - spec.telegraph));
    updateFanBoomerang(rt, spec, makeCtx(spec.telegraph + 0.01));
    expect(rt.fans.length).toBe(1);

    const mesh = rt.fans[0].mesh;
    disposeFanBoomerang(rt);

    expect(rt.fans.length).toBe(0);
    expect(rt.tell).toBeNull();
    expect(mesh.parent).toBeNull();
  });

  describe("Belly Slam Attack Suite", () => {
    const slamSpec = BOSSES.jade_buddha.moves.slam!;
    const p2SlamSpec = BOSSES.jade_buddha.phase2.moves.slam!;
    let slamRt: SlamRt;

    beforeEach(() => {
      slamRt = freshSlam(slamSpec);
    });

    it("verifies jade_buddha moveset configuration has Belly Slam and Fan Boomerang", () => {
      expect(slamSpec).toBeDefined();
      expect(slamSpec.radius).toBe(2.8);
      expect(slamSpec.launch).toBe(22);
      expect(slamSpec.damage).toBe(2);
      expect(slamSpec.telegraph).toBe(1.0);

      expect(p2SlamSpec).toBeDefined();
      expect(p2SlamSpec.radius).toBe(3.2);
      expect(p2SlamSpec.launch).toBe(26);
      expect(p2SlamSpec.damage).toBe(3);
      expect(p2SlamSpec.echo).toEqual({ delay: 0.4, radius: 3.8, damage: 2 });

      // Check fan boomerang config
      expect(spec).toBeDefined();
      expect(p2Spec.dual).toBe(true);
    });

    it("transitions from idle to telegraph with target tracking and ground ring", () => {
      expect(slamRt.phase).toBe("idle");
      expect(slamRt.ring).toBeNull();

      // Tick down to telegraph window
      updateSlam(slamRt, slamSpec, makeCtx(slamSpec.interval - slamSpec.telegraph));
      expect(slamRt.phase).toBe("telegraph");
      expect(slamRt.ring).not.toBeNull();
      expect(slamRt.x).toBe(targetPos.x);
      expect(slamRt.z).toBe(targetPos.z);
    });

    it("slams down at end of telegraph, triggering AoE hit, launch force, and screen shake", () => {
      // Advance to telegraph
      updateSlam(slamRt, slamSpec, makeCtx(slamSpec.interval - slamSpec.telegraph));
      // Trigger slam impact
      updateSlam(slamRt, slamSpec, makeCtx(slamSpec.telegraph + 0.01));

      expect(hits.length).toBe(1);
      expect(hits[0].damage).toBe(slamSpec.damage);
      expect(hits[0].launch).toBe(slamSpec.launch);
      expect(slamRt.phase).toBe("idle");
      expect(slamRt.ring).toBeNull();
      expect(slamRt.t).toBe(slamSpec.interval);
    });

    it("triggers Phase 2 echo tremor after initial belly slam", () => {
      const p2SlamRt = freshSlam(p2SlamSpec);
      // Advance to telegraph
      updateSlam(p2SlamRt, p2SlamSpec, makeCtx(p2SlamSpec.interval - p2SlamSpec.telegraph));
      // Trigger slam impact
      updateSlam(p2SlamRt, p2SlamSpec, makeCtx(p2SlamSpec.telegraph + 0.01));

      expect(hits.length).toBe(1);
      expect(hits[0].damage).toBe(p2SlamSpec.damage);
      expect(hits[0].launch).toBe(p2SlamSpec.launch);

      // Should transition to echo phase with second wider ring
      expect(p2SlamRt.phase).toBe("echo");
      expect(p2SlamRt.echoT).toBe(p2SlamSpec.echo!.delay);
      expect(p2SlamRt.ring).not.toBeNull();

      // Clear hits to verify echo hit
      hits = [];
      // Trigger echo quake
      updateSlam(p2SlamRt, p2SlamSpec, makeCtx(p2SlamSpec.echo!.delay + 0.01));
      expect(hits.length).toBe(1);
      expect(hits[0].launch).toBe(p2SlamSpec.launch * 0.6);
      expect(p2SlamRt.phase).toBe("idle");
      expect(p2SlamRt.ring).toBeNull();
    });
  });
});
