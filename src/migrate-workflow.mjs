import {connect,notificationSchema} from './db.mjs';
const db=await connect();
try {await db.query(notificationSchema(true));console.log('Persistent customer notifications ready; existing records preserved.');} finally {await db.close();}
