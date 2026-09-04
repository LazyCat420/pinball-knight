#!/usr/bin/env node
/**
 * DEATH SWARM — do EIGHT monsters die on screen, or only the first one?
 *
 * ── WHY THIS EXISTS, AND WHY DEATH LAB IS NOT ENOUGH ────────────────────────
 *
 * Every death instrument this repo has ever had kills ONE monster and scores
 * JavaScript. `death-lab.mjs` spawns one. `audit-death-live.mjs` transcribes
 * the build's own `[death:step]` lines, which are printed from the animator's
 * frame index. `pipeline-forensics.mjs` walks seven layers for one actor. The
 * unit suite has twenty-one death files and twenty of them hold exactly one
 * monster. All of them are green, and have been green for days.
 *
 * The reported failure is neither of those shapes. It is EIGHT goblins in a
 * pile, one of which collapses and seven of which do not — a claim about
 * PIXELS, in a regime (N > 1) no instrument has ever stood in. A measurement
 * that cannot enter the regime where the bug lives cannot exonerate the code;
 * it can only keep saying "fine" until somebody believes it.
 *
 * So this spawns N, kills them, and answers three questions PER ACTOR, keeping
 * them apart because they fail independently:
 *
 *   1. DID IT DIE?          hp/mode/animState, asserted BEFORE anything else.
 *      A monster that never died and a monster whose art never played produce
 *      the identical trace — "not the death clip" — and a probe that only
 *      knows how to score animation will spend the second failure's evidence
 *      on the first. That mistake printed 26 false reds here once. A goblin
 *      has TWO hit points and a bumper pop deals ONE, so "still alive at 1 hp,
 *      standing there" is a completely ordinary outcome of ramming a pile.
 *   2. DID THE ANIMATOR ADVANCE?   frameIdx / ticks, per actor, per frame.
 *   3. DID THE SCREEN CHANGE?      the actor's own pixels, cropped out of a
 *      real screenshot and classified against the death cels as the SHIPPED
 *      BUILD DRAWS THEM.
 *
 * (3) is the half nothing has ever measured for more than one actor at a time,
 * and it is the only one that can see a frozen quad under a working animator.
 *
 * ── THE CONTROL ─────────────────────────────────────────────────────────────
 *
 * A probe whose number cannot move is a probe measuring itself. Twenty-two
 * "fixes" shipped against instruments nobody had ever watched fail. So this one
 * refuses to report a number until it has been shown to go red on demand:
 *
 *   --sabotage freeze-js    one actor's animator is stopped   → expect 1 FROZEN-JS
 *   --sabotage freeze-gpu   one actor's setFrame is stopped   → expect 1 FROZEN-GPU
 *
 * and `--count` sweeps / `--matrix` run BOTH controls first and abort the whole
 * run if either comes back green.
 *
 *   node scripts/death-swarm.mjs --count 8
 *   node scripts/death-swarm.mjs --count 1,2,4,8,16 --slow
 *   node scripts/death-swarm.mjs --kill ram --count 8 --aggro
 *   node scripts/death-swarm.mjs --sabotage freeze-gpu --count 2
 *   node scripts/death-swarm.mjs --url https://pinballknight.braindeadbot.com/
 *
 * Needs `playwright` + `canvas` and a HOST browser over CDP (the game is
 * WebGPU-only; WSL's llvmpipe is not a GPU). Same contract as death-lab.mjs.
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
    /** One count, or a comma sweep: `1,2,4,8,16`. The sweep is the point — a
     *  defect that only appears past N=1 shows up as a number that MOVES. */
    count: { type: "string", default: "8" },
    /** all = __dungeonKillAll in one tick · ram = pinball them · melee =
     *  __playerAttack at point blank · stagger = one every K frames. */
    kill: { type: "string", default: "all" },
    "stagger-frames": { type: "string", default: "6" },
    /** Spawn them aggroed, so they pile onto the knight the way they do in
     *  play. Off by default: a pile occludes itself and the crops overlap. */
    aggro: { type: "boolean", default: false },
    /** Death at 2fps instead of 6. A 4-cel death at 6fps is over in 667ms and
     *  a CDP screenshot round-trip is 60-90ms, so the middle cels get one
     *  sample each AT BEST and a real progression can read as a jump. */
    slow: { type: "boolean", default: false },
    seconds: { type: "string", default: "3" },
    /** Force the atlas swap this many ms after the kill — the one production
     *  event that replaces a dying actor's texture. */
    "rebuild-at": { type: "string" },
    sabotage: { type: "string", default: "none" },
    matrix: { type: "boolean", default: false },
    out: { type: "string", default: ".death-swarm" },
    headed: { type: "boolean", default: false },
  },
});

const PORT = Number(a["cdp-port"]);
const SECONDS = Number(a.seconds);
const COUNTS = String(a.count).split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
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
      "--user-data-dir=C:\\Temp\\pk-death-swarm",
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
const consoleLines = [];
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("[death:") || t.includes("Duplicate update")) consoleLines.push(t);
});

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

const build = await page.evaluate(() => ({
  build: window.__dungeonBuild?.() ?? "unknown",
  adapter: window.__renderAdapter ?? "unknown",
  software: window.__renderSoftware ?? null,
  backend: window.__renderBackendResolved ?? "unknown",
}));
log(`▶ build ${build.build} · ${build.backend}${build.software ? " ⚠ SOFTWARE" : ""} · ${String(build.adapter).slice(0, 60)}`);

// ── THE ART, not a timer ──
// The old harnesses slept 20 seconds here on the reasoning that imported art
// lands after the first playable frame. That is both slower than it needs to be
// and silently WRONG on a slow connection — and a run that samples the PAINTER
// is measuring a different creature than the one that ships.
const hasHook = await page.evaluate(() => typeof window.__dungeonImported === "function");
let artNote;
if (hasHook) {
  const key = await page.evaluate(
    (k) => window.__dungeonImported().keys.length >= 0 && k,
    a.kind,
  );
  try {
    await page.waitForFunction(
      (k) => {
        const im = window.__dungeonImported();
        if (!im.enabled) return true; // painter art is the shipped art here
        return im.keys.some((x) => x === k || String(k).startsWith(String(x)));
      },
      a.kind,
      { timeout: 40_000 },
    );
    artNote = `imported art ready (${(await page.evaluate(() => window.__dungeonImported().keys)).length} sheets)`;
  } catch {
    artNote = `⚠ imported art for ${key} did NOT arrive in 40s — measuring the PAINTER`;
  }
} else {
  await page.waitForTimeout(20_000);
  artNote = "⚠ __dungeonImported() absent (old build) — slept 20s, art state UNVERIFIED";
}
log(`▶ ${artNote}`);

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
await page.evaluate(() => window.__dungeonDebug({ god: true }));

const deathFps = await page.evaluate((f) => window.__dungeonDeathFps?.(f) ?? 6, a.slow ? 2 : 6);
log(`▶ death clip at ${deathFps} fps`);

// ── THE CONTROLS COME FIRST ──
// A sweep is a claim about numbers; a number from an instrument that has never
// been shown to fail is not evidence. Both controls must land before any real
// cell is allowed to print.
let controlNote = "controls SKIPPED (--sabotage set explicitly)";
if (a.sabotage === "none" && (COUNTS.length > 1 || a.matrix)) {
  if (!hasSabotage) {
    console.error("✖ __dungeonSabotage is not in this build — the controls cannot run, so a sweep here would be unvalidated. Deploy the hooks first, or run a single --count.");
    process.exit(4);
  }
  const cJs = await runCell({ count: 2, sabotage: "freeze-js", label: "control-js" });
  const cGpu = await runCell({ count: 2, sabotage: "freeze-gpu", label: "control-gpu" });
  const okJs = cJs.actors.filter((x) => x.verdict === "FROZEN-JS").length === 1;
  const okGpu = cGpu.actors.filter((x) => x.verdict === "FROZEN-GPU").length === 1;
  if (!okJs || !okGpu) {
    log(`\n✖ SABOTAGE CONTROL FAILED — run invalid.`);
    log(`   freeze-js  → ${cJs.actors.map((x) => x.verdict).join(", ")} (wanted exactly one FROZEN-JS)`);
    log(`   freeze-gpu → ${cGpu.actors.map((x) => x.verdict).join(", ")} (wanted exactly one FROZEN-GPU)`);
    log(`   The instrument cannot distinguish the two failures it exists to distinguish.`);
    log(`   Any green it printed below would mean nothing. Fix the probe, not the game.`);
    await page.close();
    process.exit(4);
  }
  controlNote = "controls OK (freeze-js and freeze-gpu both landed)";
  log(`▶ ${controlNote}`);
}

const cells = [];
for (const n of COUNTS) cells.push(await runCell({ count: n, sabotage: a.sabotage, label: `n${n}` }));

log("\n── DEATH SWARM ────────────────────────────────────────────────");
log(`build ${build.build} · ${build.backend} · ${deathFps}fps · kill=${a.kill} · ${artNote}`);
log(`${controlNote}`);
log("\ncount | spawned | died | PLAYED | FROZEN-GPU | FROZEN-JS | DIVERGED | UNRESOLVED | NEVER-DIED");
let prev = null;
let anyRed = false;
for (const c of cells) {
  const t = tally(c.actors);
  const moves = prev && (t.PLAYED / Math.max(1, t.died)) < (prev.PLAYED / Math.max(1, prev.died)) - 0.001;
  log(
    `${String(c.count).padStart(5)} | ${String(c.spawned).padStart(7)} | ${String(t.died).padStart(4)} | ` +
      `${String(t.PLAYED).padStart(6)} | ${String(t["FROZEN-GPU"]).padStart(10)} | ${String(t["FROZEN-JS"]).padStart(9)} | ` +
      `${String(t.DIVERGED).padStart(8)} | ${String(t.UNRESOLVED).padStart(10)} | ${String(t["NEVER-DIED"]).padStart(10)}` +
      (moves ? "   ← MOVES" : ""),
  );
  if (t["FROZEN-GPU"] || t["FROZEN-JS"] || t.DIVERGED) anyRed = true;
  prev = t;
}
writeFileSync(`${a.out}/report.json`, JSON.stringify({ build, deathFps, artNote, controlNote, kill: a.kill, cells }, null, 2));
log(`\nartefacts in ${a.out}/  (report.json, per-cell contact sheets, templates.png)`);
if (consoleLines.length) log(`\n${consoleLines.length} death log lines captured; first few:\n  ${consoleLines.slice(0, 6).join("\n  ")}`);

await page.close();
process.exit(anyRed ? 1 : 0);

// ═══════════════════════════════════════════════════════════════════════════

/** One cell of the experiment: spawn `count`, kill them, score each one. */
async function runCell({ count, sabotage, label }) {
  await page.evaluate(() => window.__dungeonClear());
  await page.waitForTimeout(250);

  // ── TEMPLATES, CUT OFF THE SCREEN ──
  // The atlas is not the right thing to compare a screenshot against: the frame
  // the player sees has been through the palette snap, the cel grade and the
  // outline pass, so an atlas-RGB comparison scores the POST CHAIN, not the
  // animation. Pin one live actor to each death cel and photograph it. Screen
  // is then compared to screen.
  const tpl = await captureTemplates();

  const spawned = await page.evaluate(
    ({ k, n, ag }) => {
      const before = window.__dungeonAnim().length;
      window.__lab.spawn(k, n, { ring: 3, aggro: ag });
      return window.__dungeonAnim().length - before;
    },
    { k: a.kind, n: count, ag: a.aggro },
  );
  await page.waitForTimeout(600);

  let sabotaged = null;
  if (sabotage && sabotage !== "none") {
    if (!hasSabotage) throw new Error("__dungeonSabotage missing in this build");
    sabotaged = await page.evaluate(
      ({ k, m }) => window.__dungeonSabotage(k, 0, m),
      { k: a.kind, m: sabotage },
    );
  }

  const before = await anim();

  // ── ARE THE ANIMATORS EVEN RUNNING? ──
  // `sim/loop.ts` returns early while a floor is held or the tavern owns the
  // screen, and in that state NOTHING ticks — every actor would be scored
  // FROZEN-JS and the report would blame the game for a harness that started
  // measuring too early. rAF being alive is not the same claim: the page can
  // be painting the loading screen. Ask the LIVING actors whether their tick
  // count climbs, before killing anything.
  {
    const t0 = (await anim()).filter((z) => z.kind === a.kind).map((z) => z.ticks?.ticks ?? -1);
    await page.waitForTimeout(400);
    const t1 = (await anim()).filter((z) => z.kind === a.kind).map((z) => z.ticks?.ticks ?? -1);
    const climbed = t0.length > 0 && t1.every((v, i) => v > t0[i]);
    if (!climbed) {
      log(`   ⚠ animators are NOT ticking before the kill (${t0[0]} → ${t1[0]}) — the floor is held or the`);
      log(`     scene is not presenting. Waiting for the clock rather than scoring a stopped game.`);
      await page.waitForFunction(
        (k) => {
          const rows = window.__dungeonAnim().filter((z) => z.kind === k);
          const now = rows.map((z) => z.ticks?.ticks ?? -1);
          const prev = window.__swarmPrevTicks ?? now.map(() => -1);
          window.__swarmPrevTicks = now;
          return rows.length > 0 && now.every((v, i) => v > prev[i]);
        },
        a.kind,
        { timeout: 30_000, polling: 300 },
      );
      log(`   ▶ clock is running; proceeding`);
    }
  }

  // ── THE JS/UV CHANNEL IS RECORDED IN THE PAGE, NOT POLLED OVER CDP ──
  // A `page.evaluate` round-trip is 15-30ms and a screenshot 60-90ms, so a
  // polled sample lands roughly once per death cel and a real 0->1->2->3
  // progression reads as [0,2,3]. That is not a small inaccuracy: "it skipped
  // a cel" and "it never played a cel" are the two readings this whole harness
  // exists to separate. So the animator channel is sampled INSIDE the page,
  // once per rAF, and read out in one call at the end. The screenshots stay on
  // the slow path where they belong.
  await page.evaluate(() => {
    window.__swarmTrace = [];
    window.__swarmStop = false;
    const tick = () => {
      if (window.__swarmStop) return;
      const t = performance.now();
      for (const z of window.__dungeonAnim()) {
        window.__swarmTrace.push({
          t,
          id: z.dbgId,
          kind: z.kind,
          f: z.frameIdx,
          tex: z.texFrame,
          fin: z.finished,
          mode: z.mode,
          st: z.animState,
          hp: z.hp,
          map: z.mapUuid,
          tk: z.ticks?.ticks ?? -1,
          vis: z.visible,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const t0 = Date.now();
  await doKill(before);

  const samples = [];
  const rebuildAt = a["rebuild-at"] ? Number(a["rebuild-at"]) : null;
  let didRebuild = false;
  while (Date.now() - t0 < SECONDS * 1000 + 900) {
    if (rebuildAt !== null && !didRebuild && Date.now() - t0 >= rebuildAt) {
      didRebuild = true;
      await page.evaluate((k) => window.__dungeonRebuild?.(k), a.kind);
    }
    const jsA = await anim();
    const shot = await page.screenshot();
    const jsB = await anim();
    samples.push({ t: Date.now() - t0, jsA, jsB, shot });
  }

  const trace = await page.evaluate(() => {
    window.__swarmStop = true;
    return window.__swarmTrace;
  });
  const actors = await scoreActors(samples, trace, tpl, sabotaged);
  await contactSheet(samples, actors, `${a.out}/${label}-${a.kind}.png`);

  log(`\n▶ ${label}: ${a.kind} ×${spawned}${sabotaged ? ` · sabotage ${sabotaged.mode} on ${sabotaged.dbgId}` : ""}`);
  for (const x of actors) log(`   ${x.id.padEnd(16)} ${x.line}`);

  await page.evaluate(({ k }) => {
    for (let i = 0; i < 32; i++) window.__dungeonSabotage?.(k, i, "restore");
    window.__dungeonClear();
  }, { k: a.kind });

  return { label, count, spawned, sabotage, actors: actors.map(({ crops, ...rest }) => rest) };
}

function anim() {
  return page.evaluate(() => window.__dungeonAnim());
}

async function doKill(before) {
  if (a.kill === "all") {
    await page.evaluate((k) => window.__dungeonKillAll(k), a.kind);
    return;
  }
  if (a.kill === "stagger") {
    const gap = Number(a["stagger-frames"]) * 16.7;
    for (let i = 0; i < before.length; i++) {
      await page.evaluate((k) => window.__dungeonKill(k, 1), a.kind);
      await page.waitForTimeout(gap);
    }
    return;
  }
  if (a.kill === "melee") {
    // Point blank, one at a time, through the REAL swing path — the same
    // resolvePlayerAttack the bumper calls when a swing is live.
    for (let i = 0; i < before.length * 6; i++) {
      const done = await page.evaluate((k) => {
        const live = window.__dungeonAnim().filter((z) => z.kind === k && z.mode !== "dead");
        if (!live.length) return true;
        const z = live[0];
        window.__dungeonWarp(z.x - 0.5, z.z);
        window.__playerAttack();
        return false;
      }, a.kind);
      if (done) break;
      await page.waitForTimeout(90);
    }
    return;
  }
  // ram: launch the knight at the nearest living one, over and over. A goblin
  // has TWO hit points and a bumper pop deals ONE on a 0.6s cooldown, so a
  // single pass through a pile leaves most of them standing — which is exactly
  // the observation this harness has to be able to tell apart from frozen art.
  for (let i = 0; i < before.length * 12; i++) {
    const done = await page.evaluate((k) => {
      const live = window.__dungeonAnim().filter((z) => z.kind === k && z.mode !== "dead");
      if (!live.length) return true;
      const p = window.__dungeonPlayer();
      if (!p) return true;
      const z = live[0];
      window.__dungeonLaunch(z.x - p.x, z.z - p.z, 16);
      return false;
    }, a.kind);
    if (done) break;
    await page.waitForTimeout(120);
  }
}

/** Pin one actor to each death cel and photograph it, on screen, in situ. */
async function captureTemplates() {
  if (!hasSabotage) return null;
  await page.evaluate((k) => window.__lab.only(k, 1), a.kind);
  await page.waitForTimeout(900);
  const cels = await page.evaluate((k) => window.__dungeonClipCels(k), a.kind);
  const row = (await anim()).find((z) => z.kind === a.kind);
  const idx = cels?.clips?.["S:death"] ?? [];
  const out = { cels, idx, imgs: [] };
  if (!row || !idx.length) {
    await page.evaluate(() => window.__dungeonClear());
    return out;
  }
  const atlas = await loadImage(cels.atlas);
  for (const fi of idx) {
    await page.evaluate(({ k, f }) => window.__dungeonSabotage(k, 0, "pin", f), { k: a.kind, f: fi });
    const mask = maskOf(atlas, cels, fi);
    // ⚠️ A BLANK CROP IS NOT A CEL, IT IS A MISSED SHUTTER. The first captures
    // after a spawn came back solid black and were happily used as templates —
    // two identical black squares put the "cel spread" at ZERO and silently
    // disarmed the whole pixel channel. Reject an empty sample and take
    // another, the way a cold-start 1x1 PNG has to be rejected elsewhere.
    let crop = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.waitForTimeout(attempt === 0 ? 180 : 220);
      const now = (await anim()).find((z) => z.kind === a.kind);
      const rect = rectFor(now);
      if (!rect) continue;
      const c = await cropOf(await page.screenshot(), rect);
      if (ink(c, mask) > 6) {
        crop = c;
        break;
      }
    }
    if (!crop) log(`   ⚠ cel ${fi}: no usable template capture (crop stayed blank)`);
    out.imgs.push({ fi, crop, mask });
  }

  // ── THE NOISE FLOOR: THE SAME CEL, SOMEWHERE ELSE ──
  // A crop is the sprite composited over whatever floor it happens to stand on,
  // so two pictures of the SAME cel on different tiles already differ. Unless
  // the cels differ from each other by more than that, this channel is reading
  // the floor and calling it an animation — which is exactly how it accused
  // four hounds whose terminal cel is a small dark puddle on a dark floor.
  // Measure the floor's contribution, and refuse to vote when the signal does
  // not clear it.
  await page.evaluate((k) => {
    window.__dungeonSabotage(k, 0, "restore");
    window.__dungeonClear();
  }, a.kind);
  await page.evaluate((k) => window.__lab.spawn(k, 2, { ring: 3, aggro: false }), a.kind);
  await page.waitForTimeout(700);
  const pinned = idx[idx.length - 1];
  await page.evaluate(({ k, f }) => {
    window.__dungeonSabotage(k, 0, "pin", f);
    window.__dungeonSabotage(k, 1, "pin", f);
  }, { k: a.kind, f: pinned });
  await page.waitForTimeout(200);
  const pairShot = await page.screenshot();
  const pair = (await anim()).filter((z) => z.kind === a.kind).slice(0, 2);
  const pairCrops = [];
  for (const z of pair) {
    const r = rectFor(z);
    if (r) pairCrops.push(await cropOf(pairShot, r));
  }
  const mask = maskOf(atlas, cels, pinned);
  out.noise = pairCrops.length === 2 ? maskedDistance(pairCrops[0], pairCrops[1], mask) : Infinity;
  out.spread = minPairwise(out.imgs);
  const complete = out.imgs.length === idx.length && out.imgs.every((t) => t.crop);
  // ── THE TRUST TEST IS AN EXPERIMENT, NOT A THRESHOLD ──
  // "spread must beat noise by 2x" is a number I would have made up. What the
  // channel actually has to do is name the right cel for a sprite standing
  // SOMEWHERE ELSE than the template did — different floor tiles, different
  // torch light. So: photograph the same cel at two fresh positions and ask the
  // classifier. If it cannot get those right, it does not get a vote.
  out.crossPos = pairCrops.map((c) => classify(c, out).cel);
  const crossOk = pairCrops.length === 2 && out.crossPos.every((c) => c === pinned);
  out.trusted = complete && crossOk && selfTest(out);
  log(
    `   pixel channel: cel spread ${fmt(out.spread)} · background noise ${fmt(out.noise)} · ` +
      `same cel elsewhere read as [${out.crossPos.join(",")}] (wanted ${pinned},${pinned}) → ` +
      (out.trusted ? "TRUSTED" : "NOT TRUSTED (verdicts fall back to animator + UV)"),
  );
  await page.evaluate((k) => {
    window.__dungeonSabotage(k, 0, "restore");
    window.__dungeonClear();
  }, a.kind);
  await stripSheet(out, `${a.out}/templates.png`);
  return out;
}

/** The actor's quad in screen px: bottom-origin, square, scaled per kind. */
function rectFor(row) {
  if (!row?.feet || !row?.top) return null;
  const h = Math.abs(row.feet.y - row.top.y);
  if (!(h > 4)) return null;
  const w = h;
  return {
    x: Math.round(row.feet.x - w / 2),
    y: Math.round(Math.min(row.feet.y, row.top.y)),
    w: Math.round(w),
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

/** The cel's own alpha, scaled to the crop grid — which pixels are the SPRITE.
 *  Comparing only those excludes the floor, so two actors standing on
 *  different tiles are still comparable. */
function maskOf(atlas, cels, fi) {
  const N = 48;
  const c = createCanvas(N, N);
  const g = c.getContext("2d");
  g.drawImage(
    atlas,
    (fi % cels.cols) * cels.cellW,
    Math.floor(fi / cels.cols) * cels.cellH,
    cels.cellW,
    cels.cellH,
    0,
    0,
    N,
    N,
  );
  const d = g.getImageData(0, 0, N, N).data;
  const m = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) m[i] = d[i * 4 + 3] > 80 ? 1 : 0;
  return m;
}

/** Nearest death cel by masked screen distance, with a margin so a tie is
 *  reported as a tie instead of a coin flip dressed as a measurement. */
function classify(crop, tpl) {
  if (!crop || !tpl?.imgs?.length) return { cel: -1, score: 0, margin: 0 };
  const scored = [];
  for (const t of tpl.imgs) {
    if (!t.crop) continue;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < t.mask.length; i++) {
      if (!t.mask[i]) continue;
      const o = i * 4;
      sum += Math.abs(crop[o] - t.crop[o]) + Math.abs(crop[o + 1] - t.crop[o + 1]) + Math.abs(crop[o + 2] - t.crop[o + 2]);
      n += 3;
    }
    scored.push({ fi: t.fi, d: n ? sum / n : Infinity });
  }
  if (!scored.length) return { cel: -1, score: 0, margin: 0 };
  scored.sort((x, y) => x.d - y.d);
  const best = scored[0];
  const second = scored[1] ?? { d: best.d };
  const margin = second.d > 0 ? (second.d - best.d) / second.d : 0;
  return { cel: best.fi, score: best.d, margin };
}

/** Mean absolute RGB difference between two crops — "did anything change". */
function delta(x, y) {
  if (!x || !y) return -1;
  let s = 0;
  for (let i = 0; i < x.length; i += 4) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
  return s / ((x.length / 4) * 3);
}

async function scoreActors(samples, trace, tpl, sabotaged) {
  // ── WHICH CHANNELS ARE WE ALLOWED TO BELIEVE? ──
  // Three independent readings of the same death, and they fail independently:
  //
  //   frameIdx  what the ANIMATOR thinks       (in-page, once per rAF)
  //   texFrame  what the TEXTURE is sampling   (decoded from the live UV)
  //   pixels    what the SCREEN actually drew  (cropped screenshot)
  //
  // The pixel channel is the only one that can see a correct UV that never
  // reaches the glass — and it is also the only one that can be wrong for
  // reasons of its own (a crop that misses, a template that did not render, a
  // neighbour overlapping the rect). So it has to PASS A SELF-TEST before its
  // verdict counts: classify each pinned template against the whole set and
  // require every one to come back as itself. A channel that cannot identify
  // the four pictures it just took is not evidence about a fifth.
  const pixOk = tpl?.trusted === true;

  const byId = new Map();
  for (const r of trace) {
    if (r.kind !== a.kind) continue;
    if (!byId.has(r.id)) byId.set(r.id, { rows: [], pix: [] });
    byId.get(r.id).rows.push(r);
  }

  for (const s of samples) {
    for (const r of s.jsA) {
      if (r.kind !== a.kind) continue;
      if (!byId.has(r.dbgId)) byId.set(r.dbgId, { rows: [], pix: [] });
      const after = s.jsB.find((x) => x.dbgId === r.dbgId);
      const rect = rectFor(r);
      const crop = rect ? await cropOf(s.shot, rect) : null;
      // A pixel sample is ATTRIBUTABLE only if the texFrame held still while
      // the shutter was open; otherwise the photograph is of an instant between
      // two states and belongs to neither.
      const stable = !!after && after.texFrame === r.texFrame;
      byId.get(r.dbgId).pix.push({ t: s.t, texFrame: r.texFrame, stable, crop, cls: classify(crop, tpl) });
    }
  }

  const out = [];
  for (const [id, d] of byId) {
    const rows = d.rows;
    if (!rows.length) continue;
    const last = rows[rows.length - 1];
    const kindRow = samples.at(-1)?.jsB?.find((x) => x.dbgId === id) ?? null;
    const idxs = kindRow?.indices ?? [];
    const terminal = idxs.length ? idxs[idxs.length - 1] : undefined;

    // ── PRECONDITION, WITH ITS OWN VERDICT ──
    // "It never died" and "its art never played" produce the same trace, and
    // scoring the second on evidence of the first is how 26 false reds got
    // printed here. A goblin has TWO hit points and a bumper pop deals ONE.
    const died = last.mode === "dead" || last.st !== "alive";
    if (!died) {
      out.push({
        id,
        verdict: "NEVER-DIED",
        line:
          `⚠ NEVER DIED — hp ${last.hp}, mode ${last.mode}, animState ${last.st}. The ${a.kill} ` +
          `trigger did not finish it, so this says NOTHING about the death art.`,
        rows: slim(rows),
      });
      continue;
    }

    const postKill = rows.filter((r) => r.mode === "dead" || r.st !== "alive");
    const jsSeen = [...new Set(postKill.map((r) => r.f))];
    const texSeen = [...new Set(postKill.map((r) => r.tex))];
    const ticksMoved = postKill.length > 1 && postKill.at(-1).tk - postKill[0].tk >= Math.floor(postKill.length * 0.5);
    const jsReached = last.f === idxs.length - 1 && last.fin;
    const jsMoved = jsSeen.length > 1;
    const texReached = terminal !== undefined && last.tex === terminal;
    const texHeld = postKill.slice(-5).every((r) => r.tex === terminal);
    const mapSwapped = new Set(postKill.map((r) => r.map)).size > 1;

    // The margin guard used to be 0.08, which threw away most samples of the
    // two cels that look most alike — the exact pair a frozen quad sits
    // between — and left the sabotaged actor with too few votes to be judged.
    // The majority rule below is what protects against a stray now, so the
    // per-sample bar only has to exclude an outright tie.
    const pix = d.pix.filter((r) => r.stable && r.cls.cel >= 0 && r.cls.margin >= 0.02);
    const pixSeen = [...new Set(pix.map((r) => r.cls.cel))];
    // ── A MAJORITY, NOT A SINGLE SAMPLE ──
    // Nearest-template on a 48x48 crop over a moving, torch-lit floor gets one
    // in a handful wrong, and `every()` let a single stray condemn a monster
    // that had died perfectly well. A genuine frozen quad disagrees on EVERY
    // sample for the whole window; a classifier slip disagrees on one. Require
    // the disagreement to be the rule and to have enough samples to mean
    // anything, or say nothing.
    const disagreed = pix.filter((r) => r.cls.cel !== r.texFrame).length;
    const pixEnough = pix.length >= 3;
    const pixDisagrees = pixEnough && disagreed / pix.length >= 0.6;
    const pixAgrees = pixEnough && !pixDisagrees;

    let verdict;
    let why = "";
    if (!ticksMoved) {
      verdict = "FROZEN-JS";
      why = "the animator was never TICKED (tick count did not climb)";
    } else if (!jsMoved) {
      verdict = "FROZEN-JS";
      why = "ticked, but frameIdx never left 0";
    } else if (!texSeen.length || texSeen.length === 1) {
      verdict = "FROZEN-GPU";
      why = `frameIdx advanced to ${last.f} while the TEXTURE stayed on cel ${texSeen[0]}`;
    } else if (mapSwapped) {
      verdict = "DIVERGED";
      why = "the material's map was REPLACED mid-death (a sheet rebuild landed on a corpse)";
    } else if (!texReached || !texHeld) {
      verdict = "DIVERGED";
      why = `texture ended on ${last.tex}, wanted ${terminal}${texHeld ? "" : " and did not hold it"}`;
    } else if (pixOk && pixDisagrees) {
      verdict = "FROZEN-GPU";
      why =
        `UVs reached ${terminal} but the SCREEN showed cels [${pixSeen.join(",")}] ` +
        `in ${disagreed} of ${pix.length} samples`;
    } else if (!jsReached) {
      verdict = "DIVERGED";
      why = `texture is right but the animator did not finish (frameIdx ${last.f}, finished ${last.fin})`;
    } else {
      verdict = "PLAYED";
    }

    const sab = sabotaged && sabotaged.dbgId === id ? ` [sabotage ${sabotaged.mode}]` : "";
    const pixNote = !pixOk
      ? " · pixels UNTRUSTED (cannot separate cel from background)"
      : !pixEnough
        ? ` · only ${pix.length} attributable pixel sample(s) — pixels did not vote`
        : ` · pixels [${pixSeen.join(",")}] ${pixAgrees ? "agree" : `DISAGREE ${disagreed}/${pix.length}`}`;
    out.push({
      id,
      verdict,
      jsSeen,
      texSeen,
      pixSeen,
      ticks: postKill.length ? postKill.at(-1).tk - postKill[0].tk : 0,
      samples: postKill.length,
      terminal,
      mapSwapped,
      line:
        `${verdict === "PLAYED" ? "✔" : "✖"} ${verdict}${sab} · frameIdx [${jsSeen.join(",")}] · ` +
        `tex [${texSeen.join(",")}] of [${idxs.join(",")}] · ${postKill.length} frames, ` +
        `+${postKill.length ? postKill.at(-1).tk - postKill[0].tk : 0} ticks${pixNote}` +
        (why ? ` — ${why}` : ""),
      rows: slim(rows),
    });
  }
  return out;
}


/** Mean luminance over the cel's own pixels — is there anything in this crop? */
function ink(crop, mask) {
  if (!crop) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    sum += (crop[o] + crop[o + 1] + crop[o + 2]) / 3;
    n++;
  }
  return n ? sum / n : 0;
}

/** Mean |ΔRGB| over the cel's own pixels — background excluded. */
function maskedDistance(x, y, mask) {
  if (!x || !y) return Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    sum += Math.abs(x[o] - y[o]) + Math.abs(x[o + 1] - y[o + 1]) + Math.abs(x[o + 2] - y[o + 2]);
    n += 3;
  }
  return n ? sum / n : Infinity;
}

/** How far apart are the cels themselves? The closest pair is the limit. */
function minPairwise(imgs) {
  let min = Infinity;
  for (let i = 0; i < imgs.length; i++) {
    for (let j = i + 1; j < imgs.length; j++) {
      if (!imgs[i].crop || !imgs[j].crop) continue;
      min = Math.min(min, maskedDistance(imgs[i].crop, imgs[j].crop, imgs[i].mask));
    }
  }
  return min;
}

/** Can the pixel channel identify the four pictures it just took? */
function selfTest(tpl) {
  const imgs = (tpl?.imgs ?? []).filter((t) => t.crop);
  if (imgs.length < 2) return false;
  return imgs.every((t) => classify(t.crop, tpl).cel === t.fi);
}

function slim(rows) {
  // One row per rAF is 180 rows per actor per 3s; the report keeps the
  // TRANSITIONS, because a timeline is about where things changed.
  const out = [];
  let prev = null;
  for (const r of rows) {
    const key = `${r.f}|${r.tex}|${r.fin}|${r.mode}|${r.st}|${r.map}|${r.vis}`;
    if (key !== prev) {
      out.push({ t: Math.round(r.t), f: r.f, tex: r.tex, fin: r.fin, mode: r.mode, st: r.st, hp: r.hp, tk: r.tk, vis: r.vis });
      prev = key;
    }
  }
  return out;
}

function tally(actors) {
  const t = { PLAYED: 0, "FROZEN-GPU": 0, "FROZEN-JS": 0, DIVERGED: 0, UNRESOLVED: 0, "NEVER-DIED": 0, died: 0 };
  for (const x of actors) {
    t[x.verdict] = (t[x.verdict] ?? 0) + 1;
    if (x.verdict !== "NEVER-DIED") t.died++;
  }
  return t;
}

/** Rows = actors, columns = time. The artefact a human reads. */
async function contactSheet(samples, actors, path) {
  const N = 48;
  const step = Math.max(1, Math.ceil(samples.length / 12));
  const picked = samples.filter((_, i) => i % step === 0).slice(0, 12);
  const ids = actors.map((x) => x.id);
  if (!ids.length || !picked.length) return;
  const c = createCanvas(140 + picked.length * (N + 4), 18 + ids.length * (N + 18));
  const g = c.getContext("2d");
  g.fillStyle = "#101218";
  g.fillRect(0, 0, c.width, c.height);
  g.font = "11px monospace";
  ids.forEach((id, r) => {
    const y = 18 + r * (N + 18);
    g.fillStyle = "#cfd6e4";
    g.fillText(id, 4, y + N / 2);
    g.fillStyle = actors[r].verdict === "PLAYED" ? "#7fd67f" : "#e07a7a";
    g.fillText(actors[r].verdict, 4, y + N / 2 + 13);
  });
  for (let ci = 0; ci < picked.length; ci++) {
    const s = picked[ci];
    const img = await loadImage(s.shot);
    for (let r = 0; r < ids.length; r++) {
      const row = s.jsA.find((z) => z.dbgId === ids[r]);
      const rect = row ? rectFor(row) : null;
      const x = 140 + ci * (N + 4);
      const y = 18 + r * (N + 18);
      if (rect) {
        g.drawImage(img, Math.max(0, rect.x), Math.max(0, rect.y), Math.max(1, rect.w), Math.max(1, rect.h), x, y, N, N);
        g.fillStyle = "#9fb0c8";
        g.fillText(`${row.frameIdx}/${row.texFrame}`, x, y + N + 11);
      }
    }
    g.fillStyle = "#6d7889";
    g.fillText(`${s.t}ms`, 140 + ci * (N + 4), 12);
  }
  writeFileSync(path, c.toBuffer("image/png"));
}

/** The pinned templates side by side — what each death cel LOOKS LIKE on screen. */
async function stripSheet(tpl, path) {
  const N = 48;
  const imgs = (tpl?.imgs ?? []).filter((t) => t.crop);
  if (!imgs.length) return;
  const c = createCanvas(imgs.length * (N + 4), N + 16);
  const g = c.getContext("2d");
  g.fillStyle = "#202430";
  g.fillRect(0, 0, c.width, c.height);
  g.font = "11px monospace";
  imgs.forEach((t, i) => {
    const id = g.createImageData(N, N);
    id.data.set(t.crop);
    g.putImageData(id, i * (N + 4), 14);
    g.fillStyle = "#cfd6e4";
    g.fillText(`cel ${t.fi}`, i * (N + 4), 11);
  });
  writeFileSync(path, c.toBuffer("image/png"));
}
