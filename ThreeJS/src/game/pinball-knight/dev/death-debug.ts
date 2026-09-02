/**
 * 🔬 Death Debug & Actor Telemetry Diagnostic Subsystem
 *
 * Activated exclusively when `?death-debug=1` is present in URL search params.
 * Strictly adheres to gui/no-dom rules (zero DOM element creation/modification).
 *
 * Provides:
 * 1. An immutable event trace log on `window.__deathTrace` capturing:
 *    - `damage`
 *    - `kill`
 *    - `play`
 *    - `tick`
 *    - `set_frame`
 *    - `reap`
 * 2. Instantaneous actor telemetry via `window.__deathDebugSnapshot()`:
 *    - Actor ID & Kind
 *    - HP, maxHp, and ZombieMode
 *    - Facing
 *    - Requested Clip vs Resolved Clip
 *    - Animator frameIdx vs Decoded Texture Frame
 *    - Mesh visibility & Build Timestamp
 */
import { state } from "../state";
import type { Zombie } from "../state";

export interface DeathTraceEvent {
  timestamp: number;
  time: number;
  actorId: string;
  kind: string;
  type: "damage" | "kill" | "play" | "tick" | "set_frame" | "reap";
  details: Record<string, unknown>;
}

export interface ActorTelemetrySnapshot {
  actorId: string;
  kind: string;
  mode: string;
  hp: number;
  maxHp: number;
  facing: string;
  clip: string;
  frameIdx: number;
  finished: boolean;
  texFrame: number;
  uv: [number, number] | null;
  meshVisible: boolean;
  build: string;
  totalEvents: number;
}

declare global {
  interface Window {
    __deathTrace?: DeathTraceEvent[];
    __inspectActorId?: string | null;
    __deathDebugSnapshot?: () => ActorTelemetrySnapshot | null;
    __latestActorState?: ActorTelemetrySnapshot | null;
  }
}

let enabled = false;
const traceBuffer: DeathTraceEvent[] = [];

if (typeof window !== "undefined") {
  try {
    const params = new URLSearchParams(window.location.search);
    enabled = params.get("death-debug") === "1";
    if (enabled) {
      window.__deathTrace = traceBuffer;
      window.__deathDebugSnapshot = getDeathDebugSnapshot;
      console.info("[death-debug] Active. Events recorded on window.__deathTrace.");
    }
  } catch {
    enabled = false;
  }
}

export function isDeathDebugEnabled(): boolean {
  return enabled;
}

export function recordDeathTrace(
  z: Zombie | { dbgId?: string; nid?: string; kind?: string },
  type: DeathTraceEvent["type"],
  details: Record<string, unknown> = {},
): void {
  if (!enabled) return;
  const actorId = z.dbgId || z.nid || "unknown";
  const kind = z.kind || "unknown";
  const event: DeathTraceEvent = {
    timestamp: Date.now(),
    time: Number(state.elapsed.toFixed(3)),
    actorId,
    kind,
    type,
    details,
  };

  traceBuffer.push(event);
  if (traceBuffer.length > 2000) traceBuffer.shift();

  // If inspectActorId is not set, latch onto the first damaged or killed actor
  if (typeof window !== "undefined" && !window.__inspectActorId && (type === "damage" || type === "kill")) {
    window.__inspectActorId = actorId;
  }
}

/**
 * Computes instantaneous telemetry snapshot for the inspected actor.
 */
export function getDeathDebugSnapshot(): ActorTelemetrySnapshot | null {
  const targetId = typeof window !== "undefined" ? window.__inspectActorId : null;
  let target = targetId ? state.zombies.find((z) => z.dbgId === targetId || z.nid === targetId) : null;
  if (!target) {
    target = state.zombies.find((z) => z.kind === "goblin") || state.zombies.find((z) => z.mode === "dead") || state.zombies[0];
    if (target && typeof window !== "undefined") window.__inspectActorId = target.dbgId || target.nid;
  }

  if (!target) return null;

  const anim = target.anim;
  const sprite = target.sprite;
  const mesh = sprite?.mesh;
  const tex = mesh?.material ? ((mesh.material as any).map as any) : null;

  // Decode texFrame from texture offset
  let texFrame = -1;
  if (tex && sprite?.sheet) {
    const { cols, rows } = sprite.sheet;
    const col = Math.round(tex.offset.x * cols);
    const row = Math.round(rows - 1 - tex.offset.y * rows);
    texFrame = row * cols + col;
  }

  const build = typeof window !== "undefined" && (window as any).__dungeonBuild ? (window as any).__dungeonBuild() : "N/A";

  return {
    actorId: target.dbgId || target.nid || "unknown",
    kind: target.kind,
    mode: target.mode,
    hp: target.hp,
    maxHp: target.maxHp ?? target.hp,
    facing: anim.getFacing(),
    clip: anim.getClip(),
    frameIdx: anim.getFrameIdx(),
    finished: anim.isFinished(),
    texFrame,
    uv: tex ? [tex.offset.x, tex.offset.y] : null,
    meshVisible: mesh ? mesh.visible : false,
    build,
    totalEvents: traceBuffer.length,
  };
}

/**
 * Updates window.__latestActorState without touching the DOM.
 */
export function updateDeathDebugOverlay(): void {
  if (!enabled || typeof window === "undefined") return;
  window.__latestActorState = getDeathDebugSnapshot();
}
