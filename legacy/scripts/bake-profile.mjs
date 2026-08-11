import { chromium } from "playwright";
import { bundle } from "./lib/card-harness.mjs";
const js = await bundle(`
import { bakeMazeSurfaces, setMazeBiome, __bakeParts } from "./src/game/pinball-knight/maze/build";
window.__bake = { bakeMazeSurfaces, setMazeBiome, parts: __bakeParts };
`);
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--no-sandbox"] });
const p = await b.newPage();
p.on("pageerror", (e) => console.error("[pageerror]", e.message));
p.on("console", (m) => console.log("[page]", m.text()));
await p.route("http://harness.local/*", (r) =>
  r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><script>" + js + "</script>" }),
);
await p.goto("http://harness.local/index.html", { timeout: 60000 });
const r = await p.evaluate(() => {
  const P = window.__bake.parts;
  const out = {};
  const t = (name, fn) => { const t0 = performance.now(); const v = fn(); out[name] = Math.round(performance.now() - t0); return v; };
  t("cap", () => P.cap());
  t("wall-plain", () => P.wall(false, false, false));
  t("normal-cap", () => P.normalCap());
  t("normal-wall", () => P.normalWall());
  const f = t("floor", () => P.floor());
  t("floor-toDataURL", () => f.image.toDataURL("image/png").length);
  t("normal-floor", () => P.normalFloor());
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
