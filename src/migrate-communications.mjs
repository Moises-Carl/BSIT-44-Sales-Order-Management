import {connect,communicationSchema} from './db.mjs';
const db=await connect();
try {for(const statement of communicationSchema(true))await db.query(statement);console.log('Order conversations and delivery updates ready.');}finally{await db.close();}
