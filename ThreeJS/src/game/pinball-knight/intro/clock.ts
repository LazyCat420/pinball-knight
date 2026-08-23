/**
 * THE INTRO HAS TWO CLOCKS, AND MERGING THEM MAKES IT FOUR TIMES TOO LONG.
 *
 * The title sequence is authored in seconds — 2.3s of running, 0.35s of
 * hitstop, 0.95s of shatter, 5.2s of camera sweep, 2.6s on the title, 11.4s in
 * total. It also simulates a pinball bouncing around a maze, and that
 * simulation needs its delta CLAMPED: one long frame with an unclamped step
 * moves the ball further than a wall is thick and it tunnels straight through.
 *
 * Those two needs were served by one number:
 *
 *     const dt = Math.min(0.05, (now - lastNow) / 1000);
 *     pt += dt;
 *
 * so the choreography inherited the simulation's clamp, and every frame longer
 * than 50ms donated its overflow to the wall clock and nothing to the sequence.
 * The intro's LENGTH became a function of the frame rate.
 *
 * MEASURED on braindeadbot.com, not reasoned about: `applyImportedArt` rebuilds
 * one monster atlas per kind on the main thread while this plays — six kinds,
 * each roughly a second of blocking canvas work — and against that the 2.3s
 * `run` phase took 8.7s and the whole 11.4s intro took 22s. The player sat
 * through twice the intro they were meant to, most of it as a still frame, and
 * then the lobby. It is a large part of why /dungeon read as hung.
 *
 * Splitting them means a starved frame CATCHES UP rather than stretching, so
 * the sequence can skip animation. That is the intended trade and it is not
 * close: a sequence that ends when it says it does, stuttering, beats one that
 * plays smoothly at a quarter speed.
 */

/** Longest step the ball simulation may take. Above this it tunnels walls. */
export const SIM_DT_CLAMP = 0.05;

export interface IntroDeltas {
  /** Real elapsed seconds. Drives the phase clock and its edge triggers. */
  pdt: number;
  /** Clamped seconds. Drives the ball, the shatter and the screen shake. */
  dt: number;
}

/**
 * @param now      `performance.now()` for this frame, in ms
 * @param lastNow  the previous frame's `now`, or NEGATIVE on the first frame
 *
 * A negative `lastNow` yields a zero step. The origin has to be stamped by the
 * FIRST TICK, not at construction: `runPinballIntro` builds the title maze and
 * calls `compileAsync` synchronously after stamping it, so a construction-time
 * origin handed frame one a delta of however long that took — which, now that
 * the phase clock is honest, would skip part of the sequence before it drew.
 */
export function introDeltas(now: number, lastNow: number): IntroDeltas {
  if (lastNow < 0) return { pdt: 0, dt: 0 };
  const pdt = Math.max(0, (now - lastNow) / 1000);
  return { pdt, dt: Math.min(SIM_DT_CLAMP, pdt) };
}
