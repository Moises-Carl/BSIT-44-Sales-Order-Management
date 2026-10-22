import test from 'node:test';import assert from 'node:assert/strict';
import {processingStage} from '../src/processing.mjs';
import {connect} from '../src/db.mjs';import {Sales} from '../src/sales.mjs';import {Integrations} from '../src/integrations.mjs';import {processingEnd,nextStep,milestones} from '../public/ui.mjs';
const staff={role:'staff',user_id:1},alex={role:'customer',customer_id:1,user_id:2};
test('failed prepaid and COD attempts can be rescheduled repeatedly and complete only after delivery and payment',async()=>{
 const db=await connect({demo:true,file:':memory:'});const sales=new Sales(db),integrations=new Integrations(sales);try{
 for(const method of ['gcash','bank_transfer','cod']){
 const {order_id:id}=await sales.save({customer_id:1,seller_id:1,payment_method:method,items:[{offer_id:1,quantity:1}],recipient_name:'Retry Test',recipient_contact:'09170000000',requested_delivery_address:'Campus'},staff);await sales.submit(id,{...await sales.review(id,staff),submission_reference:'retry-'+id},staff);
 const dispatch=(action,service='delivery',outcome='success')=>integrations.dispatch(`sales:${id}:${service}:${action}`,staff,outcome,'Recipient unavailable');
 await dispatch('reserve','inventory');await dispatch('invoice','billing');if(method!=='cod')await dispatch('verify','billing');await dispatch('confirm','inventory');await dispatch('accept');await dispatch('verify_delivery','delivery','reject');
 let o=await sales.detail(id,staff);assert.equal(o.order_status,'fulfilling');assert.equal(processingEnd(o).finished,false);assert.equal(o.reconciliation,null);assert.equal(o.payment,method==='cod'?'pending':'verified');assert.match(nextStep(o),/rescheduling/);assert.ok(!milestones(o).some(m=>m.state==='Not applicable'));
 await assert.rejects(sales.reschedule(id,{reason:'Agreed',scheduled_at:new Date(Date.now()+10000).toISOString(),version:o.version},alex),/Staff/);
 for(let attempt=0;attempt<2;attempt++){
 o=await sales.detail(id,staff);const data={reason:'Customer agreed via order conversation',scheduled_at:new Date(Date.now()+200).toISOString(),version:o.version};await sales.reschedule(id,data,staff);
 await assert.rejects(sales.reschedule(id,{...data,version:(await sales.detail(id,staff)).version},staff),/already scheduled/);
 const r=(await sales.requests(staff,id)).find(r=>r.service==='delivery'&&r.status==='pending');assert.ok(r);await assert.rejects(integrations.dispatch(r.request_reference,staff),/lease/);await new Promise(r=>setTimeout(r,240));await integrations.dispatch(r.request_reference,staff,attempt===0?'reject':'success','Another missed attempt');
 }
 o=await sales.detail(id,staff);assert.equal(o.shipment,'delivered');if(method==='cod'){assert.equal(o.order_status,'fulfilling');assert.equal(o.payment,'pending');await dispatch('verify','billing');}
 o=await sales.detail(id,staff);assert.equal(o.order_status,'completed');assert.equal(o.payment,'verified');assert.match(nextStep(o),/delivered and payment/);assert.equal(o.history.filter(h=>h.reason?.startsWith('Delivery attempt failed')).length,2);
 assert.equal((await sales.notifications(alex)).filter(n=>n.order_id===id&&n.kind==='order_completed').length,1);
 await assert.rejects(sales.reschedule(id,{reason:'Too late',version:o.version,scheduled_at:new Date(Date.now()+10000).toISOString()},staff));
 const newDraft=await sales.orderAgain(id,alex);const n=await sales.detail(newDraft.order_id,alex);assert.equal(n.order_status,'draft');assert.equal(n.payment,'none');assert.equal(n.shipment,'none');assert.equal(n.items.length,1);assert.equal(n.payment_method,method);
 await assert.rejects(sales.orderAgain(id,{role:'customer',customer_id:2}),/not found/);
 }
 }finally{await db.close();}
});
test('shipment acceptance failure stays active and a new attempt can accept shipment',async()=>{
 const db=await connect({demo:true,file:':memory:'});const s=new Sales(db),i=new Integrations(s);try{
 const {order_id:id}=await s.save({customer_id:1,seller_id:1,payment_method:'cod',items:[{offer_id:1,quantity:1}],recipient_name:'A',recipient_contact:'B',requested_delivery_address:'C'},staff);await s.submit(id,{...await s.review(id,staff),submission_reference:'accept-retry'},staff);
 for(const[service,action]of [['inventory','reserve'],['billing','invoice'],['inventory','confirm']])await i.dispatch(`sales:${id}:${service}:${action}`,staff);
 await i.dispatch(`sales:${id}:delivery:accept`,staff,'reject','Vehicle unavailable');let o=await s.detail(id,staff);assert.equal(processingEnd(o).finished,false);
 await s.reschedule(id,{version:o.version,reason:'New vehicle confirmed',scheduled_at:new Date(Date.now()+86400000).toISOString()},staff);const requests=await s.requests(staff,id);const r=requests.find(r=>r.service==='delivery'&&r.status==='pending');assert.deepEqual(processingStage(await s.detail(id,staff),requests,true).options.map(x=>x.value),['successful','unsuccessful']);assert.equal(processingStage(await s.detail(id,staff),requests,false).options.length,0);
 await db.query("UPDATE sales_outbox SET status='processing' WHERE request_reference=?",[r.request_reference]);await assert.rejects(i.dispatch(r.request_reference,staff,'success','',{recordAttempt:true}),/lease/);await db.query("UPDATE sales_outbox SET status='pending' WHERE request_reference=?",[r.request_reference]);await i.dispatch(r.request_reference,staff,'success','',{recordAttempt:true});o=await s.detail(id,staff);assert.equal(o.shipment,'accepted');assert.equal(o.order_status,'fulfilling');
 }finally{await db.close();}
});
