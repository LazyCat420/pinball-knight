import { describe, expect, it } from "vitest";
import { resolveFloorSpec } from "../spec/floor-spec";
import { generateSectorPlan, hash32 } from "./sector-plan";

describe("SectorPlan & Mission Graph Generator (Phase 1)", () => {
  it("generates deterministic hash32 seeds that vary across coordinates and roles", () => {
    const s1 = hash32(100, 1, 2, 0, 0, 0);
    const s2 = hash32(100, 1, 2, 0, 0, 0);
    const s3 = hash32(100, 1, 2, 1, 0, 0);
    const s4 = hash32(100, 1, 2, 0, 0, 1);

    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1).not.toBe(s4);
  });

  it("builds single sector plan on tiny grids", () => {
    const spec = resolveFloorSpec({ level: 1, cellsW: 10, cellsH: 10, tier: "baseline" });
    const plan = generateSectorPlan(spec);

    expect(plan.sectors.length).toBe(1);
    expect(plan.sectors[0].role).toBe("entry");
    expect(plan.criticalPath).toEqual([0]);
  });

  it("builds multi-sector critical path from entry to boss arena on scaled grids", () => {
    const spec = resolveFloorSpec({ level: 10, progressive: true });
    const plan = generateSectorPlan(spec);

    expect(plan.cols).toBeGreaterThanOrEqual(4);
    expect(plan.rows).toBeGreaterThanOrEqual(4);
    expect(plan.criticalPath.length).toBeGreaterThanOrEqual(4);

    const startSec = plan.sectors.find((s) => s.id === plan.startSectorId);
    const bossSec = plan.sectors.find((s) => s.id === plan.bossSectorId);

    expect(startSec?.role).toBe("entry");
    expect(bossSec?.role).toBe("boss_arena");
  });

  it("supports mechanism_gauntlet mission template with mechanism_hub sectors", () => {
    const spec = resolveFloorSpec({ level: 10, progressive: true });
    expect(spec.missionTemplate).toBe("mechanism_gauntlet");

    const plan = generateSectorPlan(spec);
    const mechHubs = plan.sectors.filter((s) => s.role === "mechanism_hub");
    expect(mechHubs.length).toBeGreaterThanOrEqual(1);

    for (const hub of mechHubs) {
      expect(hub.contentBudget.targetMechanisms).toBeGreaterThanOrEqual(3);
    }
  });

  it("supports locked_vault mission template with locked gateways", () => {
    const spec = resolveFloorSpec({ level: 8, progressive: true });
    expect(spec.missionTemplate).toBe("locked_vault");

    const plan = generateSectorPlan(spec);
    const vaults = plan.sectors.filter((s) => s.role === "vault");
    expect(vaults.length).toBeGreaterThanOrEqual(1);

    const lockedGw = plan.gateways.find((g) => g.locked);
    expect(lockedGw).toBeDefined();
  });

  it("ensures all sectors have at least one incoming or outgoing gateway", () => {
    const spec = resolveFloorSpec({ level: 20, progressive: true });
    const plan = generateSectorPlan(spec);

    for (const sector of plan.sectors) {
      const totalGw = sector.incomingGateways.length + sector.outgoingGateways.length;
      expect(totalGw).toBeGreaterThan(0);
    }
  });
});
