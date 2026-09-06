import { describe, it, expect } from "vitest";
import { extractSockets } from "./sockets";
import { buildTrackFloor } from "./track-floor";
import { floorRng } from "./floor-seed";
import { archetypeFor } from "./archetypes";
import { levelConfig } from "../constants";

describe("Phase 4 — Semantic Socket Extraction", () => {
  it("extracts non-overlapping sockets deterministically from track topology", () => {
    const level = 3;
    const seed = 42;
    const cfg = levelConfig(level);
    const arch = archetypeFor(level);
    const rng = floorRng(seed, level);

    const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
      profile: arch.track,
      density: 0.5,
    });
    expect(track).not.toBeNull();
    if (!track) return;

    const graph1 = extractSockets(track.grid, track, track.doorways);
    const graph2 = extractSockets(track.grid, track, track.doorways);

    // Determinism
    expect(graph1.sockets.length).toBe(graph2.sockets.length);
    expect(graph1.sockets.length).toBeGreaterThan(10);

    // Roles present
    expect(graph1.byRole.turn.length).toBeGreaterThan(0);
    expect(graph1.byRole.straight.length).toBeGreaterThan(0);

    // Invariant: No tile is claimed by multiple sockets
    const seenTiles = new Set<number>();
    for (const s of graph1.sockets) {
      for (const t of s.tiles) {
        const k = t.j * graph1.w + t.i;
        expect(seenTiles.has(k)).toBe(false);
        seenTiles.add(k);
      }
    }
  });

  it("extracts exactly one turn socket for a single 90-degree corner", () => {
    const level = 1;
    const seed = 1;
    const cfg = levelConfig(level);
    const arch = archetypeFor(level);
    const rng = floorRng(seed, level);

    const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
      profile: arch.track,
      density: 0.5,
    });
    expect(track).not.toBeNull();
    if (!track) return;

    const graph = extractSockets(track.grid, track, track.doorways);
    const turns = graph.getSocketsByRole("turn");
    expect(turns.length).toBeGreaterThan(0);

    for (const turn of turns) {
      expect(turn.tiles.length).toBe(1);
      expect(turn.direction).toBeDefined();
      expect(turn.direction2).toBeDefined();
      // Ensure perpendicular directions
      const dot = turn.direction!.di * turn.direction2!.di + turn.direction!.dj * turn.direction2!.dj;
      expect(Math.abs(dot)).toBe(0);
    }
  });
});
