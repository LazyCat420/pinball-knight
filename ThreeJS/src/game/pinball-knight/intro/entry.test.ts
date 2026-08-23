/**
 * THE TITLE INTRO HAS A CALLER AGAIN — AND CANNOT AMBUSH A HARNESS.
 *
 * `runPinballIntro` was imported by `core.ts` and invoked by nothing: 668 lines
 * of finished title sequence that no player and no test could reach, while its
 * own docblock claimed it ran before `startLevel(1)`. Nothing in the suite could
 * tell the difference — which is the same hole `options-tab.test.ts` was written
 * for, one file over. So the first test here is about the ROUTE.
 *
 * The route is asserted against the SOURCE, deliberately. `core.ts`'s
 * `launchDungeonGame` builds a WebGPU renderer, a scene, the pixel pass, the
 * presence socket and the tavern; standing all that up to observe one call would
 * be a worse test than reading the call, and the regression worth catching is
 * textually specific — someone tidying `enterTavern` back out of the callback.
 * `run/floor-hold.test.ts` makes the same trade for the same reason.
 *
 * The rest is real behaviour, and it is mostly about who must NOT see the intro:
 * `?autostart=1` is how `playtest.mjs` and `__dungeonBot` enter, and it schedules
 * `beginRun()` one frame after launch. An 11-second title sequence in front of
 * that does not merely delay the harness — the two RAF loops would both own
 * `state.animFrameId`, and the intro's key listener would eat the bot's input.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the route into the intro", () => {
  const src = readFileSync(join(__dirname, "..", "core.ts"), "utf8");

  it("core.ts CALLS runPinballIntro, not merely imports it", () => {
    // The bug this file exists for: an import with no call site. `git log -S`
    // showed the same shape behind the unreachable settings screen.
    const calls = src.split("\n").filter((l) => /runPinballIntro\s*\(/.test(l) && !/^import\b/.test(l.trim()));
    expect(calls.length).toBeGreaterThan(0);
  });

  it("raises the lobby INSIDE the intro's callback, so the sequence comes first", () => {
    // Not just "both appear in the file": raising the lobby at the top level
    // would put it up over a playing intro. It must be what `onDone` does.
    //
    // The lobby is opened through `openLobby` (run/lobby.ts) rather than by
    // calling `enterTavern` here — core.ts's size ratchet requires new work to
    // live in the module that owns the concern. This asserts the same ROUTE at
    // the new seam; the test below pins that the seam really is the tavern, so
    // the pair cannot be satisfied by an `openLobby` that opens nothing.
    const introAt = src.search(/runPinballIntro\s*\(/);
    const lobbyAt = src.search(/openLobby\s*\(/);
    expect(introAt).toBeGreaterThan(-1);
    expect(lobbyAt).toBeGreaterThan(introAt);
    // A callback boundary between the two — an arrow or a `function`.
    expect(src.slice(introAt, lobbyAt)).toMatch(/=>|function/);
  });

  it("and the lobby module is the one that actually enters the tavern", () => {
    // The other half of the route. Without this, `openLobby` could be renamed
    // onto anything at all and the assertion above would still pass — the
    // regression worth catching is the lobby not coming up, not the spelling.
    const lobby = readFileSync(join(__dirname, "..", "run", "lobby.ts"), "utf8");
    expect(lobby).toMatch(/enterTavern\s*\(/);
  });
});

/**
 * A window and a document thin enough to boot the gate, and nothing more.
 *
 * The point is that a SKIPPED intro must not touch either — so `createElement`
 * counts its calls and the gate tests assert it was never reached.
 */
interface Harness {
  created: string[];
  rafs: number;
  /** The stubbed window, so a case can flip one gate without a cast. */
  win: { matchMedia: () => { matches: boolean }; __skipDungeonIntro?: boolean };
}

function installDom(search: string): Harness {
  const created: string[] = [];
  let rafs = 0;
  const win: Harness["win"] & Record<string, unknown> = {
    location: { search },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: () => ++rafs,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    innerWidth: 1600,
    innerHeight: 900,
  };
  const doc = {
    getElementById: () => null,
    body: { appendChild: () => {} },
    createElement: (t: string) => {
      created.push(t);
      throw new Error("stop — the intro got past the gate and started building");
    },
    fonts: { check: () => true, load: () => Promise.resolve() },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", win.requestAnimationFrame);
  return {
    win,
    created,
    get rafs() {
      return rafs;
    },
  };
}

/**
 * A fresh module graph per case — `played` is module state, and the whole point
 * of it is that it survives a second call.
 */
async function freshIntro(): Promise<{ run: (cb: () => void) => void }> {
  vi.resetModules();
  const { state } = await import("../state");
  // The gate is checked AFTER `!renderer || !scene || !camera || !pixelPass`, so
  // without these four every case would return early for the wrong reason and
  // every assertion below would pass vacuously.
  state.renderer = {} as never;
  state.scene = {} as never;
  state.camera = {} as never;
  state.pixelPass = {} as never;
  state.player = null;
  const { runPinballIntro } = await import("./index");
  return { run: runPinballIntro };
}

describe("who does not see the title intro", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => vi.unstubAllGlobals());

  it.each([
    ["?autostart=1", "the harness entry — playtest.mjs and __dungeonBot"],
    ["?no-intro=1", "the documented opt-out"],
    ["?autostart=1&gpu=webgpu", "still skips with other params alongside"],
  ])("skips straight to onDone on %s — %s", async (search) => {
    const h = installDom(search);
    const { run } = await freshIntro();
    const onDone = vi.fn();
    run(onDone);
    expect(onDone).toHaveBeenCalledTimes(1);
    // Skipped means SKIPPED: no canvases, no RAF, nothing to tear down.
    expect(h.created).toEqual([]);
    expect(h.rafs).toBe(0);
  });

  it("skips when __skipDungeonIntro is set", async () => {
    const h = installDom("");
    h.win.__skipDungeonIntro = true;
    const { run } = await freshIntro();
    const onDone = vi.fn();
    run(onDone);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(h.created).toEqual([]);
  });

  it("skips when the player asked for reduced motion", async () => {
    const h = installDom("");
    h.win.matchMedia = () => ({ matches: true });
    const { run } = await freshIntro();
    const onDone = vi.fn();
    run(onDone);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(h.created).toEqual([]);
  });

  it("THE NEGATIVE CONTROL — with no gate set it gets past and starts building", async () => {
    // Without this every assertion above would hold for a `runPinballIntro` that
    // did nothing at all, or that returned early because the fake renderer was
    // rejected. `createElement` throws on purpose: reaching it IS the proof the
    // gate let this one through.
    const h = installDom("");
    const { run } = await freshIntro();
    const onDone = vi.fn();
    expect(() => run(onDone)).toThrow(/past the gate/);
    expect(onDone).not.toHaveBeenCalled();
    // Whatever it reached for first (the pixel-font <style>, then its canvases),
    // reaching the DOM at all is the proof: every skip case above asserts this
    // list is EMPTY.
    expect(h.created.length).toBeGreaterThan(0);
  });

  it("plays ONCE per page load — the second launch goes straight to the lobby", async () => {
    // `launchDungeonGame` runs again every time the player re-enters the dungeon
    // from the site. A title sequence on the second entry of one visit is one you
    // sit through, not one you watch.
    installDom("");
    const { run } = await freshIntro();
    expect(() => run(vi.fn())).toThrow(/past the gate/); // first: plays (and marks itself)
    const onDone = vi.fn();
    run(onDone); // second: must not play
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
