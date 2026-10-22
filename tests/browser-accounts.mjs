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

 await click('[data-action="register"]');await wait("document.querySelector('#register-form')");
 await click('#register-form button[type="submit"]');await wait("!document.querySelector('[data-form-error]').hidden");
 for(const [key,value]of Object.entries({name:'Browser Customer',email:'browser.customer@example.test',password:'BrowserCustomer2026!',password_confirmation:'BrowserCustomer2026!'}))await fill('#register-form [name="'+key+'"]',value);
 await viewport(390,844);await noOverflow('Registration mobile');await screenshot('registration-mobile');await viewport(1440);await screenshot('registration-desktop');
 await click('#register-form button[type="submit"]');await wait("document.querySelector('#profile-form')");assert.ok(await evaluate("Boolean(document.querySelector('.sidebar a[href=\"#profile\"]'))"));
 await nav('new',"document.querySelector('#seller-select')");await click('[data-action="add-item"][data-id="1"]');await click('.stage-navigation [data-action="stage-next"]');
 assert.equal(await evaluate("document.querySelector('[name=\"recipient_name\"]').value"),'Browser Customer');assert.match(await evaluate("document.querySelector('.saved-details').textContent"),/Missing.*contact number.*delivery address/);
 await click('.sidebar a[href="#profile"]');await wait("document.querySelector('[data-action=\"keep-editing\"]')");await click('[data-action="keep-editing"]');assert.ok(await evaluate("Boolean(document.querySelector('#draft-form'))"));
 await click('.sidebar a[href="#profile"]');await click('[data-action="discard-draft"]');await wait("document.querySelector('#profile-form')");
 for(const [key,value]of Object.entries({customer_name:'Browser Customer',contact_number:'09175550000',default_recipient_name:'Saved Recipient',default_delivery_address:'Saved campus address'}))await fill('#profile-form [name="'+key+'"]',value);
 await click('#profile-form button[type="submit"]');await wait("document.querySelector('#notice').textContent.includes('Profile saved')");await screenshot('profile-desktop');await viewport(390,844);await noOverflow('Profile mobile');await screenshot('profile-mobile');await viewport(1440);
 await click('.sidebar-foot [data-action="logout"]');await wait("document.querySelector('#login-form')");await fill('[name="email"]','browser.customer@example.test');await fill('[name="password"]','BrowserCustomer2026!');await click('#login-form button[type="submit"]');await wait("document.querySelector('main h1')?.textContent==='My orders'");
 await nav('new',"document.querySelector('#seller-select')");
 // Clean prefilled form can be left without prompting.
 await click('.sidebar a[href="#profile"]');await wait("document.querySelector('#profile-form')");assert.equal(await evaluate("document.querySelector('#modal').open"),false);
 await nav('new',"document.querySelector('#seller-select')");await click('[data-action="add-item"][data-id="1"]');await click('.stage-navigation [data-action="stage-next"]');
 assert.equal(await evaluate("document.querySelector('[name=\"recipient_name\"]').value"),'Saved Recipient');assert.equal(await evaluate("document.querySelector('[name=\"requested_delivery_address\"]').value"),'Saved campus address');
 await click('[data-action="someone-else"]');assert.equal(await evaluate("document.querySelector('[name=\"recipient_name\"]').value"),'');await click('[data-action="use-saved"]');assert.equal(await evaluate("document.querySelector('[name=\"recipient_name\"]').value"),'Saved Recipient');
 await fill('[name="recipient_name"]','Draft Recipient');await fill('[name="requested_delivery_address"]','');
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.stage-navigation')).borderTopStyle"),'solid');assert.match(await evaluate("document.querySelector('.current-step').textContent"),/Step 2 of 3.*Recipient details/);assert.equal(await evaluate("document.querySelectorAll('.page-head [data-action=\"save-draft\"]').length"),0);
 await screenshot('saved-recipient-desktop');await viewport(320,800);await noOverflow('320px recipient actions');await screenshot('saved-recipient-mobile');await viewport(1440);
 // A failed save retains all input and must not report success.
 await evaluate("window.__fetch=window.fetch;window.fetch=async(...args)=>args[0]==='/api/orders'&&args[1]?.method==='POST'?new Response(JSON.stringify({error:'Injected save failure'}),{status:503,headers:{'content-type':'application/json'}}):window.__fetch(...args)");
 await click('[data-action="save-draft"]');await wait("!document.querySelector('[data-form-error]').hidden");assert.equal(await evaluate("document.querySelector('[name=\"recipient_name\"]').value"),'Draft Recipient');assert.equal((await db.query('SELECT * FROM sales_order')).length,0);await evaluate('window.fetch=window.__fetch');
 // Leave via Save draft with incomplete recipient details.
 await click('.sidebar a[href="#orders"]');await wait("document.querySelector('[data-action=\"save-and-leave\"]')");await screenshot('unsaved-changes');await click('[data-action="save-and-leave"]');await wait("document.querySelector('main h1')?.textContent==='My orders'");
 let rows=await db.query('SELECT * FROM sales_order');assert.equal(rows.length,1);const id=rows[0].order_id;assert.equal(rows[0].recipient_name,'Draft Recipient');assert.equal(rows[0].requested_delivery_address,'');assert.equal((await db.query('SELECT * FROM sales_outbox')).length,0);
 // A changed profile never replaces a reopened draft snapshot.
 await nav('profile',"document.querySelector('#profile-form')");await fill('[name="default_recipient_name"]','New Profile Recipient');await click('#profile-form button[type="submit"]');await wait("document.querySelector('#notice').textContent.includes('Profile saved')");
 await nav('edit/'+id,"document.querySelector('#seller-select')");await click('.stage-navigation [data-action="stage-next"]');assert.equal(await evaluate("document.querySelector('[name=\"recipient_name\"]').value"),'Draft Recipient');assert.equal(await evaluate("document.querySelector('[name=\"requested_delivery_address\"]').value"),'');
 await fill('[name="requested_delivery_address"]','Order-only address');await click('[data-action="stage"][data-stage="1"]');await click('.stage-navigation [data-action="stage-next"]');assert.equal(await evaluate("document.querySelector('[name=\"requested_delivery_address\"]').value"),'Order-only address');
 // Two rapid save clicks send one request and continue updating the existing draft.
 await evaluate("window.__fetch=window.fetch;window.__saves=0;window.fetch=async(...args)=>{if(args[0].startsWith('/api/orders/')&&args[1]?.method==='PUT'){window.__saves++;await new Promise(r=>setTimeout(r,250));}return window.__fetch(...args)}");
 await click('[data-action="save-draft"]');assert.match(await evaluate("document.querySelector('[data-action=\"save-draft\"]').textContent"),/Saving/);await evaluate("document.querySelector('[data-action=\"save-draft\"]').click()");await wait("!document.querySelector('[data-action=\"save-draft\"]').disabled");assert.equal(await evaluate('window.__saves'),1);await evaluate('window.fetch=window.__fetch');assert.equal((await db.query('SELECT * FROM sales_order')).length,1);
 const [before]=await db.query('SELECT * FROM sales_customer_profile WHERE customer_id=?',[rows[0].customer_id]);assert.equal(before.default_delivery_address,'Saved campus address');
 await click('[data-action="save-defaults"]');await wait("document.querySelector('#notice').textContent.includes('Default details saved')");const [after]=await db.query('SELECT * FROM sales_customer_profile WHERE customer_id=?',[rows[0].customer_id]);assert.equal(after.default_delivery_address,'Order-only address');
 await click('.stage-navigation [data-action="stage-next"]');await wait("document.querySelector('#accept-prices')");await screenshot('account-review-desktop');await viewport(390,844);await noOverflow('Review actions mobile');await screenshot('account-review-mobile');await viewport(1440);await click('#accept-prices');await click('[data-action="submit-order"]');await wait("document.querySelector('.page-head .badge')?.textContent==='Pending stock'");
 await nav('profile',"document.querySelector('#profile-form')");await fill('[name="default_delivery_address"]','Later profile address');await click('#profile-form button[type="submit"]');await wait("document.querySelector('#notice').textContent.includes('Profile saved')");const [submitted]=await db.query('SELECT * FROM sales_order WHERE order_id=?',[id]);assert.equal(submitted.requested_delivery_address,'Order-only address');assert.equal(submitted.recipient_name,'Draft Recipient');
 assert.deepEqual(errors,[]);console.log('Account browser QA passed: registration, sessions, partial/full prefills, explicit defaults, order-only edits, snapshot isolation, incomplete/resumed/repeated drafts, failed save preservation, all three leave choices, clean navigation, back/continue preservation, loading lock, final submit, desktop/320px/mobile screenshots.');await cdp('Browser.close').catch(()=>{});
}finally{
 socket?.close();browser.kill();await new Promise(r=>server.close(r));await db.close();const absolute=resolve(profile);assert.ok(absolute.startsWith(resolve('data')+'\\'));await sleep(500);await rm(absolute,{recursive:true,force:true,maxRetries:4,retryDelay:500}).catch(()=>{});
}
