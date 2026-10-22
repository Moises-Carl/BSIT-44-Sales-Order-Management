import { insist, text, money, decimal, uid, now, Problem } from './util.mjs';
const STATES = ['draft','pending_stock','awaiting_payment','confirmed','fulfilling','completed','cancellation_pending','cancelled'];
const ALLOWED = {draft:['pending_stock','cancelled'],pending_stock:['awaiting_payment','cancellation_pending'],awaiting_payment:['confirmed','cancellation_pending'],confirmed:['fulfilling'],fulfilling:['completed'],cancellation_pending:['cancelled'],cancelled:['cancellation_pending']};
export class Sales {
  constructor(db) { this.db = db; }
  async owned(q, id, user) {
    const [order] = await q('SELECT o.*,f.version,f.stock,f.payment,f.shipment,f.reservation_json,f.reservation_expires,f.invoice_reference,f.transaction_reference,f.tracking_reference,f.reconciliation,f.billing_clear,f.release_clear,c.customer_name,c.email,c.contact_number,s.seller_name FROM sales_order o JOIN sales_order_facts f ON f.order_id=o.order_id JOIN customer c ON c.customer_id=o.customer_id JOIN seller s ON s.seller_id=o.seller_id WHERE o.order_id=?',[id]);
    insist(order && (user.role === 'staff' || order.customer_id === user.customer_id), 'Order not found.', 404);
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
    if (user.role !== 'staff') { conditions.push('o.customer_id=?'); params.push(user.customer_id); }
    if (filters.status) { insist(STATES.includes(filters.status),'Invalid status.'); conditions.push('o.order_status=?'); params.push(filters.status); }
    if (filters.search) { conditions.push('(o.order_number LIKE ? OR c.customer_name LIKE ?)'); params.push(`%${filters.search}%`,`%${filters.search}%`); }
    for (const [field,operator] of [['from','>='],['to','<=']]) if (filters[field]) { insist(/^\d{4}-\d{2}-\d{2}$/.test(filters[field]),'Invalid date.'); conditions.push(`SUBSTR(o.created_at,1,10) ${operator} ?`); params.push(filters[field]); }
    return this.db.query(`SELECT o.*,c.customer_name,s.seller_name,f.stock,f.payment,f.shipment,f.reconciliation,f.reservation_expires,f.invoice_reference,(SELECT COALESCE(SUM(i.quantity),0) FROM order_item i WHERE i.order_id=o.order_id) AS item_count FROM sales_order o JOIN customer c ON c.customer_id=o.customer_id JOIN seller s ON s.seller_id=o.seller_id JOIN sales_order_facts f ON f.order_id=o.order_id ${conditions.length ? 'WHERE '+conditions.join(' AND ') : ''} ORDER BY o.order_id DESC LIMIT 500`,params);
  }
  async detail(id,user) {
    return this.db.tx(async q => {
      const order=await this.owned(q,id,user);
      const items=await q('SELECT * FROM order_item WHERE order_id=? ORDER BY order_item_id',[id]);
      const history=await q('SELECT * FROM order_status_history WHERE order_id=? ORDER BY history_id',[id]);
      const requests=await q('SELECT request_reference,service,action,status,attempts,last_error,created_at FROM sales_outbox WHERE order_id=? ORDER BY created_at',[id]);
      return {...order,items,history,requests};
    });
  }
  async normalized(q,data,user) {
    const customerId=Number(data.customer_id);
    const [customer]=await q('SELECT * FROM customer WHERE customer_id=?',[customerId]);
    insist(customer && (user.role==='staff'||user.customer_id===customerId),'Select an authorized customer.');
    insist(Array.isArray(data.items)&&data.items.length<=100,'Items must be a list of at most 100 offers.');
    const offers=await this.offers(q), grouped=new Map();
    for (const item of data.items) {
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
    const clean=(value,max)=>typeof value==='string' ? value.trim().slice(0,max) : '';
    return {customerId,sellerId,items,total,recipient_name:clean(data.recipient_name,150),recipient_contact:clean(data.recipient_contact,30),address:clean(data.requested_delivery_address,3000)};
  }
  async save(data,user,id) {
    return this.db.tx(async q => {
      let order;
      if(id) { order=await this.owned(q,id,user); insist(order.order_status==='draft','Submitted orders cannot be edited.',409); insist(data.version===order.version,'This draft changed. Reload before saving.',409); }
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
      for(const item of n.items) await q('INSERT INTO order_item (order_id,seller_id,offer_id,product_name_at_order,quantity,unit_price_at_order) VALUES (?,?,?,?,?,?)',[id,n.sellerId,item.offer_id,item.product_name,item.quantity,item.selling_price]);
      return {order_id:id};
    });
  }
  async quote(q,order) {
    const items=await q('SELECT * FROM order_item WHERE order_id=? ORDER BY order_item_id',[order.order_id]);
    insist(items.length>0,'Add at least one item before submission.');
    text(order.recipient_name,'Recipient name'); text(order.recipient_contact,'Recipient contact',30); text(order.requested_delivery_address,'Delivery address',3000);
    const offers=await this.offers(q);
    const revised=items.map(item=>{
      const offer=offers.find(o=>o.offer_id===item.offer_id&&o.seller_id===order.seller_id);
      insist(offer,`Offer ${item.offer_id} is unavailable. Edit the draft before submitting.`,409);
      return {...item,product_name_at_order:offer.product_name,unit_price_at_order:decimal(money(offer.selling_price))};
    });
    const total=revised.reduce((sum,item)=>sum+money(item.unit_price_at_order)*item.quantity,0);
    insist(Number.isSafeInteger(total)&&total<=999999999999,'Order total exceeds the supported limit.');
    const acceptance=JSON.stringify(revised.map(i=>[i.offer_id,i.quantity,i.product_name_at_order,i.unit_price_at_order]));
    return {items:revised,order_total:decimal(total),acceptance,version:order.version};
  }
  async review(id,user) { return this.db.tx(async q=>{const order=await this.owned(q,id,user);insist(order.order_status==='draft','Only drafts can be reviewed for submission.',409);return this.quote(q,order);}); }
  async transition(q,order,next,reason,source='sales',event=null) {
    insist(ALLOWED[order.order_status]?.includes(next),'Invalid order transition.',409);
    await q('UPDATE sales_order SET order_status=?,updated_at=? WHERE order_id=?',[next,now(),order.order_id]);
    await q('UPDATE sales_order_facts SET version=version+1 WHERE order_id=?',[order.order_id]);
    await q('INSERT INTO order_status_history (order_id,previous_status,new_status,change_source,reason,source_event_reference) VALUES (?,?,?,?,?,?)',[order.order_id,order.order_status,next,source,reason,event]);
    order.order_status=next;
  }
  async enqueue(q,id,service,action) {
    const ref=`sales:${id}:${service}:${action}`;
    const [existing]=await q('SELECT request_reference FROM sales_outbox WHERE request_reference=?',[ref]);
    if(existing) return;
    const order=await this.owned(q,id,{role:'staff'});
    const items=await q('SELECT order_item_id,offer_id,seller_id,product_name_at_order,quantity,unit_price_at_order FROM order_item WHERE order_id=?',[id]);
    const payload={request_reference:ref,order_id:id,customer_id:order.customer_id,seller_id:order.seller_id,items,product_total:order.order_total,currency:'PHP',recipient:{name:order.recipient_name,contact:order.recipient_contact,address:order.requested_delivery_address},reservation:order.reservation_json?JSON.parse(order.reservation_json):null};
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
      insist(['draft','pending_stock','awaiting_payment'].includes(order.order_status)&&order.payment!=='verified','Cancellation is unavailable for this order. Paid cancellations require reconciliation.',409);
      const reason=text(data.reason,'Cancellation reason',1000);
      await q('UPDATE sales_order SET cancellation_reason=? WHERE order_id=?',[reason,id]);
      if(order.order_status==='draft') await this.transition(q,order,'cancelled',reason);
      else {
        await this.transition(q,order,'cancellation_pending',reason);
        await q("UPDATE sales_outbox SET status='blocked' WHERE order_id=? AND service='delivery' AND status<>'done'",[id]);
        await this.enqueue(q,id,'billing','cancel');
        await this.enqueue(q,id,'inventory','release');
      }
      return {order_id:id};
    });
  }
  validStock(order) { return ['reserved','confirmed'].includes(order.stock)&&Number(order.reservation_expires)>Date.now(); }
  async event(service,event) {
    return this.db.tx(async q=>{
      text(event.event_reference,'Event reference',100); text(event.request_reference,'Request reference',100);
      const [seen]=await q('SELECT * FROM sales_event WHERE event_reference=?',[event.event_reference]);
      if(seen) { insist(seen.service===service&&seen.payload===JSON.stringify(event),'Conflicting duplicate event.',409); return {duplicate:true}; }
      const [request]=await q('SELECT * FROM sales_outbox WHERE request_reference=?',[event.request_reference]);
      insist(request&&request.service===service&&event.order_id===request.order_id,'Event does not match a Sales request.',409);
      const order=await this.owned(q,request.order_id,{role:'staff'});
      const payload=JSON.parse(request.payload), action=request.action, status=event.status;
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
          const ids=new Set();
          for(const item of payload.items) {
            const r=event.reservations.find(r=>r.order_item_id===item.order_item_id);
            insist(r&&r.offer_id===item.offer_id&&r.quantity===item.quantity&&typeof r.reservation_id==='string'&&r.reservation_id.length>0&&!ids.has(r.reservation_id),'Reservation details do not match the order.'); ids.add(r.reservation_id);
          }
          insist(Number.isSafeInteger(event.expires_at)&&event.expires_at>Date.now(),'Reservation is already expired.');
          await mark({stock:'reserved',reservation_json:JSON.stringify(event.reservations),reservation_expires:event.expires_at});
          if(order.order_status==='pending_stock') {
            await this.transition(q,order,'awaiting_payment','All items reserved',service,event.event_reference);
            await this.enqueue(q,order.order_id,'billing','invoice');
          } else if(['cancellation_pending','cancelled'].includes(order.order_status)) {
            // A late reservation after release is a contract violation; never silently accept cancellation as resolved.
            await mark({release_clear:0,reconciliation:'Inventory returned a late reservation during cancellation. Verify release with Inventory.'});
            if(order.order_status==='cancelled') await this.transition(q,order,'cancellation_pending','Late reservation contradicted Inventory release; cancellation requires reconciliation',service,event.event_reference);
          } else await reconcile('Unexpected reservation result requires Inventory reconciliation.');
        } else { await mark({stock:'rejected'}); await reconcile('Inventory rejected the all-item reservation. Cancel this order and create a new draft.'); }
      } else if(service==='billing'&&action==='invoice') {
        insist(status==='created'&&typeof event.invoice_reference==='string'&&event.invoice_reference.length>0,'Invalid invoice result.');
        insist(event.currency==='PHP'&&money(event.amount)===money(order.order_total),'Billing amount differs from accepted product total.');
        await mark({invoice_reference:event.invoice_reference,payment:'pending'});
        if(order.order_status==='awaiting_payment') await this.enqueue(q,order.order_id,'billing','verify');
      } else if(service==='billing'&&action==='verify') {
        insist(['verified','failed'].includes(status),'Invalid payment result.');
        insist(event.invoice_reference===order.invoice_reference&&event.currency==='PHP'&&money(event.amount)===money(order.order_total),'Payment reference or amount does not match.');
        if(status==='verified') {
          text(event.transaction_reference,'Transaction reference',100);
          await mark({payment:'verified',transaction_reference:event.transaction_reference});
          if(order.order_status==='awaiting_payment'&&this.validStock(order)&&!order.reconciliation) await this.enqueue(q,order.order_id,'inventory','confirm');
          else { await reconcile('Payment succeeded without eligible stock or during cancellation. Do not fulfill; reconcile with Billing and Inventory.'); if(order.order_status==='cancelled') await this.transition(q,order,'cancellation_pending','Late verified payment contradicted unpaid cancellation; reconciliation required',service,event.event_reference); }
        } else { await mark({payment:'failed'}); await reconcile('Payment failed. Cancel the unpaid order and start a new draft; no automatic stock release is assumed.'); }
      } else if(service==='inventory'&&action==='confirm') {
        insist(['confirmed','expired'].includes(status),'Invalid reservation confirmation.');
        if(status==='confirmed') {
          insist(Number.isSafeInteger(event.expires_at)&&event.expires_at>Date.now(),'Confirmed reservation must have a valid expiry.');
          insist(JSON.stringify(event.reservations)===order.reservation_json,'Confirmed reservations differ from the accepted reservation.');
          await mark({stock:'confirmed',reservation_expires:event.expires_at});
          if(order.order_status==='awaiting_payment'&&order.payment==='verified'&&!order.reconciliation) {
            await this.transition(q,order,'confirmed','Verified payment and confirmed valid stock',service,event.event_reference);
            await this.enqueue(q,order.order_id,'delivery','accept');
          } else await reconcile('Stock confirmation arrived after the order became ineligible.');
        } else { await mark({stock:'expired'}); await reconcile('Reservation expired. Verified payments require reconciliation before any fulfillment.'); }
      } else if(service==='delivery'&&action==='accept') {
        insist(status==='accepted'&&typeof event.tracking_reference==='string'&&event.tracking_reference.length>0,'Invalid shipment acceptance.');
        insist(order.order_status==='confirmed'&&order.payment==='verified'&&this.validStock(order)&&!order.reconciliation,'Shipment is no longer authorized.',409);
        insist(JSON.stringify(event.order_item_ids)===JSON.stringify(payload.items.map(i=>i.order_item_id)),'Shipment item links do not match.');
        await mark({shipment:'accepted',tracking_reference:event.tracking_reference});
        await this.transition(q,order,'fulfilling','Delivery accepted shipment',service,event.event_reference);
        await this.enqueue(q,order.order_id,'delivery','verify_delivery');
      } else if(service==='delivery'&&action==='verify_delivery') {
        insist(status==='delivered'&&event.tracking_reference===order.tracking_reference&&typeof event.proof_reference==='string'&&event.proof_reference.length>0,'Delivery proof and matching tracking reference required.');
        insist(order.order_status==='fulfilling'&&order.payment==='verified'&&!order.reconciliation,'Order is not eligible for completion.',409);
        await mark({shipment:'delivered'});
        await this.transition(q,order,'completed',`Verified delivery proof: ${event.proof_reference}`,service,event.event_reference);
      } else if(service==='billing'&&action==='cancel') {
        insist(['cancelled_unpaid','paid'].includes(status),'Billing must authoritatively cancel unpaid payment requests, or report paid.');
        if(status==='paid') {
          insist(event.currency==='PHP'&&money(event.amount)===money(order.order_total),'Paid cancellation result amount does not match.');
          text(event.transaction_reference,'Transaction reference',100); text(event.invoice_reference,'Invoice reference',100);
          insist(!order.invoice_reference||event.invoice_reference===order.invoice_reference,'Paid cancellation invoice does not match.');
          await mark({payment:'verified',billing_clear:0,transaction_reference:event.transaction_reference,invoice_reference:event.invoice_reference});
          await reconcile('Payment succeeded during cancellation. Manual reconciliation required; paid cancellation is outside scope.');
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
      await q('INSERT INTO sales_event (event_reference,request_reference,order_id,service,payload,created_at) VALUES (?,?,?,?,?,?)',[event.event_reference,event.request_reference,order.order_id,service,JSON.stringify(event),now()]);
      await q("UPDATE sales_outbox SET status='done',last_error=NULL,lease_until=0 WHERE request_reference=?",[event.request_reference]);
      return {accepted:true};
    });
  }
  async requests(user) { insist(user.role==='staff','Staff access required.',403); return this.db.query('SELECT * FROM sales_outbox ORDER BY created_at DESC LIMIT 500'); }
}




