/**
 * GAMEPLAY RECIPES — Grouped composite assemblies realized transactionally.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * In legacy generation, mutually dependent mechanisms (such as a flipper and
 * its return lane, or a launch chute and its acceleration boosters) were
 * placed as unrelated, disconnected decoration passes. When one half succeeded
 * and the other half failed (or collided with a loose piece), the game shipped
 * broken half-machines or jammed corner clusters.
 *
 * Recipes bundle related pieces into an atomic composite:
 *   1. Reserves the entire compound footprint and clearance buffer at once.
 *   2. If any part of the recipe cannot claim its space, the entire recipe
 *      stands down or relocates — never leaving orphan pieces or clumping.
 *   3. Exposes formal input and output ports connecting to the route graph.
 */
import type { TilePos } from "./generator";
import type { ReservationGrid, Port, ReservationRequest } from "./reservations";

export interface RecipePartSpec {
  kind: string;
  relI: number;
  relJ: number;
  dirI: number;
  dirJ: number;
  dir2I?: number;
  dir2J?: number;
}

export interface GameplayRecipe {
  id: string;
  name: string;
  relativeFootprint: TilePos[];
  relativeBuffer: TilePos[];
  relativePorts: Port[];
  parts: RecipePartSpec[];
}

/**
 * 1. Launch Chute Recipe:
 * Plunger base → Acceleration boost lane → Safe exit/merge threshold.
 */
export function createLaunchChuteRecipe(length = 6): GameplayRecipe {
  const footprint: TilePos[] = [];
  const buffer: TilePos[] = [];
  const parts: RecipePartSpec[] = [];

  for (let s = 0; s < length; s++) {
    footprint.push({ i: 0, j: s });
    // Flanking sealed wall buffer
    buffer.push({ i: -1, j: s });
    buffer.push({ i: 1, j: s });

    // Staggered acceleration boosters along chute spine
    if (s > 0 && s < length - 1 && s % 2 === 1) {
      parts.push({
        kind: "booster",
        relI: 0,
        relJ: s,
        dirI: 0,
        dirJ: 1,
      });
    }
  }

  // End cap buffer behind base
  buffer.push({ i: 0, j: -1 });

  return {
    id: "recipe-launch-chute",
    name: "Launch Chute Assembly",
    relativeFootprint: footprint,
    relativeBuffer: buffer,
    relativePorts: [
      { i: 0, j: length - 1, dirI: 0, dirJ: 1, role: "out" },
    ],
    parts,
  };
}

/**
 * 2. Flipper-Return Recipe:
 * Flipper paddle + angled return lane + spine rejoin point.
 */
export function createFlipperReturnRecipe(): GameplayRecipe {
  // Footprint: 2x2 corner crook with return lane
  const footprint: TilePos[] = [
    { i: 0, j: 0 },
    { i: 1, j: 0 },
    { i: 0, j: 1 },
    { i: 0, j: 2 },
  ];

  const buffer: TilePos[] = [
    { i: -1, j: 0 },
    { i: -1, j: 1 },
    { i: -1, j: 2 },
    { i: 1, j: 1 },
    { i: 1, j: 2 },
    { i: 2, j: 0 },
  ];

  const parts: RecipePartSpec[] = [
    {
      kind: "flipper",
      relI: 0,
      relJ: 0,
      dirI: 1,
      dirJ: 0,
    },
    {
      kind: "booster",
      relI: 0,
      relJ: 2,
      dirI: 0,
      dirJ: 1,
    },
  ];

  return {
    id: "recipe-flipper-return",
    name: "Flipper Return Assembly",
    relativeFootprint: footprint,
    relativeBuffer: buffer,
    relativePorts: [
      { i: 0, j: 0, dirI: 0, dirJ: 1, role: "in" },
      { i: 0, j: 2, dirI: 0, dirJ: 1, role: "out" },
    ],
    parts,
  };
}

export interface RealizedRecipeResult {
  ok: boolean;
  reservationId?: string;
  parts: Array<{
    kind: string;
    i: number;
    j: number;
    dirI: number;
    dirJ: number;
  }>;
}

/**
 * Attempt to transactionally place and reserve a gameplay recipe at an anchor point.
 */
export function placeRecipe(
  recipe: GameplayRecipe,
  anchor: TilePos,
  reservations: ReservationGrid,
  instanceId: string,
): RealizedRecipeResult {
  const footprint = recipe.relativeFootprint.map((p) => ({
    i: anchor.i + p.i,
    j: anchor.j + p.j,
  }));

  const buffer = recipe.relativeBuffer.map((p) => ({
    i: anchor.i + p.i,
    j: anchor.j + p.j,
  }));

  const ports = recipe.relativePorts.map((p) => ({
    i: anchor.i + p.i,
    j: anchor.j + p.j,
    dirI: p.dirI,
    dirJ: p.dirJ,
    role: p.role,
  }));

  const req: ReservationRequest = {
    id: instanceId,
    kind: "assembly",
    priority: 8,
    footprint,
    buffer,
    ports,
  };

  if (!reservations.canReserve(req).ok) {
    return { ok: false, parts: [] };
  }

  const success = reservations.reserve(req);
  if (!success) {
    return { ok: false, parts: [] };
  }

  const parts = recipe.parts.map((p) => ({
    kind: p.kind,
    i: anchor.i + p.relI,
    j: anchor.j + p.relJ,
    dirI: p.dirI,
    dirJ: p.dirJ,
  }));

  return {
    ok: true,
    reservationId: instanceId,
    parts,
  };
}
