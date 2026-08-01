/**
 * ASSEMBLY VALIDATION — the real-table feel rules, as checkable predicates.
 *
 * Physical pinball design has a short list of named mistakes that make a table
 * feel bad, and most of them are geometric rather than aesthetic. That means
 * they can be CHECKED rather than playtested, which matters here because the
 * game has a large unchecked manual-QA debt and generated content nobody can
 * eyeball at scale.
 *
 * These run over an assembly DEFINITION (authoring-time correctness), not over
 * a placed floor. A definition that fails here is a bug in the library, and the
 * library test fails the build rather than shipping a machine that plays badly
 * on every floor it lands on.
 */
import { TWO_LEG_KINDS, type Assembly, type AssemblyPart, type AssemblyPort } from "./assembly";

export interface AssemblyProblem {
  machine: string;
  /** Short stable code, for asserting on a specific rule in tests. */
  code:
    | "part-off-floor"
    | "port-off-floor"
    | "part-overlap"
    | "exit-into-rebounder"
    | "no-entry"
    | "dead-end-drive"
    | "impact-chain"
    | "corner-missing-leg";
  detail: string;
}

const key = (ci: number, cj: number): string => `${ci},${cj}`;

/** Cells this machine carves, as a set. */
function floorSet(a: Assembly): Set<string> {
  return new Set(a.floor.map(([ci, cj]) => key(ci, cj)));
}

/**
 * Every part and port must stand on a cell the machine actually carves.
 *
 * This is the assembly-level analogue of the shipped `fullyReachable` prefab
 * invariant. A part on an uncarved cell is a part embedded in rock: it renders,
 * it registers in the part list, and it can never be hit — the "dead switch"
 * failure real designers warn about, where the player shoots something that
 * does nothing.
 */
function checkOnFloor(a: Assembly, out: AssemblyProblem[]): void {
  const floor = floorSet(a);
  for (const p of a.parts) {
    if (!floor.has(key(p.ci, p.cj))) {
      out.push({
        machine: a.name,
        code: "part-off-floor",
        detail: `${p.kind} at ${p.ci},${p.cj} is not on carved floor`,
      });
    }
  }
  for (const p of a.ports) {
    if (!floor.has(key(p.ci, p.cj))) {
      out.push({
        machine: a.name,
        code: "port-off-floor",
        detail: `port ${p.tag ?? "?"} at ${p.ci},${p.cj} is not on carved floor`,
      });
    }
  }
}

/** Two parts on one cell is always an authoring slip — the second silently
 *  replaces the first at build time. */
function checkOverlap(a: Assembly, out: AssemblyProblem[]): void {
  const seen = new Set<string>();
  for (const p of a.parts) {
    const k = key(p.ci, p.cj);
    if (seen.has(k)) {
      out.push({ machine: a.name, code: "part-overlap", detail: `two parts on cell ${k}` });
    }
    seen.add(k);
  }
}

/** A machine nothing can enter is unreachable furniture. */
function checkHasEntry(a: Assembly, out: AssemblyProblem[]): void {
  if (!a.ports.some((p) => p.way !== "out")) {
    out.push({ machine: a.name, code: "no-entry", detail: "no in/both port — nothing can reach it" });
  }
}

/**
 * THE SLINGSHOT RULE — the single most cited feel bug in real playfield design:
 * an orbit or ramp whose exit dumps the ball into a slingshot tip, which flings
 * it away out of control. The player made the shot and got punished for it.
 *
 * Here: an exit port must not fire directly into one of this machine's own
 * rebound parts. Walk the cells along the exit direction; if a rebounder sits
 * in that line before the ball leaves the footprint, the machine punishes its
 * own successful shot.
 */
function checkExitLines(a: Assembly, out: AssemblyProblem[]): void {
  const rebounders = new Map<string, AssemblyPart>();
  for (const p of a.parts) if (p.role === "rebound") rebounders.set(key(p.ci, p.cj), p);
  if (!rebounders.size) return;

  for (const port of a.ports) {
    if (port.way === "in") continue;
    if (port.flow === "impact") continue; // chaos by design; not a promise
    let ci = port.ci + port.dir.di;
    let cj = port.cj + port.dir.dj;
    // Bounded by the footprint: once the ball is out of the machine, what it
    // hits is the placer's problem, not the definition's.
    while (ci >= 0 && cj >= 0 && ci < a.w && cj < a.h) {
      const hit = rebounders.get(key(ci, cj));
      if (hit) {
        out.push({
          machine: a.name,
          code: "exit-into-rebounder",
          detail: `exit ${port.tag ?? "?"} fires into ${hit.kind} at ${ci},${cj}`,
        });
        break;
      }
      ci += port.dir.di;
      cj += port.dir.dj;
    }
  }
}

/**
 * A `drive` part exists to send the ball somewhere. One that fires straight
 * into this machine's own uncarved rock, with no port in that direction, is
 * either mis-aimed or the footprint is wrong — the authored equivalent of the
 * launch-orphan the shipped runway repair hunts at runtime.
 */
function checkDrivesGoSomewhere(a: Assembly, out: AssemblyProblem[]): void {
  const floor = floorSet(a);
  for (const p of a.parts) {
    if (p.role !== "drive") continue;
    if (p.dir.di === 0 && p.dir.dj === 0) continue;
    const ni = p.ci + p.dir.di;
    const nj = p.cj + p.dir.dj;
    const insideFootprint = ni >= 0 && nj >= 0 && ni < a.w && nj < a.h;
    // Firing out of the footprint entirely is fine — that is a hand-off to
    // whatever the placer put beyond. Only an interior dead end is a bug.
    if (!insideFootprint) continue;
    if (!floor.has(key(ni, nj))) {
      out.push({
        machine: a.name,
        code: "dead-end-drive",
        detail: `${p.kind} at ${p.ci},${p.cj} fires into uncarved cell ${ni},${nj}`,
      });
    }
  }
}

/**
 * A CORNER NEEDS BOTH LEGS, and the failure if it doesn't is silent.
 *
 * `boostcorner` and `deflector` are entered on `dir` and leave on `dir2`. Author
 * one without a second leg and `entities/pinball-collide.ts` resolves the throw
 * to `(0, 0)` — the deflector's grab-throw catches the knight and hurls him
 * along a zero vector. Nothing errors; the part simply eats the player.
 *
 * Two legs must also be PERPENDICULAR. A corner whose legs are parallel is a
 * straight (use a booster) and one whose legs are opposed is a part that throws
 * you back the way you came, which is the launch-duel shape the pipeline spends
 * real effort breaking.
 *
 * This rule exists because the shipped library had the bug in two machines. It
 * is the reason `checkAll(MACHINES)` is worth running at all: the definitions
 * looked right, and nothing that placed them existed to prove otherwise.
 */
function checkCornerLegs(a: Assembly, out: AssemblyProblem[]): void {
  for (const p of a.parts) {
    if (!TWO_LEG_KINDS.has(p.kind)) {
      if (p.dir2) {
        out.push({
          machine: a.name,
          code: "corner-missing-leg",
          detail: `${p.kind} at ${p.ci},${p.cj} has a dir2 but is not a corner kind — it will be ignored`,
        });
      }
      continue;
    }
    const d2 = p.dir2;
    if (!d2 || (d2.di === 0 && d2.dj === 0)) {
      out.push({
        machine: a.name,
        code: "corner-missing-leg",
        detail: `${p.kind} at ${p.ci},${p.cj} has no dir2 — it throws along a ZERO VECTOR and eats the player`,
      });
      continue;
    }
    // Perpendicular ⇔ the dot product of two cardinals is 0.
    if (p.dir.di * d2.di + p.dir.dj * d2.dj !== 0) {
      out.push({
        machine: a.name,
        code: "corner-missing-leg",
        detail: `${p.kind} at ${p.ci},${p.cj} has legs (${p.dir.di},${p.dir.dj}) and (${d2.di},${d2.dj}) — a corner's legs must be perpendicular`,
      });
    }
  }
}

/** Run every rule over one machine. Empty array = the definition is sound. */
export function checkAssembly(a: Assembly): AssemblyProblem[] {
  const out: AssemblyProblem[] = [];
  checkOnFloor(a, out);
  checkOverlap(a, out);
  checkHasEntry(a, out);
  checkExitLines(a, out);
  checkDrivesGoSomewhere(a, out);
  checkCornerLegs(a, out);
  return out;
}

/** Run every rule over a whole library. */
export function checkAll(list: readonly Assembly[]): AssemblyProblem[] {
  return list.flatMap(checkAssembly);
}
