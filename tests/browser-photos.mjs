import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { connect } from '../src/db.mjs';
import { application } from '../src/server.mjs';
// Uses the locally installed Edge, no browser download or service credentials.
await mkdir('data',{recursive:true});
const profile=await mkdtemp(resolve('data/browser-qa-'));
const db=await connect({demo:true,file:':memory:'});
const {server,sales,integrations}=application(db);
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errors=[];
try{
 let port;
 for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await sleep(100);}}
 assert.ok(port,'Edge DevTools must start');
 const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 let next=0;const pending=new Map();
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+': '+m.params.exceptionDetails.exception?.description);});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=expression=>evaluate(`new Promise((resolve,reject)=>{let n=0;const check=()=>{try{if(${expression})return resolve(true);}catch{}if(++n>150)return reject(new Error('UI timed out: '+${JSON.stringify(expression)}));setTimeout(check,50);};check();})`);
  const click=async selector=>{const point=await evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!el)throw new Error('No visible control: '+${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
 const fill=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const screenshot=async name=>{await evaluate("document.querySelector('#notice').classList.remove('show');window.scrollTo(0,0)");await sleep(100);const img=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`data/screenshots/ui-${name}.png`,Buffer.from(img.data,'base64'));};
 const viewport=async(width,height=1000)=>{await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<781});await sleep(100);};
 const noOverflow=async name=>assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`${name} must not overflow`);
 const nav=async(hash,condition)=>{await evaluate(`location.hash=${JSON.stringify(hash)}`);await wait(condition);};

 await mkdir('data/screenshots',{recursive:true});await cdp('Runtime.enable');await cdp('Page.enable');await viewport(1440);
 await cdp('Page.navigate',{url:base});await wait("document.querySelector('#login-form')");

 const remoteImages=[];socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Network.requestWillBeSent'&&m.params.type==='Image'&&/^https?:/.test(m.params.request.url)&&!m.params.request.url.startsWith(base+'/'))remoteImages.push(m.params.request.url);});await cdp('Network.enable');
 const photos=async(selector,count)=>{await wait('document.querySelectorAll('+JSON.stringify(selector)+').length==='+count+' && [...document.querySelectorAll('+JSON.stringify(selector)+')].every(i=>i.complete&&i.naturalWidth>0)');assert.ok(await evaluate('[...document.querySelectorAll('+JSON.stringify(selector)+')].every(i=>getComputedStyle(i).objectFit===\'contain\' && Math.abs(i.parentElement.getBoundingClientRect().width-i.parentElement.getBoundingClientRect().height)<1 && i.alt.length>10 && i.getBoundingClientRect().width<=i.parentElement.clientWidth && i.getBoundingClientRect().height<=i.parentElement.clientHeight)'));};
 await evaluate("document.querySelector('.demo-accounts').open=true");await click('[data-email="alex@example.test"]');await wait("document.querySelector('main h1')?.textContent==='My orders'");await nav('new',"document.querySelector('#seller-select')");
 await fill('#seller-select','2');await photos('.offer-row .product-photo img',2);await screenshot('photos-studio-desktop');await viewport(390,844);await noOverflow('Studio photos mobile');await screenshot('photos-studio-mobile');await viewport(1440);
 await fill('#seller-select','1');await photos('.offer-row .product-photo img',4);for(const id of [1,2,3,4])await click('[data-action="add-item"][data-id="'+id+'"]');await photos('.selected-item .product-photo img',4);await screenshot('photos-selection-desktop');await viewport(390,844);await noOverflow('Selection 390px');await screenshot('photos-selection-mobile');await viewport(320,800);await noOverflow('Selection 320px');await screenshot('photos-selection-320');await viewport(1440);
 await click('.stage-navigation [data-action="stage-next"]');await fill('[name="requested_delivery_address"]','Sample campus address');await click('.stage-navigation [data-action="stage-next"]');await photos('.review-line .product-photo img',4);await screenshot('photos-review-desktop');await viewport(390,844);await noOverflow('Review 390px');await screenshot('photos-review-mobile');await viewport(320,800);await noOverflow('Review 320px');await screenshot('photos-review-320');await viewport(1440);
 await click('#accept-prices');await click('[data-action="submit-order"]');await wait("document.querySelector('.page-head .badge')?.textContent==='Pending stock'");await photos('.purchase-item .product-photo img',4);await screenshot('photos-details-desktop');await viewport(390,844);await noOverflow('Details 390px');await screenshot('photos-details-mobile');await viewport(320,800);await noOverflow('Details 320px');await screenshot('photos-details-320');
 await evaluate("document.querySelector('.purchase-item .product-photo img').src='/assets/demo-products/missing.jpg'");await wait("document.querySelector('.purchase-item .product-photo').classList.contains('image-unavailable')");assert.equal(await evaluate("getComputedStyle(document.querySelector('.purchase-item .product-photo-fallback')).display"),'flex');await screenshot('photos-broken-fallback');
 await evaluate("import('/product-images.mjs').then(({productThumbnail})=>{document.querySelector('.purchase-item .product-photo').outerHTML=productThumbnail({product_name:'Unavailable sample',offer_id:999},{demo:false});})");assert.equal(await evaluate("document.querySelector('.purchase-item .product-photo-fallback').getAttribute('aria-label')"),'Photo unavailable for Unavailable sample');await noOverflow('Missing photo fallback');
 assert.deepEqual(remoteImages,[]);assert.deepEqual(errors,[]);console.log('Photo browser QA passed: six local photos, both sellers, selection/selected/review/details, square contain thumbnails, alt text, broken/missing fallbacks, no external image requests, desktop/390px/320px screenshots and overflow checks.');await cdp('Browser.close').catch(()=>{});
}finally{
 socket?.close();browser.kill();await new Promise(r=>server.close(r));await db.close();const absolute=resolve(profile);assert.ok(absolute.startsWith(resolve('data')+'\\'));await sleep(500);await rm(absolute,{recursive:true,force:true,maxRetries:4,retryDelay:500}).catch(()=>{});
}
