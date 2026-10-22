import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {connect} from '../src/db.mjs';
import {Sales} from '../src/sales.mjs';
import {Integrations} from '../src/integrations.mjs';
import {application} from '../src/server.mjs';
import {processingStage} from '../src/processing.mjs';
let db,sales,integrations;
const staff={role:'staff',user_id:1},alex={role:'customer',customer_id:1,user_id:2},jamie={role:'customer',customer_id:2,user_id:3};
beforeEach(async()=>{db=await connect({demo:true,file:':memory:'});sales=new Sales(db);integrations=new Integrations(sales);});
afterEach(async()=>db.close());
async function create(){const {order_id:id}=await sales.save({customer_id:1,seller_id:1,items:[{offer_id:1,quantity:1}],recipient_name:'Test Recipient',recipient_contact:'09170000000',requested_delivery_address:'Fictional Campus'},alex);await sales.submit(id,{...await sales.review(id,alex),submission_reference:'workflow-'+id},alex);return id;}
const dispatch=(id,s,a,outcome='success',reason='Fictional customer-facing reason')=>integrations.dispatch(`sales:${id}:${s}:${a}`,staff,outcome,reason);
async function paid(id){for(const [s,a]of [['inventory','reserve'],['billing','invoice'],['billing','verify'],['inventory','confirm']])await dispatch(id,s,a);}
const detail=id=>sales.detail(id,staff);

test('definitive rejection blocks later queued work and notifies once with committed safe reason',async()=>{
 const id=await create();await db.tx(q=>sales.enqueue(q,id,'billing','invoice'));
 await dispatch(id,'inventory','reserve','reject','Requested item is unavailable');
 const o=await detail(id);assert.equal(o.order_status,'pending_stock');assert.equal(o.stock,'rejected');assert.equal(o.payment,'none');
 assert.equal((await sales.requests(staff,id)).find(r=>r.action==='invoice').status,'blocked');
 assert.equal((await dispatch(id,'billing','invoice')).duplicate,true);
 const notifications=await sales.notifications(alex);assert.equal(notifications.length,1);assert.match(notifications[0].message,/Requested item is unavailable/);assert.match(o.history.at(-1).reason,/unavailable/);
 const [record]=await db.query('SELECT payload FROM sales_event WHERE order_id=?',[id]);assert.equal((await sales.event('inventory',JSON.parse(record.payload))).duplicate,true);assert.equal((await sales.notifications(alex)).length,1);
 await assert.rejects(sales.event('inventory',{...JSON.parse(record.payload),event_reference:'late-reserved',status:'reserved'}),/terminal result/);
});
test('failed payment stops fulfillment, coordinates release and preserves reserved history after cancellation',async()=>{
 const id=await create();await dispatch(id,'inventory','reserve');await dispatch(id,'billing','invoice');await dispatch(id,'billing','verify','reject','Payment declined');
 let o=await detail(id);assert.equal(o.payment,'failed');assert.equal(o.shipment,'none');assert.ok(o.reservation_json);assert.ok(!(await sales.requests(staff,id)).some(r=>r.action==='accept'));
 let stage=processingStage(o,await sales.requests(staff,id),true);assert.equal(stage.stage,'Processing ended');assert.equal(stage.processing_finished,true);assert.equal(stage.resolution_pending,true);assert.deepEqual(stage.options,[]);
 await dispatch(id,'inventory','release');await sales.cancel(id,{reason:'Cancel failed payment'},alex);await dispatch(id,'billing','cancel');
 o=await detail(id);assert.equal(o.order_status,'cancelled');assert.equal(o.stock,'released');assert.ok(o.reservation_json);assert.ok(o.history.some(h=>h.new_status==='awaiting_payment'));
 assert.deepEqual((await sales.notifications(alex)).map(n=>n.kind).sort(),['cancellation_completed','cancellation_requested','payment_failed']);
 assert.equal(processingStage(o,await sales.requests(staff,id),true).options.length,0);
});
test('delivery failures preserve payment and cannot be changed into automatic completion',async()=>{
 for(const action of ['accept','verify_delivery']){
  const id=await create();await paid(id);if(action==='verify_delivery')await dispatch(id,'delivery','accept');
  await dispatch(id,'delivery',action,'reject','Delivery could not reach the recipient');
  const o=await detail(id);assert.equal(o.payment,'verified');assert.equal(o.stock,'confirmed');assert.equal(o.shipment,'failed');assert.equal(o.order_status,action==='accept'?'confirmed':'fulfilling');
  if(action==='verify_delivery')assert.ok(o.tracking_reference);
  assert.deepEqual(processingStage(o,await sales.requests(staff,id),true).options.map(x=>x.value),['successful','unsuccessful','reattempt']);
  const [record]=await db.query("SELECT payload FROM sales_event WHERE order_id=? AND service='delivery' ORDER BY created_at DESC",[id]);
  const event=(await db.query("SELECT payload FROM sales_event WHERE request_reference=?",[`sales:${id}:delivery:${action}`]))[0];
  await assert.rejects(sales.event('delivery',{...JSON.parse(event.payload),event_reference:'late-delivered-'+id,status:'delivered',proof_reference:'LATE'}),/terminal result/);
  assert.equal((await sales.notifications(alex)).filter(n=>n.order_id===id&&n.kind.startsWith('delivery-attempt-')).length,1);
 }
});
test('cancellation blocks work immediately; late paid result triggers reconciliation, not fulfillment',async()=>{
 const id=await create();await dispatch(id,'inventory','reserve');await dispatch(id,'billing','invoice');
 const [request]=await db.query('SELECT * FROM sales_outbox WHERE request_reference=?',[`sales:${id}:billing:verify`]);const late=await integrations.simulate(request,'success');
 await sales.cancel(id,{reason:'No longer needed'},alex);
 assert.equal((await sales.requests(staff,id)).find(r=>r.action==='verify').status,'blocked');
 await dispatch(id,'billing','cancel');await dispatch(id,'inventory','release');assert.equal((await detail(id)).order_status,'cancelled');
 await sales.event('billing',late);await sales.event('billing',late);
 const o=await detail(id);assert.equal(o.order_status,'cancellation_pending');assert.equal(o.payment,'verified');assert.equal(o.shipment,'none');assert.ok(o.reconciliation);
 assert.ok(!(await sales.requests(staff,id)).some(r=>r.service==='delivery'));
 assert.equal((await sales.notifications(alex)).filter(n=>n.kind==='payment_conflict').length,1);
});
test('unknown results stay unresolved without failure notifications; worker guards stop ineligible requests',async()=>{
 const id=await create();assert.equal((await dispatch(id,'inventory','reserve','timeout')).pending,true);
 assert.equal((await sales.notifications(alex)).length,0);assert.equal((await detail(id)).stock,'none');
 await dispatch(id,'inventory','reserve');
 await db.query("UPDATE sales_order_facts SET reconciliation='Hold for review' WHERE order_id=?",[id]);
 await assert.rejects(dispatch(id,'billing','invoice'),/Processing is stopped/);
 assert.equal((await detail(id)).payment,'none');
});
test('notifications are customer-owned, idempotently readable and roll back with the transaction',async()=>{
 const id=await create();await dispatch(id,'inventory','reserve','reject');const [n]=await sales.notifications(alex);
 assert.equal((await sales.notifications(jamie)).length,0);await assert.rejects(sales.readNotification(n.notification_id,jamie),/not found/);await assert.rejects(sales.notifications(staff),/Customer access/);
 await sales.readNotification(n.notification_id,alex);const first=(await sales.notifications(alex))[0].read_at;await sales.readNotification(n.notification_id,alex);assert.equal((await sales.notifications(alex))[0].read_at,first);
 await assert.rejects(db.tx(async q=>{await sales.notify(q,await sales.owned(q,id,staff),'rollback','Must not persist');throw new Error('rollback');}),/rollback/);
 assert.equal((await sales.notifications(alex)).length,1);
});
test('notification/read state survives a database reopen',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'campuserp-outcomes-'));const file=join(folder,'demo.sqlite');let persistent;
 try{
  persistent=await connect({demo:true,file});const service=new Sales(persistent);const result=await service.save({customer_id:1,seller_id:1,items:[],recipient_name:''},alex);await service.cancel(result.order_id,{reason:'Discard test draft'},alex);const [n]=await service.notifications(alex);await service.readNotification(n.notification_id,alex);await persistent.close();persistent=null;
  persistent=await connect({demo:true,file});const [saved]=await new Sales(persistent).notifications(alex);assert.equal(saved.message,n.message);assert.ok(saved.read_at);
 }finally{await persistent?.close();await rm(folder,{recursive:true,force:true});}
});
test('HTTP outcome form validates stage, reason, version and role; integrated mode cannot simulate',async()=>{
 const {server}=application(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const login=async email=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'CampusDemo2026!'})});const body=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],'x-csrf-token':body.csrf,'content-type':'application/json'};};
  const staffHeaders=await login('admin@example.test'),customerHeaders=await login('alex@example.test'),id=await create();
  const stage=await (await fetch(base+`/api/orders/${id}/processing`,{headers:staffHeaders})).json();assert.deepEqual(stage.options.map(x=>x.value),['successful','unsuccessful','cancel']);
  assert.equal((await fetch(base+`/api/orders/${id}/processing`,{headers:customerHeaders})).status,403);
  const apply=data=>fetch(base+`/api/orders/${id}/outcome`,{method:'POST',headers:staffHeaders,body:JSON.stringify({...stage,...data})});
  assert.equal((await apply({outcome:'unsuccessful',reason:''})).status,422);assert.equal((await apply({outcome:'successful',version:0})).status,409);
  assert.equal((await fetch(base+`/api/orders/${id}/outcome`,{method:'POST',headers:customerHeaders,body:JSON.stringify({...stage,outcome:'successful'})})).status,403);
  assert.equal((await apply({outcome:'unsuccessful',reason:'Stock unavailable for this order'})).status,200);
  const notifications=await (await fetch(base+'/api/notifications',{headers:customerHeaders})).json();assert.equal(notifications.length,1);
  assert.equal((await fetch(base+`/api/notifications/${notifications[0].notification_id}/read`,{method:'POST',headers:customerHeaders,body:'{}'})).status,200);
  db.demo=false;const integrated=await (await fetch(base+`/api/orders/${id}/processing`,{headers:staffHeaders})).json();assert.ok(integrated.options.every(x=>x.value==='cancel'));
  assert.equal((await apply({outcome:'successful',version:integrated.version})).status,409);db.demo=true;
 }finally{db.demo=true;await new Promise(r=>server.close(r));}
});

test('late stock during cancellation shows a reconciliation notification instead of stale cancellation completion',async()=>{
 const id=await create();const [request]=await db.query('SELECT * FROM sales_outbox WHERE request_reference=?',[`sales:${id}:inventory:reserve`]);const late=await integrations.simulate(request,'success');
 await sales.cancel(id,{reason:'Cancel test before stock reply'},alex);await dispatch(id,'billing','cancel');await dispatch(id,'inventory','release');assert.equal((await detail(id)).order_status,'cancelled');
 await sales.event('inventory',late);await sales.event('inventory',late);
 const o=await detail(id);assert.equal(o.order_status,'cancellation_pending');assert.equal(o.release_clear,0);assert.equal(o.outcomes[0].kind,'stock_conflict');assert.match((await sales.list(alex))[0].outcome_message,/Stock changed/);
 assert.equal((await sales.notifications(alex)).filter(n=>n.kind==='stock_conflict').length,1);
});
test('integrated processing offers service query and eligible cancellation but no manufactured external outcome',async()=>{
 const id=await create(),o=await detail(id),requests=await sales.requests(staff,id);const stage=processingStage(o,requests,false);
 assert.equal(stage.can_query,true);assert.deepEqual(stage.options.map(x=>x.value),['cancel']);
 assert.equal(processingStage({...o,order_status:'completed'},requests,false).options.length,0);
});

test('customer reads cannot observe a notification before its transaction commits',async()=>{
 const id=await create();let unlock,inserted;const ready=new Promise(r=>inserted=r),gate=new Promise(r=>unlock=r);
 const write=db.tx(async q=>{await sales.notify(q,await sales.owned(q,id,staff),'not_committed','Never publish this');inserted();await gate;throw new Error('rollback test');});
 await ready;const read=sales.notifications(alex);unlock();await assert.rejects(write,/rollback test/);assert.deepEqual(await read,[]);
});

test('expired unpaid reservations explain the cancel-only outcome instead of offering unsafe success',async()=>{
 const id=await create();await dispatch(id,'inventory','reserve');await dispatch(id,'billing','invoice');
 await db.query('UPDATE sales_order_facts SET reservation_expires=? WHERE order_id=?',[Date.now()-1000,id]);
 const o=await detail(id),stage=processingStage(o,await sales.requests(staff,id),true);
 assert.equal(stage.stage,'Reservation expired');assert.match(stage.guidance,/Cancel this unpaid order/);assert.deepEqual(stage.options.map(x=>x.value),['cancel']);
 await assert.rejects(dispatch(id,'billing','verify'),/Billing is blocked/);
});
