import {salesOverview} from './overview.mjs';
import {resolution,resolutionActions,changeResolution} from './resolution.mjs';
import {paymentMethods} from './payment.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { connect } from './db.mjs';
import {processingEnd} from '../public/ui.mjs';
import { processingStage } from './processing.mjs';
import { Accounts } from './accounts.mjs';
import { Sales } from './sales.mjs';
import { Integrations, authentic } from './integrations.mjs';
import { insist, passwordMatches, Problem } from './util.mjs';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const loginAttempts=new Map();
export function application(db) {
  const accounts=new Accounts(db), sales=new Sales(db), integrations=new Integrations(sales);
  const server=createServer(async(req,res)=>{
    const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control','no-store');
    try {
      const url=new URL(req.url,'http://localhost'), path=url.pathname;
      if(path==='/health') return send(200,{ok:true,mode:db.demo?'demo':'live'});
      if(!path.startsWith('/api/')) {
        insist(req.method==='GET','Method not allowed.',405);
        const files={'/':'index.html','/app.js':'app.js','/ui.mjs':'ui.mjs','/style.css':'style.css','/product-images.mjs':'product-images.mjs','/demo-products.mjs':'demo-products.mjs',...Object.fromEntries(['notebook','tote','tumbler','pens','planner','cards'].map(name=>['/assets/demo-products/'+name+'.jpg','assets/demo-products/'+name+'.jpg']))};
        insist(files[path],'Not found.',404);
        const content=await readFile(join(root,files[path]));
        res.writeHead(200,{'content-type':(path.endsWith('.js')||path.endsWith('.mjs'))?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.jpg')?'image/jpeg':'text/html; charset=utf-8'});res.end(content);return;
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
      if(path==='/api/config'&&req.method==='GET') return send(200,{demo:db.demo,currency:'PHP',payment_methods:paymentMethods(db.demo)});
      if(['/api/login','/api/register'].includes(path)&&req.method==='POST') {
        const key=req.socket.remoteAddress, attempt=loginAttempts.get(key);
        const record=attempt&&attempt.until>Date.now()?attempt:{count:0,until:Date.now()+900000};
        loginAttempts.set(key,record); insist(++record.count<=25,'Too many login attempts. Retry in 15 minutes.',429);
        const email=typeof data.email==='string'?data.email.toLowerCase().trim():'';
        let user;
        if(path==='/api/register') user=await accounts.register(data);
        else [user]=await db.query('SELECT * FROM sales_user WHERE email=?',[email]);
        if(path==='/api/login') insist(user&&typeof data.password==='string'&&data.password.length<=200&&passwordMatches(data.password,user.password_hash),'Email or password is incorrect.',401);
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
      const orderAccess=path.match(/^\/api\/orders\/(\d+)(?:\/|$)/);
      if(user.role!=='customer'&&orderAccess){
        const [record]=await db.query('SELECT order_status FROM sales_order WHERE order_id=?',[Number(orderAccess[1])]);
        insist(record&&record.order_status!=='draft','Order not found.',404);
      }
      if(!['staff','customer'].includes(user.role)&&req.method!=='GET'&&path!=='/api/logout'&&!path.endsWith('/resolution'))insist(false,'This role can update only its resolution actions.',403);
      if(path==='/api/me'&&req.method==='GET') return send(200,{user,csrf:user.csrf});
      if(path==='/api/logout'&&req.method==='POST') {await db.tx(q=>q('DELETE FROM sales_session WHERE token=?',[token]));res.setHeader('Set-Cookie','sales_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true});}
      if(path==='/api/notifications'&&req.method==='GET')return send(200,await sales.notifications(user));
      const notificationMatch=path.match(/^\/api\/notifications\/(\d+)\/read$/);
      if(notificationMatch&&req.method==='POST')return send(200,await sales.readNotification(Number(notificationMatch[1]),user));
      if(path==='/api/sales-overview'&&req.method==='GET')return send(200,await salesOverview(db,user,Object.fromEntries(url.searchParams)));
      if(path==='/api/sales-inbox'&&req.method==='GET')return send(200,await sales.inbox(user));
      const followupMatch=path.match(/^\/api\/orders\/(\d+)\/(reschedule|order-again)$/);
      if(followupMatch?.[2]==='order-again')insist(user.role==='customer','New drafts belong to customer accounts.',403);
      if(followupMatch&&req.method==='POST')return send(201,await (followupMatch[2]==='reschedule'?sales.reschedule(Number(followupMatch[1]),data,user):sales.orderAgain(Number(followupMatch[1]),user)));
      const communicationMatch=path.match(/^\/api\/orders\/(\d+)\/(messages|delivery-updates)$/);
      if(communicationMatch&&req.method==='POST')return send(201,await sales[communicationMatch[2]==='messages'?'message':'deliveryUpdate'](Number(communicationMatch[1]),data,user));
      const resolutionMatch=path.match(/^\/api\/orders\/(\d+)\/resolution$/);
      if(resolutionMatch){
        const id=Number(resolutionMatch[1]);
        if(req.method==='GET'){
          insist(['staff','customer','billing','delivery','inventory','seller'].includes(user.role),'Access denied.',403);
          const o=await sales.detail(id,user.role==='customer'?user:{role:'staff'});
          insist(o.order_status!=='draft','Drafts have no resolution workflow.',409);
          return send(200,{...o.resolution,actions:resolutionActions(o.resolution,o,user,db.demo)});
        }
        if(req.method==='POST')return send(200,await changeResolution(sales,id,data,user));
      }
      const processingMatch=path.match(/^\/api\/orders\/(\d+)\/(processing|outcome|resolve)$/);
      if(processingMatch){
        insist(user.role==='staff','Staff access required.',403);
        const id=Number(processingMatch[1]),order=await sales.detail(id,user),requests=await sales.requests(user,id),stage=processingStage(order,requests,db.demo);
        if(req.method==='GET'&&processingMatch[2]==='processing')return send(200,stage);
        if(req.method==='POST'&&processingMatch[2]==='resolve')return send(200,await integrations.resolveStopped(id,user));
        if(req.method==='POST'&&processingMatch[2]==='outcome'){
          insist(data.version===stage.version,'This order changed. Refresh before applying an outcome.',409);
          insist(stage.options.some(o=>o.value===data.outcome),'This outcome is not available for the current stage.',409);
          if(['unsuccessful','cancel'].includes(data.outcome))insist(typeof data.reason==='string'&&data.reason.trim().length>0&&data.reason.trim().length<=1000,'Enter a customer-facing reason (up to 1,000 characters).');
          if(data.outcome==='reattempt')return send(200,await sales.reschedule(id,data,user));
          if(data.outcome==='cancel'){await sales.cancel(id,{reason:data.reason,version:data.version},user);if(db.demo)await integrations.resolveStopped(id,user);return send(200,{order_id:id});}
          insist(db.demo,'External results are authoritative in integrated mode.',403);
          insist(data.request_reference===stage.request_reference,'This processing stage changed. Refresh and try again.',409);
          const request=stage.request_reference?requests.find(r=>r.request_reference===stage.request_reference):await sales.prepareRetry(id,data.version,user);
          const outcome=data.outcome==='successful'?'success':request.action==='confirm'?'expired':request.service==='billing'&&request.action==='cancel'?'paid':'reject';
          const result=await integrations.dispatch(request.request_reference,user,outcome,data.reason,{recordAttempt:true});
          if(db.demo&&processingEnd(await sales.detail(id,user)).finished)await integrations.resolveStopped(id,user);
          return send(200,result);
        }
      }
      if(path==='/api/profile'&&req.method==='GET') return send(200,await accounts.profile(user));
      if(path==='/api/profile'&&req.method==='PUT') return send(200,await accounts.update(data,user));
      if(path==='/api/offers'&&req.method==='GET') return send(200,await sales.offers());
      if(path==='/api/customers') {
        if(req.method==='GET') return send(200,await sales.customers(user));
        if(req.method==='POST') return send(201,await sales.createCustomer(data,user));
      }
      if(path==='/api/orders') {
        if(req.method==='GET') return send(200,await sales.list(user,Object.fromEntries(url.searchParams)));
        if(req.method==='POST'){insist(user.role==='customer','Drafts are available only in customer accounts.',403);return send(201,await sales.save(data,user));}
      }
      const match=path.match(/^\/api\/orders\/(\d+)(?:\/(review|submit|cancel))?$/);
      if(match) {
        const id=Number(match[1]),action=match[2];
        if(req.method==='GET'&&!action) return send(200,await sales.detail(id,user));
        if(req.method==='PUT'&&!action) return send(200,await sales.save(data,user,id));
        if(req.method==='POST'&&action==='review') return send(200,await sales.review(id,user));
        if(req.method==='POST'&&action==='submit') return send(200,await sales.submit(id,data,user));
        if(req.method==='POST'&&action==='cancel'){await sales.cancel(id,data,user);if(db.demo)await integrations.resolveStopped(id,{role:'staff'});return send(200,{order_id:id});}
      }
      if(path==='/api/operations/requests'&&req.method==='GET') return send(200,await sales.requests(user,url.searchParams.get('order_id')));
      if(path==='/api/operations/dispatch'&&req.method==='POST') {
        insist(user.role==='staff','Staff access required.',403);
        if(db.demo&&['reject','expired','paid'].includes(data.outcome))insist(typeof data.reason==='string'&&data.reason.trim().length>0&&data.reason.trim().length<=1000,'Enter a customer-facing reason (up to 1,000 characters).');
        return send(200,await integrations.dispatch(data.request_reference,user,data.outcome,data.reason));
      }
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
  server.listen(port,host,()=>console.log(`BSIT-44 Sales-Order Management ${demo?'DEMO — simulated integrations':'LIVE'}: http://${host}:${port}`));
  const stop=()=>server.close(async()=>{await db.close();process.exit(0);});
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

