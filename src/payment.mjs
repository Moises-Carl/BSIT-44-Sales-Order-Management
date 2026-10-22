export const isCod = order => order.payment_method==='cod';
export const paymentMethodLabel = value => ({cod:'Cash on delivery',gcash:'GCash',bank_transfer:'Bank transfer',prepaid:'Pay in advance'})[value]||'Pay in advance';
export const paymentMethods = demo => [{value:'gcash',label:'GCash',description:'Pay before shipment. Billing verifies your payment.'},{value:'bank_transfer',label:'Bank transfer',description:'Transfer before shipment. Billing verifies your payment.'},...((demo||process.env.ENABLE_COD==='true')?[{value:'cod',label:'Cash on delivery',description:'Pay when your order arrives. Billing must verify the collection before completion.'}]:[])];
export const codReady = order => isCod(order)&&Boolean(order.invoice_reference)&&['confirmed','fulfilled'].includes(order.stock);
export const shipmentPaymentReady = order => order.payment==='verified'||codReady(order);
export const confirmationPaymentReady = order => order.payment==='verified'||isCod(order)&&Boolean(order.invoice_reference)&&order.payment==='pending';
