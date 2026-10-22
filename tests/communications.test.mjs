import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connect} from '../src/db.mjs';
import {application} from '../src/server.mjs';
test('order communication enforces ownership, notifies customers and preserves delivery facts',async()=>{
 const db=await connect({demo:true,file:':memory:'});const {server,sales}=application(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
 const login=async email=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'CampusDemo2026!'})});const a=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],'x-csrf-token':a.csrf,'content-type':'application/json'};};
 const staff=await login('admin@example.test'),alex=await login('alex@example.test'),jamie=await login('jamie@example.test');const u={role:'staff',user_id:1};
 const {order_id:id}=await sales.save({customer_id:1,seller_id:1,items:[{offer_id:1,quantity:1}],recipient_name:'Test',recipient_contact:'09170000000',requested_delivery_address:'Campus'},u);await sales.submit(id,{...await sales.review(id,u),submission_reference:'communication-submitted'},u);
 const post=(path,data,headers=staff)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(data)});
 assert.equal((await post(`/api/orders/${id}/messages`,{body:'Where is my order?'},alex)).status,201);
 assert.equal((await post(`/api/orders/${id}/messages`,{body:'Not mine'},jamie)).status,404);
 assert.equal((await post(`/api/orders/${id}/messages`,{body:'  '},alex)).status,422);
 let inbox=await sales.inbox(u);assert.equal(inbox[0].sender_role,'customer');
 assert.equal((await post(`/api/orders/${id}/messages`,{body:'Checking with Delivery.'})).status,201);
 assert.equal((await sales.notifications({role:'customer',customer_id:1})).length,1);
 assert.equal((await sales.detail(id,{role:'customer',customer_id:1})).messages.length,2);
 assert.equal((await fetch(base+'/api/sales-inbox',{headers:alex})).status,403);
 assert.equal((await post(`/api/orders/${id}/delivery-updates`,{kind:'delayed',reason:'Traffic'})).status,409);
 await db.tx(async q=>{await q("UPDATE sales_order SET order_status='fulfilling' WHERE order_id=?",[id]);await q("UPDATE sales_order_facts SET shipment='accepted',stock='confirmed',payment='verified' WHERE order_id=?",[id]);});
 const before=await sales.detail(id,u);
 assert.equal((await post(`/api/orders/${id}/delivery-updates`,{kind:'delayed',reason:'Traffic'},alex)).status,403);
 assert.equal((await post(`/api/orders/${id}/delivery-updates`,{kind:'delayed',reason:'Traffic',estimated_at:'invalid'})).status,422);
 assert.equal((await post(`/api/orders/${id}/delivery-updates`,{kind:'delayed',reason:'Traffic',next_update_at:new Date(Date.now()+86400000).toISOString()})).status,201);
 let o=await sales.detail(id,u);for(const key of ['order_status','stock','payment','shipment','version'])assert.equal(o[key],before[key]);assert.equal(o.delivery_updates.length,1);
 assert.match((await sales.notifications({role:'customer',customer_id:1}))[0].message,/Awaiting an updated delivery estimate/);
 assert.equal((await post(`/api/orders/${id}/delivery-updates`,{kind:'resumed',reason:'Route reopened'})).status,201);
 await db.query("UPDATE sales_order SET order_status='completed' WHERE order_id=?",[id]);
 assert.equal((await post(`/api/orders/${id}/delivery-updates`,{kind:'delayed',reason:'Too late'})).status,409);
 assert.equal((await post(`/api/orders/${id}/messages`,{body:'Follow up after completion'},alex)).status,201);
 await db.query("UPDATE sales_order_facts SET payment='failed' WHERE order_id=?",[id]);
 await db.tx(q=>sales.notify(q,{order_id:id,customer_id:1},'payment_failed','Payment failed. Reason: Provider declined payment'));
 await post(`/api/orders/${id}/messages`,{body:'We are investigating.'});
 assert.match((await sales.detail(id,u)).outcomes[0].message,/Provider declined payment/);
 assert.match((await sales.list(u))[0].outcome_message,/Provider declined payment/);
 assert.equal((await post(`/api/orders/${id}/messages`,{body:'x'}, {...alex,'x-csrf-token':'bad'})).status,403);
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
