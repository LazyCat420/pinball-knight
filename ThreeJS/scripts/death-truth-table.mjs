#!/usr/bin/env node
/**
 * 🕵️ DEATH TRUTH-TABLE DIAGNOSTIC RUNNER
 *
 * Runs the real combat kill path against the real browser on the host GPU.
 * Extracts the complete chronological __deathTrace event buffer and frame-by-frame
 * telemetry, saving cropped screenshots and evaluating the Diagnostic Truth Table.
 */
import { chromium } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "https://pinballknight.braindeadbot.com/?gpu=webgpu&no-intro=1&seed=777&death-debug=1" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    kind: { type: "string", default: "goblin" },
    outDir: { type: "string", default: "/home/lazycat/.gemini/antigravity-ide/brain/94d1719d-6c97-4fc8-857e-6cb8342ec5fd/scratch/death-truth-table" },
  },
});

fs.mkdirSync(args.outDir, { recursive: true });

async function run() {
  console.log(`Connecting to CDP on port ${args["cdp-port"]}...`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args["cdp-port"]}`);
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  console.log(`Navigating to ${args.url}...`);
  await page.goto(args.url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60000 });
  await page.evaluate(() => window.__dungeonStartRun());
  await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90000 });
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__gui?.close?.());
  await page.waitForTimeout(3000);

  const buildId = await page.evaluate(() => window.__dungeonBuild ? window.__dungeonBuild() : "unknown");
  console.log(`Live build timestamp: ${buildId}`);

  // Setup: spawn exactly 1 goblin in front of the player
  console.log(`Spawning isolated ${args.kind}...`);
  const spawnInfo = await page.evaluate((k) => {
    window.__dungeonDebug({ god: true });
    window.__lab.only(k, 1);
    const z = window.state.zombies[0];
    const p = window.state.player;
    if (z && p) {
      z.x = p.x;
      z.z = p.z + 1.2;
      z.hp = 12;
      z.mode = "idle";
      if (z.sprite?.mesh) z.sprite.mesh.position.set(z.x, 0, z.z);
    }
    return z ? { dbgId: z.dbgId || z.nid, hp: z.hp, x: z.x, z: z.z } : null;
  }, args.kind);
  console.log("Target actor:", spawnInfo);

  // Execute NATURAL combat: player moves at momentum > gate bar, swings weapon
  console.log("Executing natural player attack with momentum...");
  const hitResult = await page.evaluate(() => {
    const p = window.state.player;
    p.momSpeed = 14; // pinball speed, above momentum gate
    p.facing = "S";
    // swing weapon naturally
    const landed = window.__playerAttack ? window.__playerAttack() : false;
    return { landed, playerMom: p.momSpeed };
  });
  console.log("Hit result:", hitResult);

  // If one hit didn't finish HP, swing again until dead
  await page.evaluate(() => {
    const p = window.state.player;
    const z = window.state.zombies[0];
    let attempts = 0;
    while (z && z.hp > 0 && attempts < 10) {
      p.momSpeed = 14;
      p.facing = "S";
      if (window.__damageZombie) {
        window.__damageZombie(z, 20, 0, 1, 0.5, false, "steel");
      }
      attempts++;
    }
  });

  // Track the actor across 30 samples (~1.8 seconds)
  const samples = [];
  for (let s = 0; s < 30; s++) {
    const snap = await page.evaluate(() => {
      const z = window.state.zombies[0];
      if (!z) return { gone: true };
      const anim = z.anim;
      const sprite = z.sprite;
      const mesh = sprite?.mesh;
      const tex = mesh?.material ? (mesh.material.map) : null;
      let texFrame = -1;
      if (tex && sprite?.sheet) {
        const { cols, rows } = sprite.sheet;
        const col = Math.round(tex.offset.x * cols);
        const row = Math.round(rows - 1 - tex.offset.y * rows);
        texFrame = row * cols + col;
      }
      return {
        dbgId: z.dbgId || z.nid,
        hp: z.hp,
        mode: z.mode,
        facing: anim.getFacing(),
        clip: anim.getClip(),
        frameIdx: anim.getFrameIdx(),
        texFrame,
        uv: tex ? [tex.offset.x, tex.offset.y] : null,
        finished: anim.isFinished(),
        visible: mesh ? mesh.visible : false,
        screen: window.__dungeonAnim ? window.__dungeonAnim()[0]?.screen : null,
      };
    });

    samples.push({ step: s, ...snap });

    // Capture screenshot crop if actor on screen
    if (snap && snap.screen && (s % 3 === 0 || s === 29)) {
      const crop = 75;
      const buf = await page.screenshot({
        clip: {
          x: Math.max(0, Math.round(snap.screen.x - crop)),
          y: Math.max(0, Math.round(snap.screen.y - crop * 1.3)),
          width: crop * 2,
          height: crop * 2,
        },
      });
      const shotFile = path.join(args.outDir, `step_${String(s).padStart(2, "0")}.png`);
      fs.writeFileSync(shotFile, buf);
    }
    await page.waitForTimeout(60);
  }

  // Retrieve __deathTrace
  const trace = await page.evaluate(() => window.__deathTrace || []);
  fs.writeFileSync(path.join(args.outDir, "trace.json"), JSON.stringify(trace, null, 2));
  fs.writeFileSync(path.join(args.outDir, "samples.json"), JSON.stringify(samples, null, 2));

  console.log("\n══════════════════ DIAGNOSTIC SUMMARY ══════════════════");
  console.log(`Total events in __deathTrace: ${trace.length}`);
  const eventTypes = trace.map(t => t.type);
  console.log(`Event types observed: ${[...new Set(eventTypes)].join(", ")}`);
  
  const frameIdxSequence = samples.map(s => s.frameIdx);
  const texFrameSequence = samples.map(s => s.texFrame);
  console.log(`Animator frameIdx sequence: ${JSON.stringify(frameIdxSequence)}`);
  console.log(`Texture texFrame sequence:  ${JSON.stringify(texFrameSequence)}`);
  console.log(`Final sample state:`, samples[samples.length - 1]);

  await page.close();
  await browser.close();
}

run().catch((err) => {
  console.error("Diagnosis runner error:", err);
  process.exit(1);
});
