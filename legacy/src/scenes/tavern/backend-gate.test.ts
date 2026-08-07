/**
 * THE TAVERN MUST NOT BE A BLACK SCREEN THAT NEVER ENDS.
 *
 * `presentMode` returns "none" while the backend is coming up, and "none"
 * presents NOTHING — no room, no UI layer, no modal. That is fine for a few
 * frames and catastrophic forever, so the two ways it became forever are the
 * two tests that matter here:
 *
 *   1. `init()` rejected and nothing caught it (reproduced live with
 *      `?tavernfail=1`: the title intro plays, then a permanently black screen
 *      with nothing on it — the reported bug).
 *   2. the pipeline warm ran inside the same gate with no bound on it.
 *
 * Both are pure choreography, which is why they live in a module `core.ts`
 * delegates to rather than inside a file that needs a GPU to import.
 */
import { describe, it, expect, vi } from "vitest";
import { openBackend, WARM_BUDGET_MS } from "./backend-gate";

/** A promise that never settles — a hung init, or a hung warm. */
const never = (): Promise<never> => new Promise(() => {});
const immediately = (): Promise<void> => Promise.resolve();

describe("openBackend", () => {
  it("presents the room once init and the warm are done", async () => {
    const onReady = vi.fn();
    const onFailed = vi.fn();
    const warm = vi.fn(immediately);
    await openBackend({ init: immediately, warm, sleep: never, onReady, onFailed });
    expect(warm).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledOnce();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("presents the room when the warm is disabled", async () => {
    const onReady = vi.fn();
    await openBackend({ init: immediately, warm: null, sleep: never, onReady, onFailed: vi.fn() });
    expect(onReady).toHaveBeenCalledOnce();
  });

  /**
   * REGRESSION 1 — the reported bug.
   *
   * Before the gate this was `void renderer.init().then(...)` with no catch, so
   * a rejection left `rendererReady` false for the life of the page. The DOM
   * fallback in index.ts could not help: it is chosen off `openTavernScene`'s
   * SYNCHRONOUS return, which already committed to "scene".
   */
  it("reports failure — and NEVER readiness — when init rejects", async () => {
    const onReady = vi.fn();
    const onFailed = vi.fn();
    const boom = new Error("no adapter");
    await openBackend({ init: () => Promise.reject(boom), warm: null, sleep: never, onReady, onFailed });
    expect(onFailed).toHaveBeenCalledWith(boom);
    // Not merely "we told someone". `render()` throws on an uninitialised
    // backend, so readiness here would trade a black screen for an exception
    // every frame — this is the assertion, not the one above.
    expect(onReady).not.toHaveBeenCalled();
  });

  it("does not run the warm when init rejected", async () => {
    const warm = vi.fn(immediately);
    await openBackend({
      init: () => Promise.reject(new Error("no adapter")),
      warm,
      sleep: never,
      onReady: vi.fn(),
      onFailed: vi.fn(),
    });
    expect(warm).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION 2 — the same black screen, reached by patience instead of by
   * failure. A warm that never settles used to hold `rendererReady` false for
   * as long as it liked, and the player cannot tell that apart from a crash.
   */
  it("presents the room anyway when the warm outlives its budget", async () => {
    const onReady = vi.fn();
    const onFailed = vi.fn();
    const sleep = vi.fn(immediately); // the budget elapses instantly
    await openBackend({ init: immediately, warm: never, sleep, onReady, onFailed });
    expect(sleep).toHaveBeenCalledWith(WARM_BUDGET_MS);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("presents the room when the warm rejects", async () => {
    // warmTavern swallows its own errors today. This is here so a rewrite that
    // stops doing that cannot turn a slow first frame back into a dead screen.
    const onReady = vi.fn();
    await openBackend({
      init: immediately,
      warm: () => Promise.reject(new Error("compile failed")),
      sleep: never,
      onReady,
      onFailed: vi.fn(),
    });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("settles exactly one way, always", async () => {
    // The caller presents nothing until it hears back, so "neither callback
    // ran" is the same bug as both running.
    for (const init of [immediately, () => Promise.reject(new Error("x"))]) {
      const onReady = vi.fn();
      const onFailed = vi.fn();
      await openBackend({ init, warm: null, sleep: never, onReady, onFailed });
      expect(onReady.mock.calls.length + onFailed.mock.calls.length).toBe(1);
    }
  });
});
