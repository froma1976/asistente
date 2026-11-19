const crypto = require('node:crypto');

function createPhone(getConfig, save, currentCall, invoices) {
  const password = process.env.CLARA_PASSWORD || crypto.randomBytes(18).toString('base64url');
  const tickets = new Map();
  let dialing = false;
  function equal(a, b) {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  function origin() {
    try {
      const u = new URL(getConfig().publicWebhookUrl);
      return u.protocol === 'https:' ? u.origin : '';
    } catch { return ''; }
  }
  function stream(details) {
    const key = crypto.randomBytes(32).toString('hex');
    tickets.set(key, details);
    setTimeout(() => tickets.delete(key), 150000).unref();
    return {key, xml:`<Response><Connect><Stream url="${origin().replace(/^https:/,'wss:')}/twilio/stream/${key}"/></Connect></Response>`};
  }
  const busy = () => currentCall()?.status === 'screening' || dialing || tickets.size > 0;
  const draining = () => process.env.CLARA_DATA_DIR && require('node:fs').existsSync(require('node:path').join(process.env.CLARA_DATA_DIR,'.deploying'));
  return {
    password: process.env.CLARA_PASSWORD ? '(la de CLARA_PASSWORD)' : password,
    authorized(req) {
      const auth = req.headers.authorization || '';
      return equal(auth, 'Basic ' + Buffer.from(`clara:${password}`).toString('base64')) &&
        (!req.headers.origin || (() => { try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; } })());
    },
    redeem(path) {
      const key = path.split('/').pop(), details = tickets.get(key);
      tickets.delete(key);
      return details;
    },
    async handle(path, req, res, readJson) {
      const cfg = getConfig();
      const send = (code, data) => { res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
      const missing = [];
      if (!cfg.geminiApiKey) missing.push('clave de Gemini');
      if (!cfg.twilioAccountSid || !cfg.twilioAuthToken || !cfg.twilioPhoneNumber) missing.push('cuenta y número de Twilio');
      if (!origin()) missing.push('URL pública HTTPS');
      const statusKey = path.match(/^\/twilio\/status\/([a-f0-9]{64})$/)?.[1];
      if (path === '/twilio/voice' || statusKey) {
        if (req.method !== 'POST' || !origin() || !cfg.twilioAuthToken) return send(403, {});
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 32768) return send(413, {}); }
        const params = new URLSearchParams(raw);
        const signed = origin() + req.url + [...new Set(params.keys())].sort().map(k => k + params.get(k)).join('');
        const sig = crypto.createHmac('sha1',cfg.twilioAuthToken).update(signed).digest('base64');
        if (!equal(sig,req.headers['x-twilio-signature'] || '')) return send(403,{});
        if (statusKey) {
          if (['completed','busy','failed','no-answer','canceled'].includes(params.get('CallStatus'))) tickets.delete(statusKey);
          return send(200,{});
        }
        res.writeHead(200, {'Content-Type':'text/xml'});
        return res.end(busy() || draining() || !cfg.geminiApiKey ? '<Response><Reject reason="busy"/></Response>' : stream({number:params.get('From'), goal:''}).xml);
      }
      if (path === '/api/phone' && req.method === 'GET') {
        const c = currentCall();
        return send(200, {busy:busy(), context:cfg.lifeContext || '', invoices:invoices(), missing, call:c && {status:c.status, number:c.fromNumber, transcript:c.transcript.slice(-8)}});
      }
      if (req.method !== 'POST') return send(405,{});
      let data;
      try { data = await readJson(req); } catch { return send(400,{error:'Mensaje no válido.'}); }
      if (path === '/api/phone/context') {
        if (typeof data?.context !== 'string' || data.context.length > 6000) return send(400,{error:'Máximo 6000 caracteres.'});
        cfg.lifeContext = data.context.trim(); save();
        return send(200,{});
      }
      if (path !== '/api/phone/dial') return send(404,{});
      return this.dial(data,send);
    },
    async dial(data,send,followId=null) {
      const cfg=getConfig(),missing=[];
      if(!cfg.geminiApiKey||!cfg.twilioAccountSid||!cfg.twilioAuthToken||!cfg.twilioPhoneNumber||!origin()) missing.push('configuración de llamadas');
      if (!/^\+[1-9]\d{6,14}$/.test(data?.number) || typeof data.goal !== 'string' || !data.goal.trim() || data.goal.length > 2000)
        return send(400,{error:'Indica el teléfono con prefijo internacional y el motivo.'});
      if (missing.length) return send(503,{error:'Falta: '+missing.join(', ')+'.'});
      if (busy()) return send(409,{error:'Ya hay una llamada en curso.'});
      if (draining()) return send(503,{error:'Clara se está actualizando. Vuelve a intentarlo en unos segundos.'});
      dialing = true;
      const s = stream({number:data.number, goal:data.goal.trim(),followId});
      try {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.twilioAccountSid)}/Calls.json`, {
          method:'POST', headers:{Authorization:'Basic '+Buffer.from(`${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`).toString('base64')},
          body:new URLSearchParams({To:data.number, From:cfg.twilioPhoneNumber, Twiml:s.xml, Timeout:'30',StatusCallback:`${origin()}/twilio/status/${s.key}`,StatusCallbackEvent:'completed'}), signal:AbortSignal.timeout(15000)
        });
        if (!r.ok) {
          if (r.status>=400 && r.status<500 && r.status!==408) {
            tickets.delete(s.key); return send(502,{error:'Twilio ha rechazado la llamada. Comprueba el número y la cuenta.'});
          }
          return send(502,{error:'Resultado incierto. Comprueba la llamada en Twilio antes de repetir.'});
        }
        return send(202,{message:'Twilio ha recibido la llamada. Esperando a que contesten.'});
      } catch (err) {
        if (['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT'].includes(err.cause?.code)) {
          tickets.delete(s.key); return send(502,{error:'No se pudo conectar con Twilio.'});
        }
        return send(502,{error:'Sin respuesta de Twilio. Comprueba el estado antes de repetir.'});
      }
      finally { dialing = false; }
    },
  };
}
module.exports = {createPhone};
