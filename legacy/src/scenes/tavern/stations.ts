/**
 * Station focus — proximity, the contextual prompt, and the floor spotlight.
 *
 * The design rule (TAVERN_PLAN): walking to a station is part of the reward-loop
 * pacing, but it must never feel cumbersome. So: one prompt, one key, a floor
 * spotlight under the station you're near, and its accent light pulses up. No
 * permanent labels cluttering the room.
 */
import * as THREE from "three";
import type { Station } from "./layout";
import { STATIONS } from "./layout";
import { tavern } from "./state";

export interface StationFx {
  /** Move the spotlight under `s` (or hide it when null). */
  setFocus(s: Station | null): void;
  /** Pulse the focused station's accent light. */
  update(dt: number, time: number, accents: Map<string, THREE.PointLight>): void;
  dispose(): void;
}

/** A soft disc on the floor marking the station you're standing at. */
export function createStationFx(scene: THREE.Scene): StationFx {
  const geo = new THREE.CircleGeometry(1.15, 24);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const disc = new THREE.Mesh(geo, mat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  disc.visible = false;
  scene.add(disc);

  let current: Station | null = null;
  let fade = 0;

  return {
    setFocus(s: Station | null): void {
      current = s;
      if (s) {
        disc.position.set(s.x, 0.03, s.z);
        mat.color.setHex(s.accent);
        disc.visible = true;
      }
    },
    update(dt: number, time: number, accents: Map<string, THREE.PointLight>): void {
      // Fade the spotlight in/out rather than popping — a hard cut reads as a bug.
      const target = current ? 1 : 0;
      fade += Math.sign(target - fade) * Math.min(Math.abs(target - fade), dt * 6);
      mat.opacity = fade * (0.22 + Math.sin(time * 4) * 0.05);
      if (fade <= 0.001) disc.visible = false;

      // Every station's accent breathes gently; the focused one breathes harder,
      // so the room stays alive but the target is unambiguous.
      for (const s of STATIONS) {
        const light = accents.get(s.id);
        if (!light) continue;
        const base = light.userData.baseIntensity as number | undefined;
        const b = base ?? light.intensity;
        if (base === undefined) light.userData.baseIntensity = b;
        const focused = current?.id === s.id;
        const breathe = 1 + Math.sin(time * (focused ? 5 : 1.6) + s.x) * (focused ? 0.22 : 0.07);
        light.intensity = b * breathe * (focused ? 1.5 : 1);
      }
    },
    dispose(): void {
      scene.remove(disc);
      geo.dispose();
      mat.dispose();
    },
  };
}

/** The single contextual prompt, parked at the bottom of the screen. */
export interface StationPrompt {
  el: HTMLElement;
  show(s: Station): void;
  hide(): void;
  dispose(): void;
}

export function createStationPrompt(host: HTMLElement): StationPrompt {
  const el = document.createElement("div");
  el.id = "tavern-prompt";
  el.style.cssText = [
    "position:absolute",
    "left:50%",
    "bottom:8%",
    "transform:translateX(-50%)",
    "padding:10px 18px",
    "background:rgba(10,12,16,0.86)",
    "border:2px solid #544e63",
    "color:#e8e2d4",
    "font-family:'Press Start 2P',monospace",
    "font-size:11px",
    "letter-spacing:1px",
    "text-align:center",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity 120ms linear",
    "z-index:10006",
    "image-rendering:pixelated",
  ].join(";");
  host.appendChild(el);

  return {
    el,
    show(s: Station): void {
      const accent = `#${s.accent.toString(16).padStart(6, "0")}`;
      el.style.borderColor = accent;
      el.innerHTML =
        `<div style="color:${accent}">[E] ${s.label.toUpperCase()}</div>` +
        `<div style="font-size:8px;color:#9a8f77;margin-top:6px;letter-spacing:0">${s.blurb}</div>`;
      el.style.opacity = "1";
    },
    hide(): void {
      el.style.opacity = "0";
    },
    dispose(): void {
      el.remove();
    },
  };
}

/** Recompute focus from the player's position. Returns true if it changed. */
export function refreshFocus(next: Station | null): boolean {
  if (tavern.focus?.id === next?.id) return false;
  tavern.focus = next;
  return true;
}
