const fs = require('node:fs');
const path = require('node:path');
const push = require('web-push');
const {guardarPrivado} = require('./acciones');

function suscripcionValida(s) {
  try {
    const u = new URL(s.endpoint);
    return s.endpoint.length < 4096 && u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
       u.hostname.endsWith('.notify.windows.com') || u.hostname === 'web.push.apple.com') &&
      /^[\w-]{87}$/.test(s.keys.p256dh) && /^[\w-]{22}$/.test(s.keys.auth);
  } catch { return false; }
}

function crearAvisos(dir, enviar = push.sendNotification.bind(push)) {
  const file = path.join(dir, 'avisos-privados.json');
  let estado;
  function cargar() {
    if (!estado) {
      if (fs.existsSync(file)) estado = JSON.parse(fs.readFileSync(file,'utf8'));
      else {
        const nuevo = { claves:push.generateVAPIDKeys(), dispositivos:[] };
        guardarPrivado(file,nuevo);
        estado = nuevo;
      }
    }
    return estado;
  }
  function guardar(dispositivos) {
    const nuevo = {...cargar(), dispositivos};
    guardarPrivado(file,nuevo);
    estado = nuevo;
  }
  return {
    clave: () => cargar().claves.publicKey,
    registrar(s) {
      if (!suscripcionValida(s)) return false;
      const lista = cargar().dispositivos.filter(d => d.endpoint !== s.endpoint);
      if (lista.length >= 32) return false;
      guardar([...lista,{endpoint:s.endpoint,keys:{auth:s.keys.auth,p256dh:s.keys.p256dh}}]);
      return true;
    },
    async llamada(id, subject) {
      if (!fs.existsSync(file)) return;
      const {dispositivos,claves} = cargar();
      await Promise.all(dispositivos.map(async dispositivo => {
        try {
          await enviar(dispositivo, JSON.stringify({id}), {TTL:120, urgency:'high', timeout:6000,
            vapidDetails:{subject,...claves}});
        } catch (e) {
          if ([404,410].includes(e.statusCode)) guardar(cargar().dispositivos.filter(d => d !== dispositivo));
          else console.warn('No se pudo entregar el aviso de llamada.',e.statusCode || '');
        }
      }));
    }
  };
}
module.exports = {crearAvisos};
