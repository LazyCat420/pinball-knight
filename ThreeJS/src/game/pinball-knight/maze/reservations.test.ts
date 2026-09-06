import { describe, it, expect } from "vitest";
import { ReservationGrid, type ReservationRequest } from "./reservations";

describe("Phase 3 — ReservationGrid & Clearance Claims", () => {
  it("grants and tracks a basic footprint reservation", () => {
    const grid = new ReservationGrid(20, 20);
    const req: ReservationRequest = {
      id: "chute-1",
      kind: "launch",
      priority: 10,
      footprint: [
        { i: 2, j: 2 },
        { i: 2, j: 3 },
        { i: 2, j: 4 },
      ],
    };

    expect(grid.canReserve(req).ok).toBe(true);
    expect(grid.reserve(req)).toBe(true);

    expect(grid.isFootprintOccupied(2, 3)).toBe(true);
    expect(grid.isFootprintOccupied(5, 5)).toBe(false);

    const claims = grid.getClaimsAt(2, 3);
    expect(claims.length).toBe(1);
    expect(claims[0].owner).toBe("chute-1");
  });

  it("rejects overlapping footprint claims on immutable higher-priority elements", () => {
    const grid = new ReservationGrid(20, 20);
    grid.reserve({
      id: "chute-1",
      kind: "launch",
      priority: 10,
      mutable: false,
      footprint: [{ i: 5, j: 5 }],
    });

    const conflict: ReservationRequest = {
      id: "corner-booster",
      kind: "piece",
      priority: 3,
      footprint: [{ i: 5, j: 5 }],
    };

    expect(grid.canReserve(conflict).ok).toBe(false);
    expect(grid.reserve(conflict)).toBe(false);
  });

  it("protects clearance buffers to prevent corner clumping", () => {
    const grid = new ReservationGrid(20, 20);

    // Corner piece reserves tile (5, 5) with a 1-tile clearance buffer around it
    const cornerReq: ReservationRequest = {
      id: "deflector-corner",
      kind: "piece",
      priority: 5,
      footprint: [{ i: 5, j: 5 }],
      buffer: [
        { i: 4, j: 5 },
        { i: 6, j: 5 },
        { i: 5, j: 4 },
        { i: 5, j: 6 },
        { i: 4, j: 4 },
      ],
    };
    expect(grid.reserve(cornerReq)).toBe(true);

    // Another pass tries to place a bumper at adjacent tile (4, 4) in the same crook
    const clumpingPiece: ReservationRequest = {
      id: "loose-bumper",
      kind: "piece",
      priority: 2,
      footprint: [{ i: 4, j: 4 }],
    };

    // Should be rejected because (4, 4) is inside the deflector's clearance buffer!
    const check = grid.canReserve(clumpingPiece);
    expect(check.ok).toBe(false);
    expect(check.conflictWith).toContain("deflector-corner");
    expect(grid.reserve(clumpingPiece)).toBe(false);

    // But placing outside the buffer (e.g. at (8, 8)) succeeds
    const farPiece: ReservationRequest = {
      id: "far-bumper",
      kind: "piece",
      priority: 2,
      footprint: [{ i: 8, j: 8 }],
    };
    expect(grid.reserve(farPiece)).toBe(true);
  });

  it("releases claims cleanly on release()", () => {
    const grid = new ReservationGrid(20, 20);
    grid.reserve({
      id: "temp-piece",
      kind: "repair",
      priority: 1,
      footprint: [{ i: 7, j: 7 }],
      buffer: [{ i: 7, j: 8 }],
    });

    expect(grid.isFootprintOccupied(7, 7)).toBe(true);
    expect(grid.isBufferOccupied(7, 8)).toBe(true);

    expect(grid.release("temp-piece")).toBe(true);
    expect(grid.isFootprintOccupied(7, 7)).toBe(false);
    expect(grid.isBufferOccupied(7, 8)).toBe(false);
  });
});
