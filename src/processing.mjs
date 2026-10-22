import {isCod,confirmationPaymentReady,shipmentPaymentReady} from './payment.mjs';
import {stockExpired,canCancel,processingEnd,issueState} from '../public/ui.mjs';
export const processingStages={
 'inventory:reserve':{name:'Stock reservation',success:'Inventory reserves all requested items.',failure:'Inventory rejects the reservation. Payment and fulfillment stop.'},
 'billing:invoice':{name:'Payment request',success:'Billing prepares the payment request for the accepted product total.'},
 'billing:verify':{name:'Payment verification',success:'Billing verifies payment of the accepted total.',failure:'Billing records failed payment. No automatic retry or fulfillment follows.'},
 'inventory:confirm':{name:'Reservation confirmation',success:'Inventory confirms the reserved stock after payment.',failure:'Inventory reports an expired reservation. Paid funds require reconciliation.'},
 'delivery:accept':{name:'Shipment acceptance',success:'Delivery accepts the shipment.',failure:'Delivery could not accept this attempt. Arrange another delivery time; the order remains active.'},
 'delivery:verify_delivery':{name:'Delivery confirmation',success:'Delivery verifies receipt with proof.',failure:'Delivery records a failed attempt. The order remains active for redelivery; payment is retained.'},
 'billing:cancel':{name:'Cancellation payment check',success:'Billing verifies the payment request is cancelled and unpaid.',failure:'Billing reports payment was received. Cancellation cannot complete; the sales team must reconcile the payment.'},
 'inventory:release':{name:'Stock release',success:'Inventory verifies that no active or future reservations remain.'}
};
export function processingStage(order,requests,demo){
 const end=processingEnd(order);
 if(issueState(order).status==='resolved')return {stage:'Issue resolved',guidance:end.explanation,condition:end.title,processing_finished:true,resolution_pending:false,options:[],version:order.version,can_query:false,unresolved:false,terminal:true};
 const resolutionPending=requests.some(r=>!['done','blocked'].includes(r.status)&&((r.service==='billing'&&r.action==='cancel')||(r.service==='inventory'&&r.action==='release')));
 if(end.finished)return {stage:'Processing ended',guidance:end.explanation,condition:end.title,processing_finished:true,resolution_pending:resolutionPending,options:[],request_reference:null,version:order.version,integrated:!demo,can_query:false,unresolved:Boolean(order.reconciliation),terminal:true};
 const scheduled=order.shipment==='failed'&&requests.find(r=>r.service==='delivery'&&!['done','blocked'].includes(r.status)&&Number(r.lease_until)>Date.now());
 if(scheduled&&!demo)return {stage:'Redelivery scheduled',guidance:'Waiting for the agreed redelivery time. Open order details for the schedule and customer conversation.',options:[],version:order.version,can_query:false,terminal:false};
 const terminal=['draft','completed','cancelled'].includes(order.order_status);
 const actionable=r=>{
  if(terminal||['done','blocked'].includes(r.status))return false;
  const scheduledDemo=demo&&r.status==='pending'&&r.service==='delivery'&&JSON.parse(r.payload||'{}').redelivery===true;
  if(Number(r.lease_until)>Date.now()&&!scheduledDemo)return false;
  const pair=r.service+':'+r.action;
  if(['billing:cancel','inventory:release'].includes(pair))return order.order_status==='cancellation_pending'||Boolean(order.reconciliation);
  if(order.order_status==='cancellation_pending'||order.reconciliation||stockExpired(order))return false;
  return ({'inventory:reserve':order.order_status==='pending_stock'&&order.stock==='none','billing:invoice':(isCod(order)?order.order_status==='pending_stock':order.order_status==='awaiting_payment')&&order.stock==='reserved'&&!order.invoice_reference,'billing:verify':(isCod(order)?order.order_status==='fulfilling'&&order.shipment==='delivered':order.order_status==='awaiting_payment')&&Boolean(order.invoice_reference)&&order.payment!=='verified','inventory:confirm':(isCod(order)?order.order_status==='pending_stock':order.order_status==='awaiting_payment')&&confirmationPaymentReady(order),'delivery:accept':order.order_status==='confirmed'&&shipmentPaymentReady(order),'delivery:verify_delivery':order.order_status==='fulfilling'&&['accepted','failed'].includes(order.shipment)&&shipmentPaymentReady(order)})[pair];
 };
 const r=requests.find(actionable),pair=r&&r.service+':'+r.action,baseStage=processingStages[pair],stage=isCod(order)&&pair==='billing:invoice'?{name:'COD arrangement',success:'Billing prepares the amount to collect on delivery.'}:isCod(order)&&pair==='billing:verify'?{name:'COD collection verification',success:'Billing verifies the exact amount collected after delivery.',failure:'Collection was not verified. Delivery remains recorded; payment requires reconciliation.'}:isCod(order)&&pair==='inventory:confirm'?{...baseStage,success:'Inventory confirms stock for the COD shipment. No advance payment is required.',failure:'Inventory reports expired stock. Shipment stops; request eligible cancellation.'}:baseStage;
 const options=[];
 const retry=order.shipment==='failed'&&['confirmed','fulfilling'].includes(order.order_status)&&shipmentPaymentReady(order)&&['confirmed','fulfilled'].includes(order.stock)&&(!order.reconciliation||order.reconciliation.startsWith('Delivery failed.')||order.reconciliation.startsWith('Shipment acceptance failed.'))&&!requests.some(x=>x.service==='delivery'&&!['done','blocked'].includes(x.status));
 if(retry&&demo)options.push({value:'successful',label:'Successful',explanation:'Record a new successful delivery attempt. Previous failed attempts and verified payments remain in history.'},{value:'unsuccessful',label:'Attempt failed — retry again',explanation:'Record another failed attempt. The order stays active and can be retried again.'});
 if(retry)options.push({value:'reattempt',label:'Reattempt delivery',explanation:'Record the agreed next delivery time. The order stays active and retains any verified payment. When the attempt is due, record its verified result here.'});
 if(demo&&r){options.push({value:'successful',label:'Successful',explanation:stage.success});if(stage.failure)options.push({value:'unsuccessful',label:r.service==='delivery'?'Attempt failed — reschedule':'Unsuccessful',explanation:stage.failure});}
 if(!terminal&&canCancel(order))options.push({value:'cancel',label:'Cancel order',explanation:'Request cancellation. Submitted orders remain pending until payment checks and stock release are verified.'});
 let fallback=order.shipment==='failed'?'Delivery needs rescheduling':'Processing paused',guidance=order.shipment==='failed'&&!r?'Choose Reattempt delivery to record the agreed next delivery time.':'';
 if(stockExpired(order)||order.stock==='expired'){
  fallback='Reservation expired';
  guidance=canCancel(order)?'The stock reservation has expired. Payment and delivery cannot continue. Cancel this unpaid order, then create a new order to check stock again.':'The stock reservation has expired. Processing is paused. Contact the sales team to reconcile any verified payment.';
 }else if(order.stock==='rejected'){
  fallback='Stock unavailable';guidance='Stock was rejected. Payment and delivery cannot continue. Cancel this unpaid order before creating a new order.';
 }else if(order.payment==='failed'){
  fallback='Payment unsuccessful';guidance=isCod(order)?'COD collection was not verified after delivery. Contact the sales team and Billing to resolve the payment. This delivered order cannot be cancelled through this workflow.':'Payment failed. There is no automatic retry. Complete stock release and request cancellation before creating a new order.';
 }else if(order.shipment==='failed'&&!r){
  fallback='Delivery needs rescheduling';guidance=retry?'Choose Reattempt delivery below to schedule another attempt.': 'Delivery is paused. Review stock and payment issues before arranging another attempt.';
 }else if(order.order_status==='cancellation_pending'){
  fallback='Cancellation checks';guidance=order.payment==='verified'?'Payment was received. Cancellation cannot complete until the sales team reconciles the payment.':'Cancellation is waiting for verified payment checks and stock release.';
 }else if(order.reconciliation){
  guidance='Processing needs review. Open order details for the recorded outcome and any available next action.';
 }else if(terminal){
  fallback={draft:'Draft',completed:'Completed',cancelled:'Cancelled'}[order.order_status];
 }else if(!r){
  guidance='No processing result can be applied right now. Refresh to check for an update or open the order details.';
 }
 return {stage:scheduled&&demo?'Redelivery scheduled':stage?.name||fallback,guidance:scheduled&&demo?'Record the result only after the delivery attempt has actually happened. Successful verifies this attempt; a failed attempt keeps the order open for another retry.':guidance,options,request_reference:r?.request_reference||null,version:order.version,integrated:!demo,can_query:!demo&&Boolean(r),unresolved:Boolean(r?.last_error),terminal};
}
