/**
 * THE MACHINE READOUT'S CHOICES.
 *
 * `hud-machines.ts` holds no drawing precisely so this file can exist: the
 * interesting behaviour is WHICH machine gets the one line the HUD has room
 * for, and WHEN there is nothing to say. Both are decisions, both were wrong in
 * an earlier draft (Map order, and a row that never went away), and neither can
 * be tested through a canvas without a DOM.
 *
 * Everything here drives `pickMachine` / `machineHudRow` on hand-built
 * `MachineState` values, so no floor is built and no registry is touched.
 */
import { describe, it, expect } from "vitest";
import { newMachine, type MachineState, type MachinePhase } from "./machines";
import { pickMachine, machineHudRow } from "./hud-machines";
import { MACHINE_WINDOW, MACHINE_ARM_TIME, MACHINE_ARM_WINDOW, MACHINE_COOL_TIME } from "./constants";

function m(id: number, name: string, phase: MachinePhase, step = 0, total = 4): MachineState {
  const s = newMachine(id, name, total);
  s.phase = phase;
  s.step = step;
  return s;
}

describe("pickMachine — one line, four machines", () => {
  it("shows nothing when every machine is unlit", () => {
    expect(pickMachine([m(1, "orbit", "unlit"), m(2, "pop-nest", "unlit")])).toBeNull();
  });

  it("shows nothing on an empty floor", () => {
    expect(pickMachine([])).toBeNull();
  });

  it("ranks by urgency, not by iteration order", () => {
    // Deliberately fed in the WRONG order every time, because Map order is
    // exactly what an earlier draft leaned on.
    const armed = m(9, "orbit", "armed");
    const lit = m(3, "loop-reactor", "lit");
    const qual = m(1, "pop-nest", "qualifying", 3);
    const cool = m(2, "kicker-lane", "cooling");
    expect(pickMachine([qual, cool, lit, armed])?.id).toBe(9);
    expect(pickMachine([cool, qual, lit])?.id).toBe(3);
    expect(pickMachine([cool, qual])?.id).toBe(1);
    expect(pickMachine([cool])?.id).toBe(2);
  });

  it("breaks a phase tie on PROGRESS — a 3-of-4 is the better line", () => {
    const behind = m(1, "orbit", "qualifying", 1);
    const ahead = m(2, "orbit", "qualifying", 3);
    expect(pickMachine([behind, ahead])?.id).toBe(2);
    expect(pickMachine([ahead, behind])?.id).toBe(2);
  });

  it("breaks a full tie on id, so the readout cannot flicker between frames", () => {
    const a = m(7, "orbit", "qualifying", 2);
    const b = m(4, "pop-nest", "qualifying", 2);
    // Same phase, same step: the answer must not depend on the order they
    // arrive in, or two machines worked together strobe the line.
    expect(pickMachine([a, b])?.id).toBe(4);
    expect(pickMachine([b, a])?.id).toBe(4);
  });

  it("never picks a machine mid-collect — `collected` is an instant, not a state to watch", () => {
    expect(pickMachine([m(1, "orbit", "collected", 4)])).toBeNull();
  });
});

describe("machineHudRow — the clock that matters in each phase", () => {
  it("reads the qualifying window, not the arm or cool timer", () => {
    const s = m(1, "orbit", "qualifying", 2);
    s.windowT = MACHINE_WINDOW / 2;
    s.armT = 999;
    s.coolT = 999;
    const r = machineHudRow(s);
    expect(r.left).toBeCloseTo(MACHINE_WINDOW / 2);
    expect(r.full).toBe(MACHINE_WINDOW);
    expect(r.frac).toBeCloseTo(0.5);
  });

  it("reads the arm spin-up while lit", () => {
    const s = m(1, "orbit", "lit", 4);
    s.armT = MACHINE_ARM_TIME;
    const r = machineHudRow(s);
    expect(r.full).toBe(MACHINE_ARM_TIME);
    expect(r.frac).toBeCloseTo(1);
  });

  it("reads the ARM WINDOW while armed — the jackpot's clock, not the step clock", () => {
    // `armed` reuses `windowT` for a different and much longer window. Reading
    // it against MACHINE_WINDOW would draw a bar that is instantly full and
    // then pinned, i.e. a bar that says nothing at the one moment it matters.
    const s = m(1, "orbit", "armed", 4);
    s.windowT = MACHINE_ARM_WINDOW;
    const r = machineHudRow(s);
    expect(r.full).toBe(MACHINE_ARM_WINDOW);
    expect(r.frac).toBeCloseTo(1);
    s.windowT = MACHINE_ARM_WINDOW / 4;
    expect(machineHudRow(s).frac).toBeCloseTo(0.25);
  });

  it("reads the cooldown while cooling", () => {
    const s = m(1, "orbit", "cooling");
    s.coolT = MACHINE_COOL_TIME / 2;
    expect(machineHudRow(s).full).toBe(MACHINE_COOL_TIME);
    expect(machineHudRow(s).frac).toBeCloseTo(0.5);
  });

  it("clamps a negative or overrun clock rather than drawing off the end of the bar", () => {
    const s = m(1, "orbit", "qualifying", 1);
    s.windowT = -3;
    expect(machineHudRow(s).frac).toBe(0);
    s.windowT = MACHINE_WINDOW * 10;
    expect(machineHudRow(s).frac).toBe(1);
  });

  it("carries the machine's own total, never a literal", () => {
    // The whole reason `MachineState.total` is derived: a 3-lane reactor and a
    // 6-corner ring are both legal, and the pip row is drawn from this.
    expect(machineHudRow(m(1, "loop-reactor", "qualifying", 2, 3)).total).toBe(3);
    expect(machineHudRow(m(2, "orbit", "qualifying", 5, 6)).total).toBe(6);
  });
});
