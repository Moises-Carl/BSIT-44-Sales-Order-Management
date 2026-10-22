import test from 'node:test';import assert from 'node:assert/strict';import {operationSummary} from '../public/ui.mjs';
test('processing picker distinguishes pending work, stopped resolution, and completed customer questions',()=>{
 const base={order_id:1,order_status:'awaiting_payment',payment:'pending',stock:'reserved'};
 let w=operationSummary(base,[{order_id:1,service:'billing',action:'verify',status:'pending'}]);assert.equal(w.pending,true);assert.equal(w.attention,false);assert.match(w.step,/Payment verification/);
 w=operationSummary({...base,payment_method:'cod'},[{order_id:1,service:'billing',action:'verify',status:'pending'}]);assert.match(w.step,/COD collection/);
 w=operationSummary({...base,order_status:'completed',payment:'verified',needs_reply:1});assert.equal(w.pending,false);assert.equal(w.closed,true);assert.equal(w.attention,true);assert.match(w.reason,/Customer awaiting Sales reply/);
 w=operationSummary({...base,order_status:'cancellation_pending'},[{order_id:1,service:'inventory',action:'release',status:'pending'}]);assert.equal(w.pending,false);assert.equal(w.attention,true);assert.match(w.step,/resolution pending/);
 w=operationSummary({...base,order_status:'fulfilling',shipment:'failed',payment:'verified'});assert.equal(w.pending,true);assert.equal(w.attention,true);assert.match(w.step,/rescheduling/);
 w=operationSummary({...base,order_status:'draft'});assert.equal(w.pending,false);assert.equal(w.closed,false);
});
