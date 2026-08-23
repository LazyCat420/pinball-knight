/**
 * DOORWAYS — the unit half. `floor-rules.test.ts` runs the pass over real
 * generated floors; this pins the pieces on grids small enough to read, and
 * every case below is one that actually went wrong while building it.
 */
import { describe, it, expect } from "vitest";
import { type Grid, T_FLOOR, T_WALL, T_CRACKED, at, idx, setTile, setShape, isWalkable } from "./generator";
import { SHAPE_ARC, SHAPE_SLANT_NE } from "../engine/tile-shape";
import {
  clearanceField,
  widthFromClearance,
  labelSections,
  sectionTerritory,
  planDoorways,
  resolveDoorway,
  carveDoorways,
  measureDoorway,
  doorwayFootprint,
  doorwayWidthFor,
  siteWidth,
  arcSpanMask,
  DOORWAY_WIDTHS,
  MIN_DOORWAY_WIDTH,
  MAX_DOORWAY_DEPTH,
} from "./doorways";

/** A solid grid; callers punch the floor they want into it. */
function solid(w: number, h: number): Grid {
  const g: Grid = { w, h, t: new Uint8Array(w * h).fill(T_WALL), shapes: new Uint8Array(w * h) };
  return g;
}

function rect(g: Grid, x0: number, y0: number, x1: number, y1: number): void {
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) setTile(g, i, j, T_FLOOR);
}

/**
 * Two rooms separated by a `thick`-column wall with a slot of height `slot` cut
 * through it. The canonical shape this whole module exists for.
 *
 * The wall is TWO tiles thick by default, and that is not an arbitrary fixture
 * choice — a one-tile partition cannot hold a doorway at all. Every tile of it
 * already has open floor on both sides, so cutting a hole gives its neighbours
 * a third open side and `removeWallStubs` eats the entire wall. The generator
 * has always behaved this way; `jambsSurvive` is what stops this pass from
 * authoring a "doorway" that is really a wall about to disappear.
 */
const ROOM_W = 11;
const WALL_X = 1 + ROOM_W;

function twoRooms(slot = 1, thick = 2): Grid {
  const w = 2 + ROOM_W * 2 + thick;
  const g = solid(w, 21);
  rect(g, 1, 1, WALL_X - 1, 19);
  rect(g, WALL_X + thick, 1, w - 2, 19);
  const y0 = 10 - Math.floor((slot - 1) / 2);
  for (let d = 0; d < thick; d++) {
    for (let j = y0; j < y0 + slot; j++) setTile(g, WALL_X + d, j, T_FLOOR);
  }
  return g;
}

/** Both wall columns of `twoRooms`, over the rows a doorway could use. */
function wallTiles(thick = 2): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let d = 0; d < thick; d++) for (let j = 1; j <= 19; j++) out.push([WALL_X + d, j]);
  return out;
}

describe("clearance", () => {
  it("measures the widest circle that fits, not the distance to any one wall", () => {
    // A 1-wide corridor and a 3-wide one both have every tile touching a wall.
    // Reading clearance off a single tile's neighbours cannot tell them apart —
    // this is the measurement mistake DOORWAY_PLAN §1 records twice.
    const g = solid(21, 11);
    rect(g, 1, 5, 19, 5); // 1 wide
    rect(g, 1, 8, 19, 8);
    rect(g, 1, 9, 19, 9);
    rect(g, 1, 10, 19, 10); // hard against the border, 3 wide upward
    const cl = clearanceField(g);
    expect(widthFromClearance(cl[idx(g, 10, 5)])).toBe(1);
    expect(widthFromClearance(cl[idx(g, 10, 9)])).toBe(3);
  });

  it("gives wall tiles zero and never reports below one tile of passage", () => {
    const g = twoRooms();
    const cl = clearanceField(g);
    expect(cl[idx(g, 0, 0)]).toBe(0);
    expect(widthFromClearance(cl[idx(g, 12, 10)])).toBe(1);
  });
});

describe("sections", () => {
  it("labels only the spaces, and drops pockets too small to be a place", () => {
    const g = solid(40, 21);
    rect(g, 1, 1, 12, 19); // a room
    rect(g, 25, 1, 38, 19); // another
    rect(g, 13, 10, 24, 10); // a 1-wide corridor between them
    rect(g, 18, 8, 20, 12); // a small bulge on the corridor
    const sec = labelSections(g, clearanceField(g));
    expect(sec.sizes.length).toBe(2);
    // The corridor and its bulge belong to neither — that is what makes a
    // doorway "between section 0 and section 1" rather than a local fact.
    expect(sec.label[idx(g, 18, 10)]).toBe(-1);
  });

  it("partitions corridor space between the sections it belongs to", () => {
    const g = solid(40, 21);
    rect(g, 1, 1, 12, 19);
    rect(g, 25, 1, 38, 19);
    rect(g, 13, 10, 24, 10);
    const sec = labelSections(g, clearanceField(g));
    const own = sectionTerritory(g, sec);
    expect(own[idx(g, 14, 10)]).toBe(sec.label[idx(g, 6, 10)]);
    expect(own[idx(g, 23, 10)]).toBe(sec.label[idx(g, 32, 10)]);
    expect(own[idx(g, 0, 0)]).toBe(-1); // wall belongs to nobody
  });
});

describe("planning", () => {
  it("puts one doorway on the connection between two rooms", () => {
    const g = twoRooms();
    const sites = planDoorways(g);
    expect(sites.length).toBe(1);
    expect(sites[0].i).toBe(12);
    // The width is measured ACROSS the slot: the slot runs north-south through a
    // vertical wall, so travel is east-west.
    expect(Math.abs(sites[0].ai)).toBe(1);
    expect(Math.abs(sites[0].wj)).toBe(1);
  });

  it("gives two rooms joined by two corridors a door on each", () => {
    // The per-PAIR rule would author one and leave the other squeeze alone —
    // measured on real floors, that is what made the pass a no-op.
    const g = solid(40, 31);
    rect(g, 1, 1, 12, 29);
    rect(g, 25, 1, 38, 29);
    rect(g, 13, 8, 24, 8);
    rect(g, 13, 22, 24, 22);
    const sites = planDoorways(g);
    expect(sites.length).toBe(2);
    expect(new Set(sites.map((s) => s.j))).toEqual(new Set([8, 22]));
  });

  it("sizes the opening from the smaller of the two rooms it joins", () => {
    expect(doorwayWidthFor(10)).toBe(3);
    expect(doorwayWidthFor(120)).toBe(5);
    expect(doorwayWidthFor(400)).toBe(7);
    // Every tier is a member of the vocabulary — a size that is not is an
    // opening the player cannot learn to recognise.
    for (const w of [10, 120, 400, 0, 1e6]) expect(DOORWAY_WIDTHS).toContain(doorwayWidthFor(w));
  });
});

describe("carving", () => {
  it("widens a one-tile slot to the vocabulary and leaves the jambs standing", () => {
    const g = twoRooms();
    const { doorways } = carveDoorways(g, planDoorways(g));
    expect(doorways.length).toBe(1);
    const d = doorways[0];
    expect(DOORWAY_WIDTHS).toContain(d.w);
    expect(measureDoorway(g, d)).toBe(d.w);
    expect(d.carved).toBeGreaterThan(0);
    // A doorway is a hole in a wall, so there is still a wall.
    const half = (d.w - 1) / 2;
    expect(isWalkable(g, 12, 10 - half - 1)).toBe(false);
    expect(isWalkable(g, 12, 10 + half + 1)).toBe(false);
  });

  it("only ever converts wall to floor", () => {
    const g = twoRooms();
    const before = [...g.t];
    carveDoorways(g, planDoorways(g));
    for (let k = 0; k < g.t.length; k++) {
      if (before[k] === T_FLOOR) expect(g.t[k]).toBe(T_FLOOR);
    }
  });

  it("rounds an opening the maze left at four tiles UP to five", () => {
    // The heart of "a vocabulary, not a minimum". A 4-tile gap already clears
    // any minimum worth having and still reads as an absence of wall.
    const g = twoRooms(4);
    const { doorways } = carveDoorways(g, planDoorways(g));
    expect(doorways.length).toBe(1);
    expect(doorways[0].w).toBe(5);
    expect(measureDoorway(g, doorways[0])).toBe(5);
  });

  it("authors nothing where the two spaces have simply merged", () => {
    // A 15-tile-wide meeting is not a threshold. Two things stop a door being
    // authored there and both are load-bearing: the clearance field runs
    // straight through the gap so the rooms are ONE section with no pair to
    // join, and — for the case where a wall island keeps them separate — the
    // opening measures wider than the vocabulary and is reported `merged`.
    const g = twoRooms(15);
    expect(labelSections(g, clearanceField(g)).sizes.length).toBe(1);
    expect(planDoorways(g)).toEqual([]);

    const wide = twoRooms(1);
    const site = { ...planDoorways(wide)[0], i: 6, j: 10 }; // out in the room
    const res = carveDoorways(wide, [site]);
    expect(res.doorways).toEqual([]);
    expect(res.merged).toBe(1);
    expect(res.blocked).toBe(0);
  });

  it("declines a squeeze whose walls are too long to be a threshold", () => {
    // A 1-wide corridor eight tiles long is a corridor. Widening it would be
    // widening the maze, which is how the first attempt carved floors open.
    const g = twoRooms(1, MAX_DOORWAY_DEPTH * 2 + 4);
    const res = carveDoorways(g, planDoorways(g));
    expect(res.doorways).toEqual([]);
    expect(res.blocked).toBe(1);
    expect(res.rejects.throat).toBe(1);
  });

  it("refuses a secret wall — announcing it is the opposite of a secret", () => {
    const g = twoRooms();
    for (const [i, j] of wallTiles()) if (at(g, i, j) === T_WALL) setTile(g, i, j, T_CRACKED);
    const res = carveDoorways(g, planDoorways(g));
    expect(res.doorways).toEqual([]);
    expect(res.rejects.secret).toBe(1);
  });

  it("refuses a published arc rim — cutting one leaves a curve with a hole in it", () => {
    const g = twoRooms();
    for (const [i, j] of wallTiles()) if (at(g, i, j) === T_WALL) setShape(g, i, j, SHAPE_ARC);
    const res = carveDoorways(g, planDoorways(g));
    expect(res.doorways).toEqual([]);
    expect(res.rejects.arc).toBe(1);
  });

  it("refuses a bevel leg, which would leave a diagonal face floating", () => {
    const g = twoRooms();
    for (const [i, j] of wallTiles()) if (at(g, i, j) === T_WALL) setShape(g, i, j, SHAPE_SLANT_NE);
    expect(carveDoorways(g, planDoorways(g)).rejects.bevel).toBe(1);
  });

  it("refuses to cut where the drawn span of an arc needs the stone", () => {
    // The failure that sank the second attempt: `publishArcs` claims only tiles
    // that are wall at stamp time, so OWNERSHIP is never the problem — the
    // drawn span covers tiles the feature never claimed, and cutting one of
    // those un-backs geometry the renderer is already drawing.
    const g = twoRooms();
    const spanMask = new Uint8Array(g.w * g.h);
    for (const [i, j] of wallTiles()) spanMask[idx(g, i, j)] = 1;
    const res = carveDoorways(g, planDoorways(g), { spanMask });
    expect(res.doorways).toEqual([]);
    expect(res.rejects.span).toBe(1);
  });

  it("builds the span mask from what the backing check SAMPLES, not from what the feature owns", () => {
    // A convex feature's backing sits 0.6 tiles inside its radius; the tiles it
    // owns start 2.0 inside. Guarding ownership guards the wrong band.
    const g = solid(30, 30);
    g.arcs = [{ cx: 15, cz: 15, r: 8, a0: 0, span: Math.PI / 2 }];
    g.arcIdx = new Int16Array(g.w * g.h).fill(-1);
    const mask = arcSpanMask(g);
    expect(mask[idx(g, Math.floor(15 + 7.4), 15)]).toBe(1); // r − 0.6 at angle 0
    expect(mask[idx(g, Math.floor(15 + 5.5), 15)]).toBe(0); // deep in the owned band
  });
});

describe("measurement", () => {
  it("reads the narrowest cross-section of the authored throat", () => {
    const g = twoRooms(1, 4);
    const { doorways } = carveDoorways(g, planDoorways(g));
    expect(doorways.length).toBe(1);
    const d = doorways[0];
    expect(d.back + d.fwd).toBeGreaterThan(0); // a throat with depth
    expect(measureDoorway(g, d)).toBe(d.w);
  });

  it("never reports an authored doorway below the minimum", () => {
    for (const slot of [1, 2, 3, 4, 5, 6, 7]) {
      const g = twoRooms(slot);
      const { doorways } = carveDoorways(g, planDoorways(g));
      for (const d of doorways) expect(measureDoorway(g, d)).toBeGreaterThanOrEqual(MIN_DOORWAY_WIDTH);
    }
  });

  it("records the SLID centre, not the planned one", () => {
    // Sliding and then reporting the plan's centre ships a doorway whose
    // footprint is measured from a tile the carve never touched. It threw on
    // the first render because the footprint ran off the grid.
    const g = twoRooms();
    const sites = planDoorways(g);
    const slid = { ...sites[0], j: 2 }; // hard against the top, must slide down
    const d = resolveDoorway(g, slid);
    expect(d).not.toBeNull();
    for (const t of doorwayFootprint(g, d!)) {
      expect(t.i).toBeGreaterThan(0);
      expect(t.j).toBeGreaterThan(0);
      expect(t.i).toBeLessThan(g.w - 1);
      expect(t.j).toBeLessThan(g.h - 1);
    }
  });

  it("reports the opening's current width across the passage", () => {
    const g = twoRooms(3);
    const site = planDoorways(g)[0];
    expect(siteWidth(g, site)).toBe(3);
  });
});

describe("determinism", () => {
  it("plans the same doorways twice — two co-op peers must agree", () => {
    const a = twoRooms();
    const b = twoRooms();
    expect(JSON.stringify(planDoorways(a))).toBe(JSON.stringify(planDoorways(b)));
  });

  it("re-planning after carving does not manufacture new doorways", () => {
    // THE v1 FAILURE, pinned. Deciding what counts as a room from clearance
    // re-derived after each carve promotes the corridor beyond a widened
    // opening into a room, which manufactures a fresh doorway: 34 → 107 per
    // floor. Sections are labelled once for exactly this reason, so a second
    // pass over the carved floor must find no more work.
    const g = twoRooms();
    setTile(g, WALL_X, 5, T_FLOOR);
    setTile(g, WALL_X + 1, 5, T_FLOOR);
    setTile(g, WALL_X, 15, T_FLOOR);
    setTile(g, WALL_X + 1, 15, T_FLOOR);
    const first = carveDoorways(g, planDoorways(g));
    expect(first.doorways.length).toBeGreaterThanOrEqual(2);
    const second = carveDoorways(g, planDoorways(g));
    expect(second.doorways.reduce((s, d) => s + d.carved, 0)).toBe(0);
  });
});
