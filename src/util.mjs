import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
export class Problem extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const insist = (condition, message, status = 422, details) => { if (!condition) throw new Problem(status, message, details); };
export const uid = () => randomUUID();
export const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
export function money(value) {
  const text = String(value);
  insist(/^\d{1,10}(\.\d{1,2})?$/.test(text), 'Invalid monetary amount.');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  insist(Number.isSafeInteger(cents) && cents <= 999999999999, 'Amount exceeds the supported limit.');
  return cents;
}
export const decimal = cents => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
export function text(value, name, max = 150) {
  insist(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${name} is required (maximum ${max} characters).`);
  return value.trim();
}
export function passwordHash(password, salt = uid()) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
}


// Compare event content independently of JSON object property order.
export function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function canonicalEvent(event) {
  const copy={...event};
  if(Array.isArray(copy.reservations)) copy.reservations=[...copy.reservations].sort((a,b)=>(a?.order_item_id||0)-(b?.order_item_id||0));
  if(Array.isArray(copy.order_item_ids)) copy.order_item_ids=[...copy.order_item_ids].sort((a,b)=>a-b);
  return canonicalJSON(copy);
}
export function reservationIdentity(reservations) {
  insist(Array.isArray(reservations),'Reservation details must be a list.');
  const itemIds=new Set(),reservationIds=new Set();
  const result=reservations.map(r=>{
    insist(r&&Number.isSafeInteger(r.order_item_id)&&r.order_item_id>0&&Number.isSafeInteger(r.offer_id)&&r.offer_id>0&&Number.isSafeInteger(r.quantity)&&r.quantity>0,'Invalid reservation details.');
    text(r.reservation_id,'Reservation ID',100);
    insist(!itemIds.has(r.order_item_id)&&!reservationIds.has(r.reservation_id),'Duplicate reservation details.');
    itemIds.add(r.order_item_id);reservationIds.add(r.reservation_id);
    return {order_item_id:r.order_item_id,offer_id:r.offer_id,quantity:r.quantity,reservation_id:r.reservation_id};
  });
  return canonicalJSON(result.sort((a,b)=>a.order_item_id-b.order_item_id));
}
export const sameReservations=(a,b)=>reservationIdentity(a)===reservationIdentity(b);
export function sameItemIds(a,b) {
  return Array.isArray(a)&&a.length===b.length&&a.every(Number.isSafeInteger)&&new Set(a).size===a.length&&canonicalJSON([...a].sort((x,y)=>x-y))===canonicalJSON([...b].sort((x,y)=>x-y));
}
