/**
 * THE FIRST SOUND IN THIS GAME THAT CAN OUTLIVE THE FRAME LOOP.
 *
 * A one-shot cannot leak: it schedules its own end before it starts. A bed can,
 * and the ways it leaks are all the same shape — something stopped calling and
 * nothing was listening for that. Descent, death, the pause menu, `dispose()`,
 * and the one with no callback at all: a HIDDEN TAB, where rAF stops dead while
 * the audio context keeps running.
 *
 * `ambience()` answers all of them with one mechanism — every refresh re-arms a
 * fade to zero a fraction of a second out — so the assertions here are about
 * that ramp existing on EVERY call, and about the mute gates being checked
 * before any node is built. The scheduling is asserted on a recording
 * AudioParam rather than by waiting: a test that slept for the fade would be
 * asserting on wall-clock, which is how a flaky audio test is born.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Ramp {
  kind: "cancel" | "setValueAtTime" | "linearRamp" | "target";
  value: number;
  time: number;
}

/** Records what was scheduled, and on which node. */
function graphCtx() {
  const edges: Array<[string, string]> = [];
  const ramps: Ramp[] = [];
  const started: string[] = [];
  const stopped: string[] = [];
  let n = 0;
  const mk = (kind: string) => {
    const id = `${kind}${n++}`;
    return {
      id,
      connect: (dst: { id?: string }) => {
        edges.push([id, dst?.id ?? "UNKNOWN"]);
        return dst;
      },
      disconnect: vi.fn(),
    };
  };
  const param = (record = false) => ({
    setValueAtTime: (v: number, t: number) => record && ramps.push({ kind: "setValueAtTime", value: v, time: t }),
    linearRampToValueAtTime: (v: number, t: number) => record && ramps.push({ kind: "linearRamp", value: v, time: t }),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: (t: number) => record && ramps.push({ kind: "cancel", value: 0, time: t }),
    value: 0,
  });
  const ctx = {
    state: "running",
    currentTime: 0,
    sampleRate: 44100,
    destination: { id: "destination", connect: vi.fn(), disconnect: vi.fn() },
    resume: vi.fn(),
    createOscillator: () => ({
      ...mk("osc"),
      type: "sine",
      frequency: param(),
      start: () => started.push("osc"),
      stop: () => stopped.push("osc"),
    }),
    createGain: () => ({ ...mk("gain"), gain: param(true) }),
    createBiquadFilter: () => ({ ...mk("filter"), type: "lowpass", frequency: param(), Q: param() }),
    createBufferSource: () => ({
      ...mk("src"),
      buffer: null,
      loop: false,
      start: () => started.push("src"),
      stop: () => stopped.push("src"),
    }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return { edges, ramps, started, stopped, ctx };
}

let master: { id: string; connect: (d: { id?: string }) => void } | null = null;

vi.mock("../../../utils/audio-manager", () => ({
  getAudioCtx: () => (globalThis as Record<string, unknown>).__ctx ?? null,
  getSfxMaster: () => master,
  setMasterVolume: () => {},
}));

const { ambience, resetAmbience, ambienceVoices } = await import("./ambience");
const { setSfxMuted, setSfxVolume, resetBus } = await import("./bus");

beforeEach(() => {
  resetAmbience();
  resetBus();
  setSfxMuted(false);
  setSfxVolume(1);
  master = null;
  (globalThis as Record<string, unknown>).__ctx = null;
});

describe("a bed starts, follows and re-arms", () => {
  it("builds ONE looping voice per id, however many times it is polled", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    for (let i = 0; i < 5; i++) ambience("fire", 0.5);
    expect(ambienceVoices()).toBe(1);
    expect(g.started.filter((s) => s === "src")).toHaveLength(1);
    ambience("water", 0.5);
    expect(ambienceVoices()).toBe(2);
  });

  it("arms a fade to ZERO on every single poll — the dead-man's switch", () => {
    // THE POINT OF THE FILE. Descent, death, pause, dispose and a hidden tab are
    // all "nothing called this again", and this ramp is the only thing that
    // makes them safe. If it is armed once and not re-armed, the bed either dies
    // mid-fire or plays forever, depending on which way the mistake goes.
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    for (let i = 0; i < 4; i++) {
      g.ctx.currentTime = i * 0.016;
      ambience("fire", 0.8);
    }
    const zeroes = g.ramps.filter((r) => r.kind === "linearRamp" && r.value === 0);
    expect(zeroes.length, "one fade-to-zero per poll").toBe(4);
    // And each is scheduled AHEAD of the poll that armed it, or it would silence
    // a live fire.
    for (const [i, z] of zeroes.entries()) expect(z.time).toBeGreaterThan(i * 0.016);
  });

  it("cancels the previous fade before scheduling the next", () => {
    // Without the cancel, last frame's ramp-to-zero is still in the queue and
    // fights the new level instead of being replaced by it — the bed would
    // stutter in exact time with the frame rate.
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    ambience("fire", 0.5);
    const before = g.ramps.length;
    g.ctx.currentTime = 0.016;
    ambience("fire", 0.9);
    const second = g.ramps.slice(before);
    expect(second[0].kind, "the poll must open with a cancel").toBe("cancel");
  });

  it("scales the level rather than opening a second voice", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    ambience("fire", 0.25);
    const quiet = g.ramps.find((r) => r.kind === "linearRamp" && r.value > 0)!.value;
    resetAmbience();
    g.ramps.length = 0;
    ambience("fire", 1);
    const loud = g.ramps.find((r) => r.kind === "linearRamp" && r.value > 0)!.value;
    expect(loud).toBeGreaterThan(quiet);
    // And a bed sits UNDER the stings — a sustained sound at sting level masks
    // the sounds that carry information.
    expect(loud).toBeLessThan(0.15);
  });

  it("clamps a level a caller over-accumulated", () => {
    // Six fires in a room hand in a total well over 1. That is not six voices
    // and it is not six times the gain.
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    ambience("fire", 6);
    const peak = Math.max(...g.ramps.filter((r) => r.kind === "linearRamp").map((r) => r.value));
    expect(peak).toBeLessThan(0.15);
    expect(ambienceVoices()).toBe(1);
  });
});

describe("the gates are checked before a node exists", () => {
  it("builds NOTHING when this game is muted", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    setSfxMuted(true);
    ambience("fire", 1);
    expect(ambienceVoices()).toBe(0);
    expect(g.edges, "a muted run must not allocate a loop").toHaveLength(0);
  });

  it("builds NOTHING at volume 0", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    setSfxVolume(0);
    ambience("fire", 1);
    expect(ambienceVoices()).toBe(0);
    expect(g.edges).toHaveLength(0);
  });

  it("builds NOTHING when the app is globally silenced", () => {
    (globalThis as Record<string, unknown>).__ctx = null; // getAudioCtx() → null
    ambience("fire", 1);
    expect(ambienceVoices()).toBe(0);
  });

  it("stops a LIVE bed when the mute arrives mid-loop", () => {
    // The gate is checked on the poll, so a mute mid-fire has to take the voice
    // with it — otherwise the fade is the only thing stopping it and it plays
    // on for a third of a second after the player asked for silence.
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    ambience("fire", 1);
    expect(ambienceVoices()).toBe(1);
    setSfxMuted(true);
    ambience("fire", 1);
    expect(ambienceVoices()).toBe(0);
    expect(g.stopped).toContain("src");
  });

  it("does not start a voice for a level of 0", () => {
    // Polled every frame by a room with no fire in it: the poll is unconditional
    // and must not allocate a silent loop for every kind, on every floor.
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    for (let i = 0; i < 60; i++) ambience("fire", 0);
    expect(ambienceVoices()).toBe(0);
    expect(g.started, "no source may be started for a silent poll").toHaveLength(0);
    // The category bus node itself IS built and cached — one gain for the whole
    // run, which is the mixer working, not a leak.
    expect(g.edges).toHaveLength(1);
  });
});

describe("routing", () => {
  it("reaches the master through the ambience bus, never destination", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    master = { id: "master", connect: () => g.edges.push(["master", "destination"]) };
    master.connect(g.ctx.destination);
    ambience("fire", 1);
    ambience("water", 1);
    const toDest = g.edges.filter(([, d]) => d === "destination").map(([s]) => s);
    expect(toDest, "only the master may reach destination").toEqual(["master"]);
    expect(g.edges.some(([, d]) => d === "master"), "the category bus must land on the master").toBe(true);
  });

  it("rebuilds when the AudioContext is replaced", () => {
    // A node belongs to exactly one context; reconnecting a cached voice across
    // two throws, and the bed would go silent for the rest of the run.
    const g1 = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g1.ctx;
    ambience("fire", 1);
    const g2 = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g2.ctx;
    resetBus(); // the bus caches per context too
    ambience("fire", 1);
    expect(g2.started).toContain("src");
    expect(ambienceVoices()).toBe(1);
  });
});
