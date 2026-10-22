import { createHmac, timingSafeEqual } from 'node:crypto';
import { insist, uid } from './util.mjs';
export function signature(secret, timestamp, body) { return createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex'); }
export function authentic(secret, timestamp, body, supplied) {
  if(!secret || !/^\d+$/.test(timestamp||'') || Math.abs(Date.now()-Number(timestamp))>300000 || !/^[a-f0-9]{64}$/.test(supplied||'')) return false;
  return timingSafeEqual(Buffer.from(signature(secret,timestamp,body),'hex'),Buffer.from(supplied,'hex'));
}
export class Integrations {
  constructor(sales) { this.sales=sales; this.db=sales.db; }
  async dispatch(reference, user, outcome='success') {
    insist(user.role==='staff','Staff access required.',403);
    const request=await this.db.tx(async q=>{
      const [r]=await q('SELECT * FROM sales_outbox WHERE request_reference=?',[reference]);
      insist(r,'Request not found.',404);
      if(['done','blocked'].includes(r.status)) return null;
      insist(Number(r.lease_until)<Date.now(),'Request is being processed. Retry after its lease expires.',409);
      const order=await this.sales.owned(q,r.order_id,{role:'staff'});
      if(r.service==='delivery'&&r.action==='accept') insist(order.order_status==='confirmed'&&order.payment==='verified'&&this.sales.validStock(order)&&!order.reconciliation,'Fulfillment is blocked. Stock or payment requires reconciliation.',409);
      if(r.service==='billing'&&['invoice','verify'].includes(r.action)) insist(order.order_status==='awaiting_payment'&&this.sales.validStock(order)&&!order.reconciliation,'Billing is blocked. Stock or order state requires reconciliation.',409);
      await q("UPDATE sales_outbox SET status='processing',attempts=attempts+1,lease_until=? WHERE request_reference=?",[Date.now()+60000,reference]);
      return {...r,attempts:r.attempts+1};
    });
    if(!request) return {duplicate:true};
    try {
      const event=this.db.demo ? await this.simulate(request,outcome) : await this.remote(request);
      if(event?.status==='pending'||!event) {
        await this.db.tx(q=>q("UPDATE sales_outbox SET status='pending',last_error=?,lease_until=0 WHERE request_reference=? AND status='processing'",['Service result unresolved; retry uses the same reference.',reference]));
        return {pending:true};
      }
      return await this.sales.event(request.service,event);
    } catch(error) {
      await this.db.tx(q=>q("UPDATE sales_outbox SET status='pending',last_error=?,lease_until=0 WHERE request_reference=? AND status='processing'",[error.message.slice(0,1000),reference]));
      throw error;
    }
  }
  async remote(request) {
    const key=request.service.toUpperCase(), base=process.env[`${key}_URL`], secret=process.env[`${key}_SECRET`];
    insist(base&&secret,`${request.service} is not configured. No simulation is used.`,503);
    const url=new URL(base);
    insist(url.protocol==='https:' || (process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(url.hostname)),'Integration URLs must use HTTPS.');
    const call=async(method,path,body='')=>{
      const timestamp=String(Date.now());
      const response=await fetch(new URL(path,base.endsWith('/')?base:base+'/'),{method,headers:{'content-type':'application/json','x-sales-timestamp':timestamp,'x-sales-signature':signature(secret,timestamp,body),'idempotency-key':request.request_reference},body:method==='POST'?body:undefined,signal:AbortSignal.timeout(10000),redirect:'error'});
      const raw=await response.text();
      insist(raw.length<1000000,'Service response exceeds the supported limit.',502);
      insist(authentic(secret,response.headers.get('x-sales-timestamp'),raw,response.headers.get('x-sales-signature')),'Unverified integration response.',502);
      if(response.status===404) return {notFound:true};
      insist(response.ok,'Integration service returned an error.',502);
      return JSON.parse(raw);
    };
    // Every retry queries the original request before resending its immutable payload.
    const found=await call('GET',`requests/${encodeURIComponent(request.request_reference)}`);
    if(!found.notFound) return found;
    return call('POST',`requests/${request.action}`,request.payload);
  }
  async simulate(request,outcome) {
    insist(this.db.demo,'Simulators are available only in explicit demo mode.',403);
    insist(['success','timeout','reject','expired','paid'].includes(outcome),'Invalid simulator outcome.');
    if(outcome==='timeout') return {status:'pending'};
    return this.db.tx(async q=>{
      const [previous]=await q('SELECT response FROM sales_simulator_result WHERE request_reference=?',[request.request_reference]);
      if(previous) return JSON.parse(previous.response);
      const p=JSON.parse(request.payload), order=await this.sales.owned(q,request.order_id,{role:'staff'});
      const e={event_reference:`sim:${uid()}`,request_reference:request.request_reference,order_id:request.order_id,simulated:true};
      const pair=`${request.service}:${request.action}`;
      if(pair==='inventory:reserve') {
        const [released]=await q("SELECT request_reference FROM sales_outbox WHERE order_id=? AND service='inventory' AND action='release' AND status='done'",[order.order_id]);
        if(outcome==='reject'||released) Object.assign(e,{status:'rejected',short_items:p.items.map(i=>({offer_id:i.offer_id,quantity:i.quantity}))});
        else Object.assign(e,{status:'reserved',expires_at:Date.now()+30*60*1000,reservations:p.items.map(i=>({order_item_id:i.order_item_id,offer_id:i.offer_id,quantity:i.quantity,reservation_id:`SIM-R-${i.order_item_id}`}))});
      } else if(pair==='billing:invoice') Object.assign(e,{status:'created',invoice_reference:`SIM-INV-${p.order_id}`,amount:p.product_total,currency:'PHP'});
      else if(pair==='billing:verify') Object.assign(e,{status:outcome==='reject'?'failed':'verified',invoice_reference:order.invoice_reference,amount:p.product_total,currency:'PHP',transaction_reference:`SIM-TXN-${p.order_id}`});
      else if(pair==='inventory:confirm') Object.assign(e,{status:outcome==='expired'||!this.sales.validStock(order)?'expired':'confirmed',expires_at:null,reservations:JSON.parse(order.reservation_json||'[]')});
      else if(pair==='delivery:accept') Object.assign(e,{status:'accepted',tracking_reference:`SIM-TRACK-${p.order_id}`,order_item_ids:p.items.map(i=>i.order_item_id)});
      else if(pair==='delivery:verify_delivery') Object.assign(e,{status:'delivered',tracking_reference:order.tracking_reference,proof_reference:`SIM-POD-${p.order_id}`});
      else if(pair==='billing:cancel') Object.assign(e,{status:order.payment==='verified'||outcome==='paid'?'paid':'cancelled_unpaid',amount:p.product_total,currency:'PHP',invoice_reference:order.invoice_reference||`SIM-INV-${p.order_id}`,transaction_reference:order.transaction_reference||`SIM-TXN-${p.order_id}`});
      else if(pair==='inventory:release') Object.assign(e,{status:'released',no_active_reservations:true});
      else throw new Error('Unknown simulator request.');
      await q('INSERT INTO sales_simulator_result (request_reference,response) VALUES (?,?)',[request.request_reference,JSON.stringify(e)]);
      return e;
    });
  }
}


