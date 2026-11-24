const test=require('node:test');
const assert=require('node:assert/strict');
const {
  locutor,
  locutorContinuo,
  normalizarTextoVoz,
  detectorInterrupcion,
  generarRuidoConfortMulaw,
  MULETILLAS,
  VOICE_SETTINGS,
}=require('../voz-telefono');

test('una interrupción descarta audio en vuelo y frases pendientes sin bloquear el turno nuevo',async()=>{
  const solicitudes=[],audio=[];
  let liberar,empezar;
  const inicio=new Promise(done=>{empezar=done;});
  const espera=new Promise(done=>{liberar=done;});
  const voz=locutor(async function*(texto){
    solicitudes.push(texto);
    if(texto==='Primera.'){empezar();await espera;}
    yield Buffer.from([texto.length,0]);
  },b=>audio.push(b[0]),()=>assert.fail());
  voz.texto('Primera. Segunda.');
  const anterior=voz.terminar();
  await inicio;
  voz.cortar();
  voz.texto('Nuevo turno');
  await voz.terminar();
  liberar(); await anterior;
  assert.deepEqual(solicitudes,['Primera.','Nuevo turno']);
  assert.deepEqual(audio,['Nuevo turno'.length]);
});

test('normalizarTextoVoz: adapta precios, unidades eléctricas/fibra, IVA y teléfonos españoles para Flash v2.5',()=>{
  assert.equal(
    normalizarTextoVoz('Pago 0,136 €/kWh con 5,75 kW y Fibra 1 Gbps por 48€ IVA incluido.'),
    'Pago 0,136 euros el kilovatio hora con 5,75 kilovatios y Fibra 1 gigas por 48 euros iva incluido.'
  );
  assert.equal(
    normalizarTextoVoz('Llámame al 639403998 o al +34 616442444 con un 21% de descuento.'),
    'Llámame al 639, 40, 39, 98 o al más 34, 616, 44, 24, 44 con un 21 por ciento de descuento.'
  );
  // Conserva espacios de borde en streaming
  assert.equal(normalizarTextoVoz(' hola '), ' hola ');
  assert.equal(MULETILLAS.length, 2);
  assert.equal(VOICE_SETTINGS.similarity_boost, 0.80);
});

test('locutorContinuo: precalienta WebSocket, normaliza unidades, emite antes del punto final y corta al instante',async()=>{
  const canales=[], enviados=[], recibidos=[];
  const voz=locutorContinuo((handlers)=>{
    const c={handlers, cerrados:0, enviar(p){enviados.push({id:canales.length, ...p});}, cerrar(){this.cerrados++;}};
    canales.push(c);
    return c;
  }, pcm=>recibidos.push(pcm[0]), ()=>assert.fail());

  assert.equal(canales.length, 1);

  voz.texto('Claro, ahora mismo pago 0,136 €/kWh, ');
  assert.ok(enviados.length >= 1);
  assert.match(enviados[0].text, /euros el kilovatio hora/);
  voz.texto('con Repsol.');
  await voz.terminar();
  assert.equal(enviados.at(-1).flush, true);
  canales[0].handlers.onAudio(Buffer.from([11]));

  voz.texto('Segundo turno en el mismo socket.');
  await voz.terminar();
  assert.equal(canales.length, 1);

  const viejo = canales[0];
  voz.cortar();
  assert.equal(viejo.cerrados, 1);
  assert.equal(canales.length, 2);
  viejo.handlers.onAudio(Buffer.from([99]));
  canales[1].handlers.onAudio(Buffer.from([22]));
  assert.deepEqual(recibidos, [11, 22]);

  voz.cerrar();
  assert.equal(canales.length, 2);
  assert.equal(canales[1].cerrados, 1);
});

test('detectorInterrupcion: ignora ruido o chasquidos breves y corta en ~80 ms ante voz humana real',()=>{
  let ahora = 1000, cortes = 0;
  const det = detectorInterrupcion(()=>{cortes++;}, ()=>ahora);
  const tramaVoz = (amp)=>{
    const b = Buffer.alloc(640);
    for (let i = 0; i < 320; i++) b.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * 300 * i) / 16000)), i * 2);
    return b;
  };
  const silencio = Buffer.alloc(640);

  det.notificarVozAsistente(2000);
  assert.equal(det.analizarEntrada(tramaVoz(400)), false);
  assert.equal(det.analizarEntrada(tramaVoz(4000)), false);
  assert.equal(det.analizarEntrada(silencio), false);
  assert.equal(cortes, 0);

  for (let i = 0; i < 3; i++) assert.equal(det.analizarEntrada(tramaVoz(4000)), false);
  assert.equal(det.analizarEntrada(tramaVoz(4000)), true);
  assert.equal(cortes, 1);
  assert.equal(det.hablando(), false);
});

test('generarRuidoConfortMulaw: genera 2 segundos continuos de baja amplitud sin saturación',()=>{
  const muestras = [];
  const buf = generarRuidoConfortMulaw((s)=>{muestras.push(s); return s & 0xff;});
  assert.equal(buf.length, 16000);
  const pico = Math.max(...muestras.map(Math.abs));
  assert.ok(pico > 5 && pico < 250);
});

test('coste mensual: comparte consulta, conserva créditos negativos y no confunde ausencia con cero',async()=>{
  const {crearConsulta}=require('../gasto-gemini');
  const env={GEMINI_BILLING_TABLE:'demo-coste.datos.tabla',GEMINI_BILLING_PROJECT:'app',GEMINI_BILLING_SERVICE_ID:'gemini'};
  let veces=0,fecha=new Date('2026-11-30T23:59:55Z');
  const consulta=crearConsulta(env,async({mes})=>{
    veces++;return mes==='202611'?[{f:[{v:'EUR'},{v:'-0.0123'}]}]:[];
  },()=>fecha);
  const [a,b]=await Promise.all([consulta(),consulta()]);
  assert.deepEqual(a,b);assert.equal(a.importes[0].total,-0.0123);assert.equal(veces,1);
  fecha=new Date('2026-12-01T00:00:01Z');
  assert.equal((await consulta()).estado,'sin_registros');
  assert.equal((await crearConsulta({})()).estado,'sin_configurar');
});
