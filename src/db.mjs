import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { passwordHash } from './util.mjs';
export async function connect({ demo = false, file = 'data/demo.sqlite', mysqlUrl = process.env.MYSQL_URL } = {}) {
  let sqlite, pool;
  if (demo) {
    const { DatabaseSync } = await import('node:sqlite');
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  } else {
    if (!mysqlUrl) throw new Error('MYSQL_URL is required. Use npm run demo for the isolated local simulator.');
    const mysql = await import('mysql2/promise');
    pool = mysql.createPool({ uri: mysqlUrl, decimalNumbers: false, dateStrings: true, connectionLimit: 5 });
  }
  let queue = Promise.resolve();
  const query = async (sql, args = [], connection) => {
    if (sqlite) {
      const statement = sqlite.prepare(sql);
      if (/^\s*(SELECT|PRAGMA)/i.test(sql)) return statement.all(...args);
      const result = statement.run(...args);
      return { insertId: Number(result.lastInsertRowid), affectedRows: result.changes };
    }
    const [result] = await (connection || pool).execute(sql, args);
    return result;
  };
  const db = {
    demo, query,
    async tx(work) {
      const task = queue.then(async () => {
        const c = pool ? await pool.getConnection() : null;
        let locked = false;
        try {
          // Shared lock also serializes multiple Sales processes using the same MySQL database.
          if (c) { const [rows] = await c.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':sales-workflow'), 15) AS acquired"); if (rows[0].acquired !== 1) throw new Error('Sales database is busy. Retry.'); locked = true; await c.beginTransaction(); }
          else sqlite.exec('BEGIN IMMEDIATE');
          const q = (sql, args = []) => query(sql, args, c);
          const value = await work(q);
          if (c) await c.commit(); else sqlite.exec('COMMIT');
          return value;
        } catch (error) { if (c) await c.rollback(); else sqlite.exec('ROLLBACK'); throw error; }
        finally { if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':sales-workflow'))"); c?.release(); }
      });
      queue = task.catch(() => {});
      return task;
    },
    async close() { await queue; if (pool) await pool.end(); sqlite?.close(); }
  };
  if (demo) await initializeDemo(db, sqlite);
  return db;
}
export const profileSchema = `CREATE TABLE IF NOT EXISTS sales_customer_profile (customer_id INTEGER PRIMARY KEY, default_recipient_name VARCHAR(150) NOT NULL, default_delivery_address TEXT NOT NULL)`;
export const extensions = (mysql = false) => {
  const id = mysql ? 'INTEGER PRIMARY KEY AUTO_INCREMENT' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  return [
    profileSchema,
    `CREATE TABLE IF NOT EXISTS sales_user (user_id ${id}, email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL, customer_id INTEGER)`,
    `CREATE TABLE IF NOT EXISTS sales_session (token VARCHAR(100) PRIMARY KEY, user_id INTEGER NOT NULL, csrf VARCHAR(100) NOT NULL, expires BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sales_order_facts (order_id INTEGER PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, stock VARCHAR(30) NOT NULL DEFAULT 'none', payment VARCHAR(30) NOT NULL DEFAULT 'none', shipment VARCHAR(30) NOT NULL DEFAULT 'none', reservation_json TEXT, reservation_expires BIGINT, invoice_reference VARCHAR(100), transaction_reference VARCHAR(100), tracking_reference VARCHAR(100), reconciliation TEXT, billing_clear INTEGER NOT NULL DEFAULT 0, release_clear INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS sales_outbox (request_reference VARCHAR(100) PRIMARY KEY, order_id INTEGER NOT NULL, service VARCHAR(30) NOT NULL, action VARCHAR(30) NOT NULL, payload TEXT NOT NULL, status VARCHAR(30) NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, lease_until BIGINT NOT NULL DEFAULT 0, created_at VARCHAR(40) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sales_event (event_reference VARCHAR(100) PRIMARY KEY, request_reference VARCHAR(100) NOT NULL, order_id INTEGER NOT NULL, service VARCHAR(30) NOT NULL, payload TEXT NOT NULL, created_at VARCHAR(40) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sales_simulator_result (request_reference VARCHAR(100) PRIMARY KEY, response TEXT NOT NULL)`
  ];
};
async function initializeDemo(db, sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS category (category_id INTEGER PRIMARY KEY, category_name TEXT NOT NULL UNIQUE, description TEXT);
    CREATE TABLE IF NOT EXISTS product (product_id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES category, product_name TEXT NOT NULL, description TEXT, product_status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS seller (seller_id INTEGER PRIMARY KEY, seller_name TEXT NOT NULL, contact_email TEXT, seller_status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS seller_offer (offer_id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL REFERENCES seller, product_id INTEGER NOT NULL REFERENCES product, selling_price TEXT NOT NULL, offer_status TEXT NOT NULL DEFAULT 'active', UNIQUE(offer_id,seller_id), UNIQUE(seller_id,product_id));
    CREATE TABLE IF NOT EXISTS customer (customer_id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, email TEXT, contact_number TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sales_order (order_id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customer, seller_id INTEGER NOT NULL REFERENCES seller, submission_reference TEXT UNIQUE, order_date TEXT, order_status TEXT NOT NULL DEFAULT 'draft' CHECK(order_status IN ('draft','pending_stock','awaiting_payment','confirmed','fulfilling','completed','cancellation_pending','cancelled')), order_total TEXT NOT NULL DEFAULT '0.00', recipient_name TEXT, recipient_contact TEXT, requested_delivery_address TEXT, cancellation_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(order_id,seller_id));
    CREATE TABLE IF NOT EXISTS order_item (order_item_id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, seller_id INTEGER NOT NULL, offer_id INTEGER NOT NULL, product_name_at_order TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price_at_order TEXT NOT NULL, UNIQUE(order_id,offer_id), FOREIGN KEY(order_id,seller_id) REFERENCES sales_order(order_id,seller_id), FOREIGN KEY(offer_id,seller_id) REFERENCES seller_offer(offer_id,seller_id));
    CREATE TABLE IF NOT EXISTS order_status_history (history_id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES sales_order, previous_status TEXT, new_status TEXT NOT NULL, changed_at TEXT DEFAULT CURRENT_TIMESTAMP, change_source TEXT NOT NULL, actor_reference TEXT, reason TEXT, source_event_reference TEXT UNIQUE);
    CREATE VIEW IF NOT EXISTS v_orderable_offer AS SELECT o.offer_id,o.seller_id,o.product_id,p.product_name,o.selling_price FROM seller_offer o JOIN product p ON p.product_id=o.product_id JOIN seller s ON s.seller_id=o.seller_id WHERE o.offer_status='active' AND p.product_status='active' AND s.seller_status='active';
  `);
  for (const statement of extensions()) sqlite.exec(statement);
  const [existing] = await db.query('SELECT COUNT(*) AS n FROM sales_user');
  if (existing.n) return;
  await db.tx(async q => {
    await q("INSERT INTO category VALUES (1,'Campus essentials','Local demonstration catalogue')");
    await q("INSERT INTO seller VALUES (1,'Campus Supply Co.','supply@example.test','active'),(2,'Studio Paper','paper@example.test','active')");
    const products = [[1,'Everyday notebook','A5 ruled · 80 pages','89.50',1],[2,'Canvas tote bag','Natural cotton · campus edition','249.00',1],[3,'Stainless tumbler','500 ml · midnight blue','495.00',1],[4,'Gel pen set','Black ink · pack of 3','75.25',1],[5,'Weekly desk planner','Undated · 52 sheets','159.00',2],[6,'Index cards','Pastel · pack of 100','65.00',2]];
    for (const [id,name,description,price,seller] of products) {
      await q('INSERT INTO product (product_id,category_id,product_name,description,product_status) VALUES (?,1,?,?,?)',[id,name,description,'active']);
      await q('INSERT INTO seller_offer VALUES (?,?,?,?,?)',[id,seller,id,price,'active']);
    }
    await q('INSERT INTO customer (customer_name,email,contact_number) VALUES (?,?,?)',['Alex Santos','alex@example.test','09171234567']);
    await q('INSERT INTO customer (customer_name,email,contact_number) VALUES (?,?,?)',['Jamie Reyes','jamie@example.test','09181234567']);
    for (const [email,role,customer] of [['admin@example.test','staff',null],['alex@example.test','customer',1],['jamie@example.test','customer',2]]) {
      await q('INSERT INTO sales_user (email,password_hash,role,customer_id) VALUES (?,?,?,?)',[email,passwordHash('CampusDemo2026!'),role,customer]);
    }
  });
}
