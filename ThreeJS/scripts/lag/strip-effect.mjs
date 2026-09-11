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
 const sh=await import('/src/game/pinball-knight/boot/sheets.ts');const eng=await import('/src/game/pinball-knight/engine/render/sprite.ts');
 const SPX=168,G=84;const mk=(w,h,hint)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d',hint?{willReadFrequently:true}:undefined)];};
 const out=[];
 for(const key of ['warden','goblin','spider','fries']){
   const paints=sh.paintsFor(key);const frames=[...(paints.S.idle||[]),...(paints.S.walk||[]),...(paints.S.attack||[]),...(paints.S.death||[]),...(paints.E.walk||[]),...(paints.N.walk||[])].slice(0,24);
   const row={key,frames:frames.length};
   for(const [label,stripHint,withStrip] of [['gpuStrip',false,true]]){
     const [pc,pg]=mk(SPX,SPX,true);const [cc,cg]=mk(G,G,true);const [st,sg]=mk(1344,1344,stripHint);
     let read=0,worst=0,blit=0;
     for(let i=0;i<frames.length;i++){const f=frames[i];pg.setTransform(1,0,0,1,0,0);pg.clearRect(0,0,SPX,SPX);eng.paintInArtSpace(pg,f);cg.clearRect(0,0,G,G);
       const b=performance.now();pg.getImageData(0,0,SPX,SPX);const c2=performance.now();read+=c2-b;worst=Math.max(worst,c2-b);
       cg.drawImage(pc,0,0,SPX,SPX,0,0,G,G);const d=performance.now();if(withStrip)sg.drawImage(cc,(i%16)*G,Math.floor(i/16)*G);blit+=performance.now()-d;}
     row[label]={readAvg:+(read/frames.length).toFixed(2),readWorst:+worst.toFixed(1),blitAvg:+(blit/frames.length).toFixed(2)};
   }
   out.push(row);
 }
 return JSON.stringify(out,null,0);})()`)).replace(/\},\{/g,"},\n{"));
ws.close();await fetch(`${cdpUrl}/json/close/${tab.id}`);
