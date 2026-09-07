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
import { TWO_LEG_KINDS, isRecoveryPort, type Assembly, type AssemblyPart, type AssemblyPort } from "./assembly";

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
    | "corner-missing-leg"
    | "capture-no-release"
    | "capture-release-into-rebound"
    | "no-recovery";
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

/**
 * A CAPTURE MUST DECLARE ITS RELEASE.
 *
 * A `capture` part stops the ball and holds it. Flow does not continue through
 * one, it RESTARTS on the far side — and the machine is the only thing that
 * knows where. Author a capture with no release and the definition has stated
 * a softlock: the ball goes in and the data does not say what happens next.
 *
 * The release must be an EJECT specifically, not merely an exit. A ballistic
 * exit preserves whatever momentum the ball has, and a captured ball's momentum
 * is zero by definition — it was stopped. So a capture whose only exit is
 * ballistic releases the player at no speed onto the tile he is standing on,
 * which is the same softlock with an extra port on it. `eject` is the one flow
 * that replaces momentum with an authored vector, which is exactly what a
 * scoop's kickout coil does and why a chain through one is reliable.
 *
 * The RECOVERY landing does not count. It is an eject exit and it would
 * satisfy a naive version of this rule, but it is the FAILURE path: letting it
 * stand in for the release would mean a machine could author what happens when
 * the ride goes wrong and never say what happens when it goes right.
 */
function checkCaptureRelease(a: Assembly, out: AssemblyProblem[]): void {
  if (!a.parts.some((p) => p.role === "capture")) return;
  const released = a.ports.some((p) => p.way !== "in" && p.flow === "eject" && !isRecoveryPort(p));
  if (!released) {
    out.push({
      machine: a.name,
      code: "capture-no-release",
      detail: "a capture part with no authored eject exit — the ball goes in and the definition never says where it comes out",
    });
  }
}

/**
 * THE SLINGSHOT RULE, ON THE INSIDE OF THE MACHINE.
 *
 * `checkExitLines` walks FORWARD from a port and stops at the footprint edge,
 * which for a port on the boundary — where ports live — is usually zero cells.
 * It is the right rule for a ballistic exit, whose ball arrives at the port
 * already travelling: what happens beyond the machine is the placer's problem.
 *
 * An EJECT from a capture is a different shot. The ball starts at rest INSIDE
 * the machine and is thrown from there to the port, so the cells between them
 * are part of the release, and they are exactly the cells the forward walk
 * never looks at. That segment is where a guarding rebounder sits — the drop
 * targets and slingshots that make a scoop worth shooting at are in front of
 * it, not behind it. A scoop that kicks the ball into its own guard punishes
 * the player for the shot he just made, which is the same feel bug as the
 * shipped rule, on the half of the line the shipped rule cannot see.
 *
 * So: walk BACKWARD from every eject exit, through the footprint, and flag a
 * rebounder standing on the release path. The recovery landing is walked too —
 * a failed ride kicked into a slingshot is not a recovery.
 */
function checkCaptureReleasePath(a: Assembly, out: AssemblyProblem[]): void {
  if (!a.parts.some((p) => p.role === "capture")) return;
  const rebounders = new Map<string, AssemblyPart>();
  for (const p of a.parts) if (p.role === "rebound") rebounders.set(key(p.ci, p.cj), p);
  if (!rebounders.size) return;

  for (const port of a.ports) {
    if (port.way === "in") continue;
    if (port.flow !== "eject") continue;
    // Backwards along the travel vector: from the port INTO the machine, which
    // is the direction the ejected ball came from.
    let ci = port.ci - port.dir.di;
    let cj = port.cj - port.dir.dj;
    while (ci >= 0 && cj >= 0 && ci < a.w && cj < a.h) {
      const hit = rebounders.get(key(ci, cj));
      if (hit) {
        out.push({
          machine: a.name,
          code: "capture-release-into-rebound",
          detail: `release ${port.tag ?? "?"} is thrown through ${hit.kind} at ${ci},${cj} on its way out`,
        });
        break;
      }
      ci -= port.dir.di;
      cj -= port.dir.dj;
    }
  }
}

/**
 * Does this machine carry a RIDE — something that can fail with the player
 * still inside it?
 *
 * `drive` and `capture`, and nothing else. A drive part throws the player
 * somewhere and can throw him short; a capture holds him and can decline to
 * let go. A bank of targets, a nest of bumpers or a lane of rollovers cannot
 * strand anyone: the ball arrives under its own power and leaves the same way,
 * so demanding a landing from them would turn the rule into a tax on every
 * machine in the library rather than a contract on the ones that need it.
 */
export function needsRecovery(a: Assembly): boolean {
  return a.parts.some((p) => p.role === "drive" || p.role === "capture");
}

/** Does it declare where a failed ride lands? */
export function hasRecoveryPort(a: Assembly): boolean {
  return a.ports.some(isRecoveryPort);
}

/**
 * THE FOUR MACHINES THAT PREDATE THE RECOVERY CONTRACT.
 *
 * `no-recovery` is an ERROR, not a warning, and that is a deliberate choice
 * with a cost attached. The alternative was a severity channel — emit the
 * problem, mark it `warn`, let the library gate filter it out. This repo has a
 * recorded scar for exactly that shape: a rule nothing enforces is a rule that
 * does nothing, and it stays green for months while the thing it was written
 * to catch ships repeatedly. An error that every NEW machine must satisfy is
 * worth more than a warning every machine may ignore.
 *
 * The cost is these four, which shipped before the contract existed and fail
 * it. Retrofitting a landing onto each is not a comment change: a recovery
 * port is a real exit, so the router runway-gates it (`scoreAt` demands
 * MIN_RUNWAY of open floor beyond every non-`in` port), and adding one lowers
 * the machine's placement rate on every floor in the game. That is a change to
 * shipped behaviour, measured by `assembly-place.test.ts`, and it does not
 * belong in the same change as the vocabulary that makes it expressible.
 *
 * So they are named — each with the reason it is here rather than fixed:
 *
 *  · `orbit`        — two boosters drive its lanes and a ball that stalls on
 *    the bend has nowhere authored to go. It already asks for `wantsRunway: 4`
 *    and gates two exits; a third would change where orbits land on every
 *    floor.
 *  · `ramp-return`  — the same, and it carries the library's highest runway
 *    demand (5). It is the machine most sensitive to another gated exit, so it
 *    is the one whose placement rate a retrofit would move furthest.
 *  · `kicker-lane`  — 2×2, the smallest machine in the library. Its four cells
 *    are a spring, a rollover, a mouth and a kickout; there is no boundary cell
 *    left to land on that is not already carrying a port whose tag something
 *    else chains to.
 *  · `spinner-gate` — a 3×1 straight-through. Both ends are already ports and
 *    the machine has no third face; a landing would have to share a cell with
 *    the mouth or the exit, which changes what chains to it.
 *
 * The list is pinned by a test that DERIVES the failing set from `MACHINES` and
 * asserts set equality in both directions. An allowlist drifts both ways and
 * keeps its count — a name that gets fixed must leave, and a new machine that
 * fails must never quietly join.
 */
export const RECOVERY_GRANDFATHERED: ReadonlySet<string> = new Set([
  "orbit",
  "ramp-return",
  "kicker-lane",
  "spinner-gate",
]);

/**
 * EVERY RIDE DECLARES ITS LANDING.
 *
 * The structural half of a promise the pipeline currently keeps only at
 * runtime. `breakLaunchDuels`, `breakFlowLoops` and the booster-jam guard all
 * exist to rescue a player who is already stuck; each of them has to guess
 * where to put him, because nothing in the data ever said. A machine that
 * declares a recovery port has answered the question in advance, at the one
 * place that knows the answer — the definition.
 */
function checkHasRecovery(a: Assembly, out: AssemblyProblem[]): void {
  if (!needsRecovery(a)) return;
  if (hasRecoveryPort(a)) return;
  if (RECOVERY_GRANDFATHERED.has(a.name)) return;
  out.push({
    machine: a.name,
    code: "no-recovery",
    detail: `carries a drive/capture but declares no port tagged "recovery" — a failed ride has nowhere authored to land`,
  });
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
  checkCaptureRelease(a, out);
  checkCaptureReleasePath(a, out);
  checkHasRecovery(a, out);
  return out;
}

/** Run every rule over a whole library. */
export function checkAll(list: readonly Assembly[]): AssemblyProblem[] {
  return list.flatMap(checkAssembly);
}
