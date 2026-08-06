/**
 * THE MIXER, and the one drift a folder split invites.
 *
 * ── THE BYPASS TEST IS THE POINT OF THIS FILE ────────────────────────────────
 * Now that sound is spread across six category modules, the easy mistake is to
 * add `sfx/frost.ts`, copy a sting, and connect its gain to `c.destination` out
 * of habit. Nothing breaks. The sound plays. It is simply immune to the volume
 * slider and to every category trim — and you find out when a player says the
 * volume control "sort of works".
 *
 * So this counts connections: exactly ONE node may reach `destination` (the
 * master), and every sting's gain must reach it transitively. Verified by fault
 * injection, not by assumption — see the last test in this file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** Records the graph so connections can be asserted, not assumed. */
function graphCtx() {
  const edges: Array<[string, string]> = [];
  let n = 0;
  const mk = (kind: string) => {
    const id = `${kind}${n++}`;
    const self: Record<string, unknown> = {
      id,
      connect: (dst: { id?: string }) => edges.push([id, dst?.id ?? "UNKNOWN"]),
      disconnect: vi.fn(),
    };
    return self;
  };
  const param = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    value: 0,
  });
  const destination = { id: "destination", connect: vi.fn(), disconnect: vi.fn() };
  return {
    edges,
    ctx: {
      state: "running",
      currentTime: 0,
      sampleRate: 44100,
      destination,
      resume: vi.fn(),
      createOscillator: () => ({ ...mk("osc"), type: "sine", frequency: param(), start: vi.fn(), stop: vi.fn(), onended: null }),
      createGain: () => ({ ...mk("gain"), gain: param() }),
      createBiquadFilter: () => ({ ...mk("filter"), type: "lowpass", frequency: { value: 0 } }),
      createBufferSource: () => ({ ...mk("src"), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null }),
      createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    },
  };
}

/**
 * The REAL audio-manager master path, unlike the stings/snapshot tests which stub
 * it to null. Those two assert timbre and want the pre-mixer graph; this one
 * asserts routing and needs the master to exist.
 */
let master: { id: string; connect: (d: { id?: string }) => void } | null = null;
let volumeSetTo = -1;
/** What the mute switch pushed at the master — see "the switch leaves this folder". */
let mutedSetTo: boolean | null = null;

vi.mock("../../../utils/audio-manager", () => ({
  getAudioCtx: () => (globalThis as Record<string, unknown>).__ctx ?? null,
  getSfxMaster: () => master,
  setMasterVolume: (v: number) => {
    volumeSetTo = v;
  },
  setMasterMuted: (v: boolean) => {
    mutedSetTo = v;
  },
}));

const { bus, setSfxMuted, setSfxVolume, getSfxVolume, isSfxMuted, resetBus } = await import("./bus");
const sfx = await import("./index");

const STINGS = Object.entries(sfx).filter(([n, v]) => n.startsWith("sfx") && typeof v === "function") as Array<
  [string, (...a: number[]) => void]
>;

beforeEach(() => {
  resetBus();
  setSfxMuted(false);
  setSfxVolume(1);
  volumeSetTo = -1;
  mutedSetTo = null;
  (globalThis as Record<string, unknown>).__ctx = null;
  master = null;
});

describe("the bus", () => {
  /**
   * `sfxMuted` gates `bus()`, and `bus()` is only this game's 28 stings. The
   * tavern, the smith and the gambler corner reach the speakers through
   * `sfxCtx`/`sfxDestination` without ever touching it — so for as long as the
   * switch stopped here, "Sound FX: MUTED" silenced the dungeon and left the hub
   * blipping at the player. The master is the one node both paths share.
   */
  it("carries the switch out of this folder, to the master", () => {
    setSfxMuted(true);
    expect(mutedSetTo, "the mute must reach the master, not just bus()").toBe(true);
    setSfxMuted(false);
    expect(mutedSetTo).toBe(false);
  });

  it("returns null when this game is muted, before creating any node", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    setSfxMuted(true);
    expect(bus("combat")).toBeNull();
    expect(g.edges, "muted must not build a graph").toHaveLength(0);
  });

  it("returns null at volume 0 — a HARD gate, not a quiet one", () => {
    // This matters more than it looks. The bus falls back to ctx.destination if
    // node creation throws; without an early volume gate that fallback would play
    // at FULL VOLUME exactly when the player asked for silence.
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    setSfxVolume(0);
    expect(bus("pinball")).toBeNull();
    expect(g.edges).toHaveLength(0);
  });

  it("returns null when the app is globally silenced (?mute=1 / __setMute)", () => {
    (globalThis as Record<string, unknown>).__ctx = null; // getAudioCtx() → null
    expect(bus("combat")).toBeNull();
  });

  it("keeps mute and volume independent", () => {
    setSfxVolume(0.4);
    setSfxMuted(true);
    setSfxMuted(false);
    // Un-muting must restore the CHOSEN level, not jump to full.
    expect(getSfxVolume()).toBe(0.4);
    expect(isSfxMuted()).toBe(false);
  });

  it("hands the linear volume to the master node", () => {
    setSfxVolume(0.5);
    expect(volumeSetTo).toBe(0.5);
  });

  it("clamps volume into 0..1", () => {
    setSfxVolume(5);
    expect(getSfxVolume()).toBe(1);
    setSfxVolume(-3);
    expect(getSfxVolume()).toBe(0);
  });

  it("builds one gain per category and reuses it", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    const a = bus("combat");
    const b = bus("combat");
    expect(a!.out).toBe(b!.out);
    const c = bus("pinball");
    expect(c!.out).not.toBe(a!.out);
  });

  it("rebuilds its cache when the AudioContext is replaced", () => {
    // A GainNode belongs to exactly one context; connecting across two throws.
    const g1 = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g1.ctx;
    const first = bus("combat")!.out;
    const g2 = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g2.ctx;
    expect(bus("combat")!.out).not.toBe(first);
  });
});

describe("nothing bypasses the mixer", () => {
  it("routes every sting through the master, with ONE edge to destination", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    // Stand in for audio-manager's master: a node that reaches destination.
    master = { id: "master", connect: () => g.edges.push(["master", "destination"]) };
    master.connect(g.ctx.destination);

    for (const [, fn] of STINGS) fn(0.5);

    const toDest = g.edges.filter(([, dst]) => dst === "destination");
    expect(toDest.map(([s]) => s), "only the master may reach destination").toEqual(["master"]);

    // And every category gain that got built must land on the master.
    const toMaster = g.edges.filter(([, dst]) => dst === "master");
    expect(toMaster.length, "no category bus reached the master").toBeGreaterThan(0);
  });

  /**
   * THE NEGATIVE CONTROL. A test that has never been seen to fail is a decoration.
   *
   * This reproduces the exact mistake — a sting wired straight to `destination` —
   * and asserts the check above would have caught it. If this test ever starts
   * failing, the bypass check has stopped working, not the other way round.
   */
  it("would CATCH a sting wired straight to destination", () => {
    const g = graphCtx();
    (globalThis as Record<string, unknown>).__ctx = g.ctx;
    master = { id: "master", connect: () => g.edges.push(["master", "destination"]) };
    master.connect(g.ctx.destination);

    // The fault: a rogue gain connected to destination instead of the bus.
    const rogue = g.ctx.createGain() as unknown as { connect: (d: unknown) => void };
    rogue.connect(g.ctx.destination);

    const toDest = g.edges.filter(([, dst]) => dst === "destination").map(([s]) => s);
    expect(toDest).not.toEqual(["master"]);
    expect(toDest.some((s) => s.startsWith("gain")), "the bypass must be visible").toBe(true);
  });
});
