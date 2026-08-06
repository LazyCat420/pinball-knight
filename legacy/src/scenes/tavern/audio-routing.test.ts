/**
 * THE TAVERN IS UNDER THE VOLUME SLIDER — the other half of `sfx/bus.test.ts`.
 *
 * The dungeon's stings have gone through a master gain since the `sfx/` split,
 * but the tavern, the slot machine, the dart board, the roulette wheel and the
 * blackjack table each connected straight to `ctx.destination`. The symptom was
 * exact and reproducible: set the volume to 0, walk into the tavern, and the
 * hearth still roars.
 *
 * Unlike `sfx/bus.test.ts`, this drives the REAL `utils/audio-manager` — the
 * master node here is the actual one a player's browser builds, not a stand-in —
 * because the thing under test is precisely whether these files reach it.
 *
 * Two assertions, and the second is the one that would have caught the bug:
 *   1. exactly ONE node touches `destination`, and it is the master;
 *   2. at volume 0 the graph is EMPTY — not quiet, empty. The gate has to come
 *      before node creation, because `sfxDestination()` degrades to
 *      `ctx.destination` if the master cannot be built, and a fallback that
 *      plays at full volume when the player asked for silence is worse than the
 *      failure it papers over.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

/** Records every `connect` so the graph can be asserted rather than assumed. */
function graphRecorder() {
  const edges: Array<[string, string]> = [];
  const created: string[] = [];
  let n = 0;
  const mk = (kind: string) => {
    const id = `${kind}${n++}`;
    created.push(id);
    return {
      id,
      connect: (dst: { id?: string }) => {
        edges.push([id, dst?.id ?? "UNKNOWN"]);
        return dst;
      },
      disconnect: () => {},
    };
  };
  const param = () => ({
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
    cancelScheduledValues: () => {},
    setTargetAtTime: () => {},
    value: 0,
  });
  class FakeCtx {
    state = "running";
    currentTime = 0;
    sampleRate = 44100;
    destination = { id: "destination", connect: () => {}, disconnect: () => {} };
    resume(): Promise<void> {
      return Promise.resolve();
    }
    suspend(): void {
      this.state = "suspended";
    }
    createOscillator() {
      return { ...mk("osc"), type: "sine", frequency: param(), detune: param(), start: () => {}, stop: () => {}, onended: null };
    }
    createGain() {
      return { ...mk("gain"), gain: param() };
    }
    createBiquadFilter() {
      return { ...mk("filter"), type: "lowpass", frequency: param(), Q: param(), gain: param() };
    }
    createBufferSource() {
      return { ...mk("src"), buffer: null, loop: false, playbackRate: param(), start: () => {}, stop: () => {}, onended: null };
    }
    createBuffer(_ch: number, len: number) {
      return { getChannelData: () => new Float32Array(len), length: len };
    }
  }
  return { edges, created, FakeCtx };
}

function install(): ReturnType<typeof graphRecorder> {
  const g = graphRecorder();
  vi.stubGlobal("window", {
    location: { search: "" },
    addEventListener: () => {},
    removeEventListener: () => {},
    AudioContext: g.FakeCtx,
  });
  return g;
}

/**
 * Every cue, called explicitly with a real argument.
 *
 * Explicit rather than reflective on purpose — the modules are then cross-checked
 * against this list below, so a cue added to any of these files and NOT added
 * here fails the suite instead of quietly going untested. That is the drift this
 * whole file exists to catch.
 */
async function playEverything(): Promise<Record<string, string[]>> {
  const called: Record<string, string[]> = {};
  const run = async (mod: string, calls: Array<[string, unknown[]]>) => {
    const m = (await import(mod)) as Record<string, (...a: unknown[]) => unknown>;
    called[mod] = calls.map(([n]) => n);
    for (const [name, args] of calls) m[name](...args);
    // Any `sfx*` export this table forgot is an untested bypass waiting to happen.
    const exported = Object.keys(m).filter((k) => k.startsWith("sfx") && typeof m[k] === "function");
    expect(exported.sort(), `${mod}: every sfx* export must be exercised here`).toEqual(calls.map(([n]) => n).sort());
  };

  const tavern = (await import("./audio")) as Record<string, (...a: unknown[]) => unknown>;
  tavern.startTavernAmbience();
  await run("./audio", [
    ["sfxAnvil", []],
    ["sfxDart", []],
    ["sfxKeeperGreet", []],
    ["sfxStationFocus", []],
    ["sfxPlunger", []],
  ]);
  await run("./gambler/audio", [
    ["sfxLeverPull", []],
    ["sfxReelSpin", []],
    ["sfxReelStop", [1]],
    ["sfxNearMiss", []],
    ["sfxWinSmall", []],
    ["sfxJackpotJingle", []],
    ["sfxLose", []],
  ]);
  await run("./gambler/darts-audio", [
    ["sfxReticleTick", ["x"]],
    ["sfxLockAxis", []],
    ["sfxThrow", []],
    ["sfxStick", ["board"]],
    ["sfxBullseye", []],
    ["sfxRoundEnd", [2]],
  ]);
  await run("./gambler/roulette-audio", [
    ["sfxWheelSpin", []],
    ["sfxBallLaunch", []],
    ["sfxBallDrop", []],
    ["sfxDeflector", []],
    ["sfxFret", [3]],
    ["sfxSeat", []],
    ["sfxRouletteWin", [2]],
    ["sfxRouletteLose", []],
  ]);
  await run("./gambler/blackjack-audio", [
    ["sfxCardDeal", []],
    ["sfxHoleFlip", []],
    ["sfxChips", [3]],
    ["sfxDouble", []],
    ["sfxDealerTick", [1]],
    ["sfxBust", []],
    ["sfxBlackjack", []],
    ["sfxWin", []],
    ["sfxPush", []],
    ["sfxLoseHand", []],
    ["sfxShuffle", []],
  ]);
  return called;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the tavern reaches the master gain", () => {
  it("routes every cue through the master, with ONE edge to destination", async () => {
    const g = install();
    const mgr = await import("../../utils/audio-manager");
    mgr.setMasterVolume(1);

    await playEverything();

    const toDest = [...new Set(g.edges.filter(([, d]) => d === "destination").map(([s]) => s))];
    expect(toDest.length, "exactly one node may reach destination").toBe(1);
    // And that one node is the master — it is the only node audio-manager builds.
    const master = mgr.getSfxMaster() as unknown as { id: string };
    expect(toDest[0]).toBe(master.id);

    const toMaster = g.edges.filter(([, d]) => d === master.id);
    expect(toMaster.length, "no tavern cue reached the master").toBeGreaterThan(10);
  });

  it("builds NOTHING at volume 0 — a hard gate, not a quiet one", async () => {
    const g = install();
    const mgr = await import("../../utils/audio-manager");
    mgr.setMasterVolume(0);

    await playEverything();

    expect(g.created, "volume 0 must not create a single node").toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("stays silent when the app is globally muted, without throwing", async () => {
    install();
    const mgr = await import("../../utils/audio-manager");
    mgr.setMasterVolume(1);
    mgr.setGlobalMute(true);
    // Fail-silent is the contract: a muted cue is a no-op, never an exception.
    await expect(playEverything()).resolves.toBeDefined();
    expect(mgr.getSfxMaster()).toBeNull();
  });

  /**
   * THE SWITCH, not just the slider.
   *
   * Routing to the master bought the volume slider and nothing else: the settings
   * screen's "Sound FX: MUTED" row calls `sfx/bus.ts setSfxMuted`, which used to
   * set a flag that only `bus()` reads — and no tavern cue goes through `bus()`.
   * So sound-off silenced the dungeon and left the hub blipping. Driven through
   * `setSfxMuted` rather than `setMasterMuted` on purpose: the defect was the
   * wiring between the two, so calling the master directly would test the half
   * that was never broken.
   */
  it("builds NOTHING when the game's sound switch is off", async () => {
    const g = install();
    const mgr = await import("../../utils/audio-manager");
    const bus = await import("../../game/pinball-knight/sfx/bus");
    mgr.setMasterVolume(1);
    bus.setSfxMuted(true);

    await playEverything();

    expect(g.created, "the mute switch must reach the tavern").toEqual([]);
    expect(g.edges).toEqual([]);

    // …and un-muting restores the chosen level, rather than latching silent.
    bus.setSfxMuted(false);
    await playEverything();
    expect(g.created.length).toBeGreaterThan(10);
  });

  /**
   * A gate cannot reach a source that is ALREADY looping — the hearth bed starts
   * on entry and runs until you leave. Muting mid-room has to zero the master.
   */
  it("silences the running hearth bed when muted mid-tavern", async () => {
    install();
    const mgr = await import("../../utils/audio-manager");
    const bus = await import("../../game/pinball-knight/sfx/bus");
    mgr.setMasterVolume(1);
    bus.setSfxMuted(false);

    const tavern = await import("./audio");
    tavern.startTavernAmbience(); // the loop is now running

    const master = mgr.getSfxMaster() as unknown as { gain: { value: number } };
    expect(master.gain.value).toBeGreaterThan(0);
    bus.setSfxMuted(true);
    expect(master.gain.value, "a live bed can only be silenced at the master").toBe(0);
    bus.setSfxMuted(false);
    expect(master.gain.value).toBe(1);
  });

  /**
   * THE NEGATIVE CONTROL. The check above passes trivially if the recorder never
   * sees a bypass, so reproduce one and prove the assertion moves.
   */
  it("would CATCH a cue wired straight to destination", async () => {
    const g = install();
    const mgr = await import("../../utils/audio-manager");
    mgr.setMasterVolume(1);
    await playEverything();

    const ctx = mgr.getAudioCtx();
    const rogue = ctx.createGain();
    rogue.connect(ctx.destination); // the exact habit this file exists to stop

    const toDest = [...new Set(g.edges.filter(([, d]) => d === "destination").map(([s]) => s))];
    expect(toDest.length, "the bypass must be visible to the assertion above").toBe(2);
  });
});
