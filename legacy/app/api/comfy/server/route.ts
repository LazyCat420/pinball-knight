/**
 * POST /api/comfy/server {action: "start"|"stop"} — run the backend's own
 * launcher scripts. Present only where the backend is (backendPresent()
 * gates it), which is what keeps this exec surface off the deployed NAS
 * container: no ~/comfy there, so the route is a 404.
 *
 * After a start we poll /system_stats for up to 20s so the panel gets a
 * definitive up/still-booting answer instead of a race.
 */
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  backendPresent,
  comfyHome,
  loadSettings,
} from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/forge-config.mjs";

export const dynamic = "force-dynamic";

function runScript(script: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("bash", [join(comfyHome(), script), ...(script === "run.sh" ? ["-d"] : [])], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out: out.trim() }));
  });
}

export async function POST(req: Request) {
  if (!backendPresent()) return NextResponse.json({ error: "no backend on this machine" }, { status: 404 });
  const { action } = await req.json();
  if (action !== "start" && action !== "stop")
    return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });

  const { code, out } = await runScript(action === "start" ? "run.sh" : "stop.sh");
  if (code !== 0) return NextResponse.json({ error: `script exited ${code}: ${out}` }, { status: 500 });

  if (action === "start") {
    const url = loadSettings().comfyUrl;
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(1000), cache: "no-store" });
        if (r.ok) return NextResponse.json({ ok: true, up: true });
      } catch {
        /* still booting */
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
    return NextResponse.json({ ok: true, up: false, note: "started but not answering yet — check ~/comfy/comfy.log" });
  }
  return NextResponse.json({ ok: true, out });
}
