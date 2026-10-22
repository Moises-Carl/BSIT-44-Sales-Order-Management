import { insist, text, passwordHash } from './util.mjs';
export class Accounts {
 constructor(db){this.db=db;}
 async register(data){
  insist(data.role===undefined&&data.customer_id===undefined&&data.user_id===undefined,'Customer registration cannot assign privileges or identity.');
  const name=text(data.name,'Full name'),email=text(data.email,'Email',255).toLowerCase();
  insist(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Enter a valid email address.');
  insist(typeof data.password==='string'&&data.password.length>=12&&data.password.length<=200,'Use a password of 12–200 characters.');
  insist(data.password===data.password_confirmation,'Passwords must match.');
  const hash=passwordHash(data.password);
  return this.db.tx(async q=>{
   const existing=await q('SELECT user_id FROM sales_user WHERE email=?',[email]);insist(!existing.length,'An account with this email already exists. Sign in instead.',409);
   const customer=await q('INSERT INTO customer (customer_name,email,contact_number) VALUES (?,?,?)',[name,email,'']);
   const result=await q('INSERT INTO sales_user (email,password_hash,role,customer_id) VALUES (?,?,?,?)',[email,hash,'customer',customer.insertId]);
   await q('INSERT INTO sales_customer_profile (customer_id,default_recipient_name,default_delivery_address) VALUES (?,?,?)',[customer.insertId,name,'']);
   return {user_id:result.insertId,email,role:'customer',customer_id:customer.insertId};
  });
 }
 async profile(user){
  insist(user.role==='customer','Customer profile access required.',403);
  const [row]=await this.db.query('SELECT c.customer_id,c.customer_name,c.email,c.contact_number,p.default_recipient_name,p.default_delivery_address FROM customer c LEFT JOIN sales_customer_profile p ON p.customer_id=c.customer_id WHERE c.customer_id=?',[user.customer_id]);
  insist(row,'Profile not found.',404);return {...row,default_recipient_name:row.default_recipient_name??row.customer_name,default_delivery_address:row.default_delivery_address??''};
 }
 async update(data,user){
  insist(user.role==='customer','Customer profile access required.',403);
  const name=text(data.customer_name,'Full name');
  const clean=(key,max)=>{insist(typeof data[key]==='string'&&data[key].trim().length<=max,'Invalid '+key+' (maximum '+max+' characters).');return data[key].trim();};
  const contact=clean('contact_number',30),recipient=clean('default_recipient_name',150),address=clean('default_delivery_address',3000);
  await this.db.tx(async q=>{
   await q('UPDATE customer SET customer_name=?,contact_number=? WHERE customer_id=?',[name,contact,user.customer_id]);
   const [row]=await q('SELECT customer_id FROM sales_customer_profile WHERE customer_id=?',[user.customer_id]);
   if(row)await q('UPDATE sales_customer_profile SET default_recipient_name=?,default_delivery_address=? WHERE customer_id=?',[recipient,address,user.customer_id]);
   else await q('INSERT INTO sales_customer_profile (customer_id,default_recipient_name,default_delivery_address) VALUES (?,?,?)',[user.customer_id,recipient,address]);
  });return this.profile(user);
 }
}
