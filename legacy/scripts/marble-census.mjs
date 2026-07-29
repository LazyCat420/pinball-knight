/**
 * MARBLE CENSUS — which palette entries a marble body actually paints.
 *
 * Written because the contact sheet showed a GREEN water marble and nobody
 * could say why. The answer needed numbers: the screen-space snap is
 * LUMA-WEIGHTED (green carries 0.587 of the distance), so a mid-luminance cyan
 * is matched mostly on its green channel and lands on the rot ramp (6-9)
 * rather than the arcane ramp it belongs to. 26.8% of the water marble was rot
 * green, measured — invisible to every test, and not obvious by eye at 128px.
 *
 * ROT% is the number to watch. Under ~5% is fringe pixels; double digits means
 * a body is being painted in the wrong ramp. The fixes are always the same:
 * author from palette entries, hard-stop the gradients, and prefer opaque
 * shapes to translucent washes.
 *
 *   node scripts/marble-census.mjs
 */
import { arg, bundle, open } from "./lib/card-harness.mjs";
const js = await bundle(`
import { marbleBallFrames } from "./src/game/pinball-knight/render/cel-painter";
import { crushToGrid } from "./src/game/pinball-knight/engine/render/sprite";
import { setEnginePalette } from "./src/game/pinball-knight/engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./src/game/pinball-knight/render/palette";
setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
window.__m = { marbleBallFrames, crushToGrid, PALETTE_HEX };
`);
const html = `<!doctype html><meta charset=utf8><script>${js}</script><script>
const { marbleBallFrames, crushToGrid, PALETTE_HEX } = window.__m;
function near(r,g,b){let bi=0,bd=1e9;for(let i=0;i<PALETTE_HEX.length;i++){const h=PALETTE_HEX[i];
 const dr=r-((h>>16)&255),dg=g-((h>>8)&255),db=b-(h&255);const d=dr*dr*0.299+dg*dg*0.587+db*db*0.114;
 if(d<bd){bd=d;bi=i;}}return bi;}
const rep=[];
for (const m of ["diamond","water","stone","storm","shadow","lava"]) {
  const counts=new Array(32).fill(0); let total=0;
  for (const f of marbleBallFrames(m)) {
    const raw=document.createElement("canvas");raw.width=128;raw.height=128;
    f(raw.getContext("2d"));
    const src=crushToGrid(raw);
    const d=src.getContext("2d").getImageData(0,0,src.width,src.height).data;
    for(let i=0;i<d.length;i+=4){if(d[i+3]<8)continue;counts[near(d[i],d[i+1],d[i+2])]++;total++;}
  }
  const top=counts.map((c,i)=>[i,c]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,7)
    .map(([i,c])=>i+":"+(100*c/total).toFixed(1)+"%").join(" ");
  const rot=counts.slice(6,10).reduce((a,b)=>a+b,0);
  rep.push(m.padEnd(8)+" ROT="+(100*rot/total).toFixed(1)+"%  "+top);
}
window.__out=rep.join("\\n");window.__ready=true;
</script>`;
const { browser, page } = await open(html, { width: 400, height: 200 });
console.log(await page.evaluate(() => window.__out));
await browser.close();
