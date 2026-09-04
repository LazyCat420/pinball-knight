#!/usr/bin/env node
/**
 * AUDIT PROBE (temporary) — does a death animation play during ORDINARY PLAY
 * on the DEPLOYED build?
 *
 * Not a lab: no god mode, no __dungeonKill, no 20-second wait for imported art.
 * The bot plays the game; every death the build reports is transcribed from its
 * own console instrumentation and scored on whether the TEXTURE reached and
 * held the last death cel.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "https://pinballknight.braindeadbot.com/" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    seconds: { type: "string", default: "70" },
    /** Wait this long after the run starts before killing anything. 0 = the early window. */
    warm: { type: "string", default: "0" },
    out: { type: "string", default: ".death-audit" },
    gpu: { type: "string", default: "webgpu" },
    intro: { type: "boolean", default: false },
  },
});
const PORT = Number(a["cdp-port"]);

async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}
if (!(await cdpAlive(PORT))) { console.error(`no CDP browser on :${PORT}`); process.exit(2); }
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 120_000 });
const ctx = browser.contexts()[0] || (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
await page.addInitScript(() => { if (typeof window.process === "undefined") window.process = { env: {} }; });

const lines = [];
page.on("console", (m) => { const t = m.text(); if (t.includes("[death:") || t.includes("[dungeon]")) lines.push({ t: Date.now(), text: t }); });
page.on("pageerror", (e) => lines.push({ t: Date.now(), text: `[pageerror] ${String(e.message).slice(0, 200)}` }));

const url = new URL(a.url);
if (a.gpu !== "none") url.searchParams.set("gpu", a.gpu);
if (!a.intro) url.searchParams.set("no-intro", "1");
if (!a.intro) url.searchParams.set("seed", "777");
if (!a.intro) url.searchParams.set("cb", String(Date.now()));
console.log(`▶ ${url}`);
await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonStartRun === "function", null, { timeout: 60_000 });
const build = await page.evaluate(() => ({
  bundle: [...document.querySelectorAll("script[src]")].map((s) => s.src),
  hasLab: typeof window.__lab === "function" || typeof window.__lab === "object",
}));
console.log("▶ build:", JSON.stringify(build));
if (!a.intro) await page.evaluate(() => window.__dungeonFreshRun?.());
if (a.intro) await page.waitForTimeout(12_000);
await page.evaluate(() => window.__dungeonStartRun());
await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__gui?.close?.(); });
const warm = Number(a.warm);
if (warm > 0) await page.waitForTimeout(warm * 1000);

const t0 = Date.now();
console.log(`▶ playing for ${a.seconds}s (bot), warm=${warm}s`);
await page.evaluate((s) => window.__dungeonBot({ seconds: s }), Number(a.seconds));

// Sample every actor every 50 ms; key each death by dbg identity via kind+position bucket.
const samples = [];
const until = Date.now() + Number(a.seconds) * 1000;
while (Date.now() < until) {
  const rows = await page.evaluate(() => (window.__dungeonAnim?.() ?? []).map((r) => ({
    kind: r.kind, mode: r.mode, animState: r.animState, clip: r.clip, resolved: r.resolved,
    frameIdx: r.frameIdx, texFrame: r.texFrame, indices: r.indices, finished: r.finished,
    visible: r.meshVisible, x: Math.round(r.x * 10) / 10, z: Math.round(r.z * 10) / 10,
  })));
  samples.push({ t: Date.now() - t0, rows });
  await page.waitForTimeout(50);
}
try { await page.evaluate(() => window.__dungeonBotStop?.()); } catch {}

mkdirSync(a.out, { recursive: true });
writeFileSync(`${a.out}/console.log`, lines.map((l) => `${l.t - t0}\t${l.text}`).join("\n"));
writeFileSync(`${a.out}/samples.json`, JSON.stringify(samples));

// ── Score: every actor that was ever seen dying, keyed by kind+spawn cell ──
const tracks = new Map();
for (const s of samples) {
  for (const r of s.rows) {
    if (r.mode !== "dead" && r.animState !== "dying" && r.animState !== "dead") continue;
    const key = `${r.kind}@${r.x},${r.z}`;
    let tr = tracks.get(key);
    if (!tr) { tr = { key, kind: r.kind, tex: [], idx: [], clips: new Set(), indices: r.indices, finished: false, visible: true }; tracks.set(key, tr); }
    if (tr.tex[tr.tex.length - 1] !== r.texFrame) tr.tex.push(r.texFrame);
    if (tr.idx[tr.idx.length - 1] !== r.frameIdx) tr.idx.push(r.frameIdx);
    tr.clips.add(r.resolved);
    tr.indices = r.indices;
    tr.finished ||= r.finished;
    tr.visible &&= r.visible;
  }
}
const rowsOut = [...tracks.values()].map((tr) => {
  const last = tr.indices?.[tr.indices.length - 1];
  const reached = tr.tex.includes(last);
  const stepped = tr.tex.length > 1;
  return { ...tr, clips: [...tr.clips], last, reached, stepped, pass: stepped && reached };
});
console.log("\n── DEATHS OBSERVED IN ORDINARY PLAY ─────────────────────────");
for (const r of rowsOut) {
  console.log(`${r.pass ? "✔" : "✖"} ${r.key.padEnd(26)} clip=${r.clips.join("/")} idx=[${r.idx.join(",")}] tex=[${r.tex.join(",")}] of [${(r.indices||[]).join(",")}] finished=${r.finished} visible=${r.visible}`);
}
const bad = rowsOut.filter((r) => !r.pass);
console.log(`\n${rowsOut.length - bad.length}/${rowsOut.length} observed deaths stepped the texture to the terminal cel.`);
console.log(`console lines: ${lines.length} -> ${a.out}/console.log`);
await page.close();
await browser.close();
