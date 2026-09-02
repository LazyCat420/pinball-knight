/**
 * 🔬 Death Debug & Actor Telemetry Diagnostic Subsystem
 *
 * Activated exclusively when `?death-debug=1` is present in URL search params.
 * Provides:
 * 1. An immutable event trace log on `window.__deathTrace` capturing:
 *    - `damage`
 *    - `kill`
 *    - `play`
 *    - `tick`
 *    - `set_frame`
 *    - `reap`
 * 2. An on-screen floating diagnostics overlay tracking real-time actor state:
 *    - Actor ID & Kind
 *    - HP, maxHp, and ZombieMode
 *    - Facing, Flipped
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

declare global {
  interface Window {
    __deathTrace?: DeathTraceEvent[];
    __inspectActorId?: string | null;
  }
}

let enabled = false;
let traceBuffer: DeathTraceEvent[] = [];
let overlayElement: HTMLDivElement | null = null;

if (typeof window !== "undefined") {
  try {
    const params = new URLSearchParams(window.location.search);
    enabled = params.get("death-debug") === "1";
    if (enabled) {
      window.__deathTrace = traceBuffer;
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
  if (!window.__inspectActorId && (type === "damage" || type === "kill")) {
    window.__inspectActorId = actorId;
  }
}

/**
 * Updates the floating DOM diagnostics badge for the inspected actor.
 */
export function updateDeathDebugOverlay(): void {
  if (!enabled) return;
  if (!overlayElement && typeof document !== "undefined") {
    overlayElement = document.createElement("div");
    overlayElement.id = "death-debug-overlay";
    overlayElement.style.cssText = `
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 999999;
      background: rgba(10, 14, 20, 0.88);
      color: #7ef49a;
      font-family: monospace;
      font-size: 11px;
      line-height: 1.4;
      padding: 10px 14px;
      border: 1px solid #327a4d;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.6);
      pointer-events: none;
      max-width: 320px;
    `;
    document.body.appendChild(overlayElement);
  }

  if (!overlayElement) return;

  // Find inspected actor or default to first goblin / dead actor
  const targetId = window.__inspectActorId;
  let target = targetId ? state.zombies.find((z) => z.dbgId === targetId || z.nid === targetId) : null;
  if (!target) {
    target = state.zombies.find((z) => z.kind === "goblin") || state.zombies.find((z) => z.mode === "dead") || state.zombies[0];
    if (target) window.__inspectActorId = target.dbgId || target.nid;
  }

  if (!target) {
    overlayElement.innerHTML = `<b>[DEATH DEBUGGER]</b><br/>No actors found in state.zombies`;
    return;
  }

  const anim = target.anim;
  const sprite = target.sprite;
  const mesh = sprite?.mesh;
  const tex = mesh?.material ? ((mesh.material as any).map as any) : null;

  // Decode texFrame from texture offset
  let texFrame = -1;
  if (tex && sprite?.sheet) {
    const { cols, rows } = sprite.sheet;
    const col = Math.round(tex.offset.x * cols - (sprite.sheet.cols > 1 ? 0 : 0));
    const row = Math.round(rows - 1 - tex.offset.y * rows);
    texFrame = row * cols + col;
  }

  const build = (window as any).__dungeonBuild ? (window as any).__dungeonBuild() : "N/A";

  overlayElement.innerHTML = `
    <div style="color: #fff; font-weight: bold; border-bottom: 1px solid #333; margin-bottom: 4px; padding-bottom: 2px;">
      💀 ACTOR TELEMETRY: ${target.dbgId || target.nid}
    </div>
    <b>Kind:</b> ${target.kind} | <b>Mode:</b> <span style="color: ${target.mode === "dead" ? "#ff4d4d" : "#4df"}">${target.mode}</span><br/>
    <b>HP:</b> ${target.hp.toFixed(1)} / ${(target.maxHp ?? target.hp).toFixed(1)}<br/>
    <b>Facing:</b> ${anim.getFacing()}<br/>
    <b>Requested Clip:</b> ${anim.getClip()}<br/>
    <b>Internal frameIdx:</b> ${anim.getFrameIdx()} / ${anim.isFinished() ? "FINISHED" : "PLAYING"}<br/>
    <b>Decoded texFrame:</b> <span style="color: #ffd700">${texFrame}</span> (UV: ${tex ? `${tex.offset.x.toFixed(3)}, ${tex.offset.y.toFixed(3)}` : "N/A"})<br/>
    <b>Mesh Visible:</b> ${mesh ? mesh.visible : "N/A"} | <b>Scale:</b> ${mesh ? mesh.scale.x.toFixed(2) : "N/A"}<br/>
    <b>Build:</b> <span style="color: #bbb">${build}</span><br/>
    <div style="font-size: 9px; color: #888; margin-top: 4px;">Trace events: ${traceBuffer.length}</div>
  `;
}
