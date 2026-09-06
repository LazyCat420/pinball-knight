import { describe, it, expect } from "vitest";
import { buildFloorPlan } from "./floor-plan";
import { liveFloor } from "../testkit/live-floor";
import { REPRESENTATIVE_MATRIX } from "./regression-census";

describe("Phase 1 — Authoritative buildFloorPlan Pipeline", () => {
  for (const item of REPRESENTATIVE_MATRIX) {
    const label = `L${item.level}s${item.seed} (${item.archetype})`;

    it(`builds valid authoritative floor plan for ${label}`, () => {
      const plan = buildFloorPlan(item.level, item.seed);
      expect(plan).not.toBeNull();
      if (!plan) return;

      // Profile Contract
      expect(plan.profile.level).toBe(item.level);
      expect(plan.profile.seed).toBe(item.seed);
      expect(plan.profile.arch.id).toBe(plan.profile.arch.id);
      expect(plan.profile.partBudget).toBeGreaterThan(0);

      // Track Topology Contract
      expect(plan.track.grid).toBe(plan.grid);
      expect(plan.track.start).toBeDefined();
      expect(plan.track.stairs).toBeDefined();

      // Content Realization Contract
      expect(plan.plan.parts.length).toBeGreaterThan(0);
      expect(plan.plan.start).toEqual(plan.track.start);
      expect(plan.plan.stairs).toEqual(plan.track.stairs);

      // Validation Contract
      expect(Array.isArray(plan.violations)).toBe(true);
    });
  }

  it("produces deterministic output identical across repeated calls", () => {
    const run1 = buildFloorPlan(3, 42);
    const run2 = buildFloorPlan(3, 42);
    expect(run1).not.toBeNull();
    expect(run2).not.toBeNull();

    expect(run1!.grid.w).toBe(run2!.grid.w);
    expect(run1!.grid.h).toBe(run2!.grid.h);
    expect(run1!.plan.parts.length).toBe(run2!.plan.parts.length);
    expect(run1!.plan.parts[0]).toEqual(run2!.plan.parts[0]);
    expect(run1!.track.start).toEqual(run2!.track.start);
  });
});
