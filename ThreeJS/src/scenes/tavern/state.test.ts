/**
 * The diorama has to REPORT the run, not decorate the room.
 *
 * The failure this guards is the one it replaced: caps chasing and a ball
 * lapping on a free-running timer, identical after a perfect floor and after a
 * death on the stairs. That is worse than a dead machine, because it looks like
 * information and isn't — so the mapping from stats to lights is pinned here.
 */
import { describe, it, expect } from "vitest";
import { readDiorama, gradeRank, type TavernStats } from "./state";

const CAPS = 5;

const run = (over: Partial<TavernStats> = {}): TavernStats => ({ grade: "-", floor: 0, kills: 0, bestCombo: 0, ...over });

describe("readDiorama", () => {
  it("shows a dead machine before any run", () => {
    // The tavern's default stats — nothing achieved, so nothing is claimed.
    const d = readDiorama(run(), CAPS);
    expect(d.lit).toBe(0);
    expect(d.ballSpeed).toBe(0);
  });

  it("lights one cap for simply clearing a floor", () => {
    expect(readDiorama(run({ floor: 1 }), CAPS).lit).toBe(1);
  });

  it("lights more caps the better the run went", () => {
    const weak = readDiorama(run({ floor: 1, kills: 4, bestCombo: 2, grade: "D" }), CAPS).lit;
    const mid = readDiorama(run({ floor: 3, kills: 15, bestCombo: 6, grade: "C" }), CAPS).lit;
    const great = readDiorama(run({ floor: 7, kills: 60, bestCombo: 12, grade: "S" }), CAPS).lit;
    expect(weak).toBeLessThan(mid);
    expect(mid).toBeLessThan(great);
    expect(great).toBe(CAPS);
  });

  it("never lights more caps than the table has", () => {
    const d = readDiorama(run({ floor: 99, kills: 9999, bestCombo: 99, grade: "S" }), 3);
    expect(d.lit).toBe(3);
  });

  it("parks the ball on a weak floor and rolls it on a strong one", () => {
    expect(readDiorama(run({ floor: 1, grade: "D" }), CAPS).ballSpeed).toBe(0);
    expect(readDiorama(run({ floor: 1, grade: "C" }), CAPS).ballSpeed).toBe(0);
    expect(readDiorama(run({ floor: 1, grade: "B" }), CAPS).ballSpeed).toBeGreaterThan(0);
  });

  it("rolls the ball faster the better the grade", () => {
    const b = readDiorama(run({ grade: "B" }), CAPS).ballSpeed;
    const a = readDiorama(run({ grade: "A" }), CAPS).ballSpeed;
    const s = readDiorama(run({ grade: "S" }), CAPS).ballSpeed;
    expect(a).toBeGreaterThan(b);
    expect(s).toBeGreaterThan(a);
  });

  it("treats an unknown or absent grade as the worst, not as a crash", () => {
    // The tavern's initial grade is literally "-", and the dungeon is free to
    // hand over anything. A machine that lies optimistically is the bug.
    expect(gradeRank("-")).toBe(0);
    expect(gradeRank("")).toBe(0);
    expect(gradeRank("???")).toBe(0);
    expect(readDiorama(run({ grade: "???" }), CAPS).ballSpeed).toBe(0);
  });

  it("reads a lowercase grade the same as an uppercase one", () => {
    expect(gradeRank("s")).toBe(gradeRank("S"));
  });
});
