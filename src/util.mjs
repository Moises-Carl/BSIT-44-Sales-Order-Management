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

