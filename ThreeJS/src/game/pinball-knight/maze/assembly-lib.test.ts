import { describe, it, expect } from "vitest";
import { MACHINES, machineNamed, LOOP_LANE_STRIDE } from "./assembly-lib";
import { checkAssembly, checkAll, needsRecovery, hasRecoveryPort, RECOVERY_GRANDFATHERED } from "./assembly-check";
import {
  orientationsOf,
  portsChain,
  hasExit,
  isRecoveryPort,
  recoveryPortOf,
  TWO_LEG_KINDS,
  type Assembly,
  N,
  E,
  S,
  W,
  O,
} from "./assembly";
// The maw's own threshold, imported rather than transcribed. A machine whose
// entry speed is a COPY of the constant agrees with itself forever; imported,
// it is a premise that moves when the mechanic does.
import { MAW_SWALLOW_SPEED } from "../entities/maw";

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

/**
 * THE RULE THAT CAUGHT A SHIPPED BUG.
 *
 * `ORBIT` and `RAMP_RETURN` both carried single-legged deflectors, which
 * `entities/pinball-collide.ts` resolves to a throw along (0,0) — the grab-throw
 * catches the knight and never releases him. Neither ever ran, because no router
 * placed them, so nothing contradicted the definitions.
 *
 * These are the falsifiers: the rule must FIRE on each broken shape, or the
 * green above is a rule that has never done anything.
 */
describe("corner-missing-leg", () => {
  const bend = (over: Partial<Assembly["parts"][number]>): Assembly => ({
    name: "probe",
    w: 2,
    h: 2,
    floor: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    parts: [{ ci: 1, cj: 0, kind: "boostcorner", dir: E, dir2: S, role: "turn", ...over }],
    ports: [{ ci: 0, cj: 0, dir: E, way: "in" }],
  });

  it("fires on a corner with NO second leg — the shipped bug", () => {
    expect(checkAssembly(bend({ dir2: undefined })).map((p) => p.code)).toContain("corner-missing-leg");
  });

  it("fires on a corner whose second leg is the null direction", () => {
    expect(checkAssembly(bend({ dir2: O })).map((p) => p.code)).toContain("corner-missing-leg");
  });

  it("fires on legs that are PARALLEL — that is a straight, not a corner", () => {
    expect(checkAssembly(bend({ dir2: E })).map((p) => p.code)).toContain("corner-missing-leg");
  });

  it("fires on legs that are OPPOSED — that throws you back the way you came", () => {
    expect(checkAssembly(bend({ dir2: W })).map((p) => p.code)).toContain("corner-missing-leg");
  });

  it("fires on a NON-corner kind carrying a dir2 that would be ignored", () => {
    const m = bend({ kind: "booster", dir2: S, role: "drive" });
    expect(checkAssembly(m).map((p) => p.code)).toContain("corner-missing-leg");
  });

  it("stays silent on a well-formed perpendicular bend", () => {
    expect(checkAssembly(bend({})).map((p) => p.code)).not.toContain("corner-missing-leg");
  });
});

/**
 * THE CAPTURE AND RECOVERY CONTRACTS.
 *
 * Three rules, three falsifiers. Each fixture is built to fail EXACTLY ONE of
 * them: a fixture that trips two rules cannot tell you which rule caught it,
 * and a rule whose only evidence is a fixture that also trips its neighbours
 * has never been shown to do anything on its own. So each `it` below asserts
 * the whole problem SET, not `toContain` — the difference between "this rule
 * fires" and "this rule fires and nothing else does".
 */
describe("capture-no-release", () => {
  /** A maw whose only eject is the FAILURE landing: the ride is unauthored. */
  const held: Assembly = {
    name: "probe-capture-no-release",
    w: 2,
    h: 1,
    floor: [
      [0, 0],
      [1, 0],
    ],
    parts: [{ ci: 1, cj: 0, kind: "maw", dir: N, role: "capture" }],
    ports: [
      { ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", tag: "mouth" },
      { ci: 0, cj: 0, dir: W, way: "out", flow: "eject", tag: "recovery" },
    ],
  };

  it("fires on a capture with no authored release — a softlock by construction", () => {
    // The machine swallows the ball and the definition never says where it
    // goes. At runtime the maw falls back to a Φ-bounded guess; at authoring
    // time that is a machine whose whole point is undeclared.
    expect(new Set(checkAssembly(held).map((p) => p.code))).toEqual(new Set(["capture-no-release"]));
  });

  it("is NOT satisfied by the recovery landing alone", () => {
    // The fixture above already HAS an eject exit — the landing. Counting it as
    // the release would let a machine author only its failure path and pass.
    expect(held.ports.some((p) => p.way === "out" && p.flow === "eject")).toBe(true);
    expect(checkAssembly(held).map((p) => p.code)).toContain("capture-no-release");
  });

  it("stays silent once a real release is authored", () => {
    const released: Assembly = {
      ...held,
      ports: [...held.ports, { ci: 1, cj: 0, dir: E, way: "out", flow: "eject", tag: "spit" }],
    };
    expect(checkAssembly(released).map((p) => p.code)).toEqual([]);
  });

  it("stays silent on a machine with no capture at all", () => {
    // The rule must not become "every machine needs an eject".
    const plain: Assembly = { ...held, name: "probe-plain", parts: [], ports: [held.ports[0]] };
    expect(checkAssembly(plain).map((p) => p.code)).toEqual([]);
  });
});

describe("capture-release-into-rebound", () => {
  /**
   * The scoop kicks the ball straight into its own guarding slingshot.
   *
   * Note where the rebounder sits: BETWEEN the maw and the exit port, i.e. on
   * the inside of the footprint. `exit-into-rebounder` walks FORWARD from a
   * port and leaves the machine immediately, so it cannot see this — the two
   * rules look at two different segments of the same shot, which is why this
   * fixture trips one and not the other.
   */
  const kicked: Assembly = {
    name: "probe-release-into-rebound",
    w: 4,
    h: 2,
    floor: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
    ],
    parts: [
      { ci: 1, cj: 0, kind: "maw", dir: N, role: "capture" },
      { ci: 2, cj: 0, kind: "slingshot", dir: O, role: "rebound" },
    ],
    ports: [
      { ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", tag: "mouth" },
      { ci: 3, cj: 0, dir: E, way: "out", flow: "eject", tag: "release" },
      { ci: 0, cj: 1, dir: S, way: "out", flow: "eject", tag: "recovery" },
    ],
  };

  it("fires on a release path that crosses the machine's own rebounder", () => {
    expect(new Set(checkAssembly(kicked).map((p) => p.code))).toEqual(new Set(["capture-release-into-rebound"]));
  });

  it("is a DIFFERENT rule from exit-into-rebounder, on a different segment", () => {
    // Both rules are live in this fixture's checker run and only one of them
    // fires. If this ever starts reporting both, the new rule has been widened
    // into a duplicate of the shipped one and its own evidence is gone.
    expect(checkAssembly(kicked).map((p) => p.code)).not.toContain("exit-into-rebounder");
  });

  it("stays silent when the release path is clear", () => {
    const clear: Assembly = { ...kicked, parts: [kicked.parts[0]] };
    expect(checkAssembly(clear).map((p) => p.code)).toEqual([]);
  });
});

describe("no-recovery", () => {
  const base = {
    w: 2,
    h: 1,
    floor: [
      [0, 0],
      [1, 0],
    ] as ReadonlyArray<readonly [number, number]>,
  };

  const launcher: Assembly = {
    ...base,
    name: "probe-no-recovery-drive",
    parts: [{ ci: 0, cj: 0, kind: "booster", dir: E, role: "drive", seq: 0 }],
    ports: [
      { ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", tag: "mouth" },
      { ci: 1, cj: 0, dir: E, way: "out", flow: "ballistic", tag: "through" },
    ],
  };

  const swallower: Assembly = {
    ...base,
    name: "probe-no-recovery-capture",
    parts: [{ ci: 1, cj: 0, kind: "maw", dir: N, role: "capture" }],
    ports: [
      { ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", tag: "mouth" },
      { ci: 1, cj: 0, dir: E, way: "out", flow: "eject", tag: "spit" },
    ],
  };

  it("fires on a launcher with no declared landing", () => {
    expect(new Set(checkAssembly(launcher).map((p) => p.code))).toEqual(new Set(["no-recovery"]));
  });

  it("fires on a capture with no declared landing", () => {
    expect(new Set(checkAssembly(swallower).map((p) => p.code))).toEqual(new Set(["no-recovery"]));
  });

  it("stays silent once a landing is declared", () => {
    const landed: Assembly = {
      ...launcher,
      ports: [...launcher.ports, { ci: 1, cj: 0, dir: S, way: "out", flow: "eject", tag: "recovery" }],
    };
    expect(checkAssembly(landed).map((p) => p.code)).toEqual([]);
  });

  it("stays silent on a machine that carries no ride at all", () => {
    // A pure scoring bank drives nothing and holds nothing; demanding a landing
    // from it would turn the rule into a tax on every machine in the library.
    const bank: Assembly = {
      ...base,
      name: "probe-scores-only",
      parts: [{ ci: 1, cj: 0, kind: "target", dir: W, role: "score", seq: 0 }],
      ports: [{ ci: 0, cj: 0, dir: E, way: "in", flow: "ballistic", tag: "face" }],
    };
    expect(checkAssembly(bank).map((p) => p.code)).toEqual([]);
  });

  it("grandfathers EXACTLY the shipped machines that predate it — derived, not transcribed", () => {
    // The rule is an ERROR, so the four machines that shipped without a landing
    // would fail the library gate above and take the build with them. They are
    // named in `RECOVERY_GRANDFATHERED` with a reason each.
    //
    // This assertion is set equality in BOTH directions against a list DERIVED
    // from `MACHINES`, because an allowlist drifts both ways and keeps its
    // count: a name that gets fixed must leave the list, and a new machine that
    // fails must never be quietly added to it.
    const failing = MACHINES.filter((m) => needsRecovery(m) && !hasRecoveryPort(m))
      .map((m) => m.name)
      .sort();
    expect(failing).toEqual([...RECOVERY_GRANDFATHERED].sort());
  });

  it("does not grandfather the new machines", () => {
    for (const name of ["gargoyle-scoop", "loop-reactor"]) {
      expect(RECOVERY_GRANDFATHERED.has(name), `${name} must obey the rule it was authored under`).toBe(false);
    }
  });
});

/**
 * THE GARGOYLE SCOOP — the capture set piece, and the first machine in the
 * library that can say what it does.
 */
describe("gargoyle-scoop", () => {
  const scoop = (): Assembly => machineNamed("gargoyle-scoop")!;

  it("is a member of MACHINES, so every gate at the top of this file already covers it", () => {
    // Stated rather than assumed. "the machine library is sound" iterates
    // MACHINES; a machine defined in the module but left out of that array
    // would be checked by nothing at all — which is precisely how the library
    // shipped two single-legged deflectors.
    expect(MACHINES.map((m) => m.name)).toContain("gargoyle-scoop");
    expect(scoop()).toBeDefined();
  });

  it("passes every authoring rule, upright and in every orientation", () => {
    expect(checkAssembly(scoop()).map((p) => `${p.code} — ${p.detail}`)).toEqual([]);
    for (const o of orientationsOf(scoop())) expect(checkAssembly(o).map((p) => p.code)).toEqual([]);
  });

  it("HOLDS the ball — it has a capture part, which no shipped machine had", () => {
    const captures = scoop().parts.filter((p) => p.role === "capture");
    expect(captures).toHaveLength(1);
    expect(captures[0].kind).toBe("maw");
  });

  it("offers a CHOICE of exit — two authored ejects, differently tagged", () => {
    // "Enter the mouth, choose where you come out." One exit is a scoop; two
    // is a decision, and the tags are what let the runtime tell them apart.
    const releases = scoop().ports.filter((p) => p.way === "out" && p.flow === "eject" && !isRecoveryPort(p));
    expect(releases.length).toBeGreaterThanOrEqual(2);
    expect(new Set(releases.map((p) => p.tag)).size).toBe(releases.length);
    // Different DIRECTIONS, not merely different labels — two exits that fire
    // the same way are one exit with two names.
    expect(new Set(releases.map((p) => `${p.dir.di},${p.dir.dj}`)).size).toBe(releases.length);
  });

  it("declares where a failed swallow puts the player down", () => {
    const rec = recoveryPortOf(scoop());
    expect(rec, "a capture without a landing is the softlock the rule exists for").toBeDefined();
    expect(rec!.flow).toBe("eject");
  });

  it("asks for an approach fast enough to actually trigger the maw", () => {
    // A maw below MAW_SWALLOW_SPEED is scenery: `canMawSwallow` returns false
    // and the ball rolls over the stone face. An entry port with minSpeed 0
    // would let the router hang this machine off a dead-end where the shot can
    // never arrive fast enough, and nothing downstream would ever notice.
    const entry = scoop().ports.find((p) => p.way !== "out")!;
    expect(entry.minSpeed ?? 0).toBeGreaterThanOrEqual(MAW_SWALLOW_SPEED);
  });

  it("wants the longest runway in the library — the shot has to be straight", () => {
    const others = MACHINES.filter((m) => m.name !== "gargoyle-scoop").map((m) => m.wantsRunway ?? 0);
    expect(scoop().wantsRunway ?? 0).toBeGreaterThanOrEqual(Math.max(...others));
  });

  it("guards the mouth with a seq-ordered target bank", () => {
    const targets = scoop()
      .parts.filter((p) => p.role === "score")
      .map((p) => p.seq);
    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect([...targets].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(targets.map((_, k) => k));
  });
});

/**
 * THE LOOP REACTOR — three loops, one machine id. The test that matters is the
 * last one: "alternated between three distinct loops" and "hit the same loop
 * three times" must be distinguishable from the emitted data alone, or the
 * machine is one loop wearing three hats.
 */
describe("loop-reactor", () => {
  const reactor = (): Assembly => machineNamed("loop-reactor")!;
  /** Which lane a part belongs to, from its seq. The stride is imported, not
   *  transcribed — a test that hard-codes 10 agrees with itself if the library
   *  ever renumbers. */
  const laneOf = (seq: number | undefined): number => Math.floor((seq ?? 0) / LOOP_LANE_STRIDE);

  it("is a member of MACHINES, so every gate at the top of this file already covers it", () => {
    expect(MACHINES.map((m) => m.name)).toContain("loop-reactor");
    expect(reactor()).toBeDefined();
  });

  it("passes every authoring rule, upright and in every orientation", () => {
    expect(checkAssembly(reactor()).map((p) => `${p.code} — ${p.detail}`)).toEqual([]);
    for (const o of orientationsOf(reactor())) expect(checkAssembly(o).map((p) => p.code)).toEqual([]);
  });

  it("splits into THREE seq-ordered lanes with no shared seq", () => {
    const lanes = new Map<number, number[]>();
    for (const p of reactor().parts) {
      expect(p.seq, "every reactor part must be ordered — an unordered part belongs to no lane").toBeDefined();
      const l = laneOf(p.seq);
      lanes.set(l, [...(lanes.get(l) ?? []), p.seq!]);
    }
    expect(lanes.size, "three loops means three lanes").toBe(3);
    for (const [, seqs] of lanes) expect(seqs.length).toBeGreaterThanOrEqual(2);
    // Globally unique seqs: two parts sharing one is what would make a runtime
    // "which loop did he take" read ambiguous.
    const all = reactor().parts.map((p) => p.seq!);
    expect(new Set(all).size).toBe(all.length);
  });

  it("is three DIFFERENT loops, not one loop copied three times", () => {
    // The falsifier for the whole machine. Group each lane's parts into a shape
    // signature — kinds and both legs, in seq order — and require all three to
    // differ. Three identical signatures would be three copies, and the "hit
    // three distinct loops" combo would be indistinguishable from spamming one.
    const shapes = new Map<number, string>();
    for (const p of [...reactor().parts].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
      const l = laneOf(p.seq);
      const step = `${p.kind}:${p.dir.di},${p.dir.dj}:${p.dir2?.di ?? "-"},${p.dir2?.dj ?? "-"}`;
      shapes.set(l, `${shapes.get(l) ?? ""}|${step}`);
    }
    expect(new Set(shapes.values()).size, `lane shapes: ${[...shapes.values()].join("  ")}`).toBe(3);
  });

  it("gives each loop its own mouth, distinctly tagged", () => {
    const mouths = reactor().ports.filter((p) => p.way !== "out");
    expect(mouths).toHaveLength(3);
    expect(new Set(mouths.map((p) => p.tag)).size).toBe(3);
  });

  it("gives every corner BOTH legs — a one-legged corner eats the player", () => {
    const corners = reactor().parts.filter((p) => TWO_LEG_KINDS.has(p.kind));
    expect(corners.length, "a loop without a turn is a lane").toBeGreaterThanOrEqual(2);
    for (const c of corners) {
      expect(c.dir2, `${c.kind} at ${c.ci},${c.cj}`).toBeDefined();
      expect(c.dir.di * c.dir2!.di + c.dir.dj * c.dir2!.dj + 0).toBe(0);
    }
  });

  it("carries at least one EJECT link — a long ballistic chain bleeds out", () => {
    // The library's own rule, stated in its header. Ballistic hand-offs
    // preserve whatever speed arrived; three of them in a row is a shot that
    // dies in the middle of the machine.
    expect(reactor().ports.some((p) => p.way !== "in" && p.flow === "eject")).toBe(true);
  });

  it("declares where a loop that dies puts the player down", () => {
    expect(recoveryPortOf(reactor())).toBeDefined();
  });
});

describe("the new machines keep the library's own promises", () => {
  it("stay inside the 2-5 cell footprint the header commits to", () => {
    for (const name of ["gargoyle-scoop", "loop-reactor"]) {
      const m = machineNamed(name)!;
      for (const side of [m.w, m.h]) {
        expect(side, `${name} side`).toBeGreaterThanOrEqual(1);
        expect(side, `${name} side`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("do not collide with an existing machine's identity", () => {
    // Same footprint, same parts, same ports as something already shipped would
    // be a duplicate wearing a new name — and `orientationsOf` would hand the
    // router two bags of the same thing.
    const sigs = MACHINES.map((m) => `${m.w}x${m.h}|${m.parts.length}|${m.ports.length}|${m.name}`);
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});
