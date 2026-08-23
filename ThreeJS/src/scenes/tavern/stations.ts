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

/**
 * The station prompt moved to `scene-screens.ts` — it is painted inside the
 * pixel pass now, like every other readout in the app. Its `StationPrompt`
 * interface lives there too, so this file is back to being about stations
 * rather than about an element.
 */

/** Recompute focus from the player's position. Returns true if it changed. */
export function refreshFocus(next: Station | null): boolean {
  if (tavern.focus?.id === next?.id) return false;
  tavern.focus = next;
  return true;
}
