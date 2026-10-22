import {insist,money} from './util.mjs';
import {issueOutcome} from '../public/ui.mjs';
const DAY=86400000;
export const businessZone='Asia/Manila';
const businessDate=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:businessZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const utcTime=value=>typeof value==='string'?Date.parse(value.includes('T')?value:value.replace(' ','T')+'Z'):NaN;
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function overviewPeriod(filters={},clock=Date.now()){
 const today=businessDate(clock),preset=filters.period||'month';let from,to;
 insist(['today','7days','month','custom'].includes(preset),'Choose a valid reporting period.');
 if(preset==='today')from=to=today;
 if(preset==='7days'){from=shift(today,-6);to=today;}
 if(preset==='month'){from=today.slice(0,7)+'-01';to=today;}
 if(preset==='custom'){from=filters.from;to=filters.to;}
 insist(validDate(from)&&validDate(to)&&from<=to,'Choose valid start and end dates in order.');
 const start=Date.parse(from+'T00:00:00+08:00'),end=Date.parse(shift(to,1)+'T00:00:00+08:00');
 insist(end-start<=36600*DAY,'Choose a reporting range of at most 100 years.');
 return {preset,from,to,start,end,timezone:businessZone,grouping:(end-start)/DAY>90?'monthly':'daily'};
}
const amount=cents=>(cents<0?'-':'')+Math.floor(Math.abs(cents)/100)+'.'+String(Math.abs(cents)%100).padStart(2,'0');
const sum=(a,b)=>{const result=a+b;insist(Number.isSafeInteger(result),'Report total exceeds supported monetary precision.');return result;};
export function calculateOverview({orders,events,history,refunds,items},period){
 const inside=value=>{const t=utcTime(value);return Number.isFinite(t)&&t>=period.start&&t<period.end;};
 const scoped=new Map(orders.map(o=>[o.order_id,o]));const paid=new Map(),completedAt=new Map();let unmappedPayments=0,unmappedCompletions=0;
 for(const e of events){const o=scoped.get(e.order_id);if(!o||o.payment!=='verified')continue;let p;try{p=JSON.parse(e.payload);}catch{continue;}
  if(!['verified','paid'].includes(p.status)||p.currency!=='PHP'||!p.transaction_reference||p.transaction_reference!==o.transaction_reference||String(p.amount)!==String(o.order_total)&&money(p.amount)!==money(o.order_total))continue;
  const t=utcTime(e.created_at);if(!Number.isFinite(t))continue;const old=paid.get(o.order_id);if(!old||t<old.time)paid.set(o.order_id,{time:t,created_at:e.created_at,cents:money(p.amount)});
 }
 for(const h of history){if(h.new_status!=='completed'||!Number.isFinite(utcTime(h.changed_at)))continue;const old=completedAt.get(h.order_id);if(!old||utcTime(h.changed_at)<utcTime(old))completedAt.set(h.order_id,h.changed_at);}
 const eligible=o=>o.order_status==='completed'&&o.payment==='verified'&&o.shipment==='delivered'&&!issueOutcome(o);
 for(const o of orders){if(o.payment==='verified'&&!paid.has(o.order_id))unmappedPayments++;if(eligible(o)&&!completedAt.has(o.order_id))unmappedCompletions++;}
 const completed=orders.filter(o=>eligible(o)&&inside(completedAt.get(o.order_id))).map(o=>({...o,completed_at:completedAt.get(o.order_id)}));
 const completedIds=new Set(completed.map(o=>o.order_id));
 const collected=[...paid.values()].filter(x=>inside(x.created_at));const refundIds=new Set(),selectedRefunds=[];
 for(const r of refunds){if(!scoped.has(r.order_id)||!inside(r.created_at)||refundIds.has(r.reference))continue;refundIds.add(r.reference);selectedRefunds.push(r);}
 const collectedCents=collected.reduce((n,x)=>sum(n,x.cents),0),refundCents=selectedRefunds.reduce((n,x)=>sum(n,money(x.amount)),0),completedCents=completed.reduce((n,o)=>sum(n,money(o.order_total)),0);
 const buckets=new Map();for(let day=period.from;day<=period.to;day=shift(day,1)){const key=period.grouping==='monthly'?day.slice(0,7):day;if(!buckets.has(key))buckets.set(key,0);}
 for(const x of collected){const day=businessDate(x.time),key=period.grouping==='monthly'?day.slice(0,7):day;buckets.set(key,sum(buckets.get(key)||0,x.cents));}
 const outcomes={active:0,completed:0,cancelled:0,unsuccessful:0};for(const o of orders){if(!inside(o.order_date))continue;const ended=issueOutcome(o);if(ended==='cancelled')outcomes.cancelled++;else if(ended==='unsuccessful')outcomes.unsuccessful++;else if(eligible(o))outcomes.completed++;else outcomes.active++;}
 const products=new Map();for(const i of items){if(!completedIds.has(i.order_id))continue;const key=String(i.product_id??'offer-'+i.offer_id),old=products.get(key)||{product_name:i.product_name_at_order,quantity:0,cents:0};old.quantity+=Number(i.quantity);old.cents=sum(old.cents,money(i.unit_price_at_order)*Number(i.quantity));products.set(key,old);}
 return {period,accounting_basis:'collections',cards:{payments_collected:amount(collectedCents),refunds_recorded:amount(refundCents),net_collections:amount(collectedCents-refundCents),completed_orders:completed.length},completed_sales:amount(completedCents),trend:[...buckets].map(([date,cents])=>({date,amount:amount(cents)})),outcomes,products:[...products.values()].sort((a,b)=>b.quantity-a.quantity||b.cents-a.cents||a.product_name.localeCompare(b.product_name)).slice(0,5).map(x=>({product_name:x.product_name,quantity:x.quantity,sales_amount:amount(x.cents)})),recent:completed.sort((a,b)=>utcTime(b.completed_at)-utcTime(a.completed_at)||b.order_id-a.order_id).slice(0,10).map(o=>({order_id:o.order_id,order_number:o.order_number,customer_name:o.customer_name,completed_at:o.completed_at,sales_amount:o.order_total,payment_status:o.payment})),limitations:{unmapped_payments:unmappedPayments,unmapped_completions:unmappedCompletions,refund_allocation:'Refunds are recorded per order, not per product. Product rankings show completed product sales before order-level refunds.',externally_documented_settlements:orders.filter(o=>o.payment!=='verified'&&JSON.parse(o.resolution_json||'{}').issue_dispositions?.payment?.status==='externally_completed').length},empty:collected.length===0&&selectedRefunds.length===0&&completed.length===0};
}
export async function salesOverview(db,user,filters={},clock=Date.now()){
 insist(user.role==='staff','Sales administrator access required.',403);
 const period=overviewPeriod(filters,clock);
 return db.tx(async q=>{
  // Sales staff have the existing global submitted-order scope. Customer and module-specific roles cannot enter analytics.
  const orders=await q("SELECT o.*,f.payment,f.shipment,f.transaction_reference,f.stock,c.customer_name,r.record_json AS resolution_json FROM sales_order o JOIN sales_order_facts f ON f.order_id=o.order_id JOIN customer c ON c.customer_id=o.customer_id LEFT JOIN sales_resolution r ON r.order_id=o.order_id WHERE o.order_status<>'draft' AND o.order_date IS NOT NULL");
  const events=await q("SELECT e.order_id,e.payload,e.created_at FROM sales_event e JOIN sales_order o ON o.order_id=e.order_id WHERE e.service='billing' AND o.order_status<>'draft' AND o.order_date IS NOT NULL");
  const history=await q("SELECT h.order_id,h.new_status,h.changed_at FROM order_status_history h JOIN sales_order o ON o.order_id=h.order_id WHERE h.new_status='completed' AND o.order_status<>'draft' AND o.order_date IS NOT NULL");
  const refunds=await q("SELECT r.reference,r.order_id,r.amount,r.created_at FROM sales_refund_record r JOIN sales_order o ON o.order_id=r.order_id WHERE o.order_status<>'draft' AND o.order_date IS NOT NULL");
  const items=await q("SELECT i.*,s.product_id FROM order_item i LEFT JOIN seller_offer s ON s.offer_id=i.offer_id JOIN sales_order o ON o.order_id=i.order_id WHERE o.order_status<>'draft' AND o.order_date IS NOT NULL");
  return calculateOverview({orders,events,history,refunds,items},period);
 });
}
