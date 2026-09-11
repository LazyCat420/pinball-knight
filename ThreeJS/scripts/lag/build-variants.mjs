import WebSocket from 'ws';
const cdpUrl='http://127.0.0.1:9353', origin='http://localhost:5183';
const tab=await (await fetch(`${cdpUrl}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)});
let id=0;const pending=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;pending.set(call,m=>m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id:call,method,params}));});
const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:170000});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value};
const until=async(expr,ms=120000)=>{const t0=Date.now();while(Date.now()-t0<ms){if(await ev(expr).catch(()=>false))return;await new Promise(r=>setTimeout(r,500));}throw new Error('until timeout: '+expr)};
await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:origin+'/?playtest=1&mute=1&seed=42'});
await until('typeof window.__dungeonStartRun==="function"');await new Promise(r=>setTimeout(r,3000));
if(process.env.RUN){await ev('window.__dungeonStartRun()');await until('window.__dungeonPlayer?.()?.active===true');await new Promise(r=>setTimeout(r,8000));if(process.env.RUN==='bot'){await ev('window.__dungeonBot({mode:"mixed",seconds:60})');await new Promise(r=>setTimeout(r,3000));}console.log('game running, bot=',process.env.RUN==='bot');}
console.log(String(await ev(`(async()=>{
 const sh=await import('/src/game/pinball-knight/boot/sheets.ts');const eng=await import('/src/game/pinball-knight/engine/render/sprite.ts');const cp=await import('/src/game/pinball-knight/render/cel-painter.ts');
 const P=CanvasRenderingContext2D.prototype, orig=P.getImageData;let rec=null;let cid=0;
 P.getImageData=function(...a){const t=performance.now();const r=orig.apply(this,a);const ms=performance.now()-t;if(rec){const c=this.canvas;c.__id??=++cid;const k=c.width+'x'+c.height+(this.getContextAttributes?.().willReadFrequently?'H':'G');const e=rec[k]??={n:0,ms:0,max:0};e.n++;e.ms+=ms;e.max=Math.max(e.max,ms);}return r;};
 const out=[];const dbg=window.__spriteDebug;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const build=async(key,label)=>{rec={};const paints=sh.paintsFor(key);const t=performance.now();const b=eng.startSpriteSheet(paints,{lockEntries:20});let steps=0;while(!b.step(3)){steps++;await new Promise(r=>requestAnimationFrame(r));}const ms=performance.now()-t;const r={};for(const [k,e] of Object.entries(rec))if(k.startsWith('168'))r[k]={n:e.n,avg:+(e.ms/e.n).toFixed(2),max:+e.max.toFixed(1)};out.push({label,key,steps,wall:+ms.toFixed(0),reads:r});b.sheet.texture?.dispose?.();};
 await build('warden','A idle player, HUD on');
 window.__dungeonBot({mode:"mixed",seconds:90});await sleep(3000);
 await build('warden','B bot playing, HUD on');
 await build('warden','B2 bot playing, HUD on');
 const gui=window.__gui;try{gui?.close?.();}catch{}
 await sleep(500);
 await build('warden','C bot playing, gui.close()');
 window.__dungeonBotStop?.();await sleep(1500);
 await build('warden','D idle after bot');
 P.getImageData=orig;return JSON.stringify(out,null,0);})()`)).replace(/\},\{/g,"},\n{"));
ws.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);
