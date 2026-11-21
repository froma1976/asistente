const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {crearAvisos} = require('../avisos');

test('avisa a cada móvil una vez, mantiene la clave tras reiniciar y retira suscripciones caducadas', async t=>{
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'clara-push-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const s = {endpoint:'https://fcm.googleapis.com/test',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}};
  const registro = crearAvisos(dir);
  const clave = registro.clave();
  assert.equal(registro.registrar({...s,endpoint:'https://localhost/test'}),false);
  assert.equal(registro.registrar(s),true);
  assert.equal(registro.registrar(s),true);
  const enviados=[];
  const reinicio = crearAvisos(dir,async (_s,body)=>{
    enviados.push(JSON.parse(body));
    throw Object.assign(new Error(),{statusCode:410});
  });
  assert.equal(reinicio.clave(),clave);
  await reinicio.llamada('call_10','https://ejemplo.es');
  await reinicio.llamada('call_11','https://ejemplo.es');
  assert.deepEqual(enviados,[{id:'call_10'}]);
});
