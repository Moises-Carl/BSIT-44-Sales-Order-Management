import test from 'node:test';
import assert from 'node:assert/strict';
import {connect} from '../src/db.mjs';
import {Accounts} from '../src/accounts.mjs';
import {sortOrders,pendingPaymentOrders} from '../public/ui.mjs';
test('payment preference belongs to customer, validates options and preserves existing orders',async()=>{
 const db=await connect({demo:true,file:':memory:'});try{
 const a=new Accounts(db),u={role:'customer',customer_id:1};const old=await a.profile(u);
 for(const value of ['gcash','bank_transfer','cod','']){await a.update({...old,preferred_payment_method:value},u);assert.equal((await a.profile(u)).preferred_payment_method,value);}
 await a.update({...old,preferred_payment_method:'bank_transfer'},u);const {preferred_payment_method,...withoutPreference}=old;await a.update(withoutPreference,u);assert.equal((await a.profile(u)).preferred_payment_method,'bank_transfer');
 assert.equal((await a.profile({role:'customer',customer_id:2})).preferred_payment_method,'');
 await assert.rejects(a.update({...old,preferred_payment_method:'arbitrary'},u));await assert.rejects(a.profile({role:'staff'}));
 db.demo=false;await assert.rejects(a.update({...old,preferred_payment_method:'cod'},u));db.demo=true;
 }finally{await db.close();}
});
test('sorting is stable across equal values and does not mutate original rows',()=>{
 const rows=[{order_id:1,order_total:'100.00',created_at:'2026-01-01',updated_at:'2026-02-01'},{order_id:2,order_total:'20.00',created_at:'2026-01-02',updated_at:'2026-01-02'},{order_id:3,order_total:'20.00',created_at:'2026-01-02',updated_at:'2026-01-02'}];
 assert.deepEqual(sortOrders(rows,'amount_asc').map(o=>o.order_id),[3,2,1]);assert.equal(sortOrders(rows,'oldest')[0].order_id,1);assert.equal(sortOrders(rows,'newest')[0].order_id,3);assert.equal(sortOrders(rows,'updated')[0].order_id,1);assert.equal(rows[0].order_id,1);
});
test('pending payments include unpaid active advance payments and COD, excluding ended and verified orders',()=>{
 const rows=[{order_id:1,order_status:'awaiting_payment',payment:'pending'},{order_id:2,order_status:'fulfilling',payment_method:'cod',payment:'pending'},{order_id:3,order_status:'fulfilling',payment:'verified'},{order_id:4,order_status:'cancelled',payment:'pending'},{order_id:5,order_status:'awaiting_payment',payment:'failed'},{order_id:6,order_status:'pending_stock',payment:'none'},{order_id:7,order_status:'awaiting_payment',stock:'expired',payment:'pending'}];assert.deepEqual(pendingPaymentOrders(rows).map(o=>o.order_id),[1,2]);
});
