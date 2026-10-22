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
 await screenshot('login-desktop');await noOverflow('Desktop login');
 await click('#login-form button[type="submit"]');assert.match(await evaluate("document.querySelector('[data-error-for=\"email\"]').textContent"),/valid email/);
 await fill('#login-form [name="email"]','alex@example.test');await fill('#password-input','wrong');
 await click('[data-action="toggle-password"]');assert.equal(await evaluate("document.querySelector('#password-input').type"),'text');await click('[data-action="toggle-password"]');
 await click('#login-form button[type="submit"]');await wait("!document.querySelector('#login-error').hidden");assert.equal(await evaluate("document.querySelector('[name=\"email\"]').value"),'alex@example.test');
 await viewport(390,844);await noOverflow('Mobile login');await screenshot('login-mobile');await viewport(1440);
 await evaluate("document.querySelector('.demo-accounts').open=true;window.__fetch=window.fetch;window.__logins=0;window.fetch=async(...args)=>{if(args[0]==='/api/login'){window.__logins++;await new Promise(r=>setTimeout(r,300));}return window.__fetch(...args);}");
 await click('[data-email="admin@example.test"]');assert.ok(await evaluate("document.querySelector('[data-email=\"alex@example.test\"]').disabled"));
 await wait("document.querySelector('main h1')?.textContent==='Sales & orders'");assert.equal(await evaluate('window.__logins'),1);
 await screenshot('staff-empty');
 await click('.sidebar-foot [data-action="logout"]');await wait("document.querySelector('#login-form')");await evaluate("document.querySelector('.demo-accounts').open=true");await click('[data-email="alex@example.test"]');await wait("document.querySelector('main h1')?.textContent==='My orders'");assert.match(await evaluate("document.querySelector('.empty p').textContent"),/Create your first order/);await screenshot('customer-empty');
 await click('.sidebar-foot [data-action="logout"]');await wait("document.querySelector('#login-form')");await evaluate("document.querySelector('.demo-accounts').open=true");await click('[data-email="admin@example.test"]');await wait("document.querySelector('main h1')?.textContent==='Sales & orders'");
 await nav('new',"document.querySelector('.stages .current')?.textContent.includes('Select items')");
 await click('.stage-navigation [data-action="stage-next"]');assert.match(await evaluate("document.querySelector('[data-form-error]').textContent"),/at least one/);
 for(const id of [1,1,4])await click(`[data-action="add-item"][data-id="${id}"]`);
 assert.equal(await evaluate("document.querySelector('[data-quantity=\"1\"]').value"),'2');
 await fill('[data-quantity="1"]','1.5');assert.equal(await evaluate("document.querySelector('[data-quantity=\"1\"]').getAttribute('aria-invalid')"),'true');await fill('[data-quantity="1"]','2');
 await screenshot('select-items-desktop');await click('.stage-navigation [data-action="stage-next"]');await wait("document.querySelector('#draft-form')");
 assert.ok(await evaluate("Boolean(document.querySelector('[name=\"customer_id\"]'))"));
 await click('.stage-navigation [data-action="stage-next"]');assert.match(await evaluate("document.querySelector('[data-error-for=\"recipient_name\"]').textContent"),/recipient/);
 await fill('[name="recipient_name"]','Alex Santos');await fill('[name="recipient_contact"]','09171234567');await fill('[name="requested_delivery_address"]','123 Test Street, Manila');
 await click('[data-action="stage"][data-stage="1"]');await click('.stage-navigation [data-action="stage-next"]');assert.equal(await evaluate("document.querySelector('[name=\"recipient_name\"]').value"),'Alex Santos');
 await screenshot('recipient-desktop');await viewport(390,844);await noOverflow('Mobile recipient');await screenshot('recipient-mobile');await viewport(1440);
 await click('.stage-navigation [data-action="stage-next"]');await wait("document.querySelector('#accept-prices')");assert.ok(await evaluate("document.querySelector('[data-action=\"submit-order\"]').disabled"));await screenshot('review-desktop');
 await db.query("UPDATE seller_offer SET selling_price='99.99' WHERE offer_id=1");
 await click('#accept-prices');await click('[data-action="submit-order"]');await wait("document.querySelector('[data-form-error]')?.textContent.includes('changed')");
 assert.equal(await evaluate("document.querySelector('#accept-prices').checked"),false);assert.ok(await evaluate("document.querySelector('[data-action=\"submit-order\"]').disabled"));await screenshot('changed-price-review');
 await click('#accept-prices');await click('[data-action="submit-order"]');await wait("document.querySelector('.page-head .badge')?.textContent==='Pending stock'");
 assert.equal(await evaluate("document.querySelectorAll('.order-progress .done').length"),1);
 await screenshot('pending-stock-desktop');
 for(const step of ['inventory:reserve','billing:invoice','billing:verify','inventory:confirm','delivery:accept','delivery:verify_delivery']){
  await nav('operations',`document.querySelector('[data-ref="sales:1:${step}"]')`);
  await click(`[data-ref="sales:1:${step}"]`);await wait(`!document.querySelector('[data-ref="sales:1:${step}"]') && document.querySelector('main h1')?.textContent==='Demo operations'`);
 }
 await nav('order/1',"document.querySelector('.page-head .badge')?.textContent==='Completed'");assert.equal(await evaluate("document.querySelectorAll('.timeline li').length"),6);assert.equal(await evaluate("document.querySelectorAll('.order-progress .done').length"),5);
 await screenshot('detail-desktop');await viewport(390,844);await noOverflow('Mobile detail');await screenshot('detail-mobile');await viewport(1440);
 // All populated demonstration records are created by Sales and isolated service simulators.
 const staff={user_id:1,role:'staff'};
 const create=async customer=>{const c=customer||1;return (await sales.save({customer_id:c,seller_id:1,items:[{offer_id:1,quantity:1}],recipient_name:c===1?'Alex Santos':'Jamie Reyes',recipient_contact:'09171234567',requested_delivery_address:'456 Fictional Avenue, Manila'},staff)).order_id;};
 const submit=async id=>{const q=await sales.review(id,staff);await sales.submit(id,{...q,submission_reference:`qa-submit-${id}`},staff);};
 const dispatch=async(id,service,action)=>integrations.dispatch(`sales:${id}:${service}:${action}`,staff);
 const draftId=await create();const pendingId=await create();await submit(pendingId);
 const awaitingId=await create();await submit(awaitingId);await dispatch(awaitingId,'inventory','reserve');
 const confirmedId=await create();await submit(confirmedId);for(const[s,a]of [['inventory','reserve'],['billing','invoice'],['billing','verify'],['inventory','confirm']])await dispatch(confirmedId,s,a);
 const cancelId=await create();await submit(cancelId);await sales.cancel(cancelId,{reason:'Fictional demo cancellation'},staff);
 const jamieId=await create(2);for(let i=0;i<5;i++)await create();
 await nav('orders',"document.querySelector('main h1')?.textContent==='Sales & orders'");
 assert.match(await evaluate("document.querySelector('.table-foot').textContent"),/Page 1 of 2/);await click('[data-action="page-next"]');await wait("document.querySelector('.pagination')?.textContent.includes('Page 2 of 2')");await click('[data-action="page-prev"]');await wait("document.querySelector('.pagination')?.textContent.includes('Page 1 of 2')");
 await screenshot('staff-orders-desktop');await viewport(390,844);await noOverflow('Staff mobile orders');assert.equal(await evaluate("getComputedStyle(document.querySelector('.desktop-orders')).display"),'none');await screenshot('staff-orders-mobile');
 await viewport(1440);await click('[data-action="status-filter"][data-status="draft"]');await wait("document.querySelector('.active-filters')?.textContent.includes('Draft')");assert.ok(await evaluate("[...document.querySelectorAll('tbody .badge')].every(e=>e.textContent==='Draft')"));
 await click('[data-action="reset-filters"]');await wait("!document.querySelector('.active-filters') && document.querySelector('#filter-form')");
 await fill('[name="search"]','NO-ORDER-MATCHES-THIS');await click('#filter-form button[type="submit"]');await wait("document.querySelector('.empty h3')?.textContent==='No matching orders'");await screenshot('no-results-desktop');await click('[data-action="reset-filters"]');await wait("document.querySelector('tbody')");
 await nav(`edit/${draftId}`,"document.querySelector('#seller-select')");await click('.stage-navigation [data-action="stage-next"]');assert.equal(await evaluate("document.querySelector('[name=\"recipient_name\"]').value"),'Alex Santos');
 await nav(`order/${cancelId}`,"document.querySelector('.page-head .badge')?.textContent==='Cancellation pending'");await screenshot('cancellation-pending-desktop');await viewport(390,844);await noOverflow('Mobile cancellation');await screenshot('cancellation-pending-mobile');await viewport(1440);assert.equal(await evaluate("document.querySelectorAll('.order-progress .done').length"),0);
 await nav(`order/${draftId}`,"document.querySelector('[data-action=\"cancel\"]')");await click('[data-action="cancel"]');await click('#cancel-form button[type="submit"]');assert.match(await evaluate("document.querySelector('[data-error-for=\"reason\"]').textContent"),/cancellation reason/);await fill('[name="reason"]','Testing draft cancellation');await click('#cancel-form button[type="submit"]');await wait("document.querySelector('.page-head .badge')?.textContent==='Cancelled'");

 await nav('order/'+confirmedId,"document.querySelector('.page-head .badge')?.textContent==='Confirmed'");assert.match(await evaluate("document.querySelector('.facts').textContent"),/no automatic expiry/);assert.equal(await evaluate("document.querySelectorAll('.order-progress .done').length"),3);await screenshot('confirmed-no-expiry');
 await db.query('UPDATE sales_order_facts SET reservation_expires=? WHERE order_id=?',[Date.now()-1000,awaitingId]);const expiring=await sales.detail(awaitingId,staff);await sales.inventoryLifecycle({schema_version:1,event_type:'reservation.lifecycle',event_reference:'browser-inventory-expiry',request_reference:'sales:'+awaitingId+':inventory:reserve',order_id:awaitingId,version:1,status:'expired',occurred_at:Date.now(),reservations:JSON.parse(expiring.reservation_json)});
 await nav('order/'+awaitingId,"document.querySelector('.next-step-banner')?.textContent.includes('needs attention')");assert.match(await evaluate("document.querySelector('.facts').textContent"),/Expired/);await noOverflow('Inventory expiry detail');await screenshot('inventory-expired');
 const raceId=await create();await submit(raceId);await dispatch(raceId,'inventory','reserve');await dispatch(raceId,'billing','invoice');const [payRequest]=await db.query('SELECT * FROM sales_outbox WHERE request_reference=?',['sales:'+raceId+':billing:verify']);const latePaid=await integrations.simulate(payRequest,'success');await sales.cancel(raceId,{reason:'Browser cancellation race'},staff);await dispatch(raceId,'billing','cancel');await dispatch(raceId,'inventory','release');await sales.event('billing',latePaid);
 await nav('order/'+raceId,"document.querySelector('.page-head .badge')?.textContent==='Cancellation pending'");assert.match(await evaluate("document.querySelector('.cancel-checks').textContent"),/Payment verified.*reconciliation required/);assert.ok(await evaluate("!document.querySelector('.cancel-checks').textContent.includes('Unpaid payment check: verified')"));await screenshot('cancellation-payment-reconciliation');
 await click('.sidebar-foot [data-action="logout"]');await wait("document.querySelector('#login-form')");await evaluate("document.querySelector('.demo-accounts').open=true");await click('[data-email="alex@example.test"]');await wait("document.querySelector('main h1')?.textContent==='My orders'");
 assert.ok(await evaluate("!document.querySelector('.sidebar a[href=\"#operations\"]')"));
 const ownRows=await evaluate("window.__fetch('/api/orders').then(r=>r.json())");assert.ok(ownRows.every(o=>o.customer_id===1));assert.ok(!ownRows.some(o=>o.order_id===jamieId));
 assert.equal(await evaluate("window.__fetch('/api/operations/requests').then(r=>r.status)"),403);
 await screenshot('customer-orders-desktop');await viewport(390,844);await noOverflow('Customer mobile orders');await screenshot('customer-orders-mobile');
 await nav('new',"document.querySelector('#seller-select')");await click('[data-action="add-item"][data-id="1"]');await click('.stage-navigation [data-action="stage-next"]');await wait("document.querySelector('#draft-form')");assert.ok(await evaluate("!document.querySelector('[name=\"customer_id\"]')"));await noOverflow('Customer mobile draft');await screenshot('customer-recipient-mobile');
 await nav('order/1',"document.querySelector('.page-head .badge')?.textContent==='Completed'");assert.ok(await evaluate("!document.querySelector('[data-action=\"cancel\"]')"));
 await click('.mobile-signout');await wait("document.querySelector('#login-form')");
 // Keyboard focus and reduced motion checks use the browser, not DOM-only assumptions.
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.ok(await evaluate("document.activeElement!==document.body"));
 await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.ok(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"));
 await viewport(320,740);await noOverflow('320px login');
 const injection=await cdp('Page.addScriptToEvaluateOnNewDocument',{source:"const original=window.fetch;window.fetch=async(...args)=>args[0]==='/api/config'?new Response(JSON.stringify({demo:false,currency:'PHP'}),{headers:{'content-type':'application/json'}}):original(...args);"});
 await cdp('Page.navigate',{url:base});await wait("document.querySelector('#login-form')");assert.ok(await evaluate("!document.querySelector('.demo-accounts') && !document.body.textContent.includes('CampusDemo2026!')"));await noOverflow('Non-demo login');await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
 // A stale server or missing module must show a recovery screen instead of permanent loading.
 const blockModule=async event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused')await cdp('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'});};
 socket.addEventListener('message',blockModule);await cdp('Fetch.enable',{patterns:[{urlPattern:'*/ui.mjs',requestStage:'Request'}]});
 await cdp('Page.navigate',{url:base});await wait("document.querySelector('#startup-retry')");assert.match(await evaluate("document.querySelector('.connection-error').textContent"),/restart the local server/);
 await cdp('Fetch.disable');socket.removeEventListener('message',blockModule);await click('#startup-retry');await wait("document.querySelector('#login-form')");
 assert.deepEqual(errors,[]);
 console.log('Browser QA passed: login validation/password/failure preservation/loading lock, role-specific empty/populated lists, filters/reset/pagination, three-stage create/edit/review, duplicate items, inline validation, verified progress, completion, cancellation, restricted demo operations, keyboard focus, reduced motion, desktop/mobile screenshots.');
 await cdp('Browser.close').catch(()=>{});
}finally{
 socket?.close();browser.kill();await new Promise(r=>server.close(r));await db.close();const absolute=resolve(profile);assert.ok(absolute.startsWith(resolve('data')+'\\'));await sleep(500);await rm(absolute,{recursive:true,force:true,maxRetries:4,retryDelay:500}).catch(()=>{});
}




