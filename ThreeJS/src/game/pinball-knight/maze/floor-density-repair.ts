import { type LevelPlan, isStructuralPart } from "./decorate";
import { DEFAULT_DENSITY } from "./floor-density";
import type { TilePos } from "./generator";

/** Enforce live legibility bounds after every content pass, without RNG draws.
 * Remove only surplus ambient content; connected machines, routes, rooms,
 * authored spawn anchors and the lamp puzzle retain their authored members. */
export function repairFloorDensity(plan: LevelPlan, walkable: number, spawnAnchors: readonly TilePos[] = []) {
  const removedParts: TilePos[] = [];
  const removedSpawns: TilePos[] = [];
  const inRoom = (p: TilePos): boolean => plan.rooms.some(r =>
    p.i >= r.i0 && p.i < r.i0 + r.w && p.j >= r.j0 && p.j < r.j0 + r.h);
  const routeCount = plan.parts.filter(p => p.spine).length;
  // Do not disguise a missing route by deleting the entire floor's content.
  const routeLimit = routeCount ? Math.floor(routeCount / DEFAULT_DENSITY.minRouteShare) : plan.parts.length;
  for (let i = plan.parts.length - 1; i >= 0 && plan.parts.length > routeLimit; i--) {
    const p = plan.parts[i];
    if (p.kind === "lamp" || inRoom(p) || isStructuralPart(p)) continue;
    removedParts.push({ i: p.i, j: p.j });
    plan.parts.splice(i, 1);
  }

  const furniture = plan.parts.length + plan.torches.length + plan.props.length + plan.items.length;
  const spawnLimit = Math.max(0, Math.min(
    Math.floor(walkable * DEFAULT_DENSITY.maxSpawnsPer1k / 1000),
    Math.floor(walkable * DEFAULT_DENSITY.maxFurniturePer1k / 1000) - furniture,
  ));
  const protectedSpawns = new Set(spawnAnchors.map(p => `${p.i},${p.j}`));
  for (let i = plan.spawns.length - 1; i >= 0 && plan.spawns.length > spawnLimit; i--) {
    const p = plan.spawns[i];
    if (inRoom(p) || protectedSpawns.has(`${p.i},${p.j}`)) continue;
    removedSpawns.push({ i: p.i, j: p.j });
    plan.spawns.splice(i, 1);
  }
  return { removedParts, removedSpawns };
}
