import { describe, it, expect } from "vitest";
import { PIECE_CONTRACTS, validatePiecePlacement, type PlacedPartRef } from "./piece-contracts";
import type { Socket } from "./sockets";

describe("Phase 5 — Piece Contracts & Validation", () => {
  const turnSocketWithWall: Socket = {
    id: "turn-1",
    role: "turn",
    anchor: { i: 5, j: 5 },
    tiles: [{ i: 5, j: 5 }],
    width: 1,
    length: 1,
    clearance: 3,
    wallBacking: "wall",
  };

  const straightSocket: Socket = {
    id: "straight-1",
    role: "straight",
    anchor: { i: 10, j: 5 },
    tiles: [{ i: 10, j: 5 }],
    width: 1,
    length: 5,
    clearance: 3,
    wallBacking: "wall",
  };

  it("enforces that deflectors ONLY accept turn sockets with solid wall backing", () => {
    const contract = PIECE_CONTRACTS.deflector;

    // Straight socket rejected
    const check1 = validatePiecePlacement(contract, straightSocket, []);
    expect(check1.legal).toBe(false);
    expect(check1.reason).toContain("Socket role");

    // Turn socket with wall backing accepted
    const check2 = validatePiecePlacement(contract, turnSocketWithWall, [], 3);
    expect(check2.legal).toBe(true);

    // Turn socket with open backing rejected
    const openTurn: Socket = { ...turnSocketWithWall, wallBacking: "open" };
    const check3 = validatePiecePlacement(contract, openTurn, [], 3);
    expect(check3.legal).toBe(false);
    expect(check3.reason).toContain("Requires backing");
  });

  it("prevents corner clumping by rejecting conflicting pieces in the same corner", () => {
    const boostContract = PIECE_CONTRACTS.boostcorner;

    // Suppose an existing deflector is at (5, 5)
    const existingParts: PlacedPartRef[] = [{ kind: "deflector", i: 5, j: 5 }];

    // Another pass tries to place a boostcorner at adjacent tile (5, 6) in the same corner
    const adjacentSocket: Socket = {
      id: "turn-adj",
      role: "turn",
      anchor: { i: 5, j: 6 },
      tiles: [{ i: 5, j: 6 }],
      width: 1,
      length: 1,
      clearance: 3,
      wallBacking: "wall",
    };

    const check = validatePiecePlacement(boostContract, adjacentSocket, existingParts, 3);
    expect(check.legal).toBe(false);
    expect(check.reason).toContain("Conflicting piece 'deflector'");
  });

  it("enforces minimum runway requirements for launchers", () => {
    const boostContract = PIECE_CONTRACTS.boostcorner;

    // 1 tile runway is too short (wants 3)
    const shortCheck = validatePiecePlacement(boostContract, turnSocketWithWall, [], 1);
    expect(shortCheck.legal).toBe(false);
    expect(shortCheck.reason).toContain("Insufficient runway");

    // 3 tile runway passes
    const goodCheck = validatePiecePlacement(boostContract, turnSocketWithWall, [], 3);
    expect(goodCheck.legal).toBe(true);
  });
});
