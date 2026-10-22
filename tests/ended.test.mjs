import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connect} from '../src/db.mjs';
import {application} from '../src/server.mjs';
import {processingEnd} from '../public/ui.mjs';

test('staff cancellation ends the form and automatically verifies demo cleanup without completing delivery',async()=>run(async({sales,post,get,create})=>{
 const id=await create();await post(id,'successful');await post(id,'cancel','Changed plans');const o=await sales.detail(id,{role:'staff'});assert.equal(o.order_status,'cancelled');assert.equal(o.shipment,'none');assert.equal(o.payment,'cancelled');assert.equal(o.stock,'released');assert.match(processingEnd(o).explanation,/Order cancelled due to Changed plans/);const stage=await get(id);assert.equal(stage.processing_finished,true);assert.deepEqual(stage.options,[]);assert.equal(stage.resolution_pending,false);
}));
test('unsuccessful payment ends normal processing, retains the reason and releases demo stock without another outcome choice',async()=>run(async({sales,post,get,create})=>{
 const id=await create();await post(id,'successful');await post(id,'successful');await post(id,'unsuccessful','Payment declined by test provider');const o=await sales.detail(id,{role:'staff'});assert.equal(o.payment,'failed');assert.equal(o.stock,'released');assert.equal(o.shipment,'none');assert.notEqual(o.order_status,'completed');assert.equal(processingEnd(o).condition,'unsuccessful');assert.match(processingEnd(o).explanation,/Payment declined by test provider/);const s=await get(id);assert.deepEqual(s.options,[]);assert.equal(s.processing_finished,true);assert.equal(s.resolution_pending,false);
}));
test('paid cancellation conflict remains ended with no next outcome while separate resolution preserves verified payment',async()=>run(async({sales,integrations,post,get,create,db,request})=>{
 const id=await create();await post(id,'successful');await post(id,'successful');await sales.cancel(id,{reason:'Customer changed plans'},{role:'staff'});await integrations.dispatch(`sales:${id}:billing:cancel`,{role:'staff'},'paid');
 let stage=await get(id);assert.equal(stage.processing_finished,true);assert.deepEqual(stage.options,[]);assert.equal(stage.resolution_pending,true);assert.match(stage.guidance,/Payment was received/);
 const response=await request(`/api/orders/${id}/resolve`,{});assert.equal(response.status,200);const o=await sales.detail(id,{role:'staff'});assert.equal(o.payment,'verified');assert.equal(o.stock,'released');assert.equal(o.order_status,'cancellation_pending');assert.equal(o.shipment,'none');stage=await get(id);assert.deepEqual(stage.options,[]);assert.equal(stage.resolution_pending,false);
 assert.equal((await request(`/api/orders/${id}/outcome`,{version:stage.version,outcome:'successful'})).status,409);assert.ok(!(await sales.requests({role:'staff'},id)).some(r=>r.service==='delivery'));
}));
test('live cancellation does not manufacture clearance; unknown cleanup remains unresolved outside the outcome form',async()=>run(async({sales,post,get,create,db,request})=>{
 const id=await create();db.demo=false;await post(id,'cancel','Cancellation request');const o=await sales.detail(id,{role:'staff'});assert.equal(o.order_status,'cancellation_pending');assert.equal(o.billing_clear,0);assert.equal(o.release_clear,0);assert.equal((await get(id)).processing_finished,true);assert.equal((await get(id)).options.length,0);
 // No configured service URL: a query cannot manufacture a successful clearance.
 const saved={BILLING_URL:process.env.BILLING_URL,INVENTORY_URL:process.env.INVENTORY_URL};delete process.env.BILLING_URL;delete process.env.INVENTORY_URL;
 try{const result=await(await request(`/api/orders/${id}/resolve`,{})).json();assert.equal(result.pending,true);assert.equal((await sales.detail(id,{role:'staff'})).order_status,'cancellation_pending');}finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;db.demo=true;}
}));
test('normal orders and customer accounts cannot use the stopped-order resolution endpoint',async()=>run(async({create,request,base})=>{
 const id=await create();assert.equal((await request(`/api/orders/${id}/resolve`,{})).status,409);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'alex@example.test',password:'CampusDemo2026!'})});const body=await login.json();const result=await fetch(base+`/api/orders/${id}/resolve`,{method:'POST',headers:{cookie:login.headers.get('set-cookie').split(';')[0],'x-csrf-token':body.csrf,'content-type':'application/json'},body:'{}'});assert.equal(result.status,403);
}));
async function run(work){
 const db=await connect({demo:true,file:':memory:'});const {server,sales,integrations}=application(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@example.test',password:'CampusDemo2026!'})});const auth=await login.json();const headers={cookie:login.headers.get('set-cookie').split(';')[0],'x-csrf-token':auth.csrf,'content-type':'application/json'};
  const get=async id=>await(await fetch(base+`/api/orders/${id}/processing`,{headers})).json();
  const request=(path,data)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(data)});
  const post=async(id,outcome,reason='')=>{const stage=await get(id);const r=await request(`/api/orders/${id}/outcome`,{version:stage.version,request_reference:stage.request_reference,outcome,reason});assert.equal(r.status,200,await r.text());};
  const create=async()=>{const{order_id:id}=await sales.save({customer_id:1,seller_id:1,items:[{offer_id:1,quantity:1}],recipient_name:'Fictional Closure Customer',recipient_contact:'09170000000',requested_delivery_address:'100 Fictional Campus'},{role:'staff',user_id:1});await sales.submit(id,{...await sales.review(id,{role:'staff'}),submission_reference:'closure-'+id},{role:'staff'});return id;};
  await work({sales,integrations,db,base,get,post,request,create});
 }finally{db.demo=true;await new Promise(r=>server.close(r));await db.close();}
}
