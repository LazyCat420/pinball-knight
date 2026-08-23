/**
 * BRINGING THE TAVERN'S BACKEND UP WITHOUT A BLACK SCREEN THAT NEVER ENDS.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 * `openTavernScene` used to do the whole thing inline:
 *
 *     rendererReady = false;
 *     void renderer.init().then(async () => {
 *       if (tavernWarmEnabled()) { try { await warmTavern(...) } catch {} }
 *       rendererReady = true;
 *     });
 *
 * Two holes, and both of them are the same black screen to the player, because
 * `presentMode` maps `!rendererReady` to "none" — which presents NOTHING. Not
 * the room, not the UI layer, not the `character-select` modal `openLobby`
 * pushes on top of it. There is no partial state: it is the room or it is a
 * black rectangle.
 *
 *   1. NO `.catch()`. An `init()` that rejects leaves `rendererReady` false
 *      FOREVER. And the DOM fallback in index.ts cannot save it — that is
 *      chosen off `openTavernScene`'s SYNCHRONOUS return value, which already
 *      said "scene" several hundred milliseconds earlier. Reproduced by fault
 *      injection (`?tavernfail=1`, kept below): /dungeon plays its whole title
 *      intro and lands on a black screen with nothing on it, permanently. That
 *      is the reported symptom, word for word — "just a black screen after the
 *      intro".
 *
 *   2. NO BOUND ON THE WARM. `warmTavern` compiles every pipeline in the room,
 *      sequentially, inside the same gate. It is worth doing — it moves the
 *      compile hitch off the first frame a hidden prop draws — but it was
 *      allowed to hold the black screen for as long as it liked. Measured at
 *      ~4s on an RTX 3090 Ti; nobody has measured the floor of that on weak
 *      hardware, and the failure mode there is indistinguishable from hole 1.
 *
 * The rule both holes break is the same one `app-bootstrap.ts` already states
 * for the room mount, in a comment that reads like it was written after exactly
 * this conversation: "never trap the user behind the loading screen". The
 * tavern simply never got its safety valve.
 *
 * ── WHY A MODULE ────────────────────────────────────────────────────────────
 *
 * Same reason as `present.ts` next door: `core.ts` needs a real WebGPU renderer
 * to import at all, so anything left inside it cannot be asserted. The two
 * regressions above are pure choreography — a promise, a timeout and two
 * callbacks — and they are exactly the kind that goes quiet again the moment
 * nobody can write a test for them.
 */

/** How long the room may stay black for the warm before we present anyway.
 *
 * The warm is an optimisation and it says so itself: "a failed precompile is a
 * slow first frame, not a broken room". A slow first frame is a far better
 * outcome than an unbounded black screen, so when the budget runs out we stop
 * waiting and let the renderer compile lazily, exactly as it did before the
 * warm existed. The warm is NOT cancelled — it keeps going underneath and its
 * later units still land; we simply stop making the player watch it. */
export const WARM_BUDGET_MS = 5000;

export interface BackendGateDeps {
  /** `WebGPURenderer.init()` — resolves when the backend is usable. */
  init: () => Promise<unknown>;
  /** `warmTavern(...)`, or null when the warm is disabled (`?tavernwarm=0`). */
  warm: (() => Promise<unknown>) | null;
  /** Injected so a test can run the budget without waiting for it. */
  sleep: (ms: number) => Promise<void>;
  budgetMs?: number;
  /** The renderer is usable — start presenting. Called AT MOST ONCE. */
  onReady: () => void;
  /** The backend is not coming. Called at most once, and never with onReady. */
  onFailed: (err: unknown) => void;
}

/**
 * Drive the backend up. Resolves when the outcome is settled either way; the
 * caller does not await it (the scene has to keep its synchronous return).
 *
 * The ONE invariant: exactly one of `onReady` / `onFailed` runs, and one of
 * them always runs — a caller that presents nothing until it hears back must
 * always hear back.
 */
export async function openBackend(d: BackendGateDeps): Promise<void> {
  try {
    await d.init();
  } catch (err) {
    // The renderer is unusable. `onReady` here would be worse than the black
    // screen: `render()` throws on an uninitialised backend, so we would swap a
    // silent black rectangle for an exception every frame.
    d.onFailed(err);
    return;
  }

  // From here the backend WORKS, so nothing below may keep the screen black.
  if (d.warm) {
    const budget = d.budgetMs ?? WARM_BUDGET_MS;
    // `race`, not `await` — a warm that hangs (a compile that never settles, a
    // rAF that never fires because the tab went to the background mid-warm)
    // must not be able to hold the room. Its own errors are already swallowed
    // internally, but catch here too so a future rewrite cannot reintroduce the
    // hang as a rejection.
    await Promise.race([
      Promise.resolve(d.warm()).catch(() => {}),
      d.sleep(budget),
    ]);
  }

  d.onReady();
}
