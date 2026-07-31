#!/usr/bin/env node
/**
 * A one-off page probe: run an expression in the live game and print the result.
 *
 * Exists because "the effect did not appear in the screenshot" has at least three
 * causes — it was never emitted, it was emitted and is invisible, or the dev hook
 * that emits it does not exist in this build — and a picture cannot tell them
 * apart. This asks the page.
 *
 *   node scripts/fx-probe.mjs --do "typeof __fx.puff"
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5199/dungeon" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    do: { type: "string", default: "1" },
    boot: { type: "string", default: "16" },
    "shot-diff": { type: "boolean", default: false },
    "shot-delay": { type: "string", default: "300" },
    out: { type: "string", default: "/tmp/fx-probe.png" },
  },
});

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${a["cdp-port"]}`, { timeout: 120_000 });
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e.message).slice(0, 300)));
page.on("console", (m) => {
  const t = m.text();
  if (/\/ws|HMR|hot-update/i.test(t)) return;
  if (m.type() === "error" || m.type() === "warning" || /THREE|WGSL|shader|node|invalid/i.test(t)) {
    errs.push(m.type().toUpperCase() + " " + t.slice(0, 300));
  }
});

const url = new URL(a.url);
url.searchParams.set("gpu", "webgpu");
url.searchParams.set("seed", "777");
url.searchParams.set("no-intro", "1");
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__renderBackendResolved != null, null, { timeout: 60_000 });
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
await page.waitForTimeout(Number(a.boot) * 1000);

/**
 * Optional: measure whether the expression CHANGED THE SCREEN.
 *
 * "It did not appear in my crop" and "it does not render" look identical from a
 * screenshot. A whole-frame diff before and after separates them without needing
 * to guess where the effect landed.
 */
if (a["shot-diff"]) {
  const sharp = (await import("sharp")).default;
  const raw = async (buf) => (await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })).data;
  const before = await raw(await page.screenshot());
  await page.evaluate((expr) => {
    // eslint-disable-next-line no-eval
    eval(expr);
  }, a.do);
  await page.waitForTimeout(Number(a["shot-delay"]));
  const shot = await page.screenshot({ path: a.out });
  const after = await raw(shot);
  let sum = 0;
  let changed = 0;
  for (let i = 0; i < before.length; i++) {
    const d = Math.abs(before[i] - after[i]);
    sum += d;
    if (d > 8) changed++;
  }
  console.log(
    JSON.stringify(
      {
        meanAbsDiff: +(sum / before.length).toFixed(3),
        changedChannels: changed,
        changedPct: +((changed / before.length) * 100).toFixed(3),
        wrote: a.out,
      },
      null,
      2,
    ),
  );
  if (errs.length) console.log("page errors:", [...new Set(errs)].slice(0, 5));
  process.exit(changed > 0 ? 0 : 1);
}

const out = await page.evaluate((expr) => {
  try {
    // eslint-disable-next-line no-eval
    const v = eval(expr);
    return { ok: true, value: JSON.parse(JSON.stringify(v ?? null)) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}, a.do);

console.log(JSON.stringify(out, null, 2));
if (errs.length) console.log("page messages:\n  " + [...new Set(errs)].slice(0, 12).join("\n  "));
process.exit(out.ok ? 0 : 1);
