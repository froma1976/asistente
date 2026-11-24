const live=document.getElementById('live'), past=document.getElementById('past'), notice=document.getElementById('notice');
let prevLive, prevHistory;
const deleting=new Set();
let historyRevision=0;
const deleteStatus=document.getElementById('delete-status');
const ultima=new URLSearchParams(location.search).has('ultima');
const llamada=new URLSearchParams(location.search).get('llamada');
if(llamada){
  document.querySelector('h1').textContent='Transcripción de la llamada';
  past.closest('section').querySelector('h2').textContent='Llamada finalizada';
  document.getElementById('seguimientos').closest('section').hidden=true;
  document.getElementById('horario').hidden=true;
}
const horario=document.getElementById('horario');
horario.onsubmit=async e=>{
  e.preventDefault();
  const r=await fetch('/api/seguimientos/horario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({desde:Number(horario.elements.desde.value),hasta:Number(horario.elements.hasta.value)})}).catch(()=>null);
  horario.querySelector('output').textContent=r?.ok?'Horario guardado.':'No se pudo guardar el horario.';
};
if(ultima) {
  past.before(notice);
  past.previousElementSibling.previousElementSibling.textContent='Última llamada';
}
const take=document.getElementById('take'), feedback=document.getElementById('transfer-status');
let available='',pending=false,requested='';
take.onclick=async()=>{
  if(!available || pending || requested===available)return;
  const id=available;
  pending=true; take.disabled=true; feedback.textContent='Pasando la llamada a tu móvil…';
  try {
    const r=await fetch('/api/call/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'mobile',liveId:id})});
    const data=await r.json();
    if(!r.ok || !data.ok)throw Error(data.error||'No se pudo retomar la llamada.');
    requested=id; feedback.textContent='Desvío solicitado. Contesta cuando suene tu móvil.';
  } catch(e){feedback.textContent=e.message;}
  finally {pending=false;take.disabled=!available||requested===available;}
};
function card(call, opened, saved=false) {
  const box=document.createElement('details'), title=document.createElement('summary');
  box.dataset.id=call.id; box.open=opened;
  title.textContent=[call.fromNumber || 'Llamada',new Date(call.startedAt).toLocaleString('es-ES')].join(' · ');
  if(saved)title.textContent=(call.resultado || call.offerReview?.resumen || 'Sin resultado disponible')+' · '+title.textContent;
  box.append(title);
  if(call.offerReview) {
    const r=call.offerReview, h=document.createElement('h3'), p=document.createElement('p');
    h.textContent=`Oferta: ${r.veredicto}`; p.textContent=[r.resumen,r.riesgo].filter(Boolean).join(' ');
    box.append(h,p);
    const sources=(call.checks||[]).flatMap(c=>c.fuentes||[]);
    if(!sources.length) box.append('Sin contraste con fuentes públicas.');
    for(const source of sources) {
      if(!source.url?.startsWith('https://')) continue;
      const link=document.createElement('a'); link.href=source.url; link.textContent=source.title; link.target='_blank'; link.rel='noopener';
      box.append(document.createElement('br'),link);
    }
  }
  for(const line of call.transcript || []) {
    const p=document.createElement('p');
    p.textContent=`${line.timestamp || ''} ${line.role==='assistant'?'Fernando':line.role==='caller'?'Interlocutor':'Sistema'}: ${line.text}`;
    box.append(p);
  }
  if (!call.transcript?.length) box.append('Sin texto transcrito.');
  if(!saved)return box;
  const row=document.createElement('div'), remove=document.createElement('button');
  row.className='transcript-row'; remove.className='delete-transcript'; remove.type='button';
  remove.title='Borrar transcripción';
  remove.setAttribute('aria-label',`Borrar transcripción de ${title.textContent}`);
  remove.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
  remove.disabled=deleting.has(call.id);
  remove.onclick=async()=>{
    if(deleting.has(call.id)||!confirm('¿Borrar esta llamada del historial y su transcripción? No se puede deshacer.'))return;
    deleting.add(call.id); remove.disabled=true; deleteStatus.textContent='Borrando transcripción…';
    try {
      const r=await fetch('/api/transcripciones',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:call.id})});
      const data=await r.json();
      if(!r.ok&&r.status!==404)throw Error(data.error||'No se pudo borrar la transcripción.');
      historyRevision++; prevHistory=undefined;
      past.querySelectorAll('.transcript-row').forEach(item=>{if(item.querySelector('details').dataset.id===call.id)item.remove();});
      if(!past.children.length)past.textContent='Todavía no hay llamadas guardadas.';
      deleteStatus.textContent='Transcripción borrada.';
    } catch(e){deleteStatus.textContent=e.message||'No se pudo borrar la transcripción.';}
    finally {deleting.delete(call.id); remove.disabled=false; prevHistory=undefined;}
  };
  row.append(box,remove);
  return row;
}
async function refresh() {
  const revision=historyRevision;
  try {
    const r=await fetch('/api/transcripciones',{cache:'no-store'});
    if(!r.ok) throw new Error();
    const data=await r.json();
    if(revision!==historyRevision)return;
    if(llamada){
      data.live=data.live.filter(c=>c.id===llamada);
      data.history=data.history.filter(c=>c.id===llamada);
      live.closest('section').querySelector('h2').hidden=!data.live.length;
    }
    const next=data.live.find(c=>c.source==='twilio' && c.status==='screening')?.id||'';
    document.dispatchEvent(new CustomEvent('llamada-directo',{detail:next?{id:next}:null}));
    const counts=data.balance;
    if(data.horario&&!horario.dataset.loaded){[horario.elements.desde.value,horario.elements.hasta.value]=data.horario;horario.dataset.loaded='1';}
    if(counts)document.getElementById('balance').textContent=`Hoy: ${counts.resueltos} resueltos · ${counts.pendientes} pendientes · ${counts.revisar} necesitan tu decisión.`;
    document.getElementById('seguimientos').replaceChildren(...(data.seguimientos||[]).map(n=>{
      const li=document.createElement('li');li.textContent=`${n.asunto} · ${n.estado} · ${n.responsable==='Clara'?'Fernando':n.responsable} · ${n.cuando} · ${n.resultado||n.paso}`;return li;
    }));
    if(next && next!==available && !pending)feedback.textContent='';
    available=next;take.hidden=!next;take.disabled=pending||requested===next;
    const a=JSON.stringify(data.live), b=JSON.stringify(data.history);
    if(a!==prevLive) {
      live.replaceChildren(...(data.live.length?data.live.map(c=>card(c,true)):llamada?[]:['No hay llamadas en curso.']));
      prevLive=a;
    }
    if(b!==prevHistory) {
      const opened=new Set([...past.querySelectorAll('details[open]')].map(d=>d.dataset.id));
      const calls=ultima?data.history.filter(c=>c.source==='twilio').slice(0,1):data.history;
      past.replaceChildren(...(calls.length?calls.map(c=>card(c,Boolean(llamada)||ultima||opened.has(c.id),true)):['Todavía no hay llamadas guardadas.']));
      prevHistory=b;
    }
    notice.textContent=llamada&&!data.live.length&&!data.history.length?'Esta llamada no está disponible en el historial.':'';
  } catch {document.dispatchEvent(new CustomEvent('llamada-directo'));available='';take.hidden=true;notice.textContent='Sin conexión con Fernando. Reintentando…';}
  finally {setTimeout(refresh,1500);}
}
refresh();
