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
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);timer.unref();const done=resolve;resolve=value=>{clearTimeout(timer);done(value);};pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=expression=>evaluate(`new Promise((resolve,reject)=>{let n=0;const check=()=>{try{if(${expression})return resolve(true);}catch{}if(++n>150)return reject(new Error('UI timed out: '+${JSON.stringify(expression)}));setTimeout(check,50);};check();})`);
  const click=async selector=>{const point=await evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);if(!el)throw new Error('No visible control: '+${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
 const fill=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const screenshot=async name=>{await evaluate("document.querySelector('#notice').classList.remove('show');window.scrollTo(0,0)");await sleep(100);const img=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`docs/ui-review/2026-10-22/ui-preferences-${name}.png`,Buffer.from(img.data,'base64'));await writeFile(`docs/ui-review/2026-10-22/ui-preferences-${name}.json`,JSON.stringify(await evaluate('({width:innerWidth,height:innerHeight,role:document.querySelector(".account small")?.textContent||"Signed out",page:location.hash})'),null,2));};
 const viewport=async(width,height=1000)=>{await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<781});await sleep(100);};
 const noOverflow=async name=>assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`${name} must not overflow`);
 const nav=async(hash,condition)=>{await evaluate(`location.hash=${JSON.stringify(hash)}`);await wait(condition);};


 await mkdir('docs/ui-review/2026-10-22',{recursive:true});await cdp('Runtime.enable');await cdp('Page.enable');await viewport(1440);
 const u={role:'staff',user_id:1};for(const [i,offer,quantity]of [[1,1,1],[2,2,2],[3,3,1]]){const {order_id:id}=await sales.save({customer_id:1,seller_id:1,payment_method:'gcash',recipient_name:'Preference Test',recipient_contact:'09170000000',requested_delivery_address:'Campus',items:[{offer_id:offer,quantity}]},u);if(i===1){await db.query("UPDATE sales_order SET order_status='awaiting_payment' WHERE order_id=?",[id]);await db.query("UPDATE sales_order_facts SET payment='pending',stock='reserved' WHERE order_id=?",[id]);}}
 await cdp('Page.navigate',{url:base});await wait("document.querySelector('#login-form')");await evaluate("document.querySelector('.demo-accounts').open=true");await click('[data-email="alex@example.test"]');await wait("document.querySelector('#filter-form')");
 assert.match(await evaluate("document.querySelector('.stats').textContent"),/Pending payments/);assert.ok(!(await evaluate("document.querySelector('.stats').textContent")).includes('Submitted product value'));
 await fill('#filter-form [name="sort"]','amount_asc');await click('#filter-form button[type="submit"]');await wait("document.querySelector('.filter-chip')?.textContent.includes('Sort by')");const amounts=await evaluate("[...document.querySelectorAll('tbody .amount strong')].map(x=>Number(x.textContent.replace(/[^0-9.]/g,'')))");assert.deepEqual(amounts,[89.5,495,498]);await screenshot('orders-desktop');await noOverflow('Orders desktop');
 await nav('profile',"document.querySelector('#profile-form')");await fill('#profile-form [name="preferred_payment_method"]','bank_transfer');await click('#profile-form button');await wait("document.querySelector('#profile-form button')?.disabled===false");await nav('orders',"document.querySelector('#filter-form')");await nav('profile',"document.querySelector('#profile-form')");assert.equal(await evaluate("document.querySelector('[name=\"preferred_payment_method\"]').value"),'bank_transfer');await screenshot('profile-desktop');await viewport(390,844);await noOverflow('Profile mobile');await screenshot('profile-mobile');
 await nav('new',"document.querySelector('#seller-select')");await click('[data-action="add-item"][data-id="1"]');await click('.stage-navigation [data-action="stage-next"]');await wait("document.querySelector('#payment-method')");assert.equal(await evaluate("document.querySelector('#payment-method').value"),'bank_transfer');await screenshot('new-payment-mobile');
 await click('[data-action="save-draft"]');await wait("document.querySelector('#filter-form')");await click('[data-action="reset-filters"]');await wait("document.querySelectorAll('.mobile-orders .order-card').length===4");await noOverflow('Orders mobile');await screenshot('orders-mobile');
 assert.deepEqual(errors,[]);console.log('Profile preference, sorting, pending payments, and responsive header checks passed.');await cdp('Browser.close').catch(()=>{});
}finally{socket?.close();browser.kill();await new Promise(r=>server.close(r));await db.close();const absolute=resolve(profile);assert.ok(absolute.startsWith(resolve('data')+'\\'));await sleep(500);await rm(absolute,{recursive:true,force:true,maxRetries:4,retryDelay:500}).catch(()=>{});}
