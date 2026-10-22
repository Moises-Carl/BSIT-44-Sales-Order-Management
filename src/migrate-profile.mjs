import { connect, profileSchema } from './db.mjs';
const db=await connect();
try { await db.query(profileSchema); console.log('Customer profile table ready; existing records preserved.'); } finally { await db.close(); }
