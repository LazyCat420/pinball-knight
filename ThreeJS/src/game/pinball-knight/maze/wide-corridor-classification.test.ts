import { describe, expect, it } from "vitest";
import { type Grid, setTile, T_FLOOR } from "./generator";
import { analyzePatternGrammar, straightCorridor } from "./pattern-grammar";
import { extractSockets } from "./sockets";

function corridor(vertical: boolean): Grid {
  const g: Grid = { w: 11, h: 11, t: new Uint8Array(121), shapes: new Uint8Array(121) };
  for (let along = 1; along <= 9; along++) {
    for (let across = 4; across <= 6; across++) {
      setTile(g, vertical ? across : along, vertical ? along : across, T_FLOOR);
    }
  }
  return g;
}

describe("widened corridor classification", () => {
  for (const vertical of [false, true]) {
    it(`retains a straight axis and actual clearance after widening (${vertical ? "vertical" : "horizontal"})`, () => {
      const g = corridor(vertical);
      const expected = { di: vertical ? 0 : 1, dj: vertical ? 1 : 0, width: 3, length: 9 };
      expect(straightCorridor(g, 5, 5)).toEqual(expected);
      const grammar = analyzePatternGrammar(g);
      expect(grammar.getSlot(5, 5)).toMatchObject({ slotType: "straight_3wide", width: 3, dirI: expected.di, dirJ: expected.dj });
      const track = { start: { i: 1, j: 5 }, stairs: { i: 9, j: 5 }, chute: null,
        mask: { lane: new Uint8Array(121) } } as Parameters<typeof extractSockets>[1];
      expect(extractSockets(g, track).getSocket(5, 5)).toMatchObject({ role: "straight", width: 3, clearance: 3,
        direction: { di: expected.di, dj: expected.dj } });
    });
  }

  it("keeps a crossing as a junction instead of choosing an arbitrary axis", () => {
    const g = corridor(false);
    for (let j = 1; j <= 9; j++) for (let i = 4; i <= 6; i++) setTile(g, i, j, T_FLOOR);
    expect(straightCorridor(g, 5, 5)).toBeNull();
    expect(analyzePatternGrammar(g).getSlot(5, 5).slotType).toBe("junction");
  });
});
