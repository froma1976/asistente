const test=require('node:test');
const assert=require('node:assert/strict');
const {locutor}=require('../voz-telefono');

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
