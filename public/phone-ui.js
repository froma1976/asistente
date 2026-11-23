const el = id => document.getElementById(id);
async function readReply(response) {
  if (response.status === 401) throw new Error('Vuelve a abrir el panel e inicia sesión.');
  if (response.status === 404) throw new Error('El servidor no tiene esta función. Reinicia Fernando y recarga el panel.');
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Fernando no está disponible. Recarga el panel y vuelve a intentarlo.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Fernando no ha podido responder.');
  return data;
}
async function api(path, data) {
  const response = await fetch('/api/phone'+path, data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {});
  return readReply(response);
}
let initialized = false;
function page(id) {
  for (const b of document.querySelectorAll('[data-page]')) {
    const active = b.dataset.page === id;
    el(b.dataset.page).hidden = !active;
    b.setAttribute('aria-pressed', String(active));
  }
}
document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => page(b.dataset.page));
let brief = '';
el('prepare').onclick = () => {
  if (brief || el('message').value.trim()) el('goal').value = brief || el('message').value.trim();
  page('calls'); el('goal').focus();
};
function renderChat(turns) {
  el('conversation').replaceChildren(...turns.map(t => {
    const p = document.createElement('p');
    p.textContent = (t.role === 'user' ? 'Tú: ' : 'Fernando: ') + t.text;
    if (t.role === 'user') p.className='mine';
    return p;
  }));
  el('conversation').scrollTop = el('conversation').scrollHeight;
}
const chatReady = fetch('/api/clara/conversation').then(readReply).then(renderChat).catch(err=>{el('answerStatus').textContent=err.message;});
el('send').onsubmit = async e => {
  e.preventDefault();
  const box = el('message'), button = e.currentTarget.querySelector('button');
  if (!box.value.trim() || button.disabled) return;
  button.disabled = box.disabled = true; el('answerStatus').textContent='Fernando está escribiendo…';
  try {
    await chatReady;
    const r = await fetch('/api/clara/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:box.value.trim()})});
    const data = await readReply(r);
    renderChat(data.secretaryData.claraChat);
    brief = data.newTask || '';
    box.value=''; el('answerStatus').textContent='';
  } catch(err){el('answerStatus').textContent=err.message;}
  finally { button.disabled=box.disabled=false; box.focus(); }
};
el('message').onkeydown = e => { if(e.key==='Enter' && !e.shiftKey && !e.isComposing){e.preventDefault();el('send').requestSubmit();} };
let lastInvoices;
async function refresh() {
  try {
    const state = await api('');
    if (!initialized) {
      el('context').value = state.context;
      initialized = true;
    }
    el('connection').textContent = state.missing.length ? 'Para usar el teléfono falta: '+state.missing.join(', ')+'.' : 'Telefonía configurada. Fernando atiende las llamadas que lleguen a tu número de Twilio.';
    el('call').textContent = state.call ? state.call.number+'\n'+state.call.transcript.map(t => t.text).join('\n') : '';
    const signature = JSON.stringify(state.invoices);
    if (signature !== lastInvoices) el('invoices').replaceChildren(...state.invoices.map(i => {
      const item = document.createElement('details'), summary = document.createElement('summary'), terms = document.createElement('pre');
      summary.textContent = `${i.provider} · ${i.price}`;
      terms.textContent = [i.category,...i.terms].join('\n');
      item.append(summary,terms);
      return item;
    }));
    lastInvoices=signature;
    const calRes = await fetch('/api/google-calendar/events');
    if (calRes.ok && el('calendarStatus') && el('calendarEvents')) {
      const cal = await calRes.json();
      if (!cal.connected) {
        el('calendarStatus').innerHTML = 'Google Calendar no está conectado. <a href="/api/google-calendar/auth">Conectar ahora</a>';
        el('calendarEvents').replaceChildren();
      } else if (!cal.events?.length) {
        el('calendarStatus').textContent = 'Google Calendar conectado · No hay próximas citas.';
        el('calendarEvents').replaceChildren();
      } else {
        el('calendarStatus').textContent = `Google Calendar conectado · ${cal.events.length} próxima(s) cita(s):`;
        el('calendarEvents').replaceChildren(...cal.events.map(ev => {
          const item = document.createElement('details'), summary = document.createElement('summary'), info = document.createElement('pre');
          const when = ev.start ? new Date(ev.start).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: ev.start.includes('T') ? 'short' : undefined }) : '';
          summary.textContent = `${when} · ${ev.summary}`;
          info.textContent = [ev.location ? `Lugar: ${ev.location}` : '', ev.htmlLink ? `Enlace: ${ev.htmlLink}` : ''].filter(Boolean).join('\n') || 'Evento sincronizado en Google Calendar';
          item.append(summary, info);
          return item;
        }));
      }
    }
  } catch { el('connection').textContent = 'No se pudo leer el estado del teléfono.'; }
}
el('dial').onsubmit = async e => {
  e.preventDefault();
  const form = e.currentTarget, button = form.querySelector('button');
  button.disabled = true;
  try { const data = Object.fromEntries(new FormData(form)); data.number=data.number.replace(/[\s()-]/g,''); el('dialStatus').textContent = (await api('/dial', data)).message; }
  catch (err) { el('dialStatus').textContent = err.message; }
  finally { button.disabled = false; }
};
el('profile').onsubmit = async e => {
  e.preventDefault();
  try { await api('/context',{context:el('context').value}); el('saved').textContent = ' Guardado para futuras llamadas.'; }
  catch (err) { el('saved').textContent = err.message; }
};
refresh();
setInterval(refresh,5000);
