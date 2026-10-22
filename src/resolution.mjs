import {issueState,issueRequirements} from '../public/ui.mjs';
import {createHash} from 'node:crypto';
import {insist,text,money,decimal,now} from './util.mjs';
export const resolutionSchema=(mysql=false)=>[
 `CREATE TABLE IF NOT EXISTS sales_resolution (order_id INTEGER PRIMARY KEY, record_json TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS sales_resolution_history (request_id VARCHAR(100) PRIMARY KEY, order_id INTEGER NOT NULL, action VARCHAR(40) NOT NULL, actor_id INTEGER NOT NULL, actor_role VARCHAR(30) NOT NULL, details TEXT NOT NULL, created_at VARCHAR(40) NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS sales_refund_record (reference VARCHAR(100) PRIMARY KEY, order_id INTEGER NOT NULL, amount VARCHAR(30) NOT NULL, method VARCHAR(40) NOT NULL, evidence TEXT NOT NULL, actor_id INTEGER NOT NULL, created_at VARCHAR(40) NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS sales_return_stock (order_id INTEGER PRIMARY KEY, reference VARCHAR(100) NOT NULL UNIQUE, mode VARCHAR(30) NOT NULL, evidence TEXT NOT NULL, created_at VARCHAR(40) NOT NULL)`
];
export async function resolution(q,o){
 const [row]=await q('SELECT record_json FROM sales_resolution WHERE order_id=?',[o.order_id]);
 const r=row?JSON.parse(row.record_json):{version:0,refund_status:'none',return_status:'none',stock_status:'none'};
 const refunds=await q('SELECT * FROM sales_refund_record WHERE order_id=? ORDER BY created_at',[o.order_id]);
 const paid=o.payment==='verified'?money(o.order_total):0,refunded=refunds.reduce((n,x)=>n+money(x.amount),0);
 const obligation=paid>0&&(r.cancel_accepted||r.fulfillment_stopped||['cancelled','cancellation_pending'].includes(o.order_status));
 const remaining=obligation?Math.max(0,paid-refunded):0;
 if(remaining&&['none','recorded'].includes(r.refund_status))r.refund_status='required';
 if(obligation&&!remaining)r.refund_status='recorded';
 if(!paid)r.refund_status='none';
 const releasePending=Boolean((r.cancel_accepted&&r.return_status==='none'||r.return_status==='not_dispatched')&&['reserved','confirmed'].includes(o.stock));
 if(r.return_status==='not_dispatched'&&o.stock==='released')r.stock_status='released';
 const history=await q('SELECT request_id,action,actor_id,actor_role,details,created_at FROM sales_resolution_history WHERE order_id=? ORDER BY created_at,request_id',[o.order_id]);
 const issue=issueState(o,{...r,refundable_amount:decimal(remaining),release_pending:releasePending});
 return {...r,issue_status:issue.status,issue_requirements:issue.requirements,issue_reopened:issue.reopened,issue_eligible:Boolean(issue.outcome),paid_amount:decimal(paid),refunded_amount:decimal(refunded),refundable_amount:decimal(remaining),refunds,history,order_version:o.version,payment_method:o.payment_method,invoice_reference:o.invoice_reference,transaction_reference:o.transaction_reference,release_pending:releasePending,needs_resolution:issue.status!=='resolved'&&(Boolean(issue.outcome)||releasePending||remaining>0||['required','in_transit','issue'].includes(r.return_status)||r.stock_status==='inventory_pending'||r.stock_status==='condition_review')};
}
const rights={mark_resolved:['staff'],accept_cancel:['staff'],refund_start:['staff','billing'],refund_fail:['staff','billing'],refund_record:['staff','billing'],return_required:['staff','delivery'],return_transit:['delivery'],return_receive:['inventory','seller'],stock_record:['inventory']};
export function resolutionActions(r,o,user,demo){
 if(!rights.accept_cancel.includes(user.role)&&!['billing','delivery','inventory','seller'].includes(user.role))return [];
 if(r.issue_status==='resolved')return [];
 const actions=[];
 if(r.issue_eligible)actions.push('mark_resolved');
 if(!r.cancel_accepted&&!r.fulfillment_stopped&&o.order_date&&o.order_status!=='completed')actions.push('accept_cancel');
 if(Number(r.refundable_amount)>0&&(r.cancel_accepted||r.fulfillment_stopped||o.order_status==='cancelled')){if(r.refund_status!=='processing')actions.push('refund_start');if(r.refund_status==='processing')actions.push('refund_fail','refund_record');}
 if(r.return_status==='none'&&o.order_date&&(o.shipment==='failed'||o.payment_method==='cod'&&o.payment==='failed'&&o.shipment==='delivered'))actions.push('return_required');
 if(r.return_status==='required')actions.push('return_transit');
 if(['in_transit','issue'].includes(r.return_status)||r.return_status==='received'&&r.stock_status==='condition_review')actions.push('return_receive');
 if(r.return_status==='received'&&r.condition==='saleable'&&r.stock_status==='inventory_pending')actions.push('stock_record');
 return actions.filter(a=>rights[a].includes(user.role)||demo&&user.role==='staff'&&['return_transit','return_receive','stock_record'].includes(a));
}
export async function changeResolution(sales,id,data,user){
 const {db}=sales;
 insist(Object.hasOwn(rights,data.action),'Unknown resolution action.');
 insist(rights[data.action].includes(user.role)||db.demo&&user.role==='staff'&&['return_transit','return_receive','stock_record'].includes(data.action),'This action requires the responsible Billing, Delivery, or Inventory role.',403);
 const requestId=text(data.request_id,'Action reference',100);
 return db.tx(async q=>{
  const o=await sales.owned(q,id,user.role==='customer'?user:{role:'staff'});
  insist(o.order_status!=='draft','Drafts have no resolution workflow.',409);
  const [seen]=await q('SELECT * FROM sales_resolution_history WHERE request_id=?',[requestId]);
  if(seen){insist(seen.order_id===id&&seen.details===JSON.stringify(data),'Conflicting repeated action.',409);return resolution(q,o);}
  const r=await resolution(q,o);
  insist(data.version===r.version&&data.order_version===o.version,'Order or resolution changed. Refresh and review before saving.',409);
  insist(resolutionActions(r,o,user,db.demo).includes(data.action),'This action is unavailable for the current state.',409);
  const reason=text(data.reason,'Reason / evidence',2000),stamp=now();
  if(data.action==='mark_resolved'){
   insist(data.confirmed===true,'Confirm that the issue is resolved.');
   const requirements=issueRequirements(o,r),dispositions=data.dispositions||{};
   for(const item of requirements){
    const entry=dispositions[item.key];
    insist(entry&&['externally_completed','not_applicable'].includes(entry.status),item.label+' Complete its resolution action or document why it is not applicable / externally completed.',409);
    text(entry.note,item.key+' resolution explanation',1000);text(entry.reference,item.key+' external reference or evidence',150);
   }
   r.issue_closed=true;r.issue_closed_version=o.version+1;r.issue_outcome=issueState(o,r).outcome;
   r.issue_note=reason;r.issue_reference=typeof data.reference==='string'?data.reference.trim().slice(0,150):'';r.issue_admin_id=user.user_id;r.issue_at=stamp;r.issue_dispositions=Object.fromEntries(requirements.map(x=>[x.key,dispositions[x.key]]));
  }
  if(data.action==='accept_cancel'){
   insist(data.confirmed===true,'Confirm acceptance of this cancellation.');
   r.cancel_accepted=true;r.reason=reason;r.cancelled_at=stamp;
   await q('UPDATE sales_order SET order_status=?,cancellation_reason=?,updated_at=? WHERE order_id=?',['cancelled',reason,stamp,id]);
   await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,actor_reference,reason) VALUES (?,?,?,?,?,?)',[id,o.order_status,'cancelled','sales',String(user.user_id),'Cancellation accepted: '+reason]);
   o.order_status='cancelled';await sales.stopWork(q,o);
   if(['accepted','delivered','failed'].includes(o.shipment)){await q("UPDATE sales_outbox SET status='blocked',lease_until=0 WHERE order_id=? AND service='inventory' AND action='release' AND status<>'done'",[id]);r.return_status='required';r.return_reason=reason;r.return_required_at=stamp;}
   else if(['reserved','confirmed'].includes(o.stock))await sales.enqueue(q,id,'inventory','release');
   if(o.payment!=='verified')await sales.enqueue(q,id,'billing','cancel');
   await sales.notify(q,o,'cancel-accepted-'+createHash('sha256').update(requestId).digest('hex').slice(0,20),'Cancellation accepted. '+(o.payment==='verified'?'Refund required: PHP '+o.order_total+'.':'No verified payment — no refund required.'));
  }
  if(data.action==='refund_start'){r.refund_status='processing';r.refund_method=text(data.method,'Refund method',40);r.refund_reason=reason;r.refund_started_at=stamp;}
  if(data.action==='refund_fail'){r.refund_status='failed';r.refund_failure=reason;}
  if(data.action==='refund_record'){
   insist(data.confirmed===true,'Confirm that the refund was completed outside this application.');
   const amount=money(data.amount);insist(amount>0&&amount<=money(r.refundable_amount),'Refund exceeds the remaining refundable amount or is zero.');
   const ref=text(data.reference,'Refund transaction reference',100);const [existing]=await q('SELECT reference FROM sales_refund_record WHERE reference=?',[ref]);insist(!existing,'This refund reference was already recorded.',409);
   await q('INSERT INTO sales_refund_record (reference,order_id,amount,method,evidence,actor_id,created_at) VALUES (?,?,?,?,?,?,?)',[ref,id,decimal(amount),r.refund_method,reason,user.user_id,stamp]);
   r.refund_status=amount===money(r.refundable_amount)?'recorded':'required';r.refund_recorded_at=stamp;
  }
  if(data.action==='return_required'){
   insist(data.confirmed===true,'Confirm normal fulfillment should stop and goods should return.');
   if(o.shipment==='delivered'){
    insist(data.not_received===true,'Delivery is recorded as successful. Confirm with Delivery evidence that the customer did not receive these goods.');
    text(data.reference,'Delivery correction reference',100);
    await q("UPDATE sales_order_facts SET shipment='failed' WHERE order_id=?",[id]);o.shipment='failed';
    await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,actor_reference,reason) VALUES (?,?,?,?,?,?)',[id,o.order_status,o.order_status,'delivery_manual',String(user.user_id),'Delivery outcome corrected from delivered to failed using evidence '+data.reference+'. '+reason]);
   }
   r.fulfillment_stopped=true;r.return_reason=reason;r.return_required_at=stamp;
   if(o.order_status==='confirmed'&&!o.tracking_reference){r.return_status='not_dispatched';r.stock_status='release_pending';if(['reserved','confirmed'].includes(o.stock))await sales.enqueue(q,id,'inventory','release');}
   else r.return_status='required';
   await sales.stopWork(q,o);
  }
  if(data.action==='return_transit'){r.return_status='in_transit';r.return_reference=text(data.reference,'Return tracking / handover reference',100);r.return_party=text(data.party,'Responsible delivery party',150);r.return_transit_at=stamp;}
  if(data.action==='return_receive'){
   insist(data.confirmed===true,'Confirm the receipt and condition evidence.');
   insist(['saleable','damaged','missing'].includes(data.condition),'Choose the received condition.');
   r.condition=data.condition;r.receipt_reference=text(data.reference,'Receipt evidence reference',100);r.inspected_at=stamp;if(data.condition!=='missing')r.received_at=stamp;r.received_by=user.user_id;
   r.return_status=data.condition==='missing'?'issue':'received';r.stock_status=data.condition==='saleable'?'inventory_pending':'condition_review';
   if(data.condition==='saleable'&&db.demo){
    const [existing]=await q('SELECT order_id FROM sales_return_stock WHERE order_id=?',[id]);
    if(!existing)await q('INSERT INTO sales_return_stock (order_id,reference,mode,evidence,created_at) VALUES (?,?,?,?,?)',[id,'DEMO-RESTORE-'+id,'demo',reason,stamp]);
    r.stock_status='demo_restored';
   }
  }
  if(data.action==='stock_record'){
   insist(data.confirmed===true,'Confirm Inventory has restored eligible stock outside this application.');
   const ref=text(data.reference,'Inventory restoration reference',100);const [existing]=await q('SELECT order_id FROM sales_return_stock WHERE order_id=? OR reference=?',[id,ref]);insist(!existing,'Stock restoration was already recorded.',409);
   await q('INSERT INTO sales_return_stock (order_id,reference,mode,evidence,created_at) VALUES (?,?,?,?,?)',[id,ref,'manual_inventory',reason,stamp]);r.stock_status='restoration_recorded';
  }
  r.version++;r.updated_at=stamp;
  // Store only resolution fields; payment totals and action history are always recomputed from source records.
  const {paid_amount,refunded_amount,refundable_amount,refunds,history,order_version,payment_method,invoice_reference,transaction_reference,needs_resolution,release_pending,issue_status,issue_requirements,issue_reopened,issue_eligible,...stored}=r;
  const [existing]=await q('SELECT order_id FROM sales_resolution WHERE order_id=?',[id]);
  if(existing)await q('UPDATE sales_resolution SET record_json=? WHERE order_id=?',[JSON.stringify(stored),id]);else await q('INSERT INTO sales_resolution (order_id,record_json) VALUES (?,?)',[id,JSON.stringify(stored)]);
  await q('INSERT INTO sales_resolution_history (request_id,order_id,action,actor_id,actor_role,details,created_at) VALUES (?,?,?,?,?,?,?)',[requestId,id,data.action,user.user_id,user.role,JSON.stringify(data),stamp]);
  await q('UPDATE sales_order_facts SET version=version+1 WHERE order_id=?',[id]);o.version++;
  await q('UPDATE sales_order SET updated_at=? WHERE order_id=?',[stamp,id]);
  const result=await resolution(q,o);
  if(data.action!=='accept_cancel')await sales.notify(q,o,'resolution-'+createHash('sha256').update(requestId).digest('hex').slice(0,24),({mark_resolved:'Issue resolved. The original order outcome and payment / delivery history are preserved. ',refund_start:'Refund processing. The application does not transfer money.',refund_fail:'Refund failed; Billing must retry. ',refund_record:'Refund recorded from external payment evidence. ',return_required:'Fulfillment stopped. Return to seller required. ',return_transit:'Goods are returning to the seller. ',return_receive:'Return receipt / condition recorded. ',stock_record:'Inventory restoration recorded from external evidence. '})[data.action]+reason);
  return result;
 });
}
