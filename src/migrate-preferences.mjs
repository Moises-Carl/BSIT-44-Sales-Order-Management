import {connect,preferenceSchema} from './db.mjs';
const db=await connect();
try{await db.query(preferenceSchema);console.log('Payment preferences ready.');}finally{await db.close();}
