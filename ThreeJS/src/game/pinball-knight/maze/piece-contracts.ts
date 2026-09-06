/**
 * PIECE CONTRACTS — Declarative requirements, clearance, and conflict definitions.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * In legacy generation, part placement logic was spread across dozens of ad-hoc
 * `if (kind === "boostcorner")`, `if (p.kind === "flipper")`, and hard-coded
 * spacing checks scattered across `decorate.ts`, `piece-rules.ts`, and `flow-loops.ts`.
 *
 * Piece contracts centralize:
 *   1. Compatible socket roles (e.g. `deflector` ONLY accepts `turn` sockets).
 *   2. Wall-backing prerequisites (e.g. `deflector` requires solid wall backing).
 *   3. Minimum run-out requirements (e.g. `boostcorner` requires >= 3 open runway tiles).
 *   4. Explicit conflict sets (e.g. forbidding another corner launcher within Chebyshev <= 2).
 *   5. Clearance buffer radius for reservation.
 */
import type { Socket, SocketRole } from "./sockets";
import type { TilePos } from "./generator";

export interface PlacementContext {
  socket: Socket;
  distanceToStairs?: number;
  openRunwayAhead?: number;
}

export interface PieceContract {
  id: string;
  accepts: readonly SocketRole[];
  requiredBacking?: "wall" | "open" | "sealed";
  minRunout?: number;
  bufferRadius: number;
  conflicts: readonly string[];
  isLauncher: boolean;
  createsLoopRisk: boolean;
  score(ctx: PlacementContext): number;
}

export const PIECE_CONTRACTS: Record<string, PieceContract> = {
  deflector: {
    id: "deflector",
    accepts: ["turn"],
    requiredBacking: "wall",
    minRunout: 2,
    bufferRadius: 2,
    conflicts: ["deflector", "boostcorner", "flipper", "bumper"],
    isLauncher: false,
    createsLoopRisk: false,
    score: (ctx) => (ctx.socket.wallBacking === "wall" ? 100 : 0),
  },

  boostcorner: {
    id: "boostcorner",
    accepts: ["turn"],
    requiredBacking: "wall",
    minRunout: 3,
    bufferRadius: 2,
    conflicts: ["boostcorner", "deflector", "flipper", "spring"],
    isLauncher: true,
    createsLoopRisk: true,
    score: (ctx) => (ctx.openRunwayAhead && ctx.openRunwayAhead >= 3 ? 120 : 0),
  },

  booster: {
    id: "booster",
    accepts: ["straight", "spine", "launch"],
    minRunout: 3,
    bufferRadius: 1,
    conflicts: ["spring"],
    isLauncher: true,
    createsLoopRisk: true,
    score: (ctx) => (ctx.socket.role === "spine" ? 150 : 80),
  },

  flipper: {
    id: "flipper",
    accepts: ["junction", "turn", "straight"],
    minRunout: 3,
    bufferRadius: 2,
    conflicts: ["flipper"],
    isLauncher: true,
    createsLoopRisk: true,
    score: () => 90,
  },

  slingshot: {
    id: "slingshot",
    accepts: ["straight", "junction"],
    minRunout: 2,
    bufferRadius: 1,
    conflicts: ["slingshot"],
    isLauncher: true,
    createsLoopRisk: false,
    score: () => 70,
  },

  bumper: {
    id: "bumper",
    accepts: ["junction", "arena", "straight"],
    bufferRadius: 1,
    conflicts: [],
    isLauncher: false,
    createsLoopRisk: false,
    score: (ctx) => (ctx.socket.role === "junction" ? 100 : 50),
  },

  spring: {
    id: "spring",
    accepts: ["bowl"],
    requiredBacking: "wall",
    minRunout: 2,
    bufferRadius: 2,
    conflicts: ["spring", "booster", "boostcorner"],
    isLauncher: true,
    createsLoopRisk: false,
    score: () => 110,
  },

  ramp: {
    id: "ramp",
    accepts: ["straight", "spine"],
    minRunout: 3,
    bufferRadius: 1,
    conflicts: [],
    isLauncher: true,
    createsLoopRisk: true,
    score: () => 85,
  },
};

export interface PlacedPartRef {
  kind: string;
  i: number;
  j: number;
}

/**
 * Validates whether a candidate piece can legally bind to a socket without
 * violating backing, clearance, runway, or neighbor conflicts.
 */
export function validatePiecePlacement(
  contract: PieceContract,
  socket: Socket,
  existingParts: readonly PlacedPartRef[],
  openRunwayAhead?: number,
): { legal: boolean; reason?: string } {
  // 1. Check socket role compatibility
  if (!contract.accepts.includes(socket.role)) {
    return { legal: false, reason: `Socket role '${socket.role}' not accepted by '${contract.id}'` };
  }

  // 2. Check wall backing requirement
  if (contract.requiredBacking && socket.wallBacking !== contract.requiredBacking) {
    return { legal: false, reason: `Requires backing '${contract.requiredBacking}', got '${socket.wallBacking}'` };
  }

  // 3. Check minimum run-out
  if (contract.minRunout && openRunwayAhead !== undefined && openRunwayAhead < contract.minRunout) {
    return { legal: false, reason: `Insufficient runway: ${openRunwayAhead} < ${contract.minRunout}` };
  }

  // 4. Check conflicting neighboring pieces
  for (const part of existingParts) {
    const chebyshev = Math.max(Math.abs(part.i - socket.anchor.i), Math.abs(part.j - socket.anchor.j));
    if (chebyshev <= contract.bufferRadius) {
      if (contract.conflicts.includes(part.kind)) {
        return { legal: false, reason: `Conflicting piece '${part.kind}' within distance ${chebyshev}` };
      }
    }
  }

  return { legal: true };
}
