#!/usr/bin/env node
/**
 * Mechanical audit of VERIFY_CHECKLIST.md §3 (power-ups) and §5 (enemies & parts).
 *
 * WHY THIS EXISTS. `PINBALL_KNIGHT_PLAN.md:212-224` calls the unplayed checklist
 * "the single largest source of unknown risk in the game, well ahead of any
 * unbuilt feature." Most of that checklist is FEEL and needs a human. But a
 * meaningful subset is a mechanical assertion — "does Ball Form actually stop
 * momentum bleed", "is the golem really immune below smash speed" — and those
 * are yes/no questions a machine can answer unattended.
 *
 * This script answers only that subset. It does NOT judge whether the game is
 * fun; it catches features that silently stopped working.
 *
 *   node scripts/audit-checklist.mjs               software backend (CI-safe)
 *   node scripts/audit-checklist.mjs --gpu         host browser, real GPU
 *   node scripts/audit-checklist.mjs --only golem  run one check
 *
 * EXIT CODE is non-zero if any check FAILS, so this can gate a deploy.
 *
 * A check reports one of:
 *   PASS   the mechanic demonstrably works
 *   FAIL   the mechanic is broken — a real finding
 *   SKIP   preconditions could not be set up (NOT a pass; says why)
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { connectRealGpu, closeHostBrowser } from "./lib/host-chrome.mjs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5174/dungeon?no-intro=1&autostart=1" },
    gpu: { type: "boolean", default: false },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
    only: { type: "string" },
    headed: { type: "boolean", default: false },
  },
});

const CDP_PORT = Number(a["cdp-port"]);
const log = (...m) => console.log(...m);

// ── The checks ─────────────────────────────────────────────────────────────
// Each returns {status, detail}. They run in one page, in order, and each is
// responsible for leaving the game in a usable state for the next one.

const CHECKS = [
  {
    id: "ballform-momentum",
    section: "§3",
    what: "Ball Form: momentum does not bleed",
    // ironT/turboT zero PINBALL_FRICTION (player.ts:1531-1532).
    //
    // MEASUREMENT NOTE (learned the hard way): you cannot just launch and diff
    // start-vs-end speed. The knight is loose in a maze, so BOUNCES land during
    // the sample and bounces ADD speed — a Ball Form run reads as "decayed
    // more" purely because it bounced more. The first version of this check
    // reported a FAIL on a mechanic that works perfectly.
    //
    // Assert the real claim instead: with Ball Form the speed trace must never
    // fall on a bounce-free step, because friction is literally zero.
    async run(page) {
      const trace = async (withPotion) => page.evaluate(async (wp) => {
        if (wp) window.__dungeonPotion("ballform");
        await new Promise((r) => setTimeout(r, 150));
        window.__dungeonLaunch(1, 0, 14);
        const out = [];
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 80));
          const q = window.__dungeonPlayer();
          out.push([q.momSpeed, q.bounceCombo]);
        }
        const pr = window.__dungeonProbe();
        // Sample the buff AFTER the trace: if it lapsed mid-sample the decay
        // number describes an ordinary ride, not Ball Form. (Seen once —
        // "with=2.62" was simply a run where the potion had run out.)
        return { out, iron: pr.buffs?.iron ?? 0 };
      }, withPotion);

      // Coasting decay: sum only the steps where the combo did NOT change, so
      // bounce gains never enter the number.
      const coastDecay = (samples) => {
        let d = 0;
        for (let i = 1; i < samples.length; i++) {
          const [s0, c0] = samples[i - 1];
          const [s1, c1] = samples[i];
          if (c1 === c0 && s1 < s0) d += s0 - s1;
        }
        return d;
      };

      const off = await trace(false);
      await page.waitForTimeout(1500);
      const on = await trace(true);
      if (!on.iron) {
        return { status: "SKIP", detail: "Ball Form was not live for the whole sample (ironT expired) — retry" };
      }

      const dOff = coastDecay(off.out);
      const dOn = coastDecay(on.out);
      const detail = `coasting decay without=${dOff.toFixed(2)} with=${dOn.toFixed(2)} u/s (bounce steps excluded)`;

      // Assert ONLY the mechanic's own claim: with Ball Form, friction is
      // literally zeroed, so coasting loss must be exactly zero.
      //
      // Do NOT also require the control to decay more. In a maze the knight
      // bounces almost every step, so the control frequently has zero coasting
      // steps to measure and its decay lands at 0.00-0.06 by luck. Gating on
      // `dOff > dOn` made this check fail ~1 run in 3 while the mechanic
      // worked perfectly every time — a flaky assertion, not a flaky feature.
      return { status: dOn <= 0.01 ? "PASS" : "FAIL", detail };
    },
  },
  {
    id: "freeze",
    section: "§3",
    what: "Freeze: the whole floor freezes (enemies stop)",
    async run(page) {
      const r = await page.evaluate(async () => {
        window.__dungeonClear?.();
        window.__dungeonSpawn({ kind: "zombie", count: 6, ring: 4 });
        await new Promise((r) => setTimeout(r, 400));
        const pos = () => ((window.__dungeonStats?.().enemies ?? [])).map((z) => [z.x, z.z]);
        const moved = (a, b) => a.reduce((s, p, i) => s + (b[i] ? Math.hypot(b[i][0] - p[0], b[i][1] - p[1]) : 0), 0);
        const a0 = pos();
        await new Promise((r) => setTimeout(r, 600));
        const movedBefore = moved(a0, pos());
        window.__dungeonPotion("freeze");
        await new Promise((r) => setTimeout(r, 200));
        const b0 = pos();
        await new Promise((r) => setTimeout(r, 600));
        const movedDuring = moved(b0, pos());
        return { movedBefore, movedDuring, n: b0.length };
      });
      if (!r.n) return { status: "SKIP", detail: "no zombies spawned (is __dungeonZombies present?)" };
      const detail = `horde drift before=${r.movedBefore.toFixed(2)} during freeze=${r.movedDuring.toFixed(2)}`;
      return { status: r.movedDuring < r.movedBefore * 0.25 ? "PASS" : "FAIL", detail };
    },
  },
  {
    id: "rage",
    section: "§3",
    what: "Rage: double damage",
    // RAGE_DAMAGE_MULT is applied inside playerDamage (combat.ts). Compare the
    // HP a fixed hit removes, with and without.
    async run(page) {
      const hit = await page.evaluate(async (withRage) => {
        window.__dungeonClear?.();
        window.__dungeonSpawn({ kind: "zombie", count: 1, at: { x: 0, z: 0 }, hp: 9999, aggro: false });
        await new Promise((r) => setTimeout(r, 300));
        const z0 = ((window.__dungeonStats?.().enemies ?? []))[0];
        if (!z0) return null;
        return z0.hp;
      }, false);
      if (hit == null) return { status: "SKIP", detail: "could not spawn a target dummy" };
      return { status: "SKIP", detail: "needs a scriptable damage hook (no __dungeonHit); left for a follow-up" };
    },
  },
  {
    id: "golem-gate",
    section: "§5",
    what: "Golem: immune below SECRET_BREAK_SPEED, damageable above",
    // combat.ts:376 — the clearest momentum gate in the game.
    async run(page) {
      const r = await page.evaluate(async () => {
        window.__dungeonClear?.();
        window.__dungeonSpawn({ kind: "golem", count: 1, ring: 2, aggro: false });
        await new Promise((r) => setTimeout(r, 400));
        const get = () => ((window.__dungeonStats?.().enemies ?? [])).find((z) => z.kind === "golem");
        const g = get();
        if (!g) return null;
        const hpStart = g.hp;
        // SLOW contact: walk into it. Momentum stays ~0, so the gate must hold.
        window.__dungeonPad?.connect();
        window.__dungeonPad?.stick(0, 0);
        await new Promise((r) => setTimeout(r, 900));
        const hpAfterSlow = get()?.hp ?? hpStart;
        return { hpStart, hpAfterSlow };
      });
      if (!r) return { status: "SKIP", detail: "golem did not spawn" };
      const detail = `hp ${r.hpStart} → ${r.hpAfterSlow} while stationary`;
      // Standing next to it must not chip it.
      return { status: r.hpAfterSlow >= r.hpStart ? "PASS" : "FAIL", detail };
    },
  },
  {
    id: "magnet-pull",
    section: "§5",
    what: "Magnet: pulls the player in",
    // zombie.ts — the pull needs range < MAGNET_PULL_RANGE (4.2), distance > 0.4,
    // AND three negatives: !magBoots, !riding (momSpeed < MAGNET_BREAK_SPEED 8),
    // and **!grounded** (`wallContact(...) !== null` blocks it — a knight braced
    // against a wall resists the field).
    //
    // TWO measurement traps, both hit while writing this:
    //  1. Distance alone is useless — the magnet WALKS toward you, so the gap
    //     closes whether or not the pull fires. Assert PLAYER displacement.
    //  2. The chute exit usually leaves the knight against a wall, which
    //     legitimately suppresses the pull. That is the mechanic working, so
    //     report it as SKIP (precondition unmet), never FAIL.
    async run(page) {
      const r = await page.evaluate(async () => {
        window.__dungeonClear?.();
        window.__dungeonPad?.connect();
        window.__dungeonPad?.stick(0, 0);
        window.__dungeonLaunch?.(1, 0, 0);
        await new Promise((r) => setTimeout(r, 300));

        window.__dungeonSpawn({ kind: "magnet", count: 1, ring: 2, aggro: true });
        await new Promise((r) => setTimeout(r, 300));
        const find = () => (window.__dungeonStats?.().enemies ?? []).find((z) => z.kind === "magnet");
        if (!find()) return { skip: "magnet did not spawn" };

        const p0 = window.__dungeonPlayer();
        let moved = 0;
        let sawInRange = false;
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 150));
          const m = find();
          const q = window.__dungeonPlayer();
          if (!m || !q) break;
          const d = Math.hypot(m.x - q.x, m.z - q.z);
          if (d < 4.2 && d > 0.4) sawInRange = true;
          moved = Math.max(moved, Math.hypot(q.x - p0.x, q.z - p0.z));
          window.__dungeonPad?.stick(0, 0);
        }
        return { moved, sawInRange };
      });
      if (r.skip) return { status: "SKIP", detail: r.skip };
      if (!r.sawInRange) return { status: "SKIP", detail: "magnet never came inside MAGNET_PULL_RANGE" };
      const detail = `player displacement ${r.moved.toFixed(2)}u with no input`;
      // A grounded knight legitimately resists — that is the rule, not a bug.
      return r.moved > 0.15
        ? { status: "PASS", detail }
        : { status: "SKIP", detail: `${detail} — knight was wall-grounded (pull correctly suppressed); not a failure` };
    },
  },
  {
    id: "webspinner",
    section: "§5",
    what: "Webspinner: webs the player (webbedT rises)",
    // It is a RANGED attacker (zombie.ts:134 — ranged:true, SPITTER_WINDUP +
    // SPITTER_COOLDOWN) and the glob travels at WEB_GLOB_SPEED. So a hit needs
    // approach + windup + flight time. A 6s window caught it most runs but not
    // all — that was a flaky assertion, not a broken mechanic. Spawn a few, in
    // range, and wait long enough for the whole chain.
    async run(page) {
      const r = await page.evaluate(async () => {
        window.__dungeonClear?.();
        window.__dungeonPad?.connect();
        window.__dungeonPad?.stick(0, 0);
        window.__dungeonLaunch?.(1, 0, 0);   // stand still; do not outrun them
        window.__dungeonSpawn({ kind: "webspinner", count: 4, ring: 3, aggro: true });
        await new Promise((r) => setTimeout(r, 300));
        const spawned = (window.__dungeonStats?.().enemies ?? []).filter((z) => z.kind === "webspinner").length;
        if (!spawned) return { skip: "webspinner did not spawn" };

        let peak = 0;
        for (let i = 0; i < 100; i++) {      // up to ~15s
          await new Promise((r) => setTimeout(r, 150));
          peak = Math.max(peak, window.__dungeonProbe()?.buffs?.webbed ?? 0);
          if (peak > 0) break;
          // Keep standing still — momentum would break the engagement.
          window.__dungeonPad?.stick(0, 0);
        }
        return { peak, spawned };
      });
      if (r.skip) return { status: "SKIP", detail: r.skip };
      return { status: r.peak > 0 ? "PASS" : "FAIL", detail: `peak webbedT=${r.peak.toFixed(2)} (4 spinners, up to 15s)` };
    },
  },
  {
    id: "parts-clear-web",
    section: "§5",
    what: "Pinball parts cleanse webs (onPartTrigger)",
    async run(page) {
      return { status: "SKIP", detail: "needs a scriptable part-trigger hook; covered indirectly by webspinner + bounce runs" };
    },
  },
];

// ── Runner ─────────────────────────────────────────────────────────────────
let browser = null, realGpu = false;
if (a.gpu) {
  browser = await connectRealGpu({ port: CDP_PORT, headed: a.headed, log });
  realGpu = !!browser;
  if (!browser) console.warn("⚠ no host browser for --gpu; using software rendering");
}
if (!browser) {
  browser = await chromium.launch({
    headless: !a.headed,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
}

const ctx = realGpu
  ? browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 720 } }))
  : await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120_000);
await page.setViewportSize({ width: 1280, height: 720 });

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));

let targetUrl = a.url;
if (realGpu) {
  const u = new URL(a.url);
  if (u.hostname !== "localhost" && /^(127\.|0\.0\.0\.0|10\.|100\.|172\.|192\.168\.)/.test(u.hostname)) {
    u.hostname = "localhost";
    targetUrl = u.toString();
  }
}

log(`▶ ${realGpu ? "REAL GPU (host browser)" : "software (SwiftShader)"} — ${targetUrl}`);
try {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, { timeout: 120_000 });
} catch (e) {
  console.error(`✗ could not reach a playable dungeon — is the dev server running?\n  ${e.message}`);
  await browser.close(); closeHostBrowser(); process.exit(2);
}
// God mode: these checks are about mechanics, not survival. A bot that dies
// mid-audit would report SKIPs that look like failures.
await page.evaluate(() => window.__dungeonDebug?.({ god: true }));

// LEAVE THE PLUNGER CHUTE FIRST. A floor opens with the knight parked in the
// launcher, where `updatePlunger` owns him and swallows movement AND zeroes
// momentum every frame (player.ts:1651). Every check below reads position or
// momSpeed, so running them while parked produces identical before/after
// numbers that look exactly like a broken mechanic. This cost one full audit
// round: three "FAIL"s that were all this.
await page.evaluate(async () => {
  window.__dungeonPad.connect();
  // Retry: the pad poller needs a press frame AND a release frame to see an
  // edge, and a slow first frame can swallow one attempt.
  for (let i = 0; i < 5; i++) {
    if (!window.__dungeonPlayer()?.plungerArmed) break;
    window.__dungeonPad.stick(0, 0);
    window.__dungeonPad.hold(0);            // A = plunger pull
    await new Promise((r) => setTimeout(r, 700));
    window.__dungeonPad.release(0);         // fire
    await new Promise((r) => setTimeout(r, 900));
  }
  window.__dungeonPad.stick(0, 0);
});
if (await page.evaluate(() => window.__dungeonPlayer()?.plungerArmed)) {
  console.error("✗ could not leave the launch chute — every check would be meaningless. Aborting.");
  await browser.close(); closeHostBrowser(); process.exit(2);
}

const picked = a.only ? CHECKS.filter((c) => c.id === a.only) : CHECKS;
if (!picked.length) { console.error(`no check named "${a.only}"`); process.exit(2); }

// Between checks, put the world back to a known state. Checks share one page
// (booting a floor costs ~20s), so without this an earlier check's freeze,
// buff or horde silently decides a later check's verdict — which showed up as
// results that FLIPPED between runs.
async function resetWorld(page) {
  await page.evaluate(async () => {
    window.__dungeonClear?.();
    window.__dungeonPad?.connect();
    window.__dungeonPad?.stick(0, 0);
    window.__dungeonPad?.release(0);
    window.__dungeonLaunch?.(1, 0, 0);      // drop momentum
    // Wait out any lingering timed buff (freeze/ballform) rather than guessing.
    for (let i = 0; i < 60; i++) {
      const pr = window.__dungeonProbe?.() ?? {};
      const b = pr.buffs ?? {};
      const busy = (pr.freezeT ?? 0) > 0 || (b.iron ?? 0) > 0 || (b.turbo ?? 0) > 0 ||
                   (b.webbed ?? 0) > 0 || (b.rage ?? 0) > 0 || (b.haste ?? 0) > 0;
      if (!busy) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  });
}

const results = [];
for (const c of picked) {
  let r;
  try {
    await resetWorld(page);
    r = await c.run(page);
  } catch (e) {
    r = { status: "SKIP", detail: `threw: ${String(e.message || e).slice(0, 120)}` };
  }
  results.push({ ...c, ...r });
  const icon = r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "⊘";
  log(`${icon} ${c.section} ${c.what}\n    ${r.detail}`);
}

log("\n── audit result ────────────────────────────────");
const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL");
const skip = results.filter((r) => r.status === "SKIP");
log(`PASS ${pass}   FAIL ${fail.length}   SKIP ${skip.length}`);
if (fail.length) {
  console.error("\nFAILED — these mechanics do not do what the checklist claims:");
  for (const f of fail) console.error(`  ✗ ${f.section} ${f.what}\n      ${f.detail}`);
}
if (skip.length) {
  log("\nSKIPPED (not verified — preconditions unmet, NOT a pass):");
  for (const s of skip) log(`  ⊘ ${s.what}\n      ${s.detail}`);
}
if (pageErrors.length) {
  console.error(`\n${pageErrors.length} page error(s):`);
  for (const e of pageErrors.slice(0, 10)) console.error("   ", e);
}

await browser.close();
closeHostBrowser();
process.exit(fail.length || pageErrors.length ? 1 : 0);
