import {test} from 'node:test';
import assert from 'node:assert/strict';
import {milestones,nextStep,canCancel,sumCentavos,cancellationChecks,stockExpired} from '../public/ui.mjs';
const valid={order_status:'awaiting_payment',order_date:'2026-10-22 01:00:00',stock:'reserved',reservation_expires:2000,payment:'pending',shipment:'none'};
test('progress requires actual facts, not a confirmed status label',()=>{const p=milestones({...valid,order_status:'confirmed',stock:'none',payment:'none'},1000);assert.deepEqual(p.map(m=>m.done),[true,false,false,false,false]);});
test('expired stock is not shown as verified and paid stock confirmation is distinguished',()=>{assert.equal(milestones(valid,3000)[1].done,false);assert.match(nextStep({...valid,payment:'verified',reservation_expires:Date.now()+60000}),/Inventory/);});
test('payment, shipment, and completed milestones require their separate facts',()=>{const p=milestones({...valid,payment:'verified',shipment:'accepted',tracking_reference:'T1',order_status:'fulfilling'},1000);assert.deepEqual(p.map(m=>m.done),[true,true,true,true,false]);assert.equal(milestones({...valid,order_status:'completed',shipment:'none',payment:'pending'},1000)[4].done,false);});
test('completed purchase can show historical stock confirmation after expiry',()=>{const p=milestones({...valid,order_status:'completed',payment:'verified',shipment:'delivered',tracking_reference:'T1',history:[{new_status:'awaiting_payment'}]},3000);assert.ok(p.every(m=>m.done));});
test('cancellation stops new stages but preserves verified historical facts',()=>{const p=milestones({...valid,order_status:'cancelled',stock:'released',payment:'cancelled',reservation_json:'[{"reservation_id":"R1"}]'},1000);assert.equal(p[0].done,true);assert.equal(p[1].state,'Reserved, then released');assert.ok(p[2].state.startsWith('Not applicable — Order '));assert.ok(p.every(m=>!m.active));assert.ok(milestones({...valid,order_status:'draft'},1000).every(m=>!m.done&&!m.active));});
test('customer reconciliation messages avoid raw operational detail',()=>{const o={...valid,reconciliation:'RAW-PAYLOAD-ERROR'};assert.ok(!nextStep(o).includes('RAW'));assert.match(nextStep(o),/sales team/);assert.match(nextStep(o,true),/Needs attention/);});
test('paid orders never show customer cancellation',()=>{assert.equal(canCancel({...valid,payment:'verified'}),false);assert.equal(canCancel(valid),true);assert.equal(canCancel({...valid,order_status:'fulfilling'}),false);});
test('submitted product values sum decimal strings exactly',()=>{assert.equal(sumCentavos([{order_total:'0.10'},{order_total:'0.20'},{order_total:'89.50'}]),8980);});

test('confirmed non-expiring and fulfilled stock milestones stay verified',()=>{for(const stock of ['confirmed','fulfilled']){const p=milestones({...valid,stock,reservation_expires:null,payment:'verified'},5000);assert.equal(p[1].done,true);}});

test('paid cancellation never shows an unpaid check verified, including legacy contradictory flags',()=>{const c=cancellationChecks({billing_clear:1,payment:'verified',release_clear:1,stock:'released'});assert.equal(c.unpaidVerified,false);assert.equal(c.paymentVerified,true);assert.equal(c.releaseVerified,true);});
test('confirmed non-expiring stock is not displayed as expired',()=>{assert.equal(stockExpired({order_status:'confirmed',stock:'confirmed',reservation_expires:null}),false);assert.equal(stockExpired({order_status:'confirmed',stock:'confirmed',reservation_expires:1}),true);});

test('expired reservation retains its historical reservation but never shows later processing as waiting',()=>{
 const p=milestones({...valid,history:[{new_status:'awaiting_payment'}]},3000);
 assert.equal(p[1].state,'Reserved, then expired');assert.ok(p[2].state.startsWith('Not applicable — Order '));assert.ok(p.every(m=>!m.active));
});
