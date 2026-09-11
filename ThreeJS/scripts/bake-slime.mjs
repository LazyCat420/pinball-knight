/** Run with Vite serving and a Chromium CDP endpoint. Produces the three slime atlases. */
import WebSocket from 'ws';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const cdp=process.env.CDP_URL || 'http://localhost:9345';
const origin=process.env.PK_URL || 'http://localhost:5174';
const tab=await (await fetch(`${cdp}/json/new?${encodeURIComponent(`${origin}/scripts/slime-bake.html`)}`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)});
let id=0;const pending=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}else if(m.method==='Runtime.exceptionThrown')console.error(m.params.exceptionDetails)});
const send=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;const timer=setTimeout(()=>{pending.delete(call);reject(new Error(`Timed out: ${method}`))},90000);pending.set(call,m=>{clearTimeout(timer);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result)});ws.send(JSON.stringify({id:call,method,params}));});
try {
 await send('Runtime.enable');
 for(let i=0;i<60;i++){const r=await send('Runtime.evaluate',{expression:'window.studioReady',returnByValue:true});if(r.result.value)break;await new Promise(r=>setTimeout(r,250));}
 const baked=await send('Runtime.evaluate',{expression:`window.bakeSlimeSheets()`,awaitPromise:true,returnByValue:true});
 if(baked.exceptionDetails)throw new Error(JSON.stringify(baked.exceptionDetails));
 const dest=new URL('../public/sprites/',import.meta.url);
 for(const {dir,png,manifest} of baked.result.value){
  const bytes=Buffer.from(png.split(',')[1],'base64');manifest.hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
  await fs.writeFile(new URL(`${manifest.name}-${dir}.png`,dest),bytes);
  await fs.writeFile(new URL(`${manifest.name}-${dir}.json`,dest),JSON.stringify(manifest,null,2)+'\n');
  console.log(`${dir}: ${manifest.rows.reduce((n,r)=>n+r.cells.length,0)} frames, ${bytes.length} bytes`);
 }
} finally {ws.close();await fetch(`${cdp}/json/close/${tab.id}`);}
