const crypto=require('node:crypto');
const fs=require('node:fs');
const {guardarPrivado}=require('./acciones');
const dias=30, segundos=dias*86400;
function mismoOrigen(req) {
  try { return new URL(req.headers.origin).host===req.headers.host; } catch { return false; }
}
function crearAcceso(password,file) {
  let sessions={};
  if(file && fs.existsSync(file)) sessions=JSON.parse(fs.readFileSync(file,'utf8'));
  const id=t=>crypto.createHmac('sha256',t).update(password).digest('hex');
  const token=req=>(req.headers.cookie||'').match(/(?:^|;\s*)clara_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  function save(next) { if(file) guardarPrivado(file,next); sessions=next; }
  function page(res,status=200) {
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'"});
    res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar · Clara</title><main><h1>Entrar en Clara</h1>${status===401?'<p role="alert">Usuario o contraseña incorrectos.</p>':''}<form method="post" action="/entrar"><p><label>Usuario <input name="username" autocomplete="username" required></label></p><p><label>Contraseña <input type="password" name="password" autocomplete="current-password" required></label></p><p><label><input type="checkbox" name="recordar" checked> Mantener la sesión en este navegador durante 30 días</label></p><button>Entrar</button></form></main></html>`);
  }
  return {
    valid(req) { const t=token(req); return !!t && sessions[id(t)]>Date.now(); },
    async handle(path,req,res) {
      if(path==='/entrar' && req.method==='GET') return page(res);
      if(req.method!=='POST'||!mismoOrigen(req)){res.writeHead(403);return res.end();}
      const cookie=`; Path=/; HttpOnly; SameSite=Lax${req.socket.encrypted||req.headers.origin.startsWith('https://')?'; Secure':''}`;
      try {
        if(path==='/salir'){
          const next={...sessions}, t=token(req); if(t) delete next[id(t)];
          save(next);
          res.writeHead(303,{Location:'/entrar','Set-Cookie':'clara_session=; Max-Age=0'+cookie,'Cache-Control':'no-store'});return res.end();
        }
        let body='';
        for await(const chunk of req){body+=chunk;if(body.length>8192){res.writeHead(413);return res.end();}}
        const form=new URLSearchParams(body), p=Buffer.from(form.get('password')||''), expected=Buffer.from(password);
        if(form.get('username')!=='clara'||p.length!==expected.length||!crypto.timingSafeEqual(p,expected))return page(res,401);
        const t=crypto.randomBytes(32).toString('hex'), now=Date.now(), remember=form.has('recordar');
        const next=Object.fromEntries(Object.entries(sessions).filter(([,exp])=>exp>now).slice(-99));
        next[id(t)]=now+1000*(remember?segundos:86400);save(next);
        res.writeHead(303,{Location:'/','Cache-Control':'no-store','Set-Cookie':`clara_session=${t}${remember?'; Max-Age='+segundos:''}${cookie}`});res.end();
      } catch {res.writeHead(503);res.end('No se pudo guardar la sesión.');}
    }
  };
}
module.exports={crearAcceso,mismoOrigen};
