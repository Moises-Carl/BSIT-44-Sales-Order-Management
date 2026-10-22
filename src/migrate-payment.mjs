import {connect,paymentSchema} from './db.mjs';
const db=await connect();
try {await db.query(paymentSchema);console.log('Order payment method table ready; existing orders remain prepaid.');} finally {await db.close();}
