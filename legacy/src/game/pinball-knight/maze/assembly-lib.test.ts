import { describe, it, expect } from "vitest";
import { MACHINES, machineNamed } from "./assembly-lib";
import { checkAssembly, checkAll } from "./assembly-check";
import { orientationsOf, portsChain, hasExit, type Assembly, E, W, O } from "./assembly";

describe("the machine library is sound", () => {
  it("every machine passes every authoring rule", () => {
    const problems = checkAll(MACHINES);
    // Print the actual problems on failure — a bare count tells the next
    // reader nothing about which machine is broken or why.
    expect(problems.map((p) => `${p.machine}: ${p.code} — ${p.detail}`)).toEqual([]);
  });

  it("every machine survives every orientation", () => {
    // A machine that is valid upright but broken rotated is worse than one
    // that is broken outright: it ships, and fails on the floors that happen
    // to draw the bad orientation.
    for (const m of MACHINES) {
      for (const o of orientationsOf(m)) {
        expect(checkAssembly(o).map((p) => p.code)).toEqual([]);
      }
    }
  });

  it("has unique names", () => {
    const names = MACHINES.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares footprints that contain every carved cell", () => {
    for (const m of MACHINES) {
      for (const [ci, cj] of m.floor) {
        expect(ci, `${m.name} floor i`).toBeLessThan(m.w);
        expect(cj, `${m.name} floor j`).toBeLessThan(m.h);
        expect(ci).toBeGreaterThanOrEqual(0);
        expect(cj).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("library flow properties", () => {
  it("provides at least one machine that can start a chain and one that ends it", () => {
    expect(MACHINES.some(hasExit)).toBe(true);
    expect(MACHINES.some((m) => !hasExit(m))).toBe(true);
  });

  it("the chaos machines expose no chainable exit", () => {
    // Pop nests and slingshot pairs must never be usable as a reliable link.
    // The pop nest DOES have an out port, but it is impact-flagged, so no
    // chain may be built through it; the sling pair has no exit at all.
    for (const name of ["pop-nest", "sling-pair"]) {
      const m = machineNamed(name)!;
      const outs = m.ports.filter((p) => p.way !== "in");
      for (const o of outs) expect(o.flow).toBe("impact");
    }
  });

  it("at least one pair of machines actually chains", () => {
    // The whole point of ports: some exit in the library must line up with
    // some entrance. If nothing chains, this is a parts catalogue, not a
    // plumbing system.
    let found = false;
    for (const from of MACHINES) {
      for (const fo of orientationsOf(from)) {
        for (const to of MACHINES) {
          for (const t of orientationsOf(to)) {
            for (const a of fo.ports) {
              for (const b of t.ports) {
                if (portsChain(a, b)) found = true;
              }
            }
          }
        }
      }
    }
    expect(found).toBe(true);
  });

  it("every machine with a runway demand also has an entry to shoot at", () => {
    for (const m of MACHINES) {
      if (!m.wantsRunway) continue;
      expect(m.ports.some((p) => p.way !== "out"), m.name).toBe(true);
    }
  });
});

describe("the validator catches what it claims to", () => {
  const base = {
    name: "broken",
    w: 2,
    h: 2,
    floor: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as ReadonlyArray<readonly [number, number]>,
  };

  it("flags a part embedded in rock", () => {
    const m: Assembly = {
      ...base,
      floor: [[0, 0]],
      parts: [{ ci: 1, cj: 1, kind: "bumper", dir: O, role: "rebound" }],
      ports: [{ ci: 0, cj: 0, dir: E, way: "in" }],
    };
    expect(checkAssembly(m).map((p) => p.code)).toContain("part-off-floor");
  });

  it("flags two parts stacked on one cell", () => {
    const m: Assembly = {
      ...base,
      parts: [
        { ci: 0, cj: 0, kind: "bumper", dir: O, role: "rebound" },
        { ci: 0, cj: 0, kind: "target", dir: E, role: "score" },
      ],
      ports: [{ ci: 1, cj: 1, dir: E, way: "in" }],
    };
    expect(checkAssembly(m).map((p) => p.code)).toContain("part-overlap");
  });

  it("flags a machine nothing can enter", () => {
    const m: Assembly = {
      ...base,
      parts: [],
      ports: [{ ci: 0, cj: 0, dir: E, way: "out" }],
    };
    expect(checkAssembly(m).map((p) => p.code)).toContain("no-entry");
  });

  it("flags THE SLINGSHOT RULE — an exit firing into its own rebounder", () => {
    // The named real-table feel bug: you make the shot, the exit throws the
    // ball into a slingshot, and you are punished for succeeding.
    const m: Assembly = {
      ...base,
      parts: [{ ci: 1, cj: 0, kind: "slingshot", dir: W, role: "rebound" }],
      ports: [
        { ci: 0, cj: 1, dir: E, way: "in" },
        { ci: 0, cj: 0, dir: E, way: "out", flow: "ballistic" },
      ],
    };
    expect(checkAssembly(m).map((p) => p.code)).toContain("exit-into-rebounder");
  });

  it("does NOT flag an impact exit near a rebounder — that is chaos on purpose", () => {
    const m: Assembly = {
      ...base,
      parts: [{ ci: 1, cj: 0, kind: "bumper", dir: O, role: "rebound" }],
      ports: [
        { ci: 0, cj: 1, dir: E, way: "in" },
        { ci: 0, cj: 0, dir: E, way: "out", flow: "impact" },
      ],
    };
    expect(checkAssembly(m).map((p) => p.code)).not.toContain("exit-into-rebounder");
  });

  it("flags a drive part firing into interior rock", () => {
    const m: Assembly = {
      ...base,
      floor: [
        [0, 0],
        [0, 1],
      ],
      parts: [{ ci: 0, cj: 0, kind: "booster", dir: E, role: "drive" }],
      ports: [{ ci: 0, cj: 1, dir: E, way: "in" }],
    };
    expect(checkAssembly(m).map((p) => p.code)).toContain("dead-end-drive");
  });

  it("does NOT flag a drive firing out of the footprint — that is a hand-off", () => {
    const m: Assembly = {
      ...base,
      floor: [[0, 0]],
      parts: [{ ci: 0, cj: 0, kind: "booster", dir: E, role: "drive" }],
      ports: [{ ci: 0, cj: 0, dir: E, way: "both" }],
      w: 1,
      h: 1,
    };
    expect(checkAssembly(m).map((p) => p.code)).not.toContain("dead-end-drive");
  });
});
