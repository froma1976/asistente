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
