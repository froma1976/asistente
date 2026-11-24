const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {Readable} = require('node:stream');
const path = require('node:path');
const vm = require('node:vm');

// Read source only: never require server.js or run its startup/configuration.
function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source boundaries: ${start} / ${end}`);
  assert.equal(source.indexOf(start, from + start.length), -1, 'Start boundary must be unique');
  return source.slice(from, to);
}

const source = readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const httpSource = between(source, 'const server = http.createServer(', "server.on('upgrade'");
assert.match(httpSource, /\}\);\s*(?:\/\/[^\n]*\s*)*$/);
assert.doesNotMatch(httpSource, /server\.listen\(/);
const jsonSource = between(source, 'function readJsonBody(req)', "const ofertas=require('./ofertas');");

test('la escucha entrega las dos voces de su llamada y corta al retomar o cambiar de llamada',()=>{
  const frames=[],call={source:'twilio',status:'screening',twilioWs:{readyState:1},
    oyentes:new Set([{write:frame=>frames.push(JSON.parse(frame.slice(6)))}])};
  const ctx=vm.createContext({activeCall:call});
  vm.runInContext(between(source,'function enDirecto()', 'let claraReplyPending'),ctx);
  const pcm=Buffer.from([0,127]);
  for(const role of ['caller','assistant','clear'])ctx.audioEscucha(call,role,role==='clear'?undefined:pcm);
  assert.deepEqual(frames,[{role:'caller',data:'AH8='},{role:'assistant',data:'AH8='},{role:'clear'}]);
  call.status='transferred';ctx.audioEscucha(call,'caller',pcm);
  call.status='screening';ctx.activeCall={...call};ctx.audioEscucha(call,'assistant',pcm);
  assert.equal(frames.length,3);
});

function harness({authorized = true, activeCall = null, rehearsal = [], failSave = false} = {}) {
  const selected = {id:'selected', transcript:[{role:'caller', text:'Synthetic selected'}]};
  const other = {id:'other', transcript:[{role:'caller', text:'Synthetic other'}]};
  const original = {history:[other, selected], claraChat:[{text:'Synthetic chat'}],
    seguimientos:[{id:'follow-up'}], ownerTasks:[{text:'Synthetic task'}], invoices:[]};
  const snapshot = structuredClone(original);
  const initialActive = activeCall;
  const events = [], saves = [], order = [];
  let handler, reads = 0;
  const context = vm.createContext({
    URL, secretaryData:original, activeCall, rehearsalCalls:new Map(rehearsal.map(id => [id, {id}])),
    secretaryDataPath:'synthetic-only.json',
    phone:{authorized:() => authorized},
    http:{createServer(callback) { handler = callback; return {}; }},
    guardarPrivado(path, next) {
      assert.equal(context.secretaryData, original, 'Save before replacing state');
      assert.deepEqual(original, snapshot, 'Save before mutating original records');
      assert.equal(context.activeCall, initialActive, 'Keep activeCall until save succeeds');
      assert.equal(events.length, 0, 'No event before persistence');
      saves.push({path, next}); order.push('save');
      if (failSave) throw new Error('Synthetic disk failure');
    },
    broadcastToDashboard(event) {
      assert.equal(saves.length, 1);
      assert.equal(context.secretaryData, saves[0].next);
      assert.equal(event.secretaryData, context.secretaryData);
      events.push(event); order.push('event');
    },
  });
  vm.runInContext(jsonSource + httpSource, context, {filename:'isolated-http.js'});
  const parser = context.readJsonBody;
  context.readJsonBody = req => { reads++; return parser(req); };
  return {context, original, snapshot, selected, other, saves, events, order,
    get reads() { return reads; },
    async request({raw = JSON.stringify({id:'selected'}), contentType = 'application/json'} = {}) {
      const req = Readable.from([raw]);
      Object.assign(req, {method:'DELETE', url:'/api/transcripciones', headers:{host:'test.invalid'}});
      if (contentType !== null) req.headers['content-type'] = contentType;
      const response = {status:200, headers:{}, body:'', ends:0,
        writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
        end(body = '') { this.body = body; this.ends++; order.push('response'); },
      };
      await handler(req, response);
      assert.equal(response.ends, 1);
      assert.equal(response.headers['Cache-Control'], 'no-store');
      return response;
    },
  };
}

function unchanged(h) {
  assert.equal(h.context.secretaryData, h.original);
  assert.deepEqual(h.original, h.snapshot);
  assert.equal(h.saves.length, 0);
  assert.equal(h.events.length, 0);
}

test('DELETE rejects unauthenticated requests before reading JSON', async () => {
  const h = harness({authorized:false});
  assert.equal((await h.request({raw:'not JSON'})).status, 401);
  assert.equal(h.reads, 0);
  unchanged(h);
});

test('DELETE validates JSON, content type and id without side effects', async t => {
  const cases = [
    ['malformed JSON', {raw:'{"id":'}], ['empty body', {raw:''}],
    ...[null, [], {}, {id:null}, {id:42}, {id:true}, {id:[]}, {id:{}}, {id:''},
      {id:'x'.repeat(201)}].map(body => [JSON.stringify(body), {raw:JSON.stringify(body)}]),
    ['missing content type', {contentType:null}], ['wrong content type', {contentType:'text/plain'}],
  ];
  for (const [name, input] of cases) await t.test(name, async () => {
    const h = harness();
    const res = await h.request(input);
    assert.equal(res.status, 400);
    assert.equal(res.headers['Content-Type'], 'application/json');
    assert.equal(typeof JSON.parse(res.body).error, 'string');
    unchanged(h);
  });
});

test('DELETE accepts the 200-character id boundary and JSON charset', async () => {
  const h = harness();
  h.selected.id = 'x'.repeat(200);
  Object.assign(h.snapshot.history[1], {id:h.selected.id});
  assert.equal((await h.request({raw:JSON.stringify({id:h.selected.id}),
    contentType:'application/json; charset=utf-8'})).status, 200);
});

test('DELETE protects active calls and rehearsals, even outside history', async t => {
  for (const status of ['screening', 'transferring']) await t.test(status, async () => {
    const activeCall = {id:'selected', status};
    const h = harness({activeCall});
    assert.equal((await h.request()).status, 409);
    assert.equal(h.context.activeCall, activeCall);
    unchanged(h);
  });
  for (const id of ['selected', 'not-in-history']) await t.test(`rehearsal ${id}`, async () => {
    const h = harness({rehearsal:[id]});
    assert.equal((await h.request({raw:JSON.stringify({id})})).status, 409);
    assert.equal(h.context.rehearsalCalls.has(id), true);
    unchanged(h);
  });
});

test('DELETE returns 404 for absent ids without writing or broadcasting', async () => {
  const h = harness();
  assert.equal((await h.request({raw:'{"id":"absent"}'})).status, 404);
  unchanged(h);
});

test('DELETE persists only the selected removal before state, event and success', async () => {
  const activeCall = {id:'other', status:'screening'};
  const h = harness({activeCall, rehearsal:['unrelated-rehearsal']});
  const res = await h.request();
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), {ok:true});
  assert.deepEqual(h.order, ['save', 'event', 'response']);
  assert.equal(h.saves[0].path, 'synthetic-only.json');
  const next = h.context.secretaryData;
  assert.notEqual(next, h.original);
  assert.deepEqual(Array.from(next.history), [h.other]);
  assert.equal(next.history[0], h.other);
  assert.deepEqual(h.original, h.snapshot);
  for (const key of Object.keys(h.original).filter(key => key !== 'history')) {
    assert.equal(next[key], h.original[key], `Preserve ${key}`);
  }
  assert.equal(h.context.activeCall, activeCall);
  assert.equal(h.context.rehearsalCalls.has('unrelated-rehearsal'), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, 'call_deleted');
  assert.equal(h.events[0].id, 'selected');
  assert.equal((await h.request()).status, 404);
  assert.equal(h.saves.length, 1);
  assert.equal(h.events.length, 1);
});

test('DELETE clears matching ended activeCall only after successful persistence', async () => {
  const h = harness({activeCall:{id:'selected', status:'ended'}});
  assert.equal((await h.request()).status, 200);
  assert.equal(h.context.activeCall, null);
  assert.equal(h.events.length, 1);
});

test('DELETE disk failure keeps history and ended activeCall, with no false success/event', async () => {
  const activeCall = {id:'selected', status:'ended'};
  const h = harness({activeCall, failSave:true});
  const res = await h.request();
  assert.equal(res.status, 503);
  const body = JSON.parse(res.body);
  assert.equal(typeof body.error, 'string');
  assert.notEqual(body.ok, true);
  assert.equal(h.saves.length, 1);
  assert.equal(h.events.length, 0);
  assert.equal(h.context.secretaryData, h.original);
  assert.deepEqual(h.original, h.snapshot);
  assert.equal(h.context.activeCall, activeCall);
  assert.deepEqual(h.order, ['save', 'response']);
});

const uiSource = readFileSync(path.join(__dirname, '../public/transcripciones.js'), 'utf8');
const cardSource = between(uiSource, 'function card(', 'async function refresh()');

function ui({confirm = () => true, fetch = async () => ({ok:true, status:200, json:async () => ({ok:true})})} = {}) {
  function element(tag) {
    return {tag, dataset:{}, children:[], disabled:false,
      append(...children) { this.children.push(...children); },
      setAttribute() {},
      querySelector() { return this.children.find(child => child.tag === 'details'); },
      remove() { past.children = past.children.filter(child => child !== this); },
    };
  }
  const past = element('div'), deleteStatus = {};
  past.querySelectorAll = () => [...past.children];
  const requests = [];
  const context = vm.createContext({document:{createElement:element}, past, deleteStatus,
    deleting:new Set(), historyRevision:0, prevHistory:'cached', confirm,
    fetch:async (...args) => { requests.push(args); return fetch(...args); },
  });
  vm.runInContext(cardSource, context);
  const call = {id:'selected', startedAt:'2026-01-01T12:00:00Z', transcript:[]};
  const row = context.card(call, false, true);
  past.append(row, context.card({...call, id:'other'}, false, true));
  return {context, past, deleteStatus, requests, row, button:row.children[1], call};
}

test('UI offers deletion only on saved cards; cancellation sends nothing', async () => {
  const h = ui({confirm:() => false});
  assert.equal(h.context.card(h.call, true).tag, 'details');
  assert.equal(h.button.type, 'button');
  await h.button.onclick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.past.children.length, 2);
  assert.equal(h.button.disabled, false);
});

test('UI disables pending deletion, prevents duplicate clicks and removes only selected row', async () => {
  let release;
  const h = ui({fetch:() => new Promise(resolve => { release = resolve; })});
  const pending = h.button.onclick();
  assert.equal(h.button.disabled, true);
  await h.button.onclick();
  assert.equal(h.requests.length, 1);
  const [url, options] = h.requests[0];
  assert.equal(url, '/api/transcripciones');
  assert.equal(options.method, 'DELETE');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), {id:'selected'});
  assert.equal(h.past.children.length, 2);
  release({ok:true, status:200, json:async () => ({ok:true})});
  await pending;
  assert.equal(h.past.children.length, 1);
  assert.equal(h.past.children[0].querySelector().dataset.id, 'other');
  assert.equal(h.context.historyRevision, 1);
  assert.equal(h.context.deleting.size, 0);
});

test('UI keeps rows on HTTP/network/JSON errors and allows retry', async t => {
  for (const [name, fetch] of [
    ['HTTP', async () => ({ok:false, status:503, json:async () => ({error:'Synthetic disk error'})})],
    ['network', async () => { throw new Error('Synthetic network error'); }],
    ['JSON', async () => ({ok:true, json:async () => { throw new Error('Synthetic JSON error'); }})],
  ]) await t.test(name, async () => {
    const h = ui({fetch});
    await h.button.onclick();
    assert.equal(h.past.children[0], h.row);
    assert.equal(h.past.children.length, 2);
    assert.match(h.deleteStatus.textContent, /Synthetic/);
    assert.equal(h.button.disabled, false);
    assert.equal(h.context.deleting.size, 0);
    assert.equal(h.context.historyRevision, 0);
    await h.button.onclick();
    assert.equal(h.requests.length, 2);
  });
});
