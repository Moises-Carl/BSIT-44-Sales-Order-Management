export const paymentMethodLabel = value => ({cod:'Cash on delivery',gcash:'GCash',bank_transfer:'Bank transfer',prepaid:'Pay in advance'})[value]||'Pay in advance';
export const statuses = ['draft','pending_stock','awaiting_payment','confirmed','fulfilling','completed','cancellation_pending','cancelled'];
export const label = value => value==='attention'?'Needs attention':String(value || 'not available').replaceAll('_',' ').replace(/^./, c => c.toUpperCase());
export const stockExpired = (order,time=Date.now()) => ['reserved','confirmed'].includes(order.stock)&&order.reservation_expires!==null&&Number(order.reservation_expires)>0&&Number(order.reservation_expires)<=time&&!['completed','cancelled'].includes(order.order_status);
export function cancellationChecks(order){return {unpaidVerified:Boolean(order.billing_clear)&&order.payment!=='verified',paymentVerified:order.payment==='verified',releaseVerified:Boolean(order.release_clear)&&order.stock==='released'};}
export function resolutionState(order){try{return order.resolution||JSON.parse(order.resolution_json||'{}');}catch{return {};}}
export function processingEnd(order){
 const resolution=resolutionState(order),issue=issueState(order,resolution);
 if(issue.status==='resolved')return {finished:true,title:(issue.outcome==='cancelled'?'Cancelled':'Unsuccessful')+' · Issue resolved',explanation:(issue.outcome==='cancelled'?'Order cancelled':'Order unsuccessful')+' — Issue resolved. '+resolution.issue_note,condition:issue.outcome};
 if(resolution.issue_outcome)return {finished:true,title:(resolution.issue_outcome==='cancelled'?'Cancelled':'Unsuccessful')+' — Issue review required',explanation:'New facts were received after issue closure. Review the outstanding requirements without reopening fulfillment.',condition:resolution.issue_outcome};
 if(resolution.fulfillment_stopped)return {finished:true,title:'Order unsuccessful — return to seller',explanation:'Normal fulfillment has stopped. Review the return journey and any refund obligation below.',condition:'unsuccessful'};
 if(resolution.cancel_accepted)return {finished:true,title:Number(order.resolution?.refundable_amount??(order.payment==='verified'?Number(order.order_total)-Number(order.refunded_total||0):0))>0?'Cancelled — Refund pending':'Order cancelled',explanation:'Cancellation accepted. Refund and stock resolution are tracked separately below.',condition:'cancelled'};
 const cancelled=order.order_status==='cancelled',cancelling=order.order_status==='cancellation_pending';
 const unsuccessful=['rejected','expired'].includes(order.stock)||order.payment==='failed';
 const finished=cancelled||cancelling||unsuccessful;
 const reason=String(order.cancellation_reason||'').trim();
 const outcome=order.outcome_message||order.outcomes?.[0]?.message;
 const failureReason=outcome?.includes(' Reason: ')?outcome.split(' Reason: ').slice(1).join(' Reason: ').trim():'';
 const title=cancelled?'Order cancelled':cancelling?(order.payment==='verified'?'Cancellation needs reconciliation':'Cancellation requested'):unsuccessful?'Order unsuccessful':order.order_status==='completed'?'Order completed':'';
 const explanation=cancelled?'Order cancelled'+(reason?' due to '+reason.replace(/[.!?]+$/,'')+'.':'.'):cancelling?'Order processing has ended'+(reason?' due to '+reason:'.')+(order.payment==='verified'?' Payment was received. Sales must accept cancellation in Refund and return resolution; Billing can then record the required refund.':' Cancellation checks and stock release are being completed.'):unsuccessful?(failureReason?'Order unsuccessful due to '+failureReason+'. '+outcome.split(' Reason: ')[0]:outcome||'Processing ended after an unsuccessful service result. Review the order history for the reason.'):'Delivery and payment are verified.';
 return {finished,title,explanation,condition:cancelled?'cancelled':cancelling?'cancellation_pending':unsuccessful?'unsuccessful':order.order_status};
}
export function nextStep(order, staff = false) {
  const end=processingEnd(order);if(end.finished)return end.explanation;
 if(order.order_status==='completed')return 'Your order was delivered and payment was confirmed. Contact Sales remains available.';
  if(['confirmed','fulfilling'].includes(order.order_status)&&order.shipment!=='delivered'&&order.delivery_updates?.[0]?.kind==='delayed')return 'Delivery delayed: '+order.delivery_updates[0].reason+(order.delivery_updates[0].estimated_at?' Check Delivery updates below for the revised estimate.':' Awaiting an updated delivery estimate.');
 if(order.shipment==='failed')return order.delivery_updates?.[0]?.kind==='rescheduled'&&order.requests?.some(r=>r.service==='delivery'&&!['done','blocked'].includes(r.status))?'Redelivery scheduled. Check delivery updates for the agreed date and time.':'Delivery needs rescheduling. Contact Sales to agree another delivery time. '+(order.payment_method==='cod'?'Cash is due only on successful delivery.':'Your payment remains recorded.');
 if(order.outcome_message)return order.outcome_message;
  if(order.outcomes?.some(o=>!o.kind.startsWith('delivery-attempt-')&&!o.kind.startsWith('redelivery-')&&o.kind!=='delivery_failed'))return order.outcomes.find(o=>!o.kind.startsWith('delivery-attempt-')&&!o.kind.startsWith('redelivery-')&&o.kind!=='delivery_failed').message;
  if(order.stock==='rejected')return 'Stock was unavailable. Processing has stopped. You can request cancellation and create a new order.';
  if(order.payment==='failed')return 'Payment was unsuccessful. Delivery is stopped. Request cancellation before creating a new order.';
  if (order.reconciliation || order.unresolved) return staff ? 'Needs attention — review the verified service results before proceeding.' : 'Your order needs a review by the sales team. Progress is paused.';
  if (stockExpired(order)) return 'Stock reservation expired. Waiting for the sales team to review.';
  if(order.payment_method==='cod'){
    if(order.order_status==='pending_stock')return order.stock==='none'?'Waiting for stock reservation. No advance payment is required for cash on delivery.':order.invoice_reference?'Waiting for Inventory to confirm stock for the COD shipment.':'Stock reserved. Preparing the amount to collect on delivery.';
    if(order.order_status==='confirmed')return 'COD order confirmed. No advance payment is required. Waiting for shipment acceptance.';
    if(order.order_status==='fulfilling')return order.shipment==='delivered'?'Delivery confirmed. Waiting for Billing to verify the cash collected before completing the order.':'Delivery is in progress. Pay the stated product total when your order arrives.';
  }
  if (order.payment === 'verified' && order.order_status === 'awaiting_payment') return 'Payment verified. Waiting for Inventory to confirm stock is still valid.';
  return {
    draft: staff ? 'Customer draft. Review details before submitting on their behalf.' : 'Continue your draft, then review the prices before submitting.',
    pending_stock: 'Waiting for stock confirmation. Payment has not been requested.',
    awaiting_payment: order.invoice_reference ? 'Waiting for payment verification.' : 'Stock reserved. Waiting for Billing to prepare the payment request.',
    confirmed: 'Preparing delivery. Waiting for Delivery to accept the order.',
    fulfilling: 'Delivery is in progress. Waiting for verified delivery confirmation.',
    completed: 'Delivery confirmed. Your purchase details are saved.',
    cancellation_pending: 'Cancellation requested. Waiting for payment checks and stock release.',
    cancelled: 'Order cancelled. Your order history is saved.'
  }[order.order_status] || 'Waiting for an update from the sales team.';
}
export function milestones(order, time = Date.now()) {
 const draft=order.order_status==='draft',cancelled=['cancelled','cancellation_pending'].includes(order.order_status);
 const expired=stockExpired(order,time);
 const definitive=expired||order.stock==='rejected'||order.stock==='expired'||order.payment==='failed';
 const stopped=cancelled||definitive||processingEnd(order).finished;
 const submitted=Boolean(order.order_date)&&!draft;
 const historicallyReserved=order.history?.some(h=>h.new_status==='awaiting_payment')||Boolean(order.reservation_json&&order.reservation_json!=='[]');
 const stockValid=order.stock==='fulfilled'||(order.stock==='confirmed'&&order.reservation_expires===null)||(['reserved','confirmed'].includes(order.stock)&&Number(order.reservation_expires)>time);
 const stockDone=Boolean(stockValid||((stopped||order.order_status==='completed')&&historicallyReserved));
 const shipmentDone=['accepted','delivered'].includes(order.shipment)&&Boolean(order.tracking_reference)||order.shipment==='failed'&&Boolean(order.tracking_reference)&&order.history?.some(h=>h.new_status==='fulfilling');
 let checks=[submitted,submitted&&stockDone,order.payment==='verified',Boolean(shipmentDone),order.order_status==='completed'&&order.shipment==='delivered'&&order.payment==='verified'];
 let names=['Submitted','Stock reserved','Payment verified','Preparing delivery','Delivered'];
 let failedIndex=order.stock==='rejected'?1:order.payment==='failed'?2:order.shipment==='failed'?(shipmentDone?4:3):(order.stock==='expired'||expired)?1:-1;
 if(order.payment_method==='cod'){
  checks=[submitted,submitted&&stockDone,Boolean(shipmentDone),order.shipment==='delivered',order.payment==='verified'];
  names=['Submitted','Stock reserved','Preparing delivery','Delivered','COD payment verified'];
  failedIndex=order.stock==='rejected'||order.stock==='expired'||expired?1:order.shipment==='failed'?(shipmentDone?3:2):order.payment==='failed'?4:-1;
 }
 let current=false;
 return names.map((name,i)=>{
  const done=!draft&&Boolean(checks[i]);
  const failed=!draft&&i===failedIndex;
  const active=!draft&&!stopped&&!order.reconciliation&&!order.unresolved&&!done&&!current;
  if(active)current=true;
  const state=done?(i===1&&order.stock==='released'?'Reserved, then released':i===1&&(order.stock==='expired'||expired)?'Reserved, then expired':'Verified'):failed&&order.shipment==='failed'&&!processingEnd(order).finished?(order.requests?.some(r=>r.service==='delivery'&&!['done','blocked'].includes(r.status))?'Redelivery scheduled':'Needs rescheduling'):failed?'Unsuccessful':!draft&&stopped?(cancelled?'Not applicable — Order cancelled':'Not applicable — Order unsuccessful'):active?'Waiting':order.reconciliation||order.unresolved?'Paused':'Not reached';
  return {name,done,active,state,explanation:state.startsWith('Not applicable')?'Further processing stopped after cancellation or an unsuccessful result.':''};
 });
}
export const canCancel = order => (['draft','pending_stock','awaiting_payment'].includes(order.order_status)||order.payment_method==='cod'&&order.order_status==='confirmed'&&order.shipment==='none') && order.payment !== 'verified';
export function sumCentavos(rows) {
  return rows.reduce((sum,row) => { const [whole,fraction=''] = String(row.order_total||'0').split('.'); return sum + Number(whole)*100+Number(fraction.padEnd(2,'0')); },0);
}

export function needsAttention(order){
 const r=resolutionState(order);if(issueState(order,r).status==='resolved')return false;
 if(issueState(order,r).outcome)return true;
 const closed=r.cancel_accepted||r.fulfillment_stopped;
 const refund=order.payment==='verified'&&(closed||['cancelled','cancellation_pending'].includes(order.order_status))&&Number(order.order_total)>Number(order.refunded_total??r.refunded_amount??0);
 const work=r.needs_resolution||refund||['required','in_transit','issue'].includes(r.return_status)||['inventory_pending','condition_review'].includes(r.stock_status)||r.stock_status==='release_pending'&&order.stock!=='released'||r.cancel_accepted&&r.return_status==='none'&&['reserved','confirmed'].includes(order.stock);
 return Boolean(order.needs_reply||work||!closed&&(order.reconciliation||order.unresolved||order.shipment==='failed'||stockExpired(order)));
}

export const orderSorts=[['newest','Newest first'],['oldest','Oldest first'],['updated','Recently updated'],['amount_desc','Total: high to low'],['amount_asc','Total: low to high']];
export function sortOrders(rows,sort='newest'){
 const compare={newest:(a,b)=>String(b.created_at).localeCompare(String(a.created_at)),oldest:(a,b)=>String(a.created_at).localeCompare(String(b.created_at)),updated:(a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)),amount_desc:(a,b)=>Number(b.order_total)-Number(a.order_total),amount_asc:(a,b)=>Number(a.order_total)-Number(b.order_total)}[sort]||((a,b)=>b.order_id-a.order_id);
 return [...rows].sort((a,b)=>compare(a,b)||b.order_id-a.order_id);
}
export const pendingPaymentOrders=rows=>rows.filter(o=>['awaiting_payment','confirmed','fulfilling'].includes(o.order_status)&&!processingEnd(o).finished&&!['verified','cancelled','failed'].includes(o.payment));

export function operationSummary(order,requests=[]){
 const resolved=issueState(order);if(resolved.status==='resolved')return {attention:false,pending:false,closed:true,step:(resolved.outcome==='cancelled'?'Cancelled':'Unsuccessful')+' · Issue resolved',reason:'',priority:3};
 const pending=requests.filter(r=>r.order_id===order.order_id&&!['done','blocked'].includes(r.status));
 const cleanup=pending.some(r=>['cancel','release'].includes(r.action));
 const attention=needsAttention(order)||Boolean(order.needs_reply)||order.order_status==='cancellation_pending'||cleanup;
 const ended=processingEnd(order).finished||order.order_status==='completed';
 const active=!ended&&order.order_status!=='draft';
 const upcoming=pending.find(r=>!['cancel','release'].includes(r.action));
 const names={'inventory:reserve':'Stock reservation pending','billing:invoice':order.payment_method==='cod'?'COD arrangement pending':'Payment request pending','billing:verify':order.payment_method==='cod'?'COD collection verification pending':'Payment verification pending','inventory:confirm':'Stock confirmation pending','delivery:accept':'Shipment acceptance pending','delivery:verify_delivery':'Delivery confirmation pending'};
 let step=order.shipment==='failed'?(upcoming?'Redelivery scheduled / awaiting Delivery':'Delivery needs rescheduling'):ended?(cleanup?'Payment / stock resolution pending':processingEnd(order).title||'Order completed'):order.order_status==='draft'?'Draft — not submitted':names[upcoming?.service+':'+upcoming?.action]||nextStep(order,true);
 const reasons=[order.needs_reply?'Customer awaiting Sales reply':'',order.reconciliation?'Service issue needs review':'',order.unresolved?'Service result unresolved':'',stockExpired(order)?'Stock reservation expired':'',order.shipment==='failed'?'Review delivery attempt':'',order.order_status==='cancellation_pending'?'Cancellation checks pending':''].filter(Boolean);
 return {attention,pending:active,closed:ended,step,reason:reasons.join(' · '),priority:attention?0:active?1:order.order_status==='draft'?2:3};
}

export function orderMetrics(rows){const submitted=rows.filter(o=>Boolean(o.order_date)&&o.order_status!=='draft'),active=submitted.filter(o=>o.order_status!=='completed'&&!processingEnd(o).finished&&!stockExpired(o));return {total:rows.length,submitted:submitted.length,active:active.length,percentage:submitted.length?Math.round(active.length/submitted.length*100):0};}

export function resolutionBadges(o){const issue=issueState(o);if(issue.status==='resolved')return ['Issue resolved'];const r=resolutionState(o),labels=[];if(issue.outcome)labels.push(issue.status==='action_required'?'Issue: Action required':'Issue: In progress');if(o.payment==='verified'&&(r.cancel_accepted||r.fulfillment_stopped||['cancelled','cancellation_pending'].includes(o.order_status))&&Number(o.order_total)>Number(o.refunded_total||0))labels.push(r.refund_status==='failed'?'Refund failed — retry required':r.refund_status==='processing'?'Refund processing':'Refund required');if(['required','in_transit','issue'].includes(r.return_status))labels.push({required:'Return required',in_transit:'Return in transit',issue:'Return unresolved'}[r.return_status]);if(['inventory_pending','condition_review'].includes(r.stock_status)||r.stock_status==='release_pending'&&o.stock!=='released')labels.push('Inventory action pending');return labels;}

export function issueOutcome(o,r=resolutionState(o)){
 if(r.issue_outcome)return r.issue_outcome;
 if(r.cancel_accepted||['cancelled','cancellation_pending'].includes(o.order_status))return 'cancelled';
 if(r.fulfillment_stopped||['rejected','expired'].includes(o.stock)||o.payment==='failed')return 'unsuccessful';
 return null;
}
export function issueRequirements(o,r=resolutionState(o)){
 const items=[];if(!issueOutcome(o,r))return items;
 if(o.order_status==='cancellation_pending'&&!r.cancel_accepted)items.push({key:'cancellation',label:'Cancellation acceptance is pending.',action:'accept_cancel'});
 const remaining=r.refundable_amount??(o.payment==='verified'&&(r.cancel_accepted||r.fulfillment_stopped||['cancelled','cancellation_pending'].includes(o.order_status))?Math.max(0,Number(o.order_total)-Number(o.refunded_total||0)):0);
 if(Number(remaining)>0)items.push({key:'refund',label:'Refund of PHP '+Number(remaining).toFixed(2)+' remains outstanding.',action:r.refund_status==='processing'?'refund_record':'refund_start'});
 if(['required','in_transit','issue'].includes(r.return_status))items.push({key:'return',label:'Return '+(r.return_status==='required'?'handover is required.':r.return_status==='in_transit'?'receipt is not confirmed.':'goods are missing or unconfirmed.'),action:r.return_status==='required'?'return_transit':'return_receive'});
 if(r.release_pending||['inventory_pending','condition_review'].includes(r.stock_status)||r.stock_status==='release_pending'&&o.stock!=='released'||['cancelled','cancellation_pending'].includes(o.order_status)&&['reserved','confirmed'].includes(o.stock)&&!['accepted','delivered','failed'].includes(o.shipment))items.push({key:'stock',label:r.stock_status==='condition_review'?'Inventory condition / damaged goods review is outstanding.':r.stock_status==='inventory_pending'?'Inventory restoration confirmation is pending.':'Stock reservation release is pending.',action:r.stock_status==='condition_review'?'return_receive':r.stock_status==='inventory_pending'?'stock_record':'clearance_check'});
 if(o.payment==='failed'&&o.shipment==='delivered')items.push({key:'payment',label:'Delivery occurred, but payment failed. Document the external payment settlement or the decision on collection; delivery history will remain unchanged.',action:'external_evidence'});
 return items;
}
export function issueState(o,r=resolutionState(o)){
 const outcome=issueOutcome(o,r);if(!outcome)return {status:'none',outcome:null,requirements:[]};
 const resolved=r.issue_closed===true&&Number(r.issue_closed_version)===Number(o.version);
 return {outcome,status:resolved?'resolved':r.refund_status==='failed'||!r.version?'action_required':'in_progress',requirements:resolved?[]:issueRequirements(o,r),reopened:Boolean(r.issue_closed&&!resolved)};
}
