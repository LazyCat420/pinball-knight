#!/usr/bin/env node
/**
 * BOSS DEATH LAB — does the guardian of each biome die ON SCREEN, and is it
 * the guardian that biome is supposed to have?
 *
 * ── WHY THIS EXISTS, GIVEN death-lab AND death-swarm ────────────────────────
 *
 * Neither of those can reach a boss. `__lab.spawn(kind)` takes an EnemyKind and
 * "dragon" is not one: every guardian spawns as a `brute` wearing a boss atlas,
 * on the floor its BIOME selects, at the end of a real descent. So a boss's
 * death animation has only ever been INFERRED from the ordinary monsters' —
 * same sprite factory, same quad, same UV path — and inference is what this
 * repo has been burned by. The Ancient Dragon in particular could not be
 * spawned at all until 2026-09-04: he guards `magma`, and the floor generator
 * had no magma band, so no depth at any seed produced him.
 *
 * ── THE THREE CHANNELS, KEPT APART ─────────────────────────────────────────
 *
 * A death that does not play and a monster that never died produce the same
 * trace, and 26 false reds were once printed by a probe that could not tell
 * them apart. So every actor gets a PRECONDITION verdict before any claim
 * about art, and the art claim itself is read on three independent channels
 * that fail independently:
 *
 *   frameIdx  what the ANIMATOR thinks       → freeze-js is visible here
 *   texFrame  what the TEXTURE is sampling   → freeze-gpu is visible here
 *   pixels    what the SCREEN actually drew  → freeze-quad is visible ONLY here
 *
 * The third one matters because the bug this repo actually shipped had the
 * animator, the offset and the matrix all CORRECT and the screen stale — every
 * JavaScript reading was green while three of four monsters held cel 0.
 *
 * The pixel test is self-calibrating rather than thresholded: the boss's own
 * crop is differenced across the death window and across a QUIESCENT window
 * after it has settled. A corpse that has finished animating is static, so
 * "during ≫ after" is the signal and "during ≈ after" is a frozen quad. No
 * number invented by me sits in the middle of it.
 *
 * ── N > 1 ──────────────────────────────────────────────────────────────────
 *
 * The UV bug survived 34 commits because every probe killed exactly ONE
 * monster; the per-object uniform upload was skipped, so the first actor was
 * always fine. `--load N` puts N ordinary monsters on the floor and kills them
 * in the same tick as the boss, and every actor is scored separately.
 *
 * ── THE CONTROL ────────────────────────────────────────────────────────────
 *
 * The probe refuses to report until it has been shown to go red: it sabotages
 * the boss with `freeze-quad` on a throwaway pass and aborts the whole run if
 * that comes back PLAYED. A probe whose number cannot move is measuring itself.
 *
 *   node scripts/boss-death-lab.mjs                    # every guardian
 *   node scripts/boss-death-lab.mjs --floors 21        # just the dragon
 *   node scripts/boss-death-lab.mjs --floors 21 --load 24
 *   node scripts/boss-death-lab.mjs --no-control       # you had better mean it
 *
 * Needs `playwright` + `canvas` and a HOST browser over CDP — the game is
 * WebGPU-only and WSL's llvmpipe is not a GPU. Same contract as death-lab.mjs.
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
    /**
     * Depths to visit, and the guardian each is EXPECTED to produce. The
     * expectation is deliberately spelled out here rather than read back from
     * the game: this probe's job is to catch the schedule and the roster
     * disagreeing, and a probe that asks the game what to expect can only ever
     * agree with it. `boss-roster.test.ts` checks table against table; this
     * checks the running game against what a player was promised.
     */
    floors: { type: "string", default: "5:reaper_king,10:broodmother,15:overlord,20:archivist,21:dragon" },
    /** Ordinary monsters on the floor alongside the boss — the N > 1 regime. */
    load: { type: "string", default: "12" },
    /** Samples of the death window. 40 × ~70 ms ≈ 2.8 s. */
    frames: { type: "string", default: "40" },
    /** Sabotage mode for negative control. */
    sabotage: { type: "string", default: "freeze-gpu" },
    /** Skip the sabotage control. Only for debugging the probe itself. */
    "no-control": { type: "boolean", default: false },
    out: { type: "string", default: ".boss-death-lab" },
    headed: { type: "boolean", default: false },
  },
});

const PORT = Number(a["cdp-port"]);
const FRAMES = Number(a.frames);
const LOAD = Number(a.load);
const PLAN = String(a.floors)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [f, kind] = s.split(":");
    return { floor: Number(f), expect: kind ?? null };
  });
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
const log = (...m) => console.log(...m);
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : "n/a");

async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The host GPU browser. Same contract as scripts/death-lab.mjs. */
async function connectHostGpu() {
  if (await cdpAlive(PORT)) {
    log(`▶ reusing CDP browser on :${PORT}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;
  const p = spawn(
    exe,
    [
      a.headed ? "--new-window" : "--headless=new",
      "--mute-audio",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\pk-boss-death-lab",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  p.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(PORT)) return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
  }
  return null;
}

const browser = await connectHostGpu();
if (!browser) {
  console.error("✖ No host browser found — WebGPU is not reachable from WSL2 without one.");
  process.exit(2);
}
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
await page.addInitScript(() => {
  if (typeof window.process === "undefined") window.process = { env: {} };
});
page.on("pageerror", (e) => log("[pageerror]", String(e.message).slice(0, 160)));

const url = new URL(a.url);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("no-intro", "1");
url.searchParams.set("seed", "777");
log(`▶ ${url}`);
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__gui?.close?.();
});
// Imported art lands AFTER the first playable frame (boot/sheets.ts) and every
// boss atlas is one of its rebuilds. Sampling before it resolves measures the
// PAINTER, which is a different creature wearing the same name.
await page.waitForTimeout(20_000);

// rAF is what steps the animator. A throttled page reports a frozen animation
// that is really a frozen PAGE, and this family of harness has been fooled by
// that before. Prove the clock runs before trusting anything below.
const ticked = await page.evaluate(async () => {
  const t0 = await new Promise((r) => requestAnimationFrame(r));
  const t1 = await new Promise((r) => requestAnimationFrame(r));
  return t1 - t0;
});
if (!(ticked > 0)) {
  console.error("✖ rAF is not running on this page — every animation would read as frozen.");
  process.exit(3);
}
log(`▶ rAF alive (${ticked.toFixed(1)} ms between frames)`);

const hasSabotage = await page.evaluate(() => typeof window.__dungeonSabotage === "function");
mkdirSync(a.out, { recursive: true });

// ── THE CONTROL, FIRST ─────────────────────────────────────────────────────
let controlNote = "control SKIPPED (--no-control)";
if (!a["no-control"]) {
  if (!hasSabotage) {
    console.error("✖ __dungeonSabotage is missing from this build — the control cannot run, so nothing below");
    console.error("  would be worth reading. Build the dev hooks, or pass --no-control and say so in the report.");
    process.exit(4);
  }
  const sabotageMode = a.sabotage ?? "freeze-gpu";
  const c = await runFloor({ floor: PLAN[0].floor, expect: null, sabotage: sabotageMode, label: "control" });
  const bossRow = c.actors.find((x) => x.isBoss);
  if (!bossRow) {
    console.error("✖ the control pass never found a boss to sabotage — the probe cannot be validated.");
    process.exit(4);
  }
  if (bossRow.verdict === "PLAYED") {
    log("\n✖ SABOTAGE CONTROL FAILED — this run is invalid.");
    log(`   ${sabotageMode} on the boss still scored ${bossRow.verdict}: ${bossRow.line}`);
    log("   The probe cannot see the failure it exists to see. Fix the probe, not the game.");
    await page.close();
    process.exit(4);
  }
  controlNote = `control OK (${sabotageMode} on the boss scored ${bossRow.verdict})`;
  log(`▶ ${controlNote}`);
}

const runs = [];
for (const step of PLAN) {
  runs.push(await runFloor({ ...step, sabotage: null, label: `f${step.floor}` }));
}

log("\n── BOSS DEATH ─────────────────────────────────────────────────");
log(controlNote);
let red = 0;
for (const r of runs) {
  const boss = r.actors.find((x) => x.isBoss);
  const others = r.actors.filter((x) => !x.isBoss);
  const bad = others.filter((x) => x.verdict !== "PLAYED" && x.verdict !== "NEVER-DIED").length;
  const ok = r.guardianOk && boss?.verdict === "PLAYED" && bad === 0;
  if (!ok) red++;
  log(
    `${ok ? "✔" : "✖"} floor ${String(r.floor).padStart(3)} · ${String(r.biome ?? "?").padEnd(11)} · ` +
      `${String(r.bossKind ?? "NONE").padEnd(12)} ${r.guardianOk ? "" : `← EXPECTED ${r.expect} `}` +
      `· boss ${boss?.verdict ?? "ABSENT"} · ${others.length} others: ${bad} not PLAYED`,
  );
  if (boss) log(`      ${boss.line}`);
  for (const x of others.filter((o) => o.verdict !== "PLAYED").slice(0, 10)) log(`      ${x.id.padEnd(14)} ${x.line}`);
}
writeFileSync(`${a.out}/report.json`, JSON.stringify({ controlNote, load: LOAD, runs }, null, 2));
log(`\nartefacts in ${a.out}/ (report.json, per-floor contact sheets)`);
await page.close();
process.exit(red ? 1 : 0);

// ═══════════════════════════════════════════════════════════════════════════

/**
 * One floor: jump to it, check WHICH guardian arrived, pile the horde on, kill
 * everything through the real damage path, and score each actor twice.
 */
async function runFloor({ floor, expect, sabotage, label }) {
  await page.evaluate((n) => {
    window.__dungeonDebug?.({ god: true, noTide: true });
    window.__lab.floor(n);
  }, floor);
  // The floor build is held behind a loading gate; wait for the guardian to
  // exist AND for floor loading to release rather than a wall-clock guess.
  await page.waitForFunction(
    () => window.__dungeonBoss?.()?.king != null && window.__dungeonHeld?.() === false,
    null,
    { timeout: 60_000, polling: 100 },
  );
  await page.evaluate(() => {
    window.__dungeonDebug?.({ god: true, noTide: true });
  });
  await page.waitForTimeout(500);

  const bossInfo = await page.evaluate(() => window.__dungeonBoss());
  const bossKind = bossInfo?.king?.bossKind ?? null;
  const biome = await page.evaluate(() => window.__dungeonFloor?.()?.biome ?? null);
  const guardianOk = !expect || bossKind === expect;
  log(`\n▶ ${label}: floor ${floor} · guardian ${bossKind ?? "NONE"}${expect ? ` (expected ${expect})` : ""}`);
  // Warp the knight back so the camera frames the arena,
  // clear ambient maze adds so only the boss and arena load are scored,
  // and hide the player sprite so the knight's idle breathing doesn't pollute corpse crops.
  await page.evaluate(() => {
    const k = window.__dungeonBoss()?.king;
    if (k) {
      window.__dungeonWarp?.(k.x, k.z - 5.5);
      window.__dungeonHidePlayer?.(true);
    }
    window.__dungeonClearAdds?.();
  });
  await page.waitForTimeout(800);

  if (LOAD > 0) {
    await page.evaluate((n) => window.__lab.spawn("goblin", n, { ring: 4, aggro: false }), LOAD);
    await page.waitForTimeout(800);
  }

  if (sabotage) {
    // freeze-quad must be installed BEFORE the kill: triggerDeath seats cel 0
    // through the same path, which would hide the difference.
    const s = await page.evaluate((m) => window.__dungeonSabotage("boss", 0, m), sabotage);
    log(`   sabotage ${sabotage} → ${s ? s.dbgId : "NOT APPLIED"}`);
  }

  // ── ARE THE ANIMATORS EVEN RUNNING? ──
  // sim/loop.ts returns early while a floor is held, and in that state NOTHING
  // ticks. Every actor would score frozen and the report would blame the game
  // for a harness that started measuring too early.
  {
    await page.evaluate(() => { window.__bossPrevTicks = null; });
    const t0 = (await anim()).map((z) => z.ticks?.ticks ?? -1);
    await page.waitForTimeout(400);
    const t1 = (await anim()).map((z) => z.ticks?.ticks ?? -1);
    if (!(t0.length && t1.every((v, i) => v > t0[i]))) {
      log("   ⚠ animators are not ticking yet — waiting for the clock rather than scoring a stopped game");
      await page.waitForFunction(
        () => {
          const now = window.__dungeonAnim().map((z) => z.ticks?.ticks ?? -1);
          const prev = window.__bossPrevTicks;
          window.__bossPrevTicks = now;
          return prev != null && now.length > 0 && now.every((v, i) => v > prev[i]);
        },
        null,
        { timeout: 30_000, polling: 300 },
      );
    }
  }

  // ── THE JS/UV CHANNEL IS RECORDED IN THE PAGE, NOT POLLED OVER CDP ──
  // A page.evaluate round-trip is 15-30 ms and a screenshot 60-90 ms, so a
  // polled sample lands roughly once per death cel and a real 0→1→2→3 reads as
  // [0,2,3]. "Skipped a cel" and "never played a cel" are the two readings this
  // harness exists to separate, so the fast channel is sampled once per rAF
  // inside the page and read out at the end.
  await page.evaluate(() => {
    window.__bossTrace = [];
    window.__bossStop = false;
    const initP = window.__dungeonPlayer?.();
    const pinX = initP?.x ?? 0;
    const pinZ = initP?.z ?? 0;
    const tick = () => {
      if (window.__bossStop) return;
      const t = performance.now();
      if (initP && window.__dungeonWarp) {
        window.__dungeonWarp(pinX, pinZ);
        window.__dungeonHidePlayer?.(true);
      }
      for (const z of window.__dungeonAnim()) {
        window.__bossTrace.push({
          t,
          id: z.dbgId,
          kind: z.kind,
          f: z.frameIdx,
          tex: z.texFrame,
          idxs: z.indices,
          clip: z.clip,
          fin: z.finished,
          mode: z.mode,
          st: z.animState,
          hp: z.hp,
          scale: z.meshScale,
          tk: z.ticks?.ticks ?? -1,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // WHICH TRACE ROW IS THE GUARDIAN. `__dungeonAnim` carries no `boss` flag and
  // every guardian's `kind` is "brute", so the identity has to come from
  // `__dungeonBoss().king.nid` — the actor the game itself calls the boss —
  // and be matched into the anim rows by that id. Picking "the biggest sprite"
  // would work today and quietly pick a golem the day a scale changes.
  const bossId = await page.evaluate(() => {
    const nid = window.__dungeonBoss()?.king?.nid ?? null;
    const rows = window.__dungeonAnim();
    const hit = nid != null ? rows.find((r) => r.nid === nid) : null;
    return hit?.dbgId ?? null;
  });
  if (!bossId) log("   ⚠ could not identify the guardian's trace row — it will not get its own verdict");

  // ── KILL, THROUGH THE REAL DAMAGE PATH ──
  // `__dungeonKill` calls damageZombie with force, which is where a player's
  // kill lands. Poking hp would test a code path nobody plays. A guardian
  // carries several hundred HP and one strike deals 999, but the loop keeps
  // striking until the boss is actually down rather than assuming.
  for (let i = 0; i < 8; i++) {
    const alive = await page.evaluate(() => {
      window.__dungeonKill();
      return window.__dungeonAnim().filter((z) => z.mode !== "dead").length;
    });
    if (!alive) break;
    await page.waitForTimeout(80);
  }

  const samples = [];
  for (let i = 0; i < FRAMES; i++) {
    const rows = await anim();
    samples.push({ t: i, rows, shot: await page.screenshot() });
  }
  // ── THE QUIESCENT WINDOW ──
  // The calibration for the pixel channel. A corpse that has finished its death
  // row is static, so whatever the crop still moves by here is the floor, the
  // torchlight and the compression — the noise floor this run's own scene
  // produced, rather than a threshold I picked.
  await page.waitForTimeout(1200);
  const quiet = [];
  for (let i = 0; i < 6; i++) {
    const rows = await anim();
    quiet.push({ t: i, rows, shot: await page.screenshot() });
  }

  const trace = await page.evaluate(() => {
    window.__bossStop = true;
    return window.__bossTrace;
  });

  const actors = await scoreActors(trace, samples, quiet, bossId);
  await contactSheet(samples, bossId, `${a.out}/${label}-boss.png`);
  for (const x of actors) log(`   ${x.isBoss ? "★" : " "} ${x.id.padEnd(16)} ${x.line}`);

  if (sabotage) await page.evaluate(() => window.__dungeonSabotage("boss", 0, "restore"));
  await page.evaluate(() => window.__dungeonHidePlayer?.(false));
  return {
    label,
    floor,
    expect,
    biome,
    bossKind,
    guardianOk,
    actors: actors.map(({ crops, ...rest }) => rest),
  };
}

function anim() {
  return page.evaluate(() => window.__dungeonAnim());
}

/**
 * Two verdicts per actor, in this order, because they fail independently and
 * the first one masquerades as the second.
 *
 *   NEVER-DIED    the kill did not land. Says NOTHING about the art.
 *   FROZEN-JS     it died, the animator never advanced.
 *   FROZEN-GPU    the animator advanced, the texture did not.
 *   FROZEN-SCREEN both advanced, the pixels did not — the real bug's shape.
 *   NO-HOLD       it played and then left the terminal cel (a resurrection).
 *   PLAYED        all three channels moved and it holds the last death cel.
 */
async function scoreActors(trace, samples, quiet, bossId) {
  const byId = new Map();
  for (const r of trace) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  const out = [];
  for (const [id, rows] of byId) {
    const isBoss = id === bossId;
    const last = rows[rows.length - 1];
    const died = rows.some((r) => r.mode === "dead");

    if (!died) {
      out.push({
        id,
        isBoss,
        verdict: "NEVER-DIED",
        line: `NEVER DIED — hp ${last.hp}, clip ${last.clip}; says NOTHING about the death animation`,
      });
      continue;
    }

    // ── THE DYING ACTOR'S OWN DEATH ROW, NOT THE KIND'S ──
    // Every guardian is a `brute` wearing a boss atlas, so the brute's S:death
    // indices are the wrong list for it — the reaper's cels are 50-53 where the
    // kind's row says 12-15. Ask the actor what it is playing.
    const dyingRows = rows.filter((r) => r.clip === "death" && r.idxs?.length);
    const deathIdx = dyingRows.length ? dyingRows[dyingRows.length - 1].idxs : [];
    const after = rows.filter((r) => r.mode === "dead");
    const jsSeen = [...new Set(after.map((r) => r.f))];
    const texSeen = [...new Set(after.map((r) => r.tex))];
    const terminal = deathIdx[deathIdx.length - 1];
    const reached = terminal !== undefined && texSeen.includes(terminal);
    const heldTail = after.slice(-8);
    const held = heldTail.length > 0 && heldTail.every((r) => r.tex === terminal);

    const crops = await cropSeries(samples, id);
    const quietCrops = await cropSeries(quiet, id);
    const moved = meanStep(crops);
    const noise = meanStep(quietCrops);
    const screenMoved = Number.isFinite(moved) && Number.isFinite(noise) && (moved > noise * 1.25 || moved > noise + 0.4);

    let verdict = "PLAYED";
    if (jsSeen.length <= 1) verdict = "FROZEN-JS";
    else if (texSeen.length <= 1 || !reached) verdict = "FROZEN-GPU";
    else if (!screenMoved) verdict = "FROZEN-SCREEN";
    else if (!held) verdict = "NO-HOLD";

    out.push({
      id,
      isBoss,
      verdict,
      jsSeen,
      texSeen,
      deathIdx,
      moved,
      noise,
      crops,
      line:
        `${verdict} · animator [${jsSeen.join(",")}] · texture [${texSeen.join(",")}] of [${deathIdx.join(",")}]` +
        ` · screen moved ${fmt(moved)} vs settled ${fmt(noise)}` +
        `${reached ? "" : ` · NEVER reached ${terminal}`}${held ? "" : " · did NOT hold the last cel"}`,
    });
  }
  // The guardian first — it is what the run is about.
  out.sort((x, y) => Number(y.isBoss) - Number(x.isBoss) || x.id.localeCompare(y.id));
  return out;
}

/** The actor's quad in screen px: bottom-origin, square, scaled per kind. */
function rectFor(row) {
  if (!row?.feet || !row?.top) return null;
  const h = Math.abs(row.feet.y - row.top.y);
  if (!(h > 4)) return null;
  return {
    x: Math.round(row.feet.x - h / 2),
    y: Math.round(Math.min(row.feet.y, row.top.y)),
    w: Math.round(h),
    h: Math.round(h),
  };
}

async function cropOf(shotBuf, rect) {
  const img = await loadImage(shotBuf);
  const N = 48;
  const c = createCanvas(N, N);
  const g = c.getContext("2d");
  const sx = Math.max(0, Math.min(img.width - 1, rect.x));
  const sy = Math.max(0, Math.min(img.height - 1, rect.y));
  const sw = Math.max(1, Math.min(img.width - sx, rect.w));
  const sh = Math.max(1, Math.min(img.height - sy, rect.h));
  g.drawImage(img, sx, sy, sw, sh, 0, 0, N, N);
  return g.getImageData(0, 0, N, N).data;
}

async function cropSeries(samples, id) {
  const out = [];
  for (const s of samples) {
    const row = s.rows.find((r) => r.dbgId === id);
    const rect = rectFor(row);
    if (!rect) continue;
    out.push(await cropOf(s.shot, rect));
  }
  return out;
}

/** Mean absolute RGB change between consecutive crops — "did anything move". */
function meanStep(crops) {
  if (crops.length < 2) return NaN;
  let total = 0;
  for (let k = 1; k < crops.length; k++) {
    const x = crops[k - 1];
    const y = crops[k];
    let s = 0;
    for (let i = 0; i < x.length; i += 4) {
      s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
    }
    total += s / ((x.length / 4) * 3);
  }
  return total / (crops.length - 1);
}

/** The boss's own frames, side by side — the artefact a human reads. */
async function contactSheet(samples, id, path) {
  const N = 96;
  const cells = [];
  for (const s of samples) {
    const row = s.rows.find((r) => r.dbgId === id);
    const rect = rectFor(row);
    if (!rect) continue;
    cells.push({ shot: s.shot, rect });
  }
  if (!cells.length) return;
  const cols = Math.min(10, cells.length);
  const rows = Math.ceil(cells.length / cols);
  const c = createCanvas(cols * N, rows * N);
  const g = c.getContext("2d");
  g.fillStyle = "#161a22";
  g.fillRect(0, 0, c.width, c.height);
  for (const [i, cell] of cells.entries()) {
    const img = await loadImage(cell.shot);
    const sx = Math.max(0, Math.min(img.width - 1, cell.rect.x));
    const sy = Math.max(0, Math.min(img.height - 1, cell.rect.y));
    const sw = Math.max(1, Math.min(img.width - sx, cell.rect.w));
    const sh = Math.max(1, Math.min(img.height - sy, cell.rect.h));
    g.drawImage(img, sx, sy, sw, sh, (i % cols) * N, Math.floor(i / cols) * N, N, N);
  }
  writeFileSync(path, c.toBuffer("image/png"));
}
