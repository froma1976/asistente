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
