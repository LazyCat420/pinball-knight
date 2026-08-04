/**
 * GET /api/comfy/manifest — everything the /forge panel needs in one poll:
 * the model registry with per-file install state, the settings (token
 * REDACTED to a boolean — it must never round-trip to the browser), and a
 * liveness probe of the ComfyUI server itself.
 *
 * Runs on the Next server, which is the same WSL box as ~/comfy — that is
 * the whole trick: the browser never talks to ComfyUI or HuggingFace
 * directly, so there is no CORS story and no token in the page.
 */
import { NextResponse } from "next/server";
import { LEGS } from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/manifest.mjs";
import {
  backendPresent,
  comfyHome,
  installState,
  loadSettings,
} from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/forge-config.mjs";

export const dynamic = "force-dynamic";

async function probeComfy(url: string) {
  try {
    const r = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!r.ok) return { reachable: false as const };
    const s = await r.json();
    const d = s.devices?.[0] ?? {};
    return {
      reachable: true as const,
      version: s.system?.comfyui_version ?? "?",
      device: d.name ?? "?",
      vramFreeGiB: d.vram_free ? +(d.vram_free / 2 ** 30).toFixed(1) : null,
      vramTotalGiB: d.vram_total ? +(d.vram_total / 2 ** 30).toFixed(1) : null,
    };
  } catch {
    return { reachable: false as const };
  }
}

export async function GET() {
  const present = backendPresent();
  const settings = loadSettings();
  const legs = present
    ? LEGS.map((leg: any) => ({
        ...leg,
        slots: leg.slots.map((slot: any) => ({
          ...slot,
          options: slot.options.map((o: any) => ({ ...o, install: installState(o) })),
        })),
      }))
    : LEGS;
  return NextResponse.json({
    backendPresent: present,
    comfyHome: comfyHome(),
    comfy: present ? await probeComfy(settings.comfyUrl) : { reachable: false },
    settings: { comfyUrl: settings.comfyUrl, civitaiTokenSet: !!settings.civitaiToken, chosen: settings.chosen },
    legs,
  });
}
