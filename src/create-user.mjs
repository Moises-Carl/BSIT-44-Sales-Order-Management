import { connect } from './db.mjs';
import { passwordHash, insist } from './util.mjs';
// Provision from trusted shell environment; customer ownership cannot be assigned by a browser.
const email=process.env.NEW_USER_EMAIL?.toLowerCase().trim(),password=process.env.NEW_USER_PASSWORD;
const customer=Number(process.env.NEW_USER_CUSTOMER_ID);
insist(email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Set a valid NEW_USER_EMAIL.');
insist(password&&password.length>=12,'Set NEW_USER_PASSWORD to 12+ characters.');
insist(Number.isSafeInteger(customer)&&customer>0,'Set NEW_USER_CUSTOMER_ID to an existing Sales customer ID.');
const db=await connect();
try {await db.tx(async q=>{const [row]=await q('SELECT customer_id FROM customer WHERE customer_id=?',[customer]);insist(row,'Customer does not exist.');await q('INSERT INTO sales_user (email,password_hash,role,customer_id) VALUES (?,?,?,?)',[email,passwordHash(password),'customer',customer]);});console.log('Customer login created.');}finally{await db.close();}
