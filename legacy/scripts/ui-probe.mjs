#!/usr/bin/env node
/**
 * UI PROBE — boot the dungeon on host Chrome (real WebGPU), then run a script
 * of steps: eval, key, click (in UI-pixel coords), shot.
 *
 *   node ui-probe.mjs --steps 'eval:__gui.debug()|shot:debug|clickui:200,140|eval:__dungeonPlayer().gold'
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5301/dungeon?no-intro=1&gpu=webgpu" },
    "cdp-port": { type: "string", default: "9345" },
    steps: { type: "string", default: "" },
    outdir: { type: "string", default: "/tmp/claude-1000/-home-lazycat-github-projects-sun/7f34d77f-110e-49c6-a4be-b1e682843257/scratchpad/shots" },
    w: { type: "string", default: "1600" },
    h: { type: "string", default: "900" },
    boot: { type: "string", default: "10" },
  },
});

const PORT = Number(a["cdp-port"]);
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

async function cdpAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureBrowser() {
  if (await cdpAlive()) return;
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) throw new Error("no host Chrome");
  const proc = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    "--user-data-dir=C:\\Temp\\bdb-gui-shot",
    "--enable-unsafe-webgpu",
    `--window-size=${a.w},${a.h}`,
  ], { detached: true, stdio: "ignore" });
  proc.unref();
  for (let i = 0; i < 60; i++) {
    if (await cdpAlive()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("CDP never came up");
}

await ensureBrowser();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: Number(a.w), height: Number(a.h) });
await page.bringToFront();

const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

await page.goto(a.url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonPlayer === "function", null, { timeout: 90_000 });
if (!(await page.evaluate(() => window.__dungeonPlayer()?.active === true))) {
  await page.evaluate(() => window.__dungeonStartRun?.());
}
await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 90_000 });
await page.waitForTimeout(Number(a.boot) * 1000);

const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
console.log(`▶ backend = ${backend}`);
if (backend !== "webgpu") {
  console.error("✘ not webgpu — refusing");
  process.exit(2);
}

const sizing = await page.evaluate(() => window.__gui.sizing());
console.log("▶ sizing", JSON.stringify(sizing));

for (const step of a.steps.split("|").filter(Boolean)) {
  const [kind, ...rest] = step.split(":");
  const arg = rest.join(":");
  if (kind === "eval") {
    const out = await page.evaluate((expr) => {
      try {
        return JSON.stringify(eval(expr));
      } catch (e) {
        return `THREW: ${e.message}`;
      }
    }, arg);
    console.log(`▶ ${arg} → ${out}`);
  } else if (kind === "key") {
    await page.keyboard.press(arg);
    await page.waitForTimeout(250);
    console.log(`▶ key ${arg}`);
  } else if (kind === "clickui") {
    // arg is "x,y" in UI pixels; convert to window coords via the pass sizing.
    const [ux, uy] = arg.split(",").map(Number);
    const pt = await page.evaluate(
      ({ ux, uy }) => {
        const s = window.__gui.sizing();
        const left = Math.floor((window.innerWidth - s.outW) / 2);
        const top = Math.floor((window.innerHeight - s.outH) / 2);
        return { x: left + ux * s.scale + s.scale / 2, y: top + uy * s.scale + s.scale / 2 };
      },
      { ux, uy },
    );
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
    await page.waitForTimeout(250);
    console.log(`▶ clickui ${arg} → window ${pt.x},${pt.y}`);
  } else if (kind === "evalfile") {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(arg, "utf8");
    const out = await page.evaluate((expr) => {
      try {
        return JSON.stringify(eval(expr));
      } catch (e) {
        return `THREW: ${e.message}`;
      }
    }, src);
    console.log(`\u25b6 evalfile ${arg} -> ${out}`);
  } else if (kind === "wheel") {
    const [ux, uy, dy] = arg.split(",").map(Number);
    const pt = await page.evaluate(
      ({ ux, uy }) => {
        const s = window.__gui.sizing();
        const left = Math.floor((window.innerWidth - s.outW) / 2);
        const top = Math.floor((window.innerHeight - s.outH) / 2);
        return { x: left + ux * s.scale, y: top + uy * s.scale };
      },
      { ux, uy },
    );
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(400);
    console.log(`▶ wheel ${arg}`);
  } else if (kind === "shot") {
    await page.screenshot({ path: `${a.outdir}/${arg}.png` });
    console.log(`▶ shot → ${a.outdir}/${arg}.png`);
  } else if (kind === "layer") {
    const data = await page.evaluate(() => window.__gui.shot());
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${a.outdir}/${arg}.png`, Buffer.from(data.split(",")[1], "base64"));
    console.log(`▶ layer → ${a.outdir}/${arg}.png`);
  } else if (kind === "wait") {
    await page.waitForTimeout(Number(arg));
  }
}

console.log("── console ──");
for (const l of logs.slice(-40)) console.log(l);
await page.close();
await browser.close();
