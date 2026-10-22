import test from 'node:test';import assert from 'node:assert/strict';import {connect} from '../src/db.mjs';import {application} from '../src/server.mjs';
test('drafts are private to customers across staff APIs and become visible only after submission',async()=>{
 const db=await connect({demo:true,file:':memory:'});const {server}=application(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
 const login=async email=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'CampusDemo2026!'})});const a=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],'x-csrf-token':a.csrf,'content-type':'application/json'};};
 const a=await login('alex@example.test'),staff=await login('admin@example.test'),other=await login('jamie@example.test');const req=(path,headers=staff,method='GET',data)=>fetch(base+'/api'+path,{headers,method,body:data===undefined?undefined:JSON.stringify(data)});
 const data={customer_id:1,seller_id:1,payment_method:'gcash',items:[{offer_id:1,quantity:1}],recipient_name:'Private draft',recipient_contact:'09170000000',requested_delivery_address:'Campus'};
 const created=await req('/orders',a,'POST',data);assert.equal(created.status,201);const {order_id:id}=await created.json();
 assert.equal((await req('/orders/'+id,a)).status,200);assert.equal((await req('/orders/'+id,other)).status,404);
 assert.deepEqual(await(await req('/orders')).json(),[]);assert.deepEqual(await(await req('/orders?status=draft')).json(),[]);
 for(const suffix of ['', '/processing'])assert.equal((await req('/orders/'+id+suffix)).status,404);
 for(const suffix of ['review','submit','cancel','messages','delivery-updates','outcome','reschedule','order-again'])assert.equal((await req('/orders/'+id+'/'+suffix,staff,'POST',{})).status,404,suffix);
 assert.equal((await req('/orders/'+id,staff,'PUT',data)).status,404);assert.equal((await req('/orders',staff,'POST',data)).status,403);
 assert.equal((await req('/orders/'+id+'/messages',a,'POST',{body:'Private draft question'})).status,201);assert.deepEqual(await(await req('/sales-inbox')).json(),[]);
 const quote=await(await req('/orders/'+id+'/review',a,'POST',{})).json();assert.equal((await req('/orders/'+id+'/submit',a,'POST',{...quote,submission_reference:'private-submitted'})).status,200);
 assert.equal((await req('/orders/'+id)).status,200);assert.equal((await(await req('/orders')).json()).length,1);assert.equal((await(await req('/sales-inbox')).json()).length,1);
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
