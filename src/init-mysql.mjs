import { readFile } from 'node:fs/promises';
import { connect, extensions } from './db.mjs';
import { passwordHash } from './util.mjs';
const db=await connect();
try {
  const existing=await db.query('SHOW TABLES');
  if(existing.length) throw new Error('Initialization requires a completely empty, dedicated database. Existing databases need a reviewed migration; nothing was changed.');
  const email=process.env.ADMIN_EMAIL, password=process.env.ADMIN_PASSWORD;
  if(!email||!password||password.length<12) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) before initialization.');
  const reference=new URL('../MiniERP_Sales_Order_Codex_Package/MiniERP_Sales_Order_Codex_Package/references/00_combined/System1_and_2.sql',import.meta.url);
  const sql=(await readFile(reference,'utf8')).replace(/^--.*$/gm,'').replace(/CREATE DATABASE[^;]+;/i,'').replace(/USE mini_erp;/i,'');
  // Original schema is retained; no DROP, TRUNCATE, overwrite, or sample Catalogue inserts.
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.query(statement);
  for(const statement of extensions(true)) await db.query(statement);
  await db.query('INSERT INTO sales_user (email,password_hash,role) VALUES (?,?,?)',[email.toLowerCase(),passwordHash(password),'staff']);
  console.log('Fresh database initialized. Catalogue is empty: connect authoritative Catalogue data before creating orders.');
} finally {await db.close();}
