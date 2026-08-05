#!/usr/bin/env node
/**
 * Screenshot the DOS boot screen — the loading manifest — on real WebGPU.
 *
 * The manifest (src/transitions/boot-manifest.ts) adds ~20 lines to a screen
 * that is a centred flex column inside `overflow:hidden`. The failure mode is
 * not "it looks wrong", it is "the PRESS ANY KEY prompt is pushed off the
 * bottom and the boot reads as hung" — which no unit test can see. So this
 * shoots the boot at several viewports AND reports whether the boot column
 * actually fits.
 *
 * Usage:
 *   node scripts/boot-shot.mjs --url http://localhost:5231/ --at 1500,4000
 *   node scripts/boot-shot.mjs --viewport 390x844 --out /tmp/boot-mobile.png
 */
import { parseArgs } from "node:util";
import { connectRealGpu, closeHostBrowser, rewriteForHostBrowser } from "./lib/host-chrome.mjs";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5231/" },
    viewport: { type: "string", default: "1280x720" },
    at: { type: "string", default: "2500" }, // ms after load, comma separated
    click: { type: "string", default: "" },  // ms at which to press START
    out: { type: "string", default: "/tmp/boot" },
    flags: { type: "string", default: "" },
  },
});

const [width, height] = a.viewport.split("x").map(Number);
const shots = a.at.split(",").map(Number);

const browser = await connectRealGpu({ port: 9333 });
if (!browser) process.exit(2);
const ctx = await browser.newContext({ viewport: { width, height } });
const page = await ctx.newPage();

try {
  const url = new URL(rewriteForHostBrowser(a.url));
  url.searchParams.set("gpu", "webgpu");
  for (const kv of a.flags.split("&").filter(Boolean)) {
    const [k, v = "1"] = kv.split("=");
    url.searchParams.set(k, v);
  }
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });

  const clickAt = a.click ? Number(a.click) : null;
  let clicked = false;
  let prev = 0;
  for (const at of shots) {
    if (clickAt != null && !clicked && clickAt <= at) {
      await page.waitForTimeout(Math.max(0, clickAt - prev));
      prev = clickAt;
      await page.mouse.click(40, 40); // anywhere but the SKIP button
      clicked = true;
      console.log(`\n  ▶ pressed START at ${clickAt}ms`);
    }
    await page.waitForTimeout(Math.max(0, at - prev));
    prev = at;
    const file = `${a.out}-${a.viewport}-${at}ms.png`;
    await page.screenshot({ path: file });

    // Fit report. `.intro-container` is the boot column; anything below the
    // viewport is invisible behind `#loading-screen { overflow: hidden }`.
    const fit = await page.evaluate(() => {
      const container = document.querySelector(".intro-container");
      const list = document.querySelector(".boot-manifest pre:last-child");
      const text = document.getElementById("dos-text");
      if (!container) return null;
      // `.intro-container` is height:100%, so ITS box always equals the
      // viewport — the overflow is in the children, which a centred flex column
      // pushes out of BOTH ends. Measure the children.
      const flow = [...container.children].filter((el) => !el.classList.contains("boot-manifest"));
      const tops = flow.map((el) => el.getBoundingClientRect().top);
      const bottoms = flow.map((el) => el.getBoundingClientRect().bottom);
      const contentTop = Math.min(...tops);
      const contentBottom = Math.max(...bottoms);
      const kids = flow.map((el) => {
        const b = el.getBoundingClientRect();
        return { tag: el.id || el.className || el.tagName, top: Math.round(b.top), bottom: Math.round(b.bottom) };
      });
      return {
        viewportH: window.innerHeight,
        columnH: Math.round(contentBottom - contentTop),
        columnBottom: Math.round(contentBottom),
        overflowPx:
          Math.max(0, Math.round(-contentTop)) +
          Math.max(0, Math.round(contentBottom - window.innerHeight)),
        // Every row is its own <span>, so textContent would run them together.
        manifest: list
          ? [...list.children]
              .filter((el) => el.style.display !== "none")
              .map((el) => el.textContent)
              .join("\n")
          : "(no manifest)",
        layout: list && list.closest(".boot-manifest").style.position === "absolute" ? "panel" : "inline",
        tally: document.querySelector(".boot-manifest pre")?.textContent ?? "",
        dosTextBottom: text ? Math.round(text.getBoundingClientRect().bottom) : 0,
        kids,
      };
    });

    console.log(`\n── ${a.viewport} @ ${at}ms → ${file}`);
    if (!fit) {
      console.log("  (loading screen already gone)");
      continue;
    }
    console.log(
      `  viewport ${fit.viewportH}px · ${fit.layout} · column ${fit.columnH}px · bottom ${fit.columnBottom}px` +
        (fit.overflowPx ? `  ⚠️ OVERFLOWS BY ${fit.overflowPx}px` : "  ✓ fits"),
    );
    console.log(`  ${fit.tally}`);
    console.log(
      fit.manifest
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );
  }
} finally {
  await ctx.close();
  closeHostBrowser();
}
