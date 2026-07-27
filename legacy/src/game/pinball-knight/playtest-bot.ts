/**
 * 🤖 THE PLAYTEST BOT — an autonomous player for unattended soak testing.
 *
 * WHY. Reproducing a performance or stability bug by hand means holding a
 * bounce chain for two minutes and hoping it happens while you are watching.
 * The wall-bounce jitter took a specific, sustained input pattern to surface at
 * all. This drives that pattern for as long as you like and reports numbers.
 *
 * HOW IT DRIVES. Through `__dungeonPad` — the same fake controller the QA hooks
 * expose — so input travels the REAL path: poller → input layer → sim. It does
 * not call movement functions directly and it does not teleport. If the bot can
 * play the game, a human holding a pad can too; if it gets stuck, that is a
 * finding rather than a harness bug.
 *
 * WHAT IT IS NOT. Not an AI and not a win-condition solver — it will not clear
 * a boss floor. It is a load generator with taste: it picks behaviours that
 * stress the parts that historically break (sustained bouncing, ability spam,
 * combat churn) and it watches for things going wrong.
 *
 * USAGE (devtools console, in the dungeon):
 *   __dungeonBot()                     play until stopped, default mix
 *   __dungeonBot({ mode: "bounce" })   the wall-bounce stress case
 *   __dungeonBot({ seconds: 120 })     run two minutes then auto-stop
 *   __dungeonBot({ profile: true })    run the frame profiler alongside
 *   __dungeonBotStop()                 stop and print the report
 *
 * The report is the point. It surfaces STUCK (position not changing while the
 * bot is pushing a stick), DEATHS, floors cleared, and the bounce-combo peak —
 * plus the profiler table when `profile` is on.
 */
import { BTN } from "./gamepad";
import { getProfileSummary, getP95FrameMs, type ProfileStage } from "./profiler";

/** The fake-pad surface installed by core.ts's debug hooks. */
interface FakePad {
  connect(): string;
  disconnect(): string;
  hold(i: number): string;
  release(i: number): string;
  tap(i: number, frames?: number): string;
  stick(x: number, y: number): string;
  aim(x: number, y: number): string;
  state(): { plugged: boolean; axes: number[]; down: number[] };
}

/** The subset of `__dungeonPlayer()` the bot actually reads. */
interface PlayerSnapshot {
  x: number;
  z: number;
  hp: number;
  active: boolean;
  gameOver: boolean;
  bounceCombo: number;
  kills: number;
  momSpeed: number;
  /** True while parked in the launch chute — input cannot move the knight. */
  plungerArmed: boolean;
  plungerCharging: boolean;
}

export type BotMode =
  /** Sustained wall-bouncing — the case that produced the jitter report. */
  | "bounce"
  /** Seek and fight: walk, attack, roll. Exercises combat + VFX churn. */
  | "fight"
  /** Mash abilities and items on cooldown. Exercises the FX/HUD paths. */
  | "abilities"
  /** Rotate through the above. The default; broadest coverage per minute. */
  | "mixed";

export interface BotOptions {
  mode?: BotMode;
  /** Auto-stop after this many seconds. Omit to run until stopped. */
  seconds?: number;
  /** Run the frame profiler for the session and print its table too. */
  profile?: boolean;
  /**
   * How long (ms) the bot may sit within STUCK_EPS of one spot while pushing a
   * direction before it is reported as stuck. Generous: hitstop, knockback and
   * animation locks all legitimately pin the player briefly.
   */
  stuckMs?: number;
}

/** Movement under this distance (world units) counts as "did not move". */
const STUCK_EPS = 0.15;
/** How often the bot re-decides what to do, in ms. */
const DECIDE_MS = 180;

interface BotReport {
  ranSeconds: number;
  mode: BotMode;
  decisions: number;
  deaths: number;
  /** Peak bounce combo observed — the headline number for "bounce" runs. */
  peakCombo: number;
  kills: number;
  /** Distinct stuck episodes (not frames), each with where it happened. */
  stuckEvents: Array<{ atSeconds: number; x: number; z: number }>;
  /** Anything thrown by game code while the bot was driving. */
  errors: string[];
  notes: string[];
  /** p95 whole-frame time in ms — 0 unless the run was started with `profile`. */
  p95FrameMs: number;
  /** Per-stage profiler summary, heaviest first. Empty unless profiling. */
  profile: ProfileStage[];
}

let running = false;
let stopFn: (() => BotReport) | null = null;
/**
 * The most recent finished run's report, kept after the bot stops.
 *
 * WHY: a timed run (`seconds`) auto-stops itself, so by the time a caller asks
 * for the result the bot is already done and `stopFn` is gone. Without this the
 * headless runner — which always calls stop() after waiting — would get a bare
 * "not running" string instead of the report it came for.
 */
let lastReport: BotReport | null = null;

function w(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

function readPlayer(): PlayerSnapshot | null {
  const fn = w().__dungeonPlayer as (() => PlayerSnapshot | null) | undefined;
  return fn ? fn() : null;
}

function pad(): FakePad | null {
  return (w().__dungeonPad as FakePad | undefined) ?? null;
}

/** Eight compass directions as unit stick vectors. */
const DIRS: Array<[number, number]> = [
  [0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7],
  [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7],
];

/**
 * Start the bot. Returns immediately; the bot drives on its own timer until
 * `seconds` elapses or `__dungeonBotStop()` is called.
 */
export function startBot(opts: BotOptions = {}): string {
  if (running) return "bot already running — __dungeonBotStop() first";
  const p = pad();
  if (!p) return "no __dungeonPad — open the dungeon first";

  const mode: BotMode = opts.mode ?? "mixed";
  const stuckMs = opts.stuckMs ?? 2500;
  const startedAt = performance.now();
  // Drop the previous run's result so a caller can never read a stale report
  // and mistake it for this run's.
  lastReport = null;

  const report: BotReport = {
    ranSeconds: 0, mode, decisions: 0, deaths: 0,
    peakCombo: 0, kills: 0, stuckEvents: [], errors: [], notes: [],
    p95FrameMs: 0, profile: [],
  };

  p.connect();

  // Surface anything the game throws while we drive. Without this a bot run
  // "succeeds" silently through a broken frame.
  const onError = (e: ErrorEvent) => {
    const msg = e.message || String(e.error);
    if (report.errors.length < 20 && !report.errors.includes(msg)) report.errors.push(msg);
  };
  window.addEventListener("error", onError);

  if (opts.profile) {
    const prof = w().__dungeonProfile as ((frames?: number) => string) | undefined;
    // Frames, not seconds: ~60fps × the run length, capped so a long soak does
    // not accumulate an enormous sample array.
    if (prof) prof(Math.min(3600, Math.round((opts.seconds ?? 30) * 60)));
  }

  let dirIdx = 0;
  let lastPos = { x: NaN, z: NaN };
  let stillSince = performance.now();
  let stuckOpen = false;
  let lastHp = Infinity;
  let phase = 0;
  /** Frames spent holding the plunger this pull; drives the release. */
  let plungerHeld = 0;

  const decide = () => {
    if (!running) return;
    const snap = readPlayer();
    report.decisions++;

    if (!snap || !snap.active) {
      report.notes.push("player inactive — stopping");
      stop();
      return;
    }

    // ── Watchers ──
    if (snap.bounceCombo > report.peakCombo) report.peakCombo = snap.bounceCombo;
    report.kills = snap.kills;
    if (snap.hp < lastHp && snap.hp <= 0) report.deaths++;
    lastHp = snap.hp;

    // ── The launch chute ──
    // A floor OPENS with the knight parked in the plunger: updatePlunger owns
    // the player and swallows every movement input until the pull is released,
    // so a bot that only pushes the stick sits motionless for the whole run.
    // (That is exactly what the first soak runs did — 0 displacement, reported
    // as a corner "wedge".) Pull, hold a beat to build power, then release.
    if (snap.plungerArmed) {
      plungerHeld++;
      if (plungerHeld === 1) {
        p.stick(0, 0); // steer straight; a held axis rotates the launch line
        p.hold(BTN.A); // A / cross = plunger pull
      } else if (plungerHeld >= 5) {
        p.release(BTN.A); // fire
        plungerHeld = 0;
      }
      // Parked is NOT stuck — the game is holding us on purpose.
      stillSince = performance.now();
      lastPos = { x: snap.x, z: snap.z };
      return;
    }
    if (plungerHeld > 0) {
      // We just LEFT the chute. The pull zeroed the stick and may still hold A;
      // clear both now. Without this the bot idles at neutral until the next
      // heading change — which reads as a mid-map freeze and was reported as a
      // phantom "stuck" for the rest of the run.
      plungerHeld = 0;
      p.release(BTN.A);
      const [rx, rz] = DIRS[dirIdx];
      p.stick(rx, rz);
      stillSince = performance.now();
    }

    // Stuck detection: only meaningful because we KNOW we are pushing a stick.
    const moved = Number.isNaN(lastPos.x)
      ? Infinity
      : Math.hypot(snap.x - lastPos.x, snap.z - lastPos.z);
    if (moved > STUCK_EPS) {
      stillSince = performance.now();
      stuckOpen = false;
    } else if (!stuckOpen && performance.now() - stillSince > stuckMs) {
      stuckOpen = true; // one event per episode, not one per tick
      report.stuckEvents.push({
        atSeconds: Math.round((performance.now() - startedAt) / 100) / 10,
        x: Math.round(snap.x * 10) / 10,
        z: Math.round(snap.z * 10) / 10,
      });
      // Shove hard in a new direction to break out, so the run continues.
      dirIdx = (dirIdx + 3) % DIRS.length;
    }
    lastPos = { x: snap.x, z: snap.z };

    // ── Act ──
    phase++;
    const active: BotMode = mode === "mixed"
      ? (["bounce", "fight", "abilities"] as const)[Math.floor(phase / 12) % 3]
      : mode;

    try {
      if (active === "bounce") {
        // Sprint flat-out and change heading often: the fastest way to rack up
        // wall bounces, which is the load pattern that produced the jitter.
        p.hold(BTN.RT);
        if (phase % 2 === 0) dirIdx = (dirIdx + 1 + Math.floor(Math.random() * 3)) % DIRS.length;
        const [dx, dz] = DIRS[dirIdx];
        p.stick(dx, dz);
      } else if (active === "fight") {
        p.release(BTN.RT);
        if (phase % 4 === 0) dirIdx = Math.floor(Math.random() * DIRS.length);
        const [dx, dz] = DIRS[dirIdx];
        p.stick(dx * 0.8, dz * 0.8);
        if (phase % 3 === 0) p.tap(BTN.X);      // attack
        if (phase % 11 === 0) p.tap(BTN.A);     // roll
      } else {
        p.release(BTN.RT);
        const [dx, dz] = DIRS[dirIdx];
        p.stick(dx * 0.5, dz * 0.5);
        if (phase % 3 === 0) p.tap(BTN.LB);     // ability Q
        if (phase % 5 === 0) p.tap(BTN.RB);     // ability E
        if (phase % 7 === 0) p.tap(BTN.DUP);    // belt item
      }
    } catch (err) {
      const msg = String(err);
      if (!report.errors.includes(msg)) report.errors.push(msg);
    }

    if (opts.seconds && performance.now() - startedAt >= opts.seconds * 1000) stop();
  };

  const timer = window.setInterval(decide, DECIDE_MS);

  function stop(): BotReport {
    if (!running) return report;
    running = false;
    window.clearInterval(timer);
    window.removeEventListener("error", onError);
    const pp = pad();
    if (pp) {
      pp.stick(0, 0);
      pp.release(BTN.RT);
      pp.disconnect();
    }
    report.ranSeconds = Math.round((performance.now() - startedAt) / 100) / 10;

    if (opts.profile) {
      const stopProf = w().__dungeonProfileStop as (() => string) | undefined;
      if (stopProf) stopProf();
      // Read AFTER stopping: the summary is only computed on stop.
      report.profile = getProfileSummary();
      report.p95FrameMs = getP95FrameMs();
    }

    /* eslint-disable no-console */
    console.log(
      `[bot] ${report.mode} — ${report.ranSeconds}s, ${report.decisions} decisions, ` +
        `peak combo ${report.peakCombo}, ${report.kills} kills, ${report.deaths} deaths`,
    );
    if (report.stuckEvents.length) {
      console.warn(`[bot] STUCK ×${report.stuckEvents.length} — the player stopped moving while input was held:`);
      console.table(report.stuckEvents);
    }
    if (report.errors.length) {
      console.error(`[bot] ${report.errors.length} error(s) thrown while playing:`);
      for (const e of report.errors) console.error("   ", e);
    }
    if (!report.stuckEvents.length && !report.errors.length) {
      console.log("[bot] no stuck episodes, no errors.");
    }
    /* eslint-enable no-console */
    stopFn = null;
    lastReport = report;
    return report;
  }

  running = true;
  stopFn = stop;
  return `bot running (${mode})${opts.seconds ? ` for ${opts.seconds}s` : ""} — __dungeonBotStop() to end`;
}

/**
 * Stop a running bot and return its report. If the bot already auto-stopped
 * (timed run), returns that run's report rather than an error — callers want
 * the result, and "it finished on time" is not a failure.
 */
export function stopBot(): BotReport | string {
  if (stopFn) return stopFn();
  return lastReport ?? "bot not running";
}

export function isBotRunning(): boolean {
  return running;
}

/** Wire the console hooks. Safe to call more than once. */
export function installBotHooks(): void {
  if (typeof window === "undefined") return;
  w().__dungeonBot = (opts?: BotOptions) => startBot(opts ?? {});
  w().__dungeonBotStop = () => stopBot();
  // Lets the headless runner poll for completion instead of sleeping for the
  // full duration — a crash or an early self-stop surfaces immediately.
  w().__dungeonBotIsRunning = () => running;
}
