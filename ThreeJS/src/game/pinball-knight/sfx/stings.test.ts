/**
 * The SFX module is fire-and-forget and FAIL-SILENT by design: audio must never
 * be able to break the game. That is exactly what makes it easy to break
 * invisibly — a throwing or no-op sound effect looks identical to a working one
 * from inside the game. These tests assert the two things that actually matter:
 * every sting still reaches the audio graph, and none of them throws when the
 * environment has no audio at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as sfx from "./index";

/** Every exported sting, so a newly added one can't silently skip these checks. */
const STINGS = Object.entries(sfx).filter(([n, v]) => n.startsWith("sfx") && typeof v === "function") as Array<
  [string, (...args: number[]) => void]
>;

/** A minimal AudioContext stand-in that records what got scheduled. */
function fakeCtx() {
  const started: string[] = [];
  /** Oscillator base pitches, in the order they were scheduled. */
  const notes: number[] = [];
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 });
  const freqParam = () => ({ ...param(), setValueAtTime: (v: number) => notes.push(v) });
  return {
    started,
    notes,
    ctx: {
      state: "running",
      currentTime: 0,
      sampleRate: 44100,
      destination: node(),
      resume: vi.fn(),
      createOscillator: () => ({ ...node(), type: "sine", frequency: freqParam(), start: () => started.push("osc"), stop: vi.fn(), onended: null }),
      createGain: () => ({ ...node(), gain: param() }),
      createBiquadFilter: () => ({ ...node(), type: "lowpass", frequency: { value: 0 } }),
      createBufferSource: () => ({ ...node(), buffer: null, start: () => started.push("buf"), stop: vi.fn(), onended: null }),
      createBuffer: (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    },
  };
}

vi.mock("../../../utils/audio-manager", () => ({
  getAudioCtx: () => (globalThis as any).__ctx ?? null,
  // bus.ts routes through the master node; returning null makes it fall
  // back to ctx.destination, which is the pre-mixer graph these baselines
  // were recorded against.
  getSfxMaster: () => null,
  setMasterVolume: () => {},
}));

beforeEach(() => {
  (globalThis as any).__ctx = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("dungeon SFX", () => {
  it("exports the stings the game actually calls", () => {
    // Guards against a rename silently turning a call site into dead code.
    for (const name of ["sfxLevelStart", "sfxStairs", "sfxModifier", "sfxBossReveal", "sfxPickup", "sfxCoin", "sfxSwing", "sfxHeavy", "sfxHit", "sfxZombieDie", "sfxHurt", "sfxGameOver"]) {
      expect(typeof (sfx as Record<string, unknown>)[name], `${name} missing`).toBe("function");
    }
  });

  it("every sting actually schedules audio when a context exists", () => {
    for (const [name, fn] of STINGS) {
      const f = fakeCtx();
      (globalThis as any).__ctx = f.ctx;
      fn(0.5); // the one arg-taking sting (sfxCartBell) reads a 0..1 nearness
      expect(f.started.length, `${name} scheduled nothing`).toBeGreaterThan(0);
    }
  });

  it("every sting is silent-safe with no audio context (never throws)", () => {
    // Headless, autoplay-blocked, or an audio-less environment: the game must
    // keep running regardless.
    (globalThis as any).__ctx = null;
    for (const [name, fn] of STINGS) {
      expect(() => fn(0.5), `${name} threw with no context`).not.toThrow();
    }
  });

  it("survives an AudioContext that throws on every node it is asked for", () => {
    const hostile = {
      state: "running",
      currentTime: 0,
      sampleRate: 44100,
      destination: {},
      resume: () => {
        throw new Error("nope");
      },
    };
    (globalThis as any).__ctx = hostile;
    for (const [name, fn] of STINGS) {
      expect(() => fn(0.5), `${name} threw on a hostile context`).not.toThrow();
    }
  });

  it("the descent sting climbs and the arrival sting does not", () => {
    // These fire within about a second of each other across a descent. If both
    // were rising fanfares they'd read as one long confusing run — so sfxStairs
    // ASCENDS (you're leaving) and sfxLevelStart settles onto a root (you've
    // arrived). Asserted on the actual note pitches, not on how many nodes got
    // created: node count is not a musical property and would pass by accident.
    const pitches = (play: () => void): number[] => {
      const f = fakeCtx();
      (globalThis as any).__ctx = f.ctx;
      play();
      return f.notes;
    };

    const descent = pitches(() => sfx.sfxStairs());
    expect(descent.length, "sfxStairs played no tones").toBeGreaterThan(1);
    expect(descent[descent.length - 1], `sfxStairs should ascend: ${descent}`).toBeGreaterThan(descent[0]);

    const arrival = pitches(() => sfx.sfxLevelStart());
    expect(arrival.length, "sfxLevelStart played no tones").toBeGreaterThan(1);
    expect(arrival[arrival.length - 1], `sfxLevelStart should not climb like the descent: ${arrival}`).toBeLessThan(
      descent[descent.length - 1],
    );
  });
});
