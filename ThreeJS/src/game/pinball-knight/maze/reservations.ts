/**
 * RESERVATION GRID — Deterministic transaction-style placement & clearance layer.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The raw terrain grid cannot distinguish between:
 *   1. Walkable floor reserved for a high-speed launch chute runout
 *   2. Walkable floor reserved for a 90-degree flipper swing arc
 *   3. Walkable floor that is a general corridor open for random furniture
 *
 * Without this layer, multiple independent passes (spine stations, room orbits,
 * loose corridor deals, assembly stamps) scan raw walkable tiles and place
 * parts on adjacent or overlapping crooks, manufacturing corner clumping,
 * steer-lock jams, and unbacked wall fragments.
 *
 * This module enforces strict ownership transactions:
 *   - Mandatory features (chute, spine, stairs, flipper returns) claim first.
 *   - Optional features claim ONLY in unclaimed compatible sockets.
 *   - Footprint + clearance buffer claims prevent crowding within Chebyshev <= 2.
 */
import type { TilePos } from "./generator";

export type ClaimKind = "track" | "launch" | "room" | "assembly" | "piece" | "repair";

export interface TileClaim {
  owner: string;
  kind: ClaimKind;
  priority: number;
  mutable: boolean;
  isBuffer: boolean;
}

export interface Port {
  i: number;
  j: number;
  dirI: number;
  dirJ: number;
  role: "in" | "out" | "bidirectional";
}

export interface ReservationRequest {
  id: string;
  kind: ClaimKind;
  priority?: number;
  mutable?: boolean;
  footprint: TilePos[];
  buffer?: TilePos[];
  ports?: Port[];
}

export interface Reservation {
  id: string;
  kind: ClaimKind;
  priority: number;
  mutable: boolean;
  footprint: TilePos[];
  buffer: TilePos[];
  ports: Port[];
}

export class ReservationGrid {
  readonly w: number;
  readonly h: number;
  private readonly claims: Array<TileClaim[] | null>;
  private readonly reservations: Map<string, Reservation> = new Map();

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.claims = new Array(w * h).fill(null);
  }

  private idx(i: number, j: number): number {
    return j * this.w + i;
  }

  inBounds(i: number, j: number): boolean {
    return i >= 0 && i < this.w && j >= 0 && j < this.h;
  }

  /**
   * Check if a reservation request can be granted without conflict.
   */
  canReserve(req: ReservationRequest): { ok: boolean; conflictWith?: string } {
    const priority = req.priority ?? 1;

    // Check footprint
    for (const t of req.footprint) {
      if (!this.inBounds(t.i, t.j)) return { ok: false, conflictWith: "out_of_bounds" };
      const tileClaims = this.claims[this.idx(t.i, t.j)];
      if (tileClaims) {
        for (const c of tileClaims) {
          if (c.owner === req.id) continue;
          // Direct footprint overlap is forbidden unless target is mutable and lower priority
          if (!c.isBuffer) {
            if (!c.mutable || c.priority >= priority) {
              return { ok: false, conflictWith: c.owner };
            }
          } else {
            // Overlapping another feature's clearance buffer
            if (c.priority >= priority) {
              return { ok: false, conflictWith: `${c.owner}:buffer` };
            }
          }
        }
      }
    }

    // Check buffer
    if (req.buffer) {
      for (const t of req.buffer) {
        if (!this.inBounds(t.i, t.j)) continue;
        const tileClaims = this.claims[this.idx(t.i, t.j)];
        if (tileClaims) {
          for (const c of tileClaims) {
            if (c.owner === req.id) continue;
            // Buffer cannot collide with an existing mandatory/immutable footprint
            if (!c.isBuffer && !c.mutable && c.priority >= priority) {
              return { ok: false, conflictWith: `${c.owner}:footprint` };
            }
          }
        }
      }
    }

    return { ok: true };
  }

  /**
   * Commit a reservation transactionally.
   * Returns true on success, false if rejected.
   */
  reserve(req: ReservationRequest): boolean {
    const check = this.canReserve(req);
    if (!check.ok) return false;

    const priority = req.priority ?? 1;
    const mutable = req.mutable ?? false;
    const buffer = req.buffer ?? [];
    const ports = req.ports ?? [];

    // Register reservation
    const res: Reservation = {
      id: req.id,
      kind: req.kind,
      priority,
      mutable,
      footprint: req.footprint.slice(),
      buffer: buffer.slice(),
      ports: ports.slice(),
    };
    this.reservations.set(req.id, res);

    // Apply footprint claims
    for (const t of req.footprint) {
      const k = this.idx(t.i, t.j);
      let list = this.claims[k];
      if (!list) {
        list = [];
        this.claims[k] = list;
      }
      list.push({
        owner: req.id,
        kind: req.kind,
        priority,
        mutable,
        isBuffer: false,
      });
    }

    // Apply buffer claims
    for (const t of buffer) {
      if (!this.inBounds(t.i, t.j)) continue;
      const k = this.idx(t.i, t.j);
      let list = this.claims[k];
      if (!list) {
        list = [];
        this.claims[k] = list;
      }
      list.push({
        owner: req.id,
        kind: req.kind,
        priority,
        mutable,
        isBuffer: true,
      });
    }

    return true;
  }

  /**
   * Release an existing reservation and remove its tile claims.
   */
  release(id: string): boolean {
    const res = this.reservations.get(id);
    if (!res) return false;

    this.reservations.delete(id);

    // Remove from footprint
    for (const t of res.footprint) {
      const k = this.idx(t.i, t.j);
      const list = this.claims[k];
      if (list) {
        const filtered = list.filter((c) => c.owner !== id);
        this.claims[k] = filtered.length > 0 ? filtered : null;
      }
    }

    // Remove from buffer
    for (const t of res.buffer) {
      if (!this.inBounds(t.i, t.j)) continue;
      const k = this.idx(t.i, t.j);
      const list = this.claims[k];
      if (list) {
        const filtered = list.filter((c) => c.owner !== id);
        this.claims[k] = filtered.length > 0 ? filtered : null;
      }
    }

    return true;
  }

  getClaimsAt(i: number, j: number): readonly TileClaim[] {
    if (!this.inBounds(i, j)) return [];
    return this.claims[this.idx(i, j)] ?? [];
  }

  getReservation(id: string): Reservation | undefined {
    return this.reservations.get(id);
  }

  isFootprintOccupied(i: number, j: number): boolean {
    if (!this.inBounds(i, j)) return true;
    const list = this.claims[this.idx(i, j)];
    return list ? list.some((c) => !c.isBuffer) : false;
  }

  isBufferOccupied(i: number, j: number): boolean {
    if (!this.inBounds(i, j)) return true;
    const list = this.claims[this.idx(i, j)];
    return list ? list.some((c) => c.isBuffer) : false;
  }
}
