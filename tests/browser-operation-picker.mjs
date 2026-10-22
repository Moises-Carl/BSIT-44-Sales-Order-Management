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
 const screenshot=async name=>{await evaluate("document.querySelector('#notice').classList.remove('show');window.scrollTo(0,0)");await sleep(100);const img=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`docs/ui-review/2026-10-22/ui-operation-picker-${name}.png`,Buffer.from(img.data,'base64'));await writeFile(`docs/ui-review/2026-10-22/ui-operation-picker-${name}.json`,JSON.stringify(await evaluate('({width:innerWidth,height:innerHeight,role:document.querySelector(".account small")?.textContent||"Signed out",page:location.hash})'),null,2));};
 const viewport=async(width,height=1000)=>{await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<781});await sleep(100);};
 const noOverflow=async name=>assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),`${name} must not overflow`);
 const nav=async(hash,condition)=>{await evaluate(`location.hash=${JSON.stringify(hash)}`);await wait(condition);};


 await mkdir('docs/ui-review/2026-10-22',{recursive:true});await cdp('Runtime.enable');await cdp('Page.enable');await viewport(1440);
 const u={role:'staff',user_id:1};const ids=[];
 for(let n=0;n<3;n++){const {order_id:id}=await sales.save({customer_id:n===1?2:1,seller_id:1,payment_method:'gcash',recipient_name:'Picker Test',recipient_contact:'09170000000',requested_delivery_address:'Campus',items:[{offer_id:1,quantity:1}]},u);ids.push(id);if(n!==2){await sales.submit(id,{...await sales.review(id,u),submission_reference:'picker-'+id},u);await integrations.dispatch(`sales:${id}:inventory:reserve`,u);await integrations.dispatch(`sales:${id}:billing:invoice`,u);}}
 await sales.message(ids[1],{body:'Please check my payment.'},{role:'customer',customer_id:2,user_id:3});
 await cdp('Page.navigate',{url:base});await wait("document.querySelector('#login-form')");await evaluate("document.querySelector('.demo-accounts').open=true");await click('[data-email="admin@example.test"]');await wait("document.querySelector('#filter-form')");assert.equal(await evaluate("Boolean(document.querySelector('.sidebar a[href=\"#new\"]'))"),false);assert.equal(await evaluate("Boolean(document.querySelector('[data-status=\"draft\"]'))"),false);assert.equal(await evaluate("Boolean(document.querySelector('#filter-form option[value=\"draft\"]'))"),false);await nav('operations',"document.querySelector('.operation-card')");
 assert.match(await evaluate("document.querySelector('.operation-card').textContent"),/Jamie Reyes/);assert.match(await evaluate("document.querySelector('.operation-card').textContent"),/Customer awaiting Sales reply/);assert.match(await evaluate("document.querySelector('#operation-order').textContent"),/Payment verification pending/);await screenshot('desktop');await noOverflow('Picker desktop');
 await fill('#operation-filter','attention');assert.equal(await evaluate("document.querySelectorAll('.operation-card').length"),1);await fill('#operation-search','Nobody matching');assert.equal(await evaluate("document.querySelectorAll('#operation-order option').length"),1);assert.match(await evaluate("document.querySelector('#operation-results').textContent"),/No orders match/);await fill('#operation-search','');await fill('#operation-filter','pending');assert.equal(await evaluate("document.querySelectorAll('.operation-card').length"),2);await fill('#operation-search','Alex');assert.equal(await evaluate("document.querySelectorAll('.operation-card').length"),1);await click('[data-action="operation-pick"]');await wait("document.querySelector('#operation-order')?.value==='"+ids[0]+"'");assert.equal(await evaluate("document.querySelector('#operation-search').value"),'Alex');await viewport(390,844);await screenshot('mobile');await noOverflow('Picker mobile');
 assert.equal(await evaluate("Boolean(document.querySelector('#operation-filter option[value=\"draft\"]'))"),false);assert.equal(await evaluate("Boolean(document.querySelector('#operation-order option[value=\""+ids[2]+"\"]'))"),false);await click('[data-action="logout"]');await wait("document.querySelector('#login-form')");await evaluate("document.querySelector('.demo-accounts').open=true");await click('[data-email="alex@example.test"]');await wait("document.querySelector('#filter-form')");assert.equal(await evaluate("Boolean(document.querySelector('[data-status=\"draft\"]'))"),true);await nav('order/'+ids[2],"document.querySelector('.page-head .badge')?.textContent==='Draft'");assert.equal(await evaluate("Boolean(document.querySelector('[data-action=\"review\"]'))"),true);assert.deepEqual(errors,[]);console.log('Operation picker browser checks passed: priorities, pending step, customer reply flag, filters, search, empty state, selected order, desktop/mobile.');await cdp('Browser.close').catch(()=>{});
}finally{socket?.close();browser.kill();await new Promise(r=>server.close(r));await db.close();const absolute=resolve(profile);assert.ok(absolute.startsWith(resolve('data')+'\\'));await sleep(500);await rm(absolute,{recursive:true,force:true,maxRetries:4,retryDelay:500}).catch(()=>{});}
