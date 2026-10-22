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
 const screenshot=async name=>{await evaluate("document.querySelector('#notice').classList.remove('show');window.scrollTo(0,0)");await sleep(100);const img=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`docs/ui-review/2026-10-22/ui-redelivery-${name}.png`,Buffer.from(img.data,'base64'));await writeFile(`docs/ui-review/2026-10-22/ui-redelivery-${name}.json`,JSON.stringify(await evaluate('({width:innerWidth,height:innerHeight,role:document.querySelector(".account small")?.textContent||"Signed out",page:location.hash})'),null,2));};
 const viewport=async(width,height=1000)=>{await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<781});await sleep(100);};
 const noOverflow=async name=>assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`${name} must not overflow`);
 const nav=async(hash,condition)=>{await evaluate(`location.hash=${JSON.stringify(hash)}`);await wait(condition);};


 await mkdir('docs/ui-review/2026-10-22',{recursive:true});await cdp('Runtime.enable');await cdp('Page.enable');await viewport(1440);
 const u={role:'staff',user_id:1};const {order_id:id}=await sales.save({customer_id:1,seller_id:1,payment_method:'gcash',recipient_name:'Redelivery Customer',recipient_contact:'09170000000',requested_delivery_address:'Campus',items:[{offer_id:1,quantity:1}]},u);await sales.submit(id,{...await sales.review(id,u),submission_reference:'browser-retry'},u);
 for(const [service,action]of [['inventory','reserve'],['billing','invoice'],['billing','verify'],['inventory','confirm'],['delivery','accept']])await integrations.dispatch(`sales:${id}:${service}:${action}`,u);
 await integrations.dispatch(`sales:${id}:delivery:verify_delivery`,u,'reject','Recipient unavailable at the first attempt');
 const login=async email=>{await evaluate("document.querySelector('.demo-accounts').open=true");await click('[data-email="'+email+'"]');await wait("document.querySelector('#filter-form')");};const logout=async()=>{await click('[data-action="logout"]');await wait("document.querySelector('#login-form')");};
 await cdp('Page.navigate',{url:base});await wait("document.querySelector('#login-form')");await login('alex@example.test');await nav('order/'+id,"document.querySelector('#message-form')");assert.equal(await evaluate("document.querySelector('.page-head .badge').textContent"),'Fulfilling');assert.match(await evaluate("document.querySelector('.next-step-banner').textContent"),/needs rescheduling/);assert.equal(await evaluate("Boolean(document.querySelector('#reschedule-form'))"),false);await viewport(390,844);await screenshot('customer-attempt-failed-mobile');await noOverflow('Customer retry mobile');

 await logout();await login('admin@example.test');await nav('operations',"document.querySelector('#processing-outcome')");assert.deepEqual(await evaluate("[...document.querySelectorAll('#processing-outcome option')].map(o=>o.value)"),['successful','unsuccessful','reattempt']);await fill('#processing-outcome','reattempt');await fill('#outcome-form [name="reason"]','Customer agreed to another delivery attempt.');const local=await evaluate("(()=>{const d=new Date(Date.now()+86400000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);})()");await fill('#outcome-form [name="scheduled_at"]',local);await screenshot('staff-reattempt-option-mobile');await click('#outcome-form button');await wait("document.querySelector('main').textContent.includes('Current stage: Redelivery scheduled')");await screenshot('staff-scheduled-mobile');await noOverflow('Staff retry mobile');await viewport(1440);await screenshot('staff-scheduled-desktop');
 await click('[data-action="refresh"]');await wait("document.querySelector('#processing-outcome option[value=\"successful\"]')");await fill('#processing-outcome','unsuccessful');await fill('#outcome-form [name="reason"]','Recipient missed the second attempt.');await click('#outcome-form button');await wait("document.querySelector('#processing-outcome option[value=\"reattempt\"]')");assert.equal(await evaluate("document.querySelector('#processing-outcome').value"),'successful');assert.equal(await evaluate("[...document.querySelectorAll('#processing-outcome option')].some(o=>o.textContent==='Choose outcome')"),false);await fill('#processing-outcome','successful');await click('#outcome-form button');await wait("document.querySelector('#processing-selected .badge')?.textContent==='Completed'");await nav('order/'+id,"document.querySelector('[data-action=\"order-again\"]')");assert.match(await evaluate("document.querySelector('main').textContent"),/Order completed/);await screenshot('completed-desktop');await click('[data-action="order-again"]');await wait("document.querySelector('#seller-select')");assert.equal(await evaluate("document.querySelector('[data-quantity]').value"),'1');await screenshot('order-again-draft-desktop');assert.deepEqual(errors,[]);console.log('Redelivery browser checks passed: customer/staff, schedule, preserved payment, completion, order again.');await cdp('Browser.close').catch(()=>{});
}finally{socket?.close();browser.kill();await new Promise(r=>server.close(r));await db.close();const absolute=resolve(profile);assert.ok(absolute.startsWith(resolve('data')+'\\'));await sleep(500);await rm(absolute,{recursive:true,force:true,maxRetries:4,retryDelay:500}).catch(()=>{});}
