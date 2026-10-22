export const statuses = ['draft','pending_stock','awaiting_payment','confirmed','fulfilling','completed','cancellation_pending','cancelled'];
export const label = value => String(value || 'not available').replaceAll('_',' ').replace(/^./, c => c.toUpperCase());
export function nextStep(order, staff = false) {
  if (order.reconciliation) return staff ? 'Needs attention — review the verified service results before proceeding.' : 'Your order needs a review by the sales team. Progress is paused.';
  if (['reserved','confirmed'].includes(order.stock) && order.reservation_expires && Number(order.reservation_expires) <= Date.now() && !['completed','cancelled'].includes(order.order_status)) return 'Stock reservation expired. Waiting for the sales team to review.';
  if (order.payment === 'verified' && order.order_status === 'awaiting_payment') return 'Payment verified. Waiting for Inventory to confirm stock is still valid.';
  return {
    draft: 'Continue your draft, then review the prices before submitting.',
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
  const stopped = ['draft','cancelled','cancellation_pending'].includes(order.order_status);
  const submitted = Boolean(order.order_date) && order.order_status !== 'draft';
  const stockValid = ['reserved','confirmed'].includes(order.stock) && Number(order.reservation_expires) > time;
  const historicalStock = order.order_status === 'completed' && order.history?.some(h => h.new_status === 'awaiting_payment');
  const checks = [submitted, submitted && Boolean(stockValid || historicalStock), order.payment === 'verified', ['accepted','delivered'].includes(order.shipment) && Boolean(order.tracking_reference), order.order_status === 'completed' && order.shipment === 'delivered' && order.payment === 'verified'];
  const names = ['Submitted','Stock reserved','Payment verified','Preparing delivery','Delivered'];
  let current = false;
  return names.map((name,i) => {
    const done = !stopped && checks[i];
    const active = !stopped && !order.reconciliation && !done && !current;
    if (active) current = true;
    return {name,done,active,state:done?'Verified':active?'Waiting':'Not reached'};
  });
}
export const canCancel = order => ['draft','pending_stock','awaiting_payment'].includes(order.order_status) && order.payment !== 'verified';
export function sumCentavos(rows) {
  return rows.reduce((sum,row) => { const [whole,fraction=''] = String(row.order_total||'0').split('.'); return sum + Number(whole)*100+Number(fraction.padEnd(2,'0')); },0);
}
