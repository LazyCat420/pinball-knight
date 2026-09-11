import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import * as THREE from "three";
import { BOSSES, movesAt } from "../boss-kinds";
import {
  freshPinballCharge,
  freshSlam,
  freshSummon,
  pinballChargeHoldsMovement,
} from "../boss-moves";
import { makeDoppelgangerPaints } from "../render/monsters/doppelganger";
import { state } from "../state";
import { installSpriteTestDom } from "../testkit/atlas-census";

describe("The Doppelgänger Boss — Entity & Mechanics Suite", () => {
  let restoreDom: () => void;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.shakeT = 0;
  });

  it("registers The Doppelgänger in BOSSES with complete phase 1 and phase 2 movesets", () => {
    const spec = BOSSES.doppelganger;
    expect(spec).toBeDefined();
    expect(spec.kind).toBe("doppelganger");
    expect(spec.name).toBe("The Doppelgänger");
    expect(spec.biome).toBe("arcane");
    expect(spec.title).toContain("THE DOPPELGÄNGER");
    expect(spec.art.sheetKey).toBe("doppelganger");
    expect(spec.art.scale).toBeGreaterThanOrEqual(2.0);
    expect(spec.hpMult).toBeGreaterThan(1.0);
    expect(spec.speedMult).toBeGreaterThan(1.0);

    // Phase 1 moves
    expect(spec.moves.pinballCharge).toBeDefined();
    expect(spec.moves.pinballCharge?.speed).toBe(26);
    expect(spec.moves.slam).toBeDefined();
    expect(spec.moves.slam?.radius).toBe(2.8);
    expect(spec.moves.summon).toBeDefined();

    // Phase 2 moves
    expect(spec.phase2.at).toBe(0.5);
    expect(spec.phase2.speedMult).toBe(1.40);
    expect(spec.phase2.moves.pinballCharge).toBeDefined();
    expect(spec.phase2.moves.pinballCharge?.speed).toBe(32);
    expect(spec.phase2.moves.pinballCharge?.maxBounces).toBe(2);
    expect(spec.phase2.moves.slam?.echo).toBeDefined();
    expect(spec.phase2.moves.slam?.echo?.damage).toBe(2);
  });

  it("transitions smoothly to Phase 2 Eclipse Overdrive at <= 50% HP", () => {
    const spec = BOSSES.doppelganger;
    const p1 = movesAt(spec, 0.8);
    expect(p1.pinballCharge?.speed).toBe(26);
    expect(p1.slam?.echo).toBeUndefined();

    const p2 = movesAt(spec, 0.4);
    expect(p2.pinballCharge?.speed).toBe(32);
    expect(p2.pinballCharge?.maxBounces).toBe(2);
    expect(p2.slam?.echo).toBeDefined();
  });

  it("provides complete directional procedural cel-paints for offline testing", () => {
    const paints = makeDoppelgangerPaints();
    expect(paints).toBeDefined();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    const clips = ["idle", "walk", "attack", "death"] as const;
    for (const clip of clips) {
      const frames = paints.S[clip];
      expect(frames, `clip ${clip} frames`).toBeDefined();
      expect(frames?.length).toBe(4);
      // Ensure frame paint is executable
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        expect(() => frames![0](ctx)).not.toThrow();
      }
    }
  });

  it("initializes and executes shadow pinball charge and slam routines", () => {
    const spec = BOSSES.doppelganger;
    const chargeRt = freshPinballCharge(spec.moves.pinballCharge!);
    expect(chargeRt).toBeDefined();
    expect(chargeRt.phase).toBe("idle");
    expect(pinballChargeHoldsMovement(chargeRt)).toBe(false);

    const slamRt = freshSlam(spec.moves.slam!);
    expect(slamRt).toBeDefined();

    const summonRt = freshSummon(spec.moves.summon!);
    expect(summonRt).toBeDefined();
  });
});
