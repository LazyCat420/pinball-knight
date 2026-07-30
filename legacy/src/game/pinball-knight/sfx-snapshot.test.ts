/**
 * LOUDNESS + PITCH SNAPSHOT — proves an audio refactor is INAUDIBLE.
 *
 * ── WHY THIS EXISTS, AND WHY IT WAS WRITTEN FIRST ────────────────────────────
 * `audio.ts` is being split into an `sfx/` folder and re-pointed at a gain bus.
 * That is a pure reorganisation: nothing about how the game SOUNDS is meant to
 * change. But "nothing changed" is exactly the claim a refactor cannot make
 * about itself, because every existing test here asserts only that a sting
 * schedules SOMETHING — a sting rerouted through a half-built mixer, or one
 * whose volume literal got dropped in a copy-paste, passes all of them.
 *
 * So this table was generated from the code BEFORE the move and committed
 * against it. It records, per sting: how many oscillators and noise bursts were
 * created, every oscillator frequency in order, every gain value in order, and
 * every filter cutoff. If the move is honest, this file does not change. If any
 * value moves, the diff names the sting and the number.
 *
 * It is deliberately a table of opaque strings rather than a snapshot file: a
 * `toMatchSnapshot()` that can be regenerated with `-u` is not a guard, it is a
 * record of whatever came out last.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────
 * `Math.random` is pinned to 0.5. Three stings detune off it (sfxRoll,
 * sfxBumper, sfxCoin) and without the pin this test compares dice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as sfx from "./audio";

/** Generated from the pre-move implementation. Do NOT regenerate to make a
 *  failure go away — a change here means the game sounds different. */
const BASELINE: Record<string, string> = {
  sfxSwing: "o1 b1 n[330 140] g[0.12 0.001 0 0.05 0.001] f[1600]",
  sfxRoll: "o1 b1 n[260 90] g[0.11 0.001 0 0.05 0.001] f[700]",
  sfxBumper: "o2 b0 n[620 980 1240 1240] g[0 0.09 0.001 0 0.05 0.001] f[]",
  sfxSpring: "o2 b0 n[180 640 90 320] g[0 0.1 0.001 0 0.06 0.001] f[]",
  sfxHeavy: "o1 b1 n[260 90] g[0.16 0.001 0 0.08 0.001] f[1100]",
  sfxGun: "o1 b2 n[220 60] g[0.3 0.001 0.18 0.001 0 0.12 0.001] f[2200 600]",
  sfxBow: "o1 b1 n[480 180] g[0 0.14 0.001 0.08 0.001] f[3000]",
  sfxFlame: "o0 b2 n[] g[0.07 0.001 0.04 0.001] f[900 1700]",
  sfxHit: "o1 b1 n[190 70] g[0.2 0.001 0 0.14 0.001] f[900]",
  sfxZombieDie: "o1 b1 n[160 36] g[0 0.14 0.001 0.1 0.001] f[500]",
  sfxGroan: "o2 b0 n[82 55 110 66] g[0 0.11 0.001 0 0.06 0.001] f[]",
  sfxHurt: "o2 b0 n[220 110 165 82] g[0 0.16 0.001 0 0.14 0.001] f[]",
  sfxPickup: "o2 b0 n[523 784 784] g[0 0.1 0.001 0 0.08 0.001] f[]",
  sfxCoin: "o2 b0 n[1046.5 2093] g[0 0.07 0.001 0 0.04 0.001] f[]",
  sfxBreak: "o1 b2 n[140 60] g[0.22 0.001 0.12 0.001 0 0.1 0.001] f[1800 700]",
  sfxLevelStart: "o3 b1 n[78 62 196 294] g[0.09 0.001 0 0.09 0.001 0 0.09 0.001 0 0.06 0.001] f[420]",
  sfxModifier: "o2 b1 n[233 220 156 147] g[0 0.1 0.001 0 0.11 0.001 0.05 0.001] f[320]",
  sfxBossReveal: "o3 b1 n[98 123 147] g[0 0.1 0.001 0 0.1 0.001 0 0.1 0.001 0.08 0.001] f[260]",
  sfxStairs: "o4 b0 n[392 494 587 784] g[0 0.1 0.001 0 0.1 0.001 0 0.1 0.001 0 0.1 0.001] f[]",
  sfxSpin: "o2 b0 n[220 880 330 1320] g[0 0.16 0.001 0 0.1 0.001] f[]",
  sfxTarget: "o2 b0 n[1320 1760] g[0 0.2 0.001 0 0.16 0.001] f[]",
  sfxTrapdoor: "o2 b1 n[140 70 500 90] g[0 0.14 0.001 0.16 0.001 0 0.12 0.001] f[500]",
  sfxGoblin: "o2 b0 n[180 420 420 240] g[0 0.2 0.001 0 0.14 0.001] f[]",
  sfxCackle: "o5 b0 n[880 809.6 740 680.8 620 570.4 520 478.4 440 404.8] g[0 0.12 0.001 0 0.12 0.001 0 0.12 0.001 0 0.12 0.001 0 0.12 0.001] f[]",
  sfxFreeze: "o1 b1 n[1760 440] g[0 0.14 0.001 0.06 0.001] f[3000]",
  sfxRibbit: "o2 b0 n[110 160 90 140] g[0 0.16 0.001 0 0.14 0.001] f[]",
  sfxCartBell: "o2 b0 n[1568 1480 2093 1976] g[0 0.085 0.001 0 0.059 0.001] f[]",
  sfxGameOver: "o4 b1 n[330 262 196 131] g[0 0.12 0.001 0 0.12 0.001 0 0.12 0.001 0 0.12 0.001 0.06 0.001] f[300]",
};

/** Records everything about a sting that a listener could notice. */
function probeCtx() {
  const notes: number[] = [];
  const gains: number[] = [];
  const filters: number[] = [];
  let oscs = 0;
  let bufs = 0;
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const rec = (into: number[]) => ({
    setValueAtTime: (v: number) => into.push(Math.round(v * 1000) / 1000),
    linearRampToValueAtTime: (v: number) => into.push(Math.round(v * 1000) / 1000),
    exponentialRampToValueAtTime: (v: number) => into.push(Math.round(v * 1000) / 1000),
    value: 0,
  });
  return {
    sig: () => `o${oscs} b${bufs} n[${notes.join(" ")}] g[${gains.join(" ")}] f[${filters.join(" ")}]`,
    ctx: {
      state: "running",
      currentTime: 0,
      sampleRate: 44100,
      destination: node(),
      resume: vi.fn(),
      createOscillator: () => {
        oscs++;
        return { ...node(), type: "sine", frequency: rec(notes), start: vi.fn(), stop: vi.fn(), onended: null };
      },
      createGain: () => ({ ...node(), gain: rec(gains) }),
      createBiquadFilter: () => ({
        ...node(),
        type: "lowpass",
        frequency: {
          set value(v: number) {
            filters.push(v);
          },
          get value() {
            return 0;
          },
        },
      }),
      createBufferSource: () => {
        bufs++;
        return { ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null };
      },
      createBuffer: (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    },
  };
}

vi.mock("../../utils/audio-manager", () => ({
  getAudioCtx: () => (globalThis as Record<string, unknown>).__ctx ?? null,
}));

beforeEach(() => {
  (globalThis as Record<string, unknown>).__ctx = null;
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

const STINGS = Object.entries(sfx).filter(([n, v]) => n.startsWith("sfx") && typeof v === "function") as Array<
  [string, (...args: number[]) => void]
>;

describe("sfx loudness snapshot", () => {
  it("covers every sting the module exports", () => {
    // A new sting with no baseline entry would otherwise pass by not being
    // looked at. Both directions are checked, so a DELETED sting fails too.
    expect(STINGS.map(([n]) => n).sort()).toEqual(Object.keys(BASELINE).sort());
  });

  it("every sting schedules exactly what it scheduled before the sfx/ split", () => {
    for (const [name, fn] of STINGS) {
      const p = probeCtx();
      (globalThis as Record<string, unknown>).__ctx = p.ctx;
      fn(0.5); // sfxCartBell is the only arg-taker; the rest ignore it
      expect(p.sig(), `${name} sounds different than it did before the refactor`).toBe(BASELINE[name]);
    }
  });
});
