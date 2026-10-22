import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { connect } from './db.mjs';
import { Sales } from './sales.mjs';
import { Integrations, authentic } from './integrations.mjs';
import { insist, passwordMatches, Problem } from './util.mjs';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const loginAttempts=new Map();
export function application(db) {
  const sales=new Sales(db), integrations=new Integrations(sales);
  const server=createServer(async(req,res)=>{
    const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control','no-store');
    try {
      const url=new URL(req.url,'http://localhost'), path=url.pathname;
      if(path==='/health') return send(200,{ok:true,mode:db.demo?'demo':'live'});
      if(!path.startsWith('/api/')) {
        insist(req.method==='GET','Method not allowed.',405);
        const files={'/':'index.html','/app.js':'app.js','/ui.mjs':'ui.mjs','/style.css':'style.css'};
        insist(files[path],'Not found.',404);
        const content=await readFile(join(root,files[path]));
        res.writeHead(200,{'content-type':(path.endsWith('.js')||path.endsWith('.mjs'))?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(content);return;
      }
      req.setEncoding('utf8');
      let raw='';
      for await(const chunk of req) { raw+=chunk.toString(); insist(Buffer.byteLength(raw)<=131072,'Request too large.',413); }
      let data={};
      if(raw) { try {data=JSON.parse(raw);} catch {throw new Problem(400,'Invalid JSON.');} insist(data&&typeof data==='object'&&!Array.isArray(data),'Expected a JSON object.',400); }
      const hook=path.match(/^\/api\/events\/(inventory|billing|delivery)(\/lifecycle)?$/);
      if(hook) {
        insist(req.method==='POST','Method not allowed.',405);
        insist(!db.demo,'Live webhooks are disabled in demo mode.',403);
        insist(authentic(process.env[`${hook[1].toUpperCase()}_SECRET`],req.headers['x-sales-timestamp'],raw,req.headers['x-sales-signature']),'Invalid service signature.',401);
        if(hook[2]){insist(hook[1]==='inventory','Lifecycle endpoint not found.',404);return send(200,await sales.inventoryLifecycle(data));}
        return send(200,await sales.event(hook[1],data));
      }
      if(!['GET','HEAD'].includes(req.method)) {
        const origin=req.headers.origin;
        insist(!origin||origin===`http${req.socket.encrypted?'s':''}://${req.headers.host}`||origin===process.env.PUBLIC_ORIGIN,'Request origin rejected.',403);
        insist(req.headers['content-type']?.startsWith('application/json'),'JSON content type required.',415);
      }
      if(path==='/api/config'&&req.method==='GET') return send(200,{demo:db.demo,currency:'PHP'});
      if(path==='/api/login'&&req.method==='POST') {
        const key=req.socket.remoteAddress, attempt=loginAttempts.get(key);
        const record=attempt&&attempt.until>Date.now()?attempt:{count:0,until:Date.now()+900000};
        loginAttempts.set(key,record); insist(++record.count<=25,'Too many login attempts. Retry in 15 minutes.',429);
        const email=typeof data.email==='string'?data.email.toLowerCase().trim():'';
        const [user]=await db.query('SELECT * FROM sales_user WHERE email=?',[email]);
        insist(user&&typeof data.password==='string'&&data.password.length<=200&&passwordMatches(data.password,user.password_hash),'Email or password is incorrect.',401);
        loginAttempts.delete(key);
        const token=randomBytes(32).toString('hex'), csrf=randomBytes(24).toString('hex');
        await db.tx(async q=>{await q('DELETE FROM sales_session WHERE expires<?',[Date.now()]);await q('INSERT INTO sales_session (token,user_id,csrf,expires) VALUES (?,?,?,?)',[token,user.user_id,csrf,Date.now()+8*3600000]);});
        res.setHeader('Set-Cookie',`sales_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?'; Secure':''}`);
        return send(200,{user:{user_id:user.user_id,email:user.email,role:user.role,customer_id:user.customer_id},csrf});
      }
      const token=req.headers.cookie?.match(/(?:^|;\s*)sales_session=([a-f0-9]{64})(?:;|$)/)?.[1]||'';
      const [user]=await db.query('SELECT u.user_id,u.email,u.role,u.customer_id,s.csrf FROM sales_session s JOIN sales_user u ON u.user_id=s.user_id WHERE s.token=? AND s.expires>?',[token,Date.now()]);
      insist(user,'Please sign in.',401);
      if(req.method!=='GET') insist(req.headers['x-csrf-token']===user.csrf,'Session verification failed. Refresh and try again.',403);
      if(path==='/api/me'&&req.method==='GET') return send(200,{user,csrf:user.csrf});
      if(path==='/api/logout'&&req.method==='POST') {await db.tx(q=>q('DELETE FROM sales_session WHERE token=?',[token]));res.setHeader('Set-Cookie','sales_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
      if(path==='/api/offers'&&req.method==='GET') return send(200,await sales.offers());
      if(path==='/api/customers') {
        if(req.method==='GET') return send(200,await sales.customers(user));
        if(req.method==='POST') return send(201,await sales.createCustomer(data,user));
      }
      if(path==='/api/orders') {
        if(req.method==='GET') return send(200,await sales.list(user,Object.fromEntries(url.searchParams)));
        if(req.method==='POST') return send(201,await sales.save(data,user));
      }
      const match=path.match(/^\/api\/orders\/(\d+)(?:\/(review|submit|cancel))?$/);
      if(match) {
        const id=Number(match[1]),action=match[2];
        if(req.method==='GET'&&!action) return send(200,await sales.detail(id,user));
        if(req.method==='PUT'&&!action) return send(200,await sales.save(data,user,id));
        if(req.method==='POST'&&action==='review') return send(200,await sales.review(id,user));
        if(req.method==='POST'&&action==='submit') return send(200,await sales.submit(id,data,user));
        if(req.method==='POST'&&action==='cancel') return send(200,await sales.cancel(id,data,user));
      }
      if(path==='/api/operations/requests'&&req.method==='GET') return send(200,await sales.requests(user));
      if(path==='/api/operations/dispatch'&&req.method==='POST') return send(200,await integrations.dispatch(data.request_reference,user,data.outcome));
      throw new Problem(404,'Not found.');
    } catch(error) {
      if(!error.status) console.error(error);
      send(error.status||500,{error:error.status?error.message:'The server could not complete the request. Check its logs.',details:error.details});
    }
  });
  server.requestTimeout=20000;
  return {server,sales,integrations};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  const demo=process.argv.includes('--demo');
  if(demo&&process.env.NODE_ENV==='production') throw new Error('Demo mode cannot run in production.');
  const db=await connect({demo});
  const {server}=application(db);
  const port=Number(process.env.PORT||3100),host=process.env.HOST||'127.0.0.1';
  if(demo&&!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('Demo mode must bind to loopback.');
  server.listen(port,host,()=>console.log(`MiniERP ${demo?'DEMO — simulated integrations':'LIVE'}: http://${host}:${port}`));
  const stop=()=>server.close(async()=>{await db.close();process.exit(0);});
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

