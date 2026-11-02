'use strict';
// KHADRE221 : serveur de la boutique (aucune dépendance, Node 18+)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||3000,DATA=process.env.DATA_DIR||path.join(__dirname,'data'),PUB=path.join(__dirname,'public'),ADMIN=process.env.ADMIN_PASSWORD;
if(!ADMIN||ADMIN.length<8){console.error('Définissez la variable ADMIN_PASSWORD (8 caractères minimum).');process.exit(1)}
fs.mkdirSync(path.join(DATA,'uploads'),{recursive:true});
const DBF=path.join(DATA,'db.json');
const db=JSON.parse(fs.readFileSync(fs.existsSync(DBF)?DBF:path.join(__dirname,'seed.json'),'utf8'));
const save=()=>{fs.writeFileSync(DBF+'.tmp',JSON.stringify(db));fs.renameSync(DBF+'.tmp',DBF)};
save();
const MIME={'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
const STATUS=['Nouvelle','Confirmée','En livraison','Livrée','Annulée'],PAY=['Wave','Orange Money','Paiement à la livraison'];
const sessions=new Map(),hits=new Map();
// Notification par e-mail à chaque nouvelle commande (service Resend, facultatif)
const RESEND=process.env.RESEND_API_KEY,NOTIFY=process.env.NOTIFY_EMAIL,FROM=process.env.NOTIFY_FROM||'KHADRE221 <onboarding@resend.dev>',RESEND_URL=process.env.RESEND_API_URL||'https://api.resend.com/emails';
const fmt=n=>n.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g,' ')+' FCFA';
async function notifyMail(o){
  if(!RESEND||!NOTIFY)return;
  const text=['Nouvelle commande '+o.ref,'','Client : '+o.nom,'Téléphone : '+o.tel,'Adresse : '+o.adr+', '+o.quartier+', '+o.ville+' ('+o.zone+')',o.note?'Instructions : '+o.note:'','Paiement souhaité : '+o.pay,'','Articles :'].concat(o.lines.map(l=>'- '+l.br+' '+l.n+' ('+l.s+') x'+l.q+' : '+fmt(l.q*l.p))).concat(['','Sous-total : '+fmt(o.sub),'Livraison : '+fmt(o.fee),'Total : '+fmt(o.total),'','Gérez la commande dans l’administration (/admin).']).filter((x,i,a)=>x!==''||a[i-1]!=='').join('\n');
  try{
    const r=await fetch(RESEND_URL,{method:'POST',headers:{Authorization:'Bearer '+RESEND,'Content-Type':'application/json'},body:JSON.stringify({from:FROM,to:[NOTIFY],subject:'Nouvelle commande '+o.ref+' : '+fmt(o.total),text})});
    if(!r.ok)console.error('Notification e-mail refusée ('+r.status+') : '+(await r.text()));
  }catch(e){console.error('Notification e-mail impossible : '+e.message)}
}
const limited=(k,max,ms)=>{const n=Date.now(),a=(hits.get(k)||[]).filter(t=>n-t<ms);a.push(n);hits.set(k,a);return a.length>max};
const ipOf=r=>(r.headers['x-forwarded-for']||r.socket.remoteAddress||'').split(',')[0].trim();
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o))};
const body=req=>new Promise((ok,ko)=>{let b='',n=0;req.on('data',d=>{n+=d.length;if(n>7e6){ko(new Error('Fichier trop volumineux'));req.destroy()}else b+=d});req.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch(e){ko(new Error('Requête invalide'))}})});
const str=(v,n)=>String(v==null?'':v).trim().slice(0,n);
const num=(v,max)=>{v=Math.round(+v);return Number.isFinite(v)&&v>=0&&v<=max?v:0};
const safeEq=(a,b)=>{const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();return crypto.timingSafeEqual(x,y)};
const isAdmin=req=>{const m=/(?:^|; )kh_s=([a-f0-9]+)/.exec(req.headers.cookie||'');return !!m&&(sessions.get(m[1])||0)>Date.now()};
const pub=p=>({id:p.id,br:p.br,b:p.b,n:p.n,c:p.c,p:p.p,o:p.o||0,t:p.t||'',bs:p.bs||0,q:p.q,e:p.e,s:p.s,f:p.f,top:p.top,heart:p.heart,base:p.base,d:p.d,img:p.img||''});
// Notification WhatsApp gratuite vers votre propre numéro (service CallMeBot, facultatif)
const CMB_PHONE=process.env.CALLMEBOT_PHONE,CMB_KEY=process.env.CALLMEBOT_KEY,CMB_URL=process.env.CALLMEBOT_URL||'https://api.callmebot.com/whatsapp.php';
async function notifyWhatsApp(o){
  if(!CMB_PHONE||!CMB_KEY)return;
  const text='Nouvelle commande '+o.ref+'\n'+o.nom+' ('+o.tel+')\n'+o.lines.map(l=>l.br+' '+l.n+' x'+l.q).join(', ')+'\nTotal : '+fmt(o.total)+'\nPaiement : '+o.pay+'\nDétails dans /admin';
  try{
    const r=await fetch(CMB_URL+'?phone='+encodeURIComponent(CMB_PHONE)+'&text='+encodeURIComponent(text)+'&apikey='+encodeURIComponent(CMB_KEY));
    if(!r.ok)console.error('Notification WhatsApp refusée ('+r.status+')');
  }catch(e){console.error('Notification WhatsApp impossible : '+e.message)}
}
function notify(o){notifyMail(o);notifyWhatsApp(o)}
function createOrder(b){
  if(b.hp)return{ref:'KH-00000'};
  const nom=str(b.nom,80),ville=str(b.ville,60),quartier=str(b.quartier,60),adr=str(b.adr,160),note=str(b.note,300),pay=str(b.pay,40);
  const tel=str(b.tel,25).replace(/\D/g,'').replace(/^(00)?221/,'');
  if(nom.length<3||ville.length<2||quartier.length<2||adr.length<3)throw new Error('Veuillez remplir tous les champs obligatoires.');
  if(!/^[37]\d{8}$/.test(tel))throw new Error('Numéro de téléphone invalide (9 chiffres, ex. 77 123 45 67).');
  if(!PAY.includes(pay))throw new Error('Moyen de paiement invalide.');
  const z=db.zones[+b.zone];if(!z)throw new Error('Zone de livraison invalide.');
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>20)throw new Error('Votre panier est vide.');
  const want=new Map();
  for(const it of b.items){const id=+it.id,q=Math.floor(+it.q);if(!Number.isInteger(id)||!(q>=1&&q<=20))throw new Error('Quantité invalide.');want.set(id,(want.get(id)||0)+q)}
  const lines=[];let sub=0;
  for(const[id,q]of want){
    const p=db.products.find(x=>x.id===id&&x.active);
    if(!p)throw new Error('Un produit de votre panier n’est plus disponible.');
    if(p.q<q)throw new Error('Stock insuffisant pour '+p.br+' '+p.n+' (disponible : '+p.q+').');
    lines.push({id,n:p.n,br:p.br,s:p.s,q,p:p.p});sub+=q*p.p;
  }
  lines.forEach(l=>{db.products.find(x=>x.id===l.id).q-=l.q});
  const ref='KH-'+String(++db.seq).padStart(5,'0');
  db.orders.unshift({ref,date:new Date().toISOString(),status:'Nouvelle',paid:false,nom,tel,zone:z[0],delai:z[2],ville,quartier,adr,note,pay,lines,sub,fee:z[1],total:sub+z[1]});
  save();return{ref};
}
function saveImage(d){
  const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(d||'');if(!m)throw new Error('Image invalide (JPG, PNG ou WebP).');
  const buf=Buffer.from(m[2],'base64');if(buf.length>4e6)throw new Error('Image trop lourde (4 Mo maximum).');
  const f='p'+Date.now()+'.'+(m[1]=='jpeg'?'jpg':m[1]);fs.writeFileSync(path.join(DATA,'uploads',f),buf);return'/uploads/'+f;
}
function upsertProduct(b){
  const p={br:str(b.br,50),b:str(b.b||b.br,12).toUpperCase(),n:str(b.n,60),c:['Homme','Femme','Mixte'].includes(b.c)?b.c:'Mixte',p:num(b.p,5e6),o:num(b.o,5e6),t:['','new','promo'].includes(b.t)?b.t:'',bs:b.bs?1:0,q:num(b.q,9999),active:!!b.active,e:str(b.e,40),s:str(b.s,20),f:str(b.f,60),top:str(b.top,160),heart:str(b.heart,160),base:str(b.base,160),d:str(b.d,400)};
  if(!p.n||!p.br||!p.p)throw new Error('Nom, marque et prix sont obligatoires.');
  let cur=b.id?db.products.find(x=>x.id===+b.id):null;
  if(b.id&&!cur)throw new Error('Produit introuvable.');
  const img=b.image?saveImage(b.image):null;
  if(cur)Object.assign(cur,p,img?{img}:{});
  else{if(!img)throw new Error('Une photo est obligatoire pour un nouveau parfum.');db.products.push(Object.assign({id:Math.max(0,...db.products.map(x=>x.id))+1,img},p))}
  save();
}
function stats(){
  const ok=db.orders.filter(o=>o.status!=='Annulée'),top={},byStatus={};
  db.orders.forEach(o=>{byStatus[o.status]=(byStatus[o.status]||0)+1});
  ok.forEach(o=>o.lines.forEach(l=>{const k=l.br+' '+l.n;top[k]=top[k]||{n:k,q:0,ca:0};top[k].q+=l.q;top[k].ca+=l.q*l.p}));
  return{orders:db.orders.length,revenue:ok.reduce((s,o)=>s+o.total,0),paid:db.orders.filter(o=>o.paid&&o.status!=='Annulée').reduce((s,o)=>s+o.total,0),byStatus,top:Object.values(top).sort((a,b)=>b.q-a.q).slice(0,8),low:db.products.filter(p=>p.q<=3).map(p=>({n:p.br+' '+p.n,q:p.q}))};
}
async function api(req,res,u){
  const m=req.method,p=u.pathname,ip=ipOf(req);
  if(m==='POST'&&!/application\/json/.test(req.headers['content-type']||''))return send(res,415,{error:'Format non pris en charge.'});
  if(m==='GET'&&p==='/api/products')return send(res,200,{products:db.products.filter(x=>x.active).map(pub),zones:db.zones});
  if(m==='POST'&&p==='/api/orders'){
    if(limited('o'+ip,8,36e5))return send(res,429,{error:'Trop de commandes depuis votre connexion. Réessayez plus tard ou appelez-nous.'});
    const out=createOrder(await body(req));if(out.ref!=='KH-00000')notify(db.orders[0]);return send(res,200,out);
  }
  if(m==='GET'&&p==='/api/track'){
    if(limited('t'+ip,20,6e5))return send(res,429,{error:'Trop de tentatives, réessayez dans quelques minutes.'});
    const ref=str(u.searchParams.get('ref'),12).toUpperCase(),tel=str(u.searchParams.get('tel'),25).replace(/\D/g,'').replace(/^(00)?221/,'');
    const o=db.orders.find(x=>x.ref===ref&&x.tel===tel);
    return o?send(res,200,{ref:o.ref,status:o.status,date:o.date,total:o.total}):send(res,404,{error:'Aucune commande trouvée avec ces informations.'});
  }
  if(m==='POST'&&p==='/api/admin/login'){
    if(limited('l'+ip,6,9e5))return send(res,429,{error:'Trop de tentatives, réessayez dans 15 minutes.'});
    const b=await body(req);
    if(!safeEq(String(b.password||''),ADMIN))return send(res,401,{error:'Mot de passe incorrect.'});
    const t=crypto.randomBytes(32).toString('hex');sessions.set(t,Date.now()+12*36e5);
    res.setHeader('Set-Cookie','kh_s='+t+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+(req.headers['x-forwarded-proto']==='https'?'; Secure':''));
    return send(res,200,{ok:1});
  }
  if(!p.startsWith('/api/admin/'))return send(res,404,{error:'Introuvable'});
  if(!isAdmin(req))return send(res,401,{error:'Connexion requise.'});
  if(m==='POST'&&p==='/api/admin/logout'){res.setHeader('Set-Cookie','kh_s=; Max-Age=0; Path=/');return send(res,200,{ok:1})}
  if(m==='GET'&&p==='/api/admin/data')return send(res,200,{products:db.products,orders:db.orders,zones:db.zones,stats:stats(),statuses:STATUS});
  if(m==='POST'&&p==='/api/admin/order'){
    const b=await body(req),o=db.orders.find(x=>x.ref===b.ref);if(!o)return send(res,404,{error:'Commande introuvable.'});
    if(b.status!==undefined){
      if(!STATUS.includes(b.status))return send(res,400,{error:'Statut invalide.'});
      if(o.status==='Annulée'&&b.status!=='Annulée')return send(res,400,{error:'Une commande annulée ne peut plus être modifiée.'});
      if(b.status==='Annulée'&&o.status!=='Annulée')o.lines.forEach(l=>{const pr=db.products.find(x=>x.id===l.id);if(pr)pr.q+=l.q});
      o.status=b.status;
    }
    if(b.paid!==undefined)o.paid=!!b.paid;
    save();return send(res,200,{ok:1});
  }
  if(m==='POST'&&p==='/api/admin/product'){upsertProduct(await body(req));return send(res,200,{ok:1})}
  if(m==='POST'&&p==='/api/admin/product/delete'){const b=await body(req);db.products=db.products.filter(x=>x.id!==+b.id);save();return send(res,200,{ok:1})}
  send(res,404,{error:'Introuvable'});
}
function serve(req,res,u){
  let p=decodeURIComponent(u.pathname);if(p==='/')p='/index.html';if(p==='/admin')p='/admin.html';
  const base=p.startsWith('/uploads/')?path.join(DATA,'uploads'):PUB,rel=p.startsWith('/uploads/')?p.slice(9):p;
  const f=path.normalize(path.join(base,rel));
  if(!f.startsWith(base+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Page introuvable')}
  const ext=path.extname(f),h={'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=86400'};
  if(f.endsWith('admin.html'))h['X-Robots-Tag']='noindex';
  res.writeHead(200,h);fs.createReadStream(f).pipe(res);
}
http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  try{const u=new URL(req.url,'http://x');u.pathname.startsWith('/api/')?await api(req,res,u):serve(req,res,u)}
  catch(e){if(!res.headersSent)send(res,400,{error:e.message||'Erreur'})}
}).listen(PORT,()=>console.log('KHADRE221 en ligne sur le port '+PORT));
