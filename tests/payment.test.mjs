import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {connect} from '../src/db.mjs';
import {Sales} from '../src/sales.mjs';
import {Integrations} from '../src/integrations.mjs';
import {processingStage} from '../src/processing.mjs';
import {milestones,canCancel,nextStep} from '../public/ui.mjs';
let db,sales,integrations;
const staff={role:'staff',user_id:1},alex={role:'customer',customer_id:1,user_id:2};
beforeEach(async()=>{db=await connect({demo:true,file:':memory:'});sales=new Sales(db);integrations=new Integrations(sales);});
afterEach(async()=>db.close());
const input=method=>({customer_id:1,seller_id:1,payment_method:method,items:[{offer_id:1,quantity:1}],recipient_name:'Fictional COD Customer',recipient_contact:'09170000000',requested_delivery_address:'100 Fictional Campus'});
async function create(method='cod'){const {order_id:id}=await sales.save(input(method),alex);await sales.submit(id,{...await sales.review(id,alex),submission_reference:'method-'+id},alex);return id;}
const dispatch=(id,s,a,outcome='success')=>integrations.dispatch(`sales:${id}:${s}:${a}`,staff,outcome,'Fictional test reason');
const detail=id=>sales.detail(id,staff);
async function confirmed(id){for(const[s,a]of [['inventory','reserve'],['billing','invoice'],['inventory','confirm']])await dispatch(id,s,a);}
async function delivered(id){await confirmed(id);await dispatch(id,'delivery','accept');await dispatch(id,'delivery','verify_delivery');}

test('chosen payment methods persist through draft changes, review and immutable submission snapshots',async()=>{
 for(const method of ['cod','gcash','bank_transfer']){
  const data=input(method);data.requested_delivery_address='';const draft=await sales.save(data,alex);assert.equal((await detail(draft.order_id)).payment_method,method);
  const saved=await sales.save({...input(method),version:draft.version},alex,draft.order_id);const quote=await sales.review(draft.order_id,alex);assert.match(quote.acceptance,new RegExp(method));await sales.submit(draft.order_id,{...quote,submission_reference:'snapshot-'+draft.order_id},alex);
  await assert.rejects(sales.save({...input('gcash'),version:saved.version},alex,draft.order_id),/cannot be edited/);
  const [r]=await sales.requests(staff,draft.order_id);assert.equal(JSON.parse(r.payload).payment_method,method);assert.equal((await detail(draft.order_id)).payment_method,method);
 }
 await assert.rejects(sales.save(input('unsupported'),alex),/available payment method/);
});
test('COD ships unpaid only after arrangement and confirmed stock; delivery alone never completes or verifies payment',async()=>{
 const id=await create();await dispatch(id,'inventory','reserve');let o=await detail(id);assert.equal(o.order_status,'pending_stock');assert.equal(o.payment,'none');
 let stage=processingStage(o,await sales.requests(staff,id),true);assert.equal(stage.stage,'COD arrangement');
 await dispatch(id,'billing','invoice');o=await detail(id);assert.equal(o.payment,'pending');assert.equal(processingStage(o,await sales.requests(staff,id),true).stage,'Reservation confirmation');assert.ok(!(await sales.requests(staff,id)).some(r=>r.service==='billing'&&r.action==='verify'));
 await dispatch(id,'inventory','confirm');o=await detail(id);assert.equal(o.order_status,'confirmed');assert.equal(o.reservation_expires,null);assert.equal(o.payment,'pending');assert.equal(canCancel(o),true);
 await dispatch(id,'delivery','accept');await dispatch(id,'delivery','verify_delivery');o=await detail(id);assert.equal(o.order_status,'fulfilling');assert.equal(o.shipment,'delivered');assert.equal(o.payment,'pending');assert.match(nextStep(o),/cash collected/);
 const p=milestones(o);assert.equal(p[3].done,true);assert.equal(p[4].name,'COD payment verified');assert.equal(p[4].done,false);assert.equal(processingStage(o,await sales.requests(staff,id),true).stage,'COD collection verification');
 await dispatch(id,'billing','verify');o=await detail(id);assert.equal(o.order_status,'completed');assert.equal(o.payment,'verified');assert.ok(milestones(o).every(x=>x.done));assert.equal((await dispatch(id,'billing','verify')).duplicate,true);
});
test('COD confirmed but unshipped orders use checked cancellation; shipped orders cannot be cancelled as unpaid drafts',async()=>{
 const id=await create();await confirmed(id);await sales.cancel(id,{reason:'Customer changed plans'},alex);assert.equal((await detail(id)).order_status,'cancellation_pending');assert.equal((await sales.requests(staff,id)).find(r=>r.service==='delivery').status,'blocked');await dispatch(id,'billing','cancel');await dispatch(id,'inventory','release');assert.equal((await detail(id)).order_status,'cancelled');
 const shipped=await create();await confirmed(shipped);await dispatch(shipped,'delivery','accept');assert.equal(canCancel(await detail(shipped)),false);await assert.rejects(sales.cancel(shipped,{reason:'Too late'},alex),/unavailable/);
});
test('failed COD collection preserves delivered shipment and blocks completion without releasing delivered stock',async()=>{
 const id=await create();await delivered(id);await dispatch(id,'billing','verify','reject');const o=await detail(id);assert.equal(o.shipment,'delivered');assert.equal(o.payment,'failed');assert.equal(o.order_status,'fulfilling');assert.equal(o.stock,'confirmed');assert.equal(canCancel(o),false);assert.ok(!(await sales.requests(staff,id)).some(r=>r.action==='release'));
 assert.match((await sales.notifications(alex))[0].message,/COD collection was not verified/);assert.equal(processingStage(o,await sales.requests(staff,id),true).options.length,0);
});
test('COD delivery failure does not claim payment received and does not request collection verification',async()=>{
 const id=await create();await confirmed(id);await dispatch(id,'delivery','accept');await dispatch(id,'delivery','verify_delivery','reject');const o=await detail(id);assert.equal(o.payment,'pending');assert.equal(o.shipment,'failed');assert.match(o.outcomes[0].message,/No COD collection is verified/);assert.ok(!(await sales.requests(staff,id)).some(r=>r.service==='billing'&&r.action==='verify'));
});
test('GCash and bank transfer still require verified payment before confirmation and shipment',async()=>{
 for(const method of ['gcash','bank_transfer']){const id=await create(method);await dispatch(id,'inventory','reserve');assert.equal((await detail(id)).order_status,'awaiting_payment');await dispatch(id,'billing','invoice');assert.equal(processingStage(await detail(id),await sales.requests(staff,id),true).stage,'Payment verification');await dispatch(id,'billing','verify');await dispatch(id,'inventory','confirm');assert.equal((await detail(id)).payment,'verified');}
});
test('COD collection requires matching amount/reference and cannot be verified before delivery',async()=>{
 const id=await create();await confirmed(id);await db.tx(q=>sales.enqueue(q,id,'billing','verify'));await assert.rejects(dispatch(id,'billing','verify'),/Billing is blocked/);
 await dispatch(id,'delivery','accept');await dispatch(id,'delivery','verify_delivery');const [request]=await db.query('SELECT * FROM sales_outbox WHERE request_reference=?',[`sales:${id}:billing:verify`]);const e=await integrations.simulate(request,'success');await assert.rejects(sales.event('billing',{...e,amount:'0.01'}),/does not match/);assert.equal((await detail(id)).payment,'pending');assert.equal((await detail(id)).order_status,'fulfilling');
});
test('COD is disabled for live adapters unless explicitly configured',async()=>{
 const previous=process.env.ENABLE_COD;delete process.env.ENABLE_COD;db.demo=false;
 try{await assert.rejects(sales.save(input('cod'),alex),/available payment method/);}finally{db.demo=true;if(previous===undefined)delete process.env.ENABLE_COD;else process.env.ENABLE_COD=previous;}
});

test('client or event method flags cannot turn a prepaid order into an unpaid COD shipment',async()=>{
 const {order_id:id}=await sales.save(input('gcash'),alex);const quote=await sales.review(id,alex);await sales.submit(id,{...quote,payment_method:'cod',submission_reference:'forged-cod'},alex);assert.equal((await detail(id)).payment_method,'gcash');await dispatch(id,'inventory','reserve');await dispatch(id,'billing','invoice');await db.tx(q=>sales.enqueue(q,id,'inventory','confirm'));
 const [request]=await db.query('SELECT * FROM sales_outbox WHERE request_reference=?',[`sales:${id}:inventory:confirm`]);const e=await integrations.simulate(request,'success');await assert.rejects(sales.event('inventory',{...e,payment_method:'cod'}),/no longer eligible/);assert.equal((await detail(id)).order_status,'awaiting_payment');assert.equal((await detail(id)).payment,'pending');
});

test('Inventory can verify COD stock fulfillment after shipment without falsely verifying cash collection',async()=>{
 const id=await create();await confirmed(id);await dispatch(id,'delivery','accept');const o=await detail(id);
 await sales.inventoryLifecycle({schema_version:1,event_type:'reservation.lifecycle',event_reference:'cod-fulfillment',request_reference:`sales:${id}:inventory:reserve`,order_id:id,version:1,status:'fulfilled',occurred_at:Date.now(),fulfillment_reference:'COD-SIM-FULFILLMENT',reservations:JSON.parse(o.reservation_json)});
 assert.equal((await detail(id)).stock,'fulfilled');assert.equal((await detail(id)).payment,'pending');assert.equal((await detail(id)).order_status,'fulfilling');await dispatch(id,'delivery','verify_delivery');await dispatch(id,'billing','verify');assert.equal((await detail(id)).order_status,'completed');
});
