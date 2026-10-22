import {resolution} from './resolution.mjs';
import {processingEnd,needsAttention,issueOutcome} from '../public/ui.mjs';
import {isCod,paymentMethods,shipmentPaymentReady,confirmationPaymentReady} from './payment.mjs';
import { insist, text, money, decimal, uid, now, Problem, canonicalEvent, sameReservations, sameItemIds, reservationIdentity } from './util.mjs';
const STATES = ['draft','pending_stock','awaiting_payment','confirmed','fulfilling','completed','cancellation_pending','cancelled'];
const ALLOWED = {draft:['pending_stock','cancelled'],pending_stock:['awaiting_payment','confirmed','cancellation_pending'],awaiting_payment:['confirmed','cancellation_pending'],confirmed:['fulfilling','cancellation_pending'],fulfilling:['completed'],cancellation_pending:['cancelled'],cancelled:['cancellation_pending']};
export class Sales {
  constructor(db) { this.db = db; }
  async notify(q,order,kind,message) {
    const key=`order:${order.order_id}:${kind}`;
    const [existing]=await q('SELECT notification_id FROM sales_notification WHERE notification_key=?',[key]);
    if(!existing)await q('INSERT INTO sales_notification (notification_key,customer_id,order_id,kind,message,created_at) VALUES (?,?,?,?,?,?)',[key,order.customer_id,order.order_id,kind,message,now()]);
  }
  async notifications(user) {
    insist(user.role==='customer','Customer access required.',403);
    return this.db.tx(q=>q('SELECT n.*,o.order_number FROM sales_notification n JOIN sales_order o ON o.order_id=n.order_id WHERE n.customer_id=? AND o.customer_id=? ORDER BY n.notification_id DESC',[user.customer_id,user.customer_id]));
  }
  async readNotification(id,user) {
    insist(user.role==='customer','Customer access required.',403);
    return this.db.tx(async q=>{
      const [row]=await q('SELECT n.notification_id FROM sales_notification n JOIN sales_order o ON o.order_id=n.order_id WHERE n.notification_id=? AND n.customer_id=? AND o.customer_id=?',[id,user.customer_id,user.customer_id]);
      insist(row,'Notification not found.',404);
      await q('UPDATE sales_notification SET read_at=COALESCE(read_at,?) WHERE notification_id=?',[now(),id]);
      return {ok:true};
    });
  }
  async inbox(user) {
    insist(user.role==='staff','Staff access required.',403);
    return this.db.tx(q=>q(`SELECT o.order_id,o.order_number,c.customer_name,m.body,m.created_at,m.sender_role FROM sales_order_message m JOIN sales_order o ON o.order_id=m.order_id JOIN customer c ON c.customer_id=o.customer_id WHERE o.order_status<>'draft' AND m.message_id=(SELECT MAX(x.message_id) FROM sales_order_message x WHERE x.order_id=m.order_id) ORDER BY CASE WHEN m.sender_role='customer' THEN 0 ELSE 1 END,m.message_id DESC`));
  }
  async message(id,data,user) {
    const body=text(data.body,'Message',2000);
    return this.db.tx(async q=>{
      const o=await this.owned(q,id,user);
      const result=await q('INSERT INTO sales_order_message (order_id,sender_role,sender_id,body,created_at) VALUES (?,?,?,?,?)',[id,user.role,user.user_id,body,now()]);
      if(user.role==='staff')await this.notify(q,o,'reply-'+result.insertId,'Sales replied: '+body);
      return {message_id:result.insertId};
    });
  }
  async deliveryUpdate(id,data,user) {
    insist(user.role==='staff','Staff access required.',403);
    const reason=text(data.reason,'Delivery update',1000);
    insist(['delayed','resumed'].includes(data.kind),'Choose a delivery update.');
    const parse=(value,name)=>{
      if(!value)return null;
      insist(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now(),name+' must be a future date and time.');
      return new Date(value).toISOString();
    };
    const eta=parse(data.estimated_at,'Delivery estimate'),next=parse(data.next_update_at,'Next update');
    return this.db.tx(async q=>{
      const o=await this.owned(q,id,user);
      insist(['confirmed','fulfilling'].includes(o.order_status)&&!processingEnd(o).finished&&!o.reconciliation&&o.shipment!=='delivered','Delivery updates require an active order awaiting delivery.',409);
      const [previous]=await q('SELECT kind FROM sales_delivery_update WHERE order_id=? ORDER BY update_id DESC LIMIT 1',[id]);
      insist(data.kind!=='resumed'||previous?.kind==='delayed','There is no active delay to clear.',409);
      const result=await q('INSERT INTO sales_delivery_update (order_id,kind,reason,estimated_at,next_update_at,actor_id,created_at) VALUES (?,?,?,?,?,?,?)',[id,data.kind,reason,eta,next,user.user_id,now()]);
      const message=(data.kind==='delayed'?'Delivery delayed: ':'Delivery delay cleared: ')+reason+(eta?' Estimated delivery: '+eta: data.kind==='delayed'?' Awaiting an updated delivery estimate.':'')+(next?' Next update by '+next:'');
      await this.notify(q,o,'delivery-update-'+result.insertId,message);
      return {update_id:result.insertId};
    });
  }
  async reschedule(id,data,user){
    insist(user.role==='staff','Staff access required.',403);
    const reason=text(data.reason,'Agreed redelivery details',1000);
    insist(typeof data.scheduled_at==='string'&&Number.isFinite(Date.parse(data.scheduled_at))&&Date.parse(data.scheduled_at)>Date.now(),'Choose a future redelivery date and time.');
    return this.db.tx(async q=>{
      const o=await this.owned(q,id,user);
      insist(o.version===data.version,'Order changed. Refresh before scheduling.',409);
      insist(o.shipment==='failed'&&['confirmed','fulfilling'].includes(o.order_status)&&!processingEnd(o).finished&&shipmentPaymentReady(o)&&['confirmed','fulfilled'].includes(o.stock),'This order cannot be scheduled for redelivery.',409);
      insist(!o.reconciliation||o.reconciliation.startsWith('Delivery failed.')||o.reconciliation.startsWith('Shipment acceptance failed.'),'Other service issues require review first.',409);
      const [pending]=await q("SELECT request_reference FROM sales_outbox WHERE order_id=? AND service='delivery' AND status NOT IN ('done','blocked')",[id]);
      insist(!pending,'Redelivery is already scheduled.',409);
      const scheduled=new Date(data.scheduled_at).toISOString();
      const r=await q('INSERT INTO sales_delivery_update (order_id,kind,reason,estimated_at,next_update_at,actor_id,created_at) VALUES (?,?,?,?,?,?,?)',[id,'rescheduled',reason,scheduled,null,user.user_id,now()]);
      await q('UPDATE sales_order_facts SET reconciliation=NULL,version=version+1 WHERE order_id=?',[id]);
      const action=o.order_status==='confirmed'?'accept':'verify_delivery';
      await this.enqueue(q,id,'delivery',action,':attempt-'+r.insertId,{redelivery:true,scheduled_at:scheduled});
      await q('UPDATE sales_outbox SET lease_until=? WHERE request_reference=?',[Date.parse(scheduled),`sales:${id}:delivery:${action}:attempt-${r.insertId}`]);
      await this.notify(q,o,'redelivery-'+r.insertId,'Redelivery scheduled for '+scheduled+'. '+reason);
      await q('UPDATE sales_order SET updated_at=? WHERE order_id=?',[now(),id]);
      return {order_id:id};
    });
  }
  async prepareRetry(id,version,user){
    insist(this.db.demo&&user.role==='staff','Demo staff access required.',403);
    return this.db.tx(async q=>{
      const o=await this.owned(q,id,user);
      insist(o.version===version,'Order changed. Refresh before recording the attempt.',409);
      insist(o.shipment==='failed'&&['confirmed','fulfilling'].includes(o.order_status)&&!processingEnd(o).finished&&shipmentPaymentReady(o)&&['confirmed','fulfilled'].includes(o.stock),'This order is not eligible for another delivery attempt.',409);
      insist(!o.reconciliation||o.reconciliation.startsWith('Delivery failed.')||o.reconciliation.startsWith('Shipment acceptance failed.'),'Other issues require review first.',409);
      const [pending]=await q("SELECT request_reference FROM sales_outbox WHERE order_id=? AND service='delivery' AND status NOT IN ('done','blocked')",[id]);
      insist(!pending,'Another attempt is already pending. Refresh.',409);
      await q('UPDATE sales_order_facts SET reconciliation=NULL,version=version+1 WHERE order_id=?',[id]);
      const action=o.order_status==='confirmed'?'accept':'verify_delivery',suffix=':attempt-'+uid();
      await this.enqueue(q,id,'delivery',action,suffix,{redelivery:true,scheduled_at:new Date().toISOString()});
      return {request_reference:`sales:${id}:delivery:${action}${suffix}`,action,service:'delivery'};
    });
  }
  async orderAgain(id,user){
    const old=await this.detail(id,user);
    insist(processingEnd(old).finished||old.order_status==='completed','Use the existing active order instead.',409);
    const offers=await this.offers();
    const items=old.items.filter(i=>offers.some(o=>o.offer_id===i.offer_id&&o.seller_id===old.seller_id)).map(i=>({offer_id:i.offer_id,quantity:i.quantity}));
    insist(items.length,'These products are no longer available. Create a new order from the catalogue.',409);
    const result=await this.save({customer_id:old.customer_id,seller_id:old.seller_id,items,recipient_name:old.recipient_name,recipient_contact:old.recipient_contact,requested_delivery_address:old.requested_delivery_address,payment_method:paymentMethods(this.db.demo).some(x=>x.value===old.payment_method)?old.payment_method:paymentMethods(this.db.demo)[0].value},user);
    return {...result,removed_items:old.items.length-items.length};
  }
  async deliveryAttemptFailed(q,order,event){
    const reason=typeof event.customer_reason==='string'?event.customer_reason.trim().slice(0,1000):'The delivery service could not complete this attempt.';
    const message='Delivery attempt failed. Arrange redelivery with Sales. '+(isCod(order)?'No COD collection is verified. ':'Your payment remains recorded. ')+'Reason: '+reason;
    await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,reason,source_event_reference) VALUES (?,?,?,?,?,?)',[order.order_id,order.order_status,order.order_status,'delivery',message,event.event_reference]);
    await this.notify(q,order,'delivery-attempt-'+uid().replaceAll('-','').slice(0,20),message);
  }

  async stopWork(q,order) {
    await q("UPDATE sales_outbox SET status='blocked',lease_until=0 WHERE order_id=? AND status<>'done' AND NOT ((service='billing' AND action='cancel') OR (service='inventory' AND action='release'))",[order.order_id]);
  }
  async failure(q,order,event,kind,message) {
    const reason=this.db.demo&&event.simulated&&typeof event.customer_reason==='string'?event.customer_reason.trim().slice(0,1000):'';
    const explanation=message+(reason?' Reason: '+reason:'');
    await this.stopWork(q,order);
    await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,reason,source_event_reference) VALUES (?,?,?,?,?,?)',[order.order_id,order.order_status,order.order_status,kind.startsWith('delivery')?'delivery':kind.startsWith('payment')?'billing':'inventory',explanation,event.event_reference]);
    await q('UPDATE sales_order SET updated_at=? WHERE order_id=?',[now(),order.order_id]);
    await this.notify(q,order,kind,explanation);
  }
  async owned(q, id, user) {
    const [order] = await q('SELECT o.*,COALESCE(p.payment_method,\'prepaid\') AS payment_method,f.version,f.stock,f.payment,f.shipment,f.reservation_json,f.reservation_expires,f.invoice_reference,f.transaction_reference,f.tracking_reference,f.reconciliation,f.billing_clear,f.release_clear,c.customer_name,c.email,c.contact_number,s.seller_name,rs.record_json AS resolution_json FROM sales_order o LEFT JOIN sales_resolution rs ON rs.order_id=o.order_id LEFT JOIN sales_order_payment p ON p.order_id=o.order_id JOIN sales_order_facts f ON f.order_id=o.order_id JOIN customer c ON c.customer_id=o.customer_id JOIN seller s ON s.seller_id=o.seller_id WHERE o.order_id=?',[id]);
    insist(order && (['staff','billing','delivery','inventory','seller'].includes(user.role) || order.customer_id === user.customer_id), 'Order not found.', 404);
    return order;
  }
  async offers(q = this.db.query) {
    return q('SELECT v.*,p.description,s.seller_name FROM v_orderable_offer v JOIN product p ON p.product_id=v.product_id JOIN seller s ON s.seller_id=v.seller_id ORDER BY s.seller_name,p.product_name');
  }
  async customers(user) { return this.db.query('SELECT * FROM customer' + (user.role === 'staff' ? ' ORDER BY customer_name' : ' WHERE customer_id=?'), user.role === 'staff' ? [] : [user.customer_id]); }
  async createCustomer(data, user) {
    insist(user.role === 'staff', 'Staff access required.',403);
    const name=text(data.customer_name,'Customer name'), contact=text(data.contact_number,'Contact number',30);
    const email=typeof data.email==='string' ? data.email.trim() : '';
    insist(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length<=255,'Enter a valid email address.');
    return this.db.tx(async q => { const r=await q('INSERT INTO customer (customer_name,email,contact_number) VALUES (?,?,?)',[name,email,contact]); return {customer_id:r.insertId}; });
  }
  async list(user, filters = {}) {
    const conditions=[], params=[];
    if(user.role!=='customer')conditions.push("o.order_status<>'draft'");
    if (user.role === 'customer') { conditions.push('o.customer_id=?'); params.push(user.customer_id); }
    if (filters.status&&!['attention','unsuccessful','cancelled'].includes(filters.status)) { insist(STATES.includes(filters.status),'Invalid status.'); conditions.push('o.order_status=?'); params.push(filters.status); }
    if (filters.search) { conditions.push('(o.order_number LIKE ? OR c.customer_name LIKE ?)'); params.push(`%${filters.search}%`,`%${filters.search}%`); }
    for (const [field,operator] of [['from','>='],['to','<=']]) if (filters[field]) { insist(/^\d{4}-\d{2}-\d{2}$/.test(filters[field]),'Invalid date.'); conditions.push(`SUBSTR(o.created_at,1,10) ${operator} ?`); params.push(filters[field]); }
    return this.db.tx(async q=>{const rows=await q(`SELECT o.*,COALESCE(p.payment_method,\'prepaid\') AS payment_method,c.customer_name,s.seller_name,f.stock,f.payment,f.shipment,f.reconciliation,f.reservation_expires,f.invoice_reference,(SELECT n.message FROM sales_notification n WHERE n.order_id=o.order_id AND n.kind NOT LIKE 'reply-%' AND n.kind NOT LIKE 'delivery-update-%' AND n.kind NOT LIKE 'delivery-attempt-%' AND n.kind NOT LIKE 'redelivery-%' AND n.kind<>'delivery_failed' ORDER BY n.notification_id DESC LIMIT 1) AS outcome_message,(SELECT CASE WHEN m.sender_role='customer' THEN 1 ELSE 0 END FROM sales_order_message m WHERE m.order_id=o.order_id ORDER BY m.message_id DESC LIMIT 1) AS needs_reply,EXISTS (SELECT 1 FROM sales_outbox x WHERE x.order_id=o.order_id AND x.status NOT IN ('done','blocked') AND x.last_error IS NOT NULL) AS unresolved,(SELECT COALESCE(SUM(i.quantity),0) FROM order_item i WHERE i.order_id=o.order_id) AS item_count,f.version,rs.record_json AS resolution_json,(SELECT COALESCE(SUM(CAST(amount AS DECIMAL(14,2))),0) FROM sales_refund_record rr WHERE rr.order_id=o.order_id) AS refunded_total FROM sales_order o LEFT JOIN sales_resolution rs ON rs.order_id=o.order_id LEFT JOIN sales_order_payment p ON p.order_id=o.order_id JOIN customer c ON c.customer_id=o.customer_id JOIN seller s ON s.seller_id=o.seller_id JOIN sales_order_facts f ON f.order_id=o.order_id ${conditions.length ? 'WHERE '+conditions.join(' AND ') : ''} ORDER BY o.order_id DESC`,params);return filters.status==='attention'?rows.filter(needsAttention):filters.status==='unsuccessful'?rows.filter(o=>issueOutcome(o)==='unsuccessful'):filters.status==='cancelled'?rows.filter(o=>issueOutcome(o)==='cancelled'):rows;});
  }
  async detail(id,user) {
    return this.db.tx(async q => {
      const order=await this.owned(q,id,user);
      const items=await q('SELECT * FROM order_item WHERE order_id=? ORDER BY order_item_id',[id]);
      const history=await q('SELECT * FROM order_status_history WHERE order_id=? ORDER BY history_id',[id]);
      const requests=await q('SELECT request_reference,service,action,status,attempts,last_error,created_at FROM sales_outbox WHERE order_id=? ORDER BY created_at',[id]);
      const outcomes=await q("SELECT kind,message,created_at FROM sales_notification WHERE order_id=? AND kind NOT LIKE 'reply-%' AND kind NOT LIKE 'delivery-update-%' ORDER BY notification_id DESC",[id]);
      const messages=await q('SELECT message_id,sender_role,body,created_at FROM sales_order_message WHERE order_id=? ORDER BY message_id',[id]);
      const delivery_updates=await q('SELECT update_id,kind,reason,estimated_at,next_update_at,created_at FROM sales_delivery_update WHERE order_id=? ORDER BY update_id DESC',[id]);
      return {...order,items,history,requests,outcomes,messages,delivery_updates,resolution:await resolution(q,order)};
    });
  }
  async normalized(q,data,user) {
    const customerId=Number(data.customer_id);
    insist(Number.isSafeInteger(customerId)&&customerId>0,'Select a valid customer.');
    const [customer]=await q('SELECT * FROM customer WHERE customer_id=?',[customerId]);
    insist(customer && (user.role==='staff'||user.customer_id===customerId),'Select an authorized customer.');
    insist(Array.isArray(data.items)&&data.items.length<=100,'Items must be a list of at most 100 offers.');
    const offers=await this.offers(q), grouped=new Map();
    for (const item of data.items) {
      insist(item&&typeof item==='object'&&!Array.isArray(item)&&Number.isSafeInteger(Number(item.offer_id))&&Number(item.offer_id)>0,'Each item must reference a valid offer.');
      insist(Number.isSafeInteger(item.quantity)&&item.quantity>0&&item.quantity<=100000,'Quantities must be positive whole numbers, up to 100,000.');
      const offer=offers.find(o=>o.offer_id===Number(item.offer_id));
      insist(offer,'An item is unavailable. Check active offers, products, and sellers.',409);
      const prior=grouped.get(offer.offer_id);
      const quantity=item.quantity+(prior?.quantity||0);
      insist(quantity<=100000,'Quantity exceeds the supported limit.');
      grouped.set(offer.offer_id,{...offer,quantity});
    }
    const items=[...grouped.values()];
    const sellerId=items[0]?.seller_id || Number(data.seller_id);
    const [seller]=await q("SELECT * FROM seller WHERE seller_id=? AND seller_status='active'",[sellerId]);
    insist(seller,'Select a seller.');
    insist(items.every(i=>i.seller_id===sellerId),'All items must belong to one seller.');
    let total=0;
    for(const item of items) total+=money(item.selling_price)*item.quantity;
    insist(Number.isSafeInteger(total)&&total<=999999999999,'Order exceeds the supported total.');
    const clean=(value,max)=>{insist(value===undefined||value===null||typeof value==='string','Recipient details must be text.');insist(!value||value.trim().length<=max,'Recipient details exceed the supported length.');return value?.trim()||'';};
    return {customerId,sellerId,items,total,recipient_name:clean(data.recipient_name,150),recipient_contact:clean(data.recipient_contact,30),address:clean(data.requested_delivery_address,3000)};
  }
  async save(data,user,id) {
    return this.db.tx(async q => {
      let order;
      if(id) { order=await this.owned(q,id,user); insist(order.order_status==='draft','Submitted orders cannot be edited.',409); insist(data.version===order.version,'This draft changed. Reload before saving.',409); }
      const method=data.payment_method===undefined?order?.payment_method||'prepaid':data.payment_method;
      insist((method==='prepaid'||paymentMethods(this.db.demo).some(x=>x.value===method)),'Choose an available payment method.');
      const n=await this.normalized(q,data,user);
      if(!id) {
        const result=await q('INSERT INTO sales_order (order_number,customer_id,seller_id,order_total,recipient_name,recipient_contact,requested_delivery_address) VALUES (?,?,?,?,?,?,?)',[`SO-${new Date().getFullYear()}-${uid().slice(0,8).toUpperCase()}`,n.customerId,n.sellerId,decimal(n.total),n.recipient_name,n.recipient_contact,n.address]);
        id=result.insertId;
        await q('INSERT INTO sales_order_facts (order_id) VALUES (?)',[id]);
        await q('INSERT INTO order_status_history (order_id,new_status,change_source,actor_reference,reason) VALUES (?,?,?,?,?)',[id,'draft','sales',String(user.user_id),'Draft created']);
      } else {
        await q('DELETE FROM order_item WHERE order_id=?',[id]);
        await q('UPDATE sales_order SET customer_id=?,seller_id=?,order_total=?,recipient_name=?,recipient_contact=?,requested_delivery_address=?,updated_at=? WHERE order_id=?',[n.customerId,n.sellerId,decimal(n.total),n.recipient_name,n.recipient_contact,n.address,now(),id]);
        await q('UPDATE sales_order_facts SET version=version+1 WHERE order_id=?',[id]);
      }
      const [savedMethod]=await q('SELECT order_id FROM sales_order_payment WHERE order_id=?',[id]);
      if(savedMethod)await q('UPDATE sales_order_payment SET payment_method=? WHERE order_id=?',[method,id]);
      else await q('INSERT INTO sales_order_payment (order_id,payment_method) VALUES (?,?)',[id,method]);
      for(const item of n.items) await q('INSERT INTO order_item (order_id,seller_id,offer_id,product_name_at_order,quantity,unit_price_at_order) VALUES (?,?,?,?,?,?)',[id,n.sellerId,item.offer_id,item.product_name,item.quantity,item.selling_price]);
      const [facts]=await q('SELECT version FROM sales_order_facts WHERE order_id=?',[id]);
      return {order_id:id,version:facts.version};
    });
  }
  async quote(q,order) {
    insist((order.payment_method==='prepaid'||paymentMethods(this.db.demo).some(x=>x.value===order.payment_method)),'This payment method is unavailable. Edit the draft before submitting.',409);
    const items=await q('SELECT * FROM order_item WHERE order_id=? ORDER BY order_item_id',[order.order_id]);
    insist(items.length>0,'Add at least one item before submission.');
    text(order.recipient_name,'Recipient name'); text(order.recipient_contact,'Recipient contact',30); text(order.requested_delivery_address,'Delivery address',3000);
    const offers=await this.offers(q);
    const revised=items.map(item=>{
      const offer=offers.find(o=>o.offer_id===item.offer_id&&o.seller_id===order.seller_id);
      insist(offer,`${item.product_name_at_order} (offer #${item.offer_id}) is unavailable. Edit the draft before submitting.`,409);
      return {...item,product_name_at_order:offer.product_name,unit_price_at_order:decimal(money(offer.selling_price))};
    });
    const total=revised.reduce((sum,item)=>sum+money(item.unit_price_at_order)*item.quantity,0);
    insist(Number.isSafeInteger(total)&&total<=999999999999,'Order total exceeds the supported limit.');
    const acceptance=JSON.stringify({items:revised.map(i=>[i.offer_id,i.quantity,i.product_name_at_order,i.unit_price_at_order]),payment_method:order.payment_method});
    return {items:revised,order_total:decimal(total),acceptance,version:order.version};
  }
  async review(id,user) { return this.db.tx(async q=>{const order=await this.owned(q,id,user);insist(order.order_status==='draft','Only drafts can be reviewed for submission.',409);return this.quote(q,order);}); }
  async transition(q,order,next,reason,source='sales',event=null) {
    insist(ALLOWED[order.order_status]?.includes(next),'Invalid order transition.',409);
    await q('UPDATE sales_order SET order_status=?,updated_at=? WHERE order_id=?',[next,now(),order.order_id]);
    await q('UPDATE sales_order_facts SET version=version+1 WHERE order_id=?',[order.order_id]);
    await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,reason,source_event_reference) VALUES (?,?,?,?,?,?)',[order.order_id,order.order_status,next,source,reason,event]);
    order.order_status=next;
    if(next==='cancellation_pending')await this.notify(q,order,'cancellation_requested','Cancellation requested. We are checking payment and releasing any stock before confirming cancellation.'+(order.cancellation_reason?' Reason: '+order.cancellation_reason:''));
    if(next==='completed')await this.notify(q,order,'order_completed','Your order was delivered and payment was confirmed. Purchase details and Contact Sales remain available.');
    if(next==='cancelled')await this.notify(q,order,'cancellation_completed','Your order is cancelled. '+(order.order_date?'Payment checks and stock release are complete.':'This draft was not submitted.')+(order.cancellation_reason?' Reason: '+order.cancellation_reason:''));
  }
  async enqueue(q,id,service,action,suffix='',extra={}) {
    const ref=`sales:${id}:${service}:${action}${suffix}`;
    const [existing]=await q('SELECT request_reference FROM sales_outbox WHERE request_reference=?',[ref]);
    if(existing) return;
    const order=await this.owned(q,id,{role:'staff'});
    const items=await q('SELECT order_item_id,offer_id,seller_id,product_name_at_order,quantity,unit_price_at_order FROM order_item WHERE order_id=?',[id]);
    const payload={...extra,request_reference:ref,order_id:id,customer_id:order.customer_id,seller_id:order.seller_id,payment_method:order.payment_method,collection_due:isCod(order)?order.order_total:null,invoice_reference:order.invoice_reference,tracking_reference:order.tracking_reference,shipment:order.shipment,items,product_total:order.order_total,currency:'PHP',recipient:{name:order.recipient_name,contact:order.recipient_contact,address:order.requested_delivery_address},reservation:order.reservation_json?JSON.parse(order.reservation_json):null};
    await q('INSERT INTO sales_outbox (request_reference,order_id,service,action,payload,status,created_at) VALUES (?,?,?,?,?,?,?)',[ref,id,service,action,JSON.stringify(payload),'pending',now()]);
  }
  async submit(id,data,user) {
    return this.db.tx(async q=>{
      const order=await this.owned(q,id,user);
      const ref=text(data.submission_reference,'Submission reference',100);
      if(order.submission_reference===ref) return {order_id:id,duplicate:true};
      insist(order.order_status==='draft','This order has already been submitted.',409);
      insist(order.version===data.version,'Draft changed. Review it again.',409);
      const quote=await this.quote(q,order);
      insist(data.acceptance===quote.acceptance,'Prices or products changed. Review and accept the revised order.',409,{quote});
      const [used]=await q('SELECT order_id FROM sales_order WHERE submission_reference=?',[ref]);
      insist(!used,'Submission reference is already used.',409);
      for(const item of quote.items) await q('UPDATE order_item SET product_name_at_order=?,unit_price_at_order=? WHERE order_item_id=?',[item.product_name_at_order,item.unit_price_at_order,item.order_item_id]);
      await q('UPDATE sales_order SET submission_reference=?,order_date=?,order_total=? WHERE order_id=?',[ref,now(),quote.order_total,id]);
      await this.transition(q,order,'pending_stock','Accepted purchase saved; waiting for all-item stock reservation');
      await this.enqueue(q,id,'inventory','reserve');
      return {order_id:id};
    });
  }
  async cancel(id,data,user) {
    return this.db.tx(async q=>{
      const order=await this.owned(q,id,user);
      if(['cancellation_pending','cancelled'].includes(order.order_status)) return {order_id:id};
      if(data.version!==undefined)insist(data.version===order.version,'This order changed. Refresh before requesting cancellation.',409);
      insist((['draft','pending_stock','awaiting_payment'].includes(order.order_status)||isCod(order)&&order.order_status==='confirmed'&&order.shipment==='none')&&order.payment!=='verified','Cancellation is unavailable for this order. Paid cancellations require reconciliation.',409);
      const reason=text(data.reason,'Cancellation reason',1000);
      await q('UPDATE sales_order SET cancellation_reason=? WHERE order_id=?',[reason,id]);
      order.cancellation_reason=reason;
      if(order.order_status==='draft') await this.transition(q,order,'cancelled',reason);
      else {
        await this.transition(q,order,'cancellation_pending',reason);
        await this.stopWork(q,order);
        await this.enqueue(q,id,'billing','cancel');
        await this.enqueue(q,id,'inventory','release');
      }
      return {order_id:id};
    });
  }
  validStock(order) { return (order.stock==='confirmed'&&order.reservation_expires===null)||(['reserved','confirmed'].includes(order.stock)&&Number(order.reservation_expires)>Date.now()); }
  async event(service,event) {
    return this.db.tx(async q=>{
      text(event.event_reference,'Event reference',100); text(event.request_reference,'Request reference',100);
      const [seen]=await q('SELECT * FROM sales_event WHERE event_reference=?',[event.event_reference]);
      if(seen) { insist(seen.service===service&&canonicalEvent(JSON.parse(seen.payload))===canonicalEvent(event),'Conflicting duplicate event.',409); return {duplicate:true}; }
      const [request]=await q('SELECT * FROM sales_outbox WHERE request_reference=?',[event.request_reference]);
      insist(request&&request.service===service&&event.order_id===request.order_id,'Event does not match a Sales request.',409);
      const order=await this.owned(q,request.order_id,{role:'staff'});
      const payload=JSON.parse(request.payload), action=request.action, status=event.status;
      const closed=JSON.parse(order.resolution_json||'{}');
      insist(!closed.cancel_accepted&&!closed.fulfillment_stopped&&!closed.issue_outcome||service==='billing'&&['verify','cancel'].includes(action)||service==='inventory'&&action==='release','Normal fulfillment is stopped; refund and return actions remain available.',409);
      if(payload.redelivery&&!(this.db.demo&&event.simulated&&event.manual_attempt_recorded===true))insist(Date.parse(payload.scheduled_at)<=Date.now(),'Redelivery is not due yet.',409);
      const latePayment=service==='billing'&&((action==='verify'&&status==='verified')||(action==='cancel'&&status==='paid'))&&order.payment!=='verified';
      if(request.status==='blocked'&&!latePayment&&!(service==='inventory'&&action==='reserve'&&status==='reserved')) throw new Problem(409,'Request was superseded by verified cancellation.');
      if(request.status==='done'&&!latePayment) {
        // A service request has a single authoritative terminal result. Status updates need their own request.
        throw new Problem(409,'Request already has a terminal result. Reconcile conflicting results with the owning service.');
      }
      const mark=async(fields)=>{
        const names=Object.keys(fields);
        await q(`UPDATE sales_order_facts SET ${names.map(k=>`${k}=?`).join(',')} WHERE order_id=?`,[...Object.values(fields),order.order_id]);
        Object.assign(order,fields);
      };
      const reconcile=async message=>mark({reconciliation:message});
      if(service==='inventory'&&action==='reserve') {
        insist(['reserved','rejected'].includes(status),'Invalid reservation result.');
        if(status==='reserved') {
          insist(Array.isArray(event.reservations)&&event.reservations.length===payload.items.length,'Inventory must reserve every item.');
          reservationIdentity(event.reservations);
          const ids=new Set();
          for(const item of payload.items) {
            const r=event.reservations.find(r=>r.order_item_id===item.order_item_id);
            insist(r&&r.offer_id===item.offer_id&&r.quantity===item.quantity&&typeof r.reservation_id==='string'&&r.reservation_id.length>0&&!ids.has(r.reservation_id),'Reservation details do not match the order.'); ids.add(r.reservation_id);
          }
          insist(Number.isSafeInteger(event.expires_at)&&event.expires_at>Date.now(),'Reservation is already expired.');
          await mark({stock:'reserved',reservation_json:JSON.stringify(event.reservations),reservation_expires:event.expires_at});
          if(order.order_status==='pending_stock'&&!order.reconciliation) {
            if(!isCod(order))await this.transition(q,order,'awaiting_payment','All items reserved',service,event.event_reference);
            else await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,reason,source_event_reference) VALUES (?,?,?,?,?,?)',[order.order_id,order.order_status,order.order_status,service,'Inventory reserved stock for cash on delivery.',event.event_reference]);
            await this.enqueue(q,order.order_id,'billing','invoice');
          } else if(['cancellation_pending','cancelled'].includes(order.order_status)) {
            // A late reservation after release is a contract violation; never silently accept cancellation as resolved.
            await mark({release_clear:0,reconciliation:'Inventory returned a late reservation during cancellation. Verify release with Inventory.'});
            await this.notify(q,order,'stock_conflict','Stock changed while cancellation was being checked. Cancellation is not yet confirmed. Contact the sales team; payment and delivery will not proceed automatically.');
            if(order.order_status==='cancelled'&&!closed.cancel_accepted) await this.transition(q,order,'cancellation_pending','Late reservation contradicted Inventory release; cancellation requires reconciliation',service,event.event_reference);
          } else await reconcile('Unexpected reservation result requires Inventory reconciliation.');
        } else {
          await mark({stock:'rejected'}); await reconcile('Inventory rejected the all-item reservation. Cancel this order and create a new draft.');
          await this.failure(q,order,event,'stock_rejected','Stock was unavailable. Payment and delivery will not proceed. You can request cancellation and create a new order.');
          if(order.reservation_json)await this.enqueue(q,order.order_id,'inventory','release');
        }
      } else if(service==='billing'&&action==='invoice') {
        insist(status==='created'&&typeof event.invoice_reference==='string'&&event.invoice_reference.length>0,'Invalid invoice result.');
        insist(event.currency==='PHP'&&money(event.amount)===money(order.order_total),'Billing amount differs from accepted product total.');
        await mark({invoice_reference:event.invoice_reference,payment:'pending'});
        if(!order.reconciliation){if(isCod(order)&&order.order_status==='pending_stock')await this.enqueue(q,order.order_id,'inventory','confirm');else if(!isCod(order)&&order.order_status==='awaiting_payment')await this.enqueue(q,order.order_id,'billing','verify');}
      } else if(service==='billing'&&action==='verify') {
        insist(['verified','failed'].includes(status),'Invalid payment result.');
        insist(event.invoice_reference===order.invoice_reference&&event.currency==='PHP'&&money(event.amount)===money(order.order_total),'Payment reference or amount does not match.');
        if(status==='verified') {
          text(event.transaction_reference,'Transaction reference',100);
          await mark({payment:'verified',billing_clear:0,transaction_reference:event.transaction_reference});
          if(isCod(order)&&order.order_status==='fulfilling'&&order.shipment==='delivered'&&!order.reconciliation&&!closed.issue_outcome)await this.transition(q,order,'completed','Delivery and COD collection verified by their owning services',service,event.event_reference);
          else if(!isCod(order)&&order.order_status==='awaiting_payment'&&this.validStock(order)&&!order.reconciliation) await this.enqueue(q,order.order_id,'inventory','confirm');
          else { await reconcile('Payment succeeded without eligible stock or during cancellation. Do not fulfill; reconcile with Billing and Inventory.'); await this.stopWork(q,order);await this.notify(q,order,'payment_conflict','Payment was received while this order could not proceed. Progress is paused. Contact the sales team to resolve the payment; cancellation is not yet confirmed.'); if(order.order_status==='cancelled') await this.transition(q,order,'cancellation_pending','Late verified payment contradicted unpaid cancellation; reconciliation required',service,event.event_reference); }
        } else {
          await mark({payment:'failed'}); await reconcile(isCod(order)?'COD collection failed after delivery. Reconcile with Billing; do not cancel the delivered order.':'Payment failed. No automatic retry. Cancel the unpaid order and start a new draft.');
          await this.failure(q,order,event,'payment_failed',isCod(order)?'COD collection was not verified. Delivery remains recorded. Contact the sales team to reconcile the payment; this order is not cancelled.':'Payment was unsuccessful. Delivery is stopped. There is no automatic payment retry; request cancellation before creating a new order.');
          if(order.reservation_json&&!isCod(order))await this.enqueue(q,order.order_id,'inventory','release');
        }
      } else if(service==='inventory'&&action==='confirm') {
        insist(['confirmed','expired'].includes(status),'Invalid reservation confirmation.');
        if(status==='confirmed') {
          insist(event.expires_at===null||(Number.isSafeInteger(event.expires_at)&&event.expires_at>Date.now()),'Confirmed reservation must explicitly have no expiry or a valid future expiry.');
          insist(order.stock==='reserved'&&confirmationPaymentReady(order),'Reservation is no longer eligible for confirmation.',409);
          insist(sameReservations(event.reservations,JSON.parse(order.reservation_json||'[]')),'Confirmed reservations differ from the accepted reservation.');
          await mark({stock:'confirmed',reservation_expires:event.expires_at});
          if((order.order_status==='awaiting_payment'&&!isCod(order)||order.order_status==='pending_stock'&&isCod(order))&&confirmationPaymentReady(order)&&!order.reconciliation) {
            await this.transition(q,order,'confirmed',isCod(order)?'COD arrangement prepared and stock confirmed':'Verified payment and confirmed valid stock',service,event.event_reference);
            await this.enqueue(q,order.order_id,'delivery','accept');
          } else await reconcile('Stock confirmation arrived after the order became ineligible.');
        } else { await mark({stock:'expired'}); await reconcile('Reservation expired. Verified payments require reconciliation before any fulfillment.'); await this.failure(q,order,event,'stock_expired','The stock reservation expired. Processing is stopped. Contact the sales team if payment was already made.'); }
      } else if(service==='delivery'&&action==='accept') {
        insist(['accepted','failed'].includes(status),'Invalid shipment acceptance.');
        insist(order.order_status==='confirmed'&&shipmentPaymentReady(order)&&this.validStock(order)&&!order.reconciliation,'Shipment is no longer authorized.',409);
        insist(sameItemIds(event.order_item_ids,payload.items.map(i=>i.order_item_id)),'Shipment item links do not match.');
        if(status==='failed') {
          await mark({shipment:'failed'});
          await this.deliveryAttemptFailed(q,order,event);
        } else {
          text(event.tracking_reference,'Tracking reference',100);
          await mark({shipment:'accepted',tracking_reference:event.tracking_reference});
          await this.transition(q,order,'fulfilling','Delivery accepted shipment',service,event.event_reference);
          await this.enqueue(q,order.order_id,'delivery','verify_delivery');
        }
      } else if(service==='delivery'&&action==='verify_delivery') {
        insist(['delivered','failed'].includes(status)&&event.tracking_reference===order.tracking_reference,'Matching tracking reference required.');
        insist(order.order_status==='fulfilling'&&shipmentPaymentReady(order)&&!order.reconciliation,'Order is not eligible for completion.',409);
        if(status==='failed') {
          await mark({shipment:'failed'});
          await this.deliveryAttemptFailed(q,order,event);
        } else {
          text(event.proof_reference,'Delivery proof',100);
          await mark({shipment:'delivered'});
          if(isCod(order)&&order.payment!=='verified'){await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,reason,source_event_reference) VALUES (?,?,?,?,?,?)',[order.order_id,order.order_status,order.order_status,service,'Delivery verified. Waiting for COD collection verification.',event.event_reference]);await this.enqueue(q,order.order_id,'billing','verify');}else await this.transition(q,order,'completed',`Verified delivery proof: ${event.proof_reference}`,service,event.event_reference);
        }
      } else if(service==='billing'&&action==='cancel') {
        insist(['cancelled_unpaid','paid'].includes(status),'Billing must authoritatively cancel unpaid payment requests, or report paid.');
        if(status==='paid') {
          insist(event.currency==='PHP'&&money(event.amount)===money(order.order_total),'Paid cancellation result amount does not match.');
          text(event.transaction_reference,'Transaction reference',100); text(event.invoice_reference,'Invoice reference',100);
          insist(!order.invoice_reference||event.invoice_reference===order.invoice_reference,'Paid cancellation invoice does not match.');
          await mark({payment:'verified',billing_clear:0,transaction_reference:event.transaction_reference,invoice_reference:event.invoice_reference});
          await reconcile('Payment succeeded during cancellation. Manual reconciliation required; paid cancellation is outside scope.');
          await this.stopWork(q,order);
          await this.notify(q,order,'payment_conflict','Payment was received during cancellation. Cancellation is not confirmed. Contact the sales team to resolve the payment; delivery is paused.'+(this.db.demo&&event.simulated&&event.customer_reason?' Reason: '+String(event.customer_reason).trim().slice(0,1000):''));
          if(order.order_status==='cancelled') await this.transition(q,order,'cancellation_pending','Late payment contradicted unpaid cancellation; reconciliation required',service,event.event_reference);
        }
        else {
          insist(order.payment!=='verified','Cannot clear a verified payment.',409);
          await mark({payment:'cancelled',billing_clear:1});
          // Billing contract guarantees invoice/verify requests for this order cannot later charge.
          await q("UPDATE sales_outbox SET status='blocked' WHERE order_id=? AND service='billing' AND action<>'cancel' AND status<>'done'",[order.order_id]);
        }
      } else if(service==='inventory'&&action==='release') {
        insist(status==='released'&&event.no_active_reservations===true,'Inventory must verify no active or future reservations remain.');
        await mark({stock:'released',release_clear:1});
        await q("UPDATE sales_outbox SET status='blocked' WHERE order_id=? AND service='inventory' AND action IN ('reserve','confirm') AND status<>'done'",[order.order_id]);
      } else throw new Problem(422,'Unsupported integration event.');
      if(order.order_status==='cancellation_pending'&&order.billing_clear&&order.release_clear&&order.payment!=='verified'&&order.stock==='released') {
        await mark({reconciliation:null});
        await this.transition(q,order,'cancelled','Billing verified unpaid cancellation; Inventory verified complete release',service,event.event_reference);
      }
      if(order.reconciliation) {
        const [history]=await q('SELECT history_id FROM order_status_history WHERE source_event_reference=?',[event.event_reference]);
        if(!history)await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,reason,source_event_reference) VALUES (?,?,?,?,?,?)',[order.order_id,order.order_status,order.order_status,service,'Processing paused. Contact the sales team to reconcile the service results.'+(this.db.demo&&event.simulated&&event.customer_reason?' Reason: '+String(event.customer_reason).trim().slice(0,1000):''),event.event_reference]);
      }
      await q('INSERT INTO sales_event (event_reference,request_reference,order_id,service,payload,created_at) VALUES (?,?,?,?,?,?)',[event.event_reference,event.request_reference,order.order_id,service,JSON.stringify(event),now()]);
      await q('UPDATE sales_order_facts SET version=version+1 WHERE order_id=?',[order.order_id]);
      await q('UPDATE sales_order SET updated_at=? WHERE order_id=?',[now(),order.order_id]);
      await q("UPDATE sales_outbox SET status='done',last_error=NULL,lease_until=0 WHERE request_reference=?",[event.request_reference]);
      const resolved=await resolution(q,order);
      if(resolved.cancel_accepted&&order.order_status!=='cancelled'){
        await q("UPDATE sales_order SET order_status='cancelled' WHERE order_id=?",[order.order_id]);
        await this.stopWork(q,order);
      }
      if((resolved.cancel_accepted||resolved.fulfillment_stopped)&&order.payment==='verified')await this.notify(q,order,'refund-required','Verified payment requires a refund of PHP '+resolved.refundable_amount+'. Open Refund and return resolution for the next step.');
      return {accepted:true};
    });
  }

  // Inventory owns lifecycle facts. These versioned notifications never edit stock balances.
  async inventoryLifecycle(event) {
    return this.db.tx(async q=>{
      text(event.event_reference,'Event reference',100);text(event.request_reference,'Request reference',100);
      insist(event.schema_version===1&&event.event_type==='reservation.lifecycle','Unsupported Inventory lifecycle schema.');
      insist(Number.isSafeInteger(event.version)&&event.version>0,'A positive Inventory lifecycle version is required.');
      insist(Number.isSafeInteger(event.occurred_at)&&event.occurred_at>0&&event.occurred_at<=Date.now()+300000,'Invalid Inventory occurrence time.');
      insist(['expired','released','fulfilled'].includes(event.status),'Unsupported Inventory lifecycle state.');
      const [seen]=await q('SELECT * FROM sales_event WHERE event_reference=?',[event.event_reference]);
      if(seen){insist(seen.service==='inventory'&&canonicalEvent(JSON.parse(seen.payload))===canonicalEvent(event),'Conflicting duplicate event.',409);return {duplicate:true};}
      const [request]=await q('SELECT * FROM sales_outbox WHERE request_reference=?',[event.request_reference]);
      insist(request&&request.service==='inventory'&&request.action==='reserve'&&request.order_id===event.order_id,'Lifecycle event does not match the original Inventory request.',409);
      const order=await this.owned(q,event.order_id,{role:'staff'});
      insist(order.reservation_json&&sameReservations(event.reservations,JSON.parse(order.reservation_json)),'Lifecycle reservations do not match the accepted reservation.',409);
      const rows=await q("SELECT payload FROM sales_event WHERE order_id=? AND service='inventory'",[event.order_id]);
      const prior=rows.map(r=>JSON.parse(r.payload)).filter(e=>e.event_type==='reservation.lifecycle'&&e.schema_version===1&&Number.isSafeInteger(e.version)&&e.version>0);
      const latest=prior.reduce((max,e)=>Math.max(max,e.version),0);
      insist(!prior.some(e=>e.version===event.version),'Inventory lifecycle version already has a different event reference.',409);
      const record=()=>q('INSERT INTO sales_event (event_reference,request_reference,order_id,service,payload,created_at) VALUES (?,?,?,?,?,?)',[event.event_reference,event.request_reference,event.order_id,'inventory',JSON.stringify(event),now()]);
      if(event.version<latest){await record();return {ignored:true,reason:'outdated_version'};}
      if(event.status==='expired'){
        insist(order.stock==='reserved'||order.stock==='expired','Only an unpaid active reservation can expire.',409);
        insist(Number(order.reservation_expires)>0&&event.occurred_at>=Number(order.reservation_expires),'Expiry precedes the authoritative reservation deadline.',409);
      }
      if(event.status==='released')insist(['reserved','confirmed','released'].includes(order.stock),'A fulfilled or expired reservation cannot be released.',409);
      if(event.status==='fulfilled'){
        text(event.fulfillment_reference,'Fulfillment reference',100);
        insist(['confirmed','fulfilled'].includes(order.stock)&&shipmentPaymentReady(order)&&['accepted','delivered'].includes(order.shipment)&&['fulfilling','completed'].includes(order.order_status)&&!order.reconciliation,'Reservation is not eligible for fulfillment.',409);
      }
      if(event.status==='fulfilled')await q("UPDATE sales_order_facts SET stock='fulfilled',reservation_expires=NULL WHERE order_id=?",[event.order_id]);
      else {
        const message=event.status==='expired'?'Inventory verified reservation expiry. Payment and fulfillment are blocked pending cancellation or reconciliation.':'Inventory verified reservation release. Progress is paused pending cancellation or reconciliation.';
        await q('UPDATE sales_order_facts SET stock=?,reconciliation=? WHERE order_id=?',[event.status,order.order_status==='cancelled'?order.reconciliation:message,event.order_id]);
        await q("UPDATE sales_outbox SET status='blocked' WHERE order_id=? AND status<>'done' AND ((service='billing' AND action IN ('invoice','verify')) OR (service='delivery') OR (service='inventory' AND action='confirm'))",[event.order_id]);
        if(!['cancelled','cancellation_pending','completed'].includes(order.order_status))await this.failure(q,order,event,event.status==='expired'?'stock_expired':'stock_released','The stock reservation '+(event.status==='expired'?'expired':'was released')+'. Processing is stopped. Contact the sales team if payment was made.');
        // A lifecycle release is not the cancellation tombstone acknowledgement.
        // Only the release request result may set release_clear.
      }
      await q('UPDATE sales_order_facts SET version=version+1 WHERE order_id=?',[event.order_id]);
      await record();return {accepted:true,version:event.version};
    });
  }
  async requests(user,orderId=null) {
    insist(user.role==='staff','Staff access required.',403);
    if(orderId!==null)insist(Number.isSafeInteger(Number(orderId))&&Number(orderId)>0,'Invalid order.');
    const where=" WHERE EXISTS (SELECT 1 FROM sales_order visible WHERE visible.order_id=o.order_id AND visible.order_status<>'draft')"+(orderId===null?'':' AND o.order_id=?');
    return this.db.query((this.db.demo?'SELECT o.*,s.response AS simulated_response FROM sales_outbox o LEFT JOIN sales_simulator_result s ON s.request_reference=o.request_reference':'SELECT o.* FROM sales_outbox o')+where+' ORDER BY o.created_at DESC LIMIT 500',orderId===null?[]:[Number(orderId)]);
  }
}




