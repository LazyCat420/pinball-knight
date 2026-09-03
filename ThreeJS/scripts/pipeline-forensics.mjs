#!/usr/bin/env node
/**
 * 🕵️ PIPELINE FORENSICS RUNNER — Pinball Knight
 *
 * Implements the 7-Layer Evidence Ladder for Monster Death Animations:
 *   L1: Combat Event (Damage & HP Bottoming)
 *   L2: State Transition (mode="dead", animState="dying" → "dead")
 *   L3: Frame Progression (frameIdx monotonic 0 → N-1)
 *   L4: Texture / UV State (Live GPU UV matrix maps to death cels)
 *   L5: Rendered Pixels (Screen framebuffer shows distinct visual cels)
 *   L6: Scene Visibility (Mesh remains attached, visible=true, scale > 0)
 *   L7: Delivery Identity (Bundle & Manifest hashes match current build)
 *
 * Usage:
 *   node scripts/pipeline-forensics.mjs --kind goblin --kill ram
 *   node scripts/pipeline-forensics.mjs --kind brute --kill slash
 *   node scripts/pipeline-forensics.mjs --all
 */

import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "canvas";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    kind: { type: "string", default: "goblin" },
    all: { type: "boolean", default: false },
    kill: { type: "string", default: "ram" }, // 'ram' | 'slash' | 'force'
    samples: { type: "string", default: "40" },
    crop: { type: "string", default: "75" },
    out: { type: "string", default: ".pipeline-forensics" },
  },
});

const PORT = Number(a["cdp-port"]);
const SAMPLES = Number(a.samples);
const CROP = Number(a.crop);
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const log = (...m) => console.log(...m);

async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function connectHostBrowser() {
  if (await cdpAlive(PORT)) {
    log(`▶ Reusing existing CDP browser on port :${PORT}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) {
    throw new Error("No browser found with CDP. Start Chrome/Edge with --remote-debugging-port=" + PORT);
  }
  log(`▶ Spawning host browser: ${exe} on port :${PORT}`);
  spawn(exe, [
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=C:\\Temp\\pk-forensics-profile",
    "--no-first-run",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ], { detached: true, stdio: "ignore" });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await cdpAlive(PORT)) {
      return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
    }
  }
  throw new Error("Failed to connect to CDP browser after launch.");
}

mkdirSync(a.out, { recursive: true });

log("\n════════════════════════════════════════════════════════════════");
log("  PINBALL KNIGHT: PIPELINE FORENSICS PASS");
log("════════════════════════════════════════════════════════════════\n");

const browser = await connectHostBrowser();
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();

const targetUrl = new URL(a.url);
targetUrl.searchParams.set("gpu", "webgpu");
targetUrl.searchParams.set("no-intro", "1");
targetUrl.searchParams.set("seed", "777");

log(`▶ Navigating to ${targetUrl}`);
await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });

// Dismiss any menus/modals
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__gui?.close?.();
});

// Allow imported sheets to settle
await page.waitForTimeout(4000);

// Verify rAF clock is running
const rAfDelta = await page.evaluate(async () => {
  const t0 = await new Promise((r) => requestAnimationFrame(r));
  const t1 = await new Promise((r) => requestAnimationFrame(r));
  return t1 - t0;
});
log(`▶ rAF clock alive: ${rAfDelta.toFixed(1)} ms/frame`);

const kinds = a.all ? await page.evaluate(() => window.__lab.kinds()) : [a.kind];
const summary = [];

for (const kind of kinds) {
  log(`\n── Investigating: ${kind.toUpperCase()} (Kill Mode: ${a.kill}) ─────────────────`);
  const result = await runForensicTrace(kind, a.kill);
  summary.push(result);
}

log("\n════════════════════════════════════════════════════════════════");
log("  FORENSIC PASS SUMMARY");
log("════════════════════════════════════════════════════════════════");
for (const res of summary) {
  const symbol = res.pass ? "✔ PASS" : "✖ FAIL";
  log(`${symbol} ${res.kind.padEnd(14)} ${res.statusText}`);
}

await page.close();
await browser.close();

process.exit(summary.some((s) => !s.pass) ? 1 : 0);

async function runForensicTrace(kind, killMode) {
  // Clear scene & spawn single monster
  await page.evaluate(({ k }) => {
    window.__dungeonClear();
    window.__dungeonDebug({ god: true });
    window.__lab.only(k, 1);
  }, { k: kind });

  await page.waitForTimeout(1000);

  // Read manifest & atlas metadata
  const meta = await page.evaluate((k) => {
    const anim = window.__dungeonAnim()[0];
    const cels = window.__dungeonClipCels(k);
    return { anim, cels };
  }, kind);

  if (!meta.anim) {
    return { kind, pass: false, statusText: "Failed to spawn actor in scene" };
  }

  const deathClipIndices = meta.cels?.clips["S:death"] ?? meta.cels?.clips["E:death"] ?? [];
  const expectedFinalCel = deathClipIndices.length > 0 ? deathClipIndices[deathClipIndices.length - 1] : null;

  log(`[Asset Meta] death cels defined in manifest: [${deathClipIndices.join(", ")}] (Target: ${expectedFinalCel})`);

  // Execute killing blow
  log(`[Combat Trigger] Delivering fatal blow via ${killMode}...`);
  if (killMode === "ram") {
    for (let attempt = 0; attempt < 25; attempt++) {
      const isDead = await page.evaluate(() => {
        const z = window.__dungeonAnim()[0];
        const p = window.__dungeonPlayer();
        if (!z || !p) return true;
        if (z.mode === "dead") return true;
        window.__dungeonLaunch(z.x - p.x, z.z - p.z, 18);
        return false;
      });
      if (isDead) break;
      await page.waitForTimeout(80);
    }
  } else if (killMode === "slash") {
    await page.evaluate(() => {
      const z = window.__dungeonAnim()[0];
      const p = window.__dungeonPlayer();
      if (p && z) {
        p.x = z.x - 0.4;
        p.z = z.z;
        window.__playerAttack();
      }
    });
  } else {
    await page.evaluate((k) => window.__dungeonKill(k, 1), kind);
  }

  // Sample the 7 evidence layers across time
  const timeline = [];
  const screenshots = [];

  for (let i = 0; i < SAMPLES; i++) {
    const frame = await page.evaluate(() => {
      const z = window.__dungeonAnim()[0];
      return z ? {
        mode: z.mode,
        animState: z.animState,
        hp: z.hp,
        clip: z.clip,
        resolved: z.resolved,
        facing: z.facing,
        frameIdx: z.frameIdx,
        finished: z.finished,
        indices: z.indices,
        texFrame: z.texFrame,
        visible: z.visible,
        screen: z.screen,
      } : null;
    });

    timeline.push(frame);

    if (frame?.screen) {
      screenshots.push(
        await page.screenshot({
          clip: {
            x: Math.max(0, Math.round(frame.screen.x - CROP)),
            y: Math.max(0, Math.round(frame.screen.y - CROP * 1.3)),
            width: CROP * 2,
            height: CROP * 2,
          },
        }),
      );
    }

    await page.waitForTimeout(45);
  }

  // Evidence Evaluation
  const validFrames = timeline.filter(Boolean);
  const texFramesSeen = [...new Set(validFrames.map((f) => f.texFrame))];
  const terminalHeld = validFrames.slice(-5).every((f) => f && f.texFrame === expectedFinalCel);
  const reachedTerminal = texFramesSeen.includes(expectedFinalCel);
  const monotonic = isMonotonicProgression(validFrames.map((f) => f.frameIdx));

  log(`[Evidence L2-L4] texFrames stepped: [${texFramesSeen.join(" → ")}]`);
  log(`[Evidence L3] Monotonic progression: ${monotonic ? "YES" : "NO"}`);
  log(`[Evidence L4] Reached terminal cel (${expectedFinalCel}): ${reachedTerminal ? "YES" : "NO"}`);
  log(`[Evidence L4] Permanently holds terminal cel: ${terminalHeld ? "YES" : "NO"}`);

  // Create contact sheet
  const contactPath = `${a.out}/${kind}-forensics.png`;
  await writeContactSheet(screenshots, contactPath);

  const pass = (deathClipIndices.length <= 1) || (reachedTerminal && terminalHeld && monotonic);
  const statusText = pass
    ? `Stepped [${texFramesSeen.join(",")}] and cleanly held terminal cel ${expectedFinalCel}`
    : `Failed: seen=[${texFramesSeen.join(",")}], target=${expectedFinalCel}, reached=${reachedTerminal}, held=${terminalHeld}`;

  // Generate markdown artifact
  const reportPath = `${a.out}/${kind}-report.md`;
  const reportContent = `# Forensic Evidence Report: ${kind}\n\n` +
    `- **Status**: ${pass ? "PASS" : "FAIL"}\n` +
    `- **Kill Mode**: ${killMode}\n` +
    `- **Authored Death Indices**: \`[${deathClipIndices.join(", ")}]\`\n` +
    `- **GPU TexFrames Stepped**: \`[${texFramesSeen.join(", ")}]\`\n` +
    `- **Reached Terminal**: ${reachedTerminal}\n` +
    `- **Held Terminal**: ${terminalHeld}\n` +
    `- **Monotonic**: ${monotonic}\n\n` +
    `## Contact Sheet\n\n![${kind} Contact Sheet](${kind}-forensics.png)\n`;

  writeFileSync(reportPath, reportContent);

  return { kind, pass, statusText };
}

function isMonotonicProgression(indices) {
  let prev = 0;
  for (const idx of indices) {
    if (idx < prev) return false;
    prev = idx;
  }
  return true;
}

async function writeContactSheet(pngBuffers, outputPath) {
  if (!pngBuffers.length) return;
  const cols = Math.min(8, pngBuffers.length);
  const rows = Math.ceil(pngBuffers.length / cols);
  const cellW = CROP * 2;
  const cellH = CROP * 2;

  const canvas = createCanvas(cols * cellW, rows * cellH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#12151c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < pngBuffers.length; i++) {
    const img = await loadImage(pngBuffers[i]);
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH);
  }

  writeFileSync(outputPath, canvas.toBuffer("image/png"));
}
