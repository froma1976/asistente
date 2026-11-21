const test = require('node:test');
const assert = require('node:assert/strict');
const {Readable} = require('node:stream');
const {createHmac} = require('node:crypto');
const {createPhone} = require('../phone');
const {registrarRecado} = require('../acciones');

test('libera rechazos y errores previos a la conexión; concilia un timeout sin volver a marcar', async t => {
  const cfg={publicWebhookUrl:'https://example.org',twilioAuthToken:'test',twilioAccountSid:'test',twilioPhoneNumber:'+12025550110',geminiApiKey:'test'};
  const phone=createPhone(()=>cfg,()=>{},()=>null,()=>[]);
  const dial=()=>phone.dial({number:'+12025550111',goal:'Prueba'},code=>code);
  let callback;
  const remote=t.mock.method(global,'fetch',async()=>({ok:false,status:400}));
  assert.equal(await dial(),502);
  remote.mock.mockImplementation(async()=>{throw new Error('connect',{cause:{code:'ECONNREFUSED'}});});
  assert.equal(await dial(),502);
  remote.mock.mockImplementation(async(url,opts)=>{callback=opts.body.get('StatusCallback'); throw new Error('timeout');});
  assert.equal(await dial(),502);
  assert.equal(await dial(),409);
  const route=new URL(callback).pathname;
  const complete=async sig=>{
    const req=Readable.from(['CallStatus=completed']);
    Object.assign(req,{method:'POST',url:route,headers:{'x-twilio-signature':sig}});
    let status;
    await phone.handle(route,req,{writeHead(code){status=code;},end(){}});
    return status;
  };
  assert.equal(await complete('invalid'),403);
  assert.equal(await dial(),409);
  assert.equal(await complete(createHmac('sha1','test').update(callback+'CallStatuscompleted').digest('base64')),200);
  remote.mock.mockImplementation(async()=>({ok:true}));
  assert.equal(await dial(),202);
  assert.equal(remote.mock.callCount(),4);
});

test('no avisa si falla el disco; no confunde el guardado con la entrega', async()=>{
  const item={id:'rec_1'};
  let avisos=0;
  const fallo=await registrarRecado(item,()=>{throw Error();},()=>{avisos++;});
  assert.equal(fallo.status,'message_not_saved');
  assert.equal(avisos,0);
  for (const [resultado,esperado] of [[{ok:true},'enviado'],[{ok:false},'sin_confirmar'],[{skipped:true},'desactivado']]) {
    const rec=await registrarRecado(item,()=>{},()=>resultado);
    assert.deepEqual(rec,{...item,status:'message_saved',telegram:esperado});
  }
});
const {datoComercial}=require('../criterio-llamada');
require('node:test')('solo devuelve la condición solicitada del sector y omite identificadores de los paquetes',()=>{
  const assert=require('node:assert/strict');
  const invoices=[
    {category:'Luz',provider:'Eléctrica Demo',terms:['Producto: Plan Fijo','Potencia contratada: 3,4 kW Punta y 2 kW Valle','0,12 €/kWh (45 kWh = 5,40 €)']},
    {category:'Fibra + 2 móviles',provider:'Demo Red',price:'45 €/mes',terms:['Fibra 1 Gbps y móvil 600000000 con GB ilimitados']}
  ];
  const ask=(s,c,t)=>datoComercial(s,c,'oferta de '+s+' '+t,t,invoices);
  assert.equal(ask('luz','compania','¿Con qué compañía estás?'),'Eléctrica Demo');
  assert.equal(ask('luz','tarifa','¿Qué tarifa tienes?'),'Plan Fijo');
  assert.equal(ask('luz','consumo','¿Cuánto consumiste?'),'45 kWh');
  assert.equal(ask('luz','potencia','¿Qué potencia tienes?'),'3,4 kW Punta, 2 kW Valle');
  assert.equal(ask('telefonia','cuota','¿Cuánto paga de fibra?'),'45 €/mes');
  assert.doesNotMatch(ask('telefonia','paquete','¿Qué incluye la fibra?'),/600000000/);
  assert.equal(ask('luz','potencia','¿Cuál es tu DNI?'),null);
  assert.equal(ask('luz','direccion','¿Cuál es la dirección?'),null);
  assert.equal(ask('luz','compania','¿Qué compañía de fibra tienes?'),null);
});
require('node:test')('la negociación distingue promoción, falta de condiciones y respuesta final',()=>{
  const assert=require('node:assert/strict'), {siguientePaso}=require('../ofertas');
  assert.match(siguientePaso('Interesa','telecomunicaciones','solo los primeros tres meses',false),/todo el plazo/);
  assert.match(siguientePaso('Faltan datos','energía','le mejoramos el precio',false),/aclara/);
  assert.match(siguientePaso('Interesa','energía','es definitiva',true),/por escrito/);
  assert.match(siguientePaso('No interesa','energía','es definitiva',true),/declina/);
});
