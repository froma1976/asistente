const live=document.getElementById('live'), past=document.getElementById('past'), notice=document.getElementById('notice');
let prevLive, prevHistory;
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
function card(call, opened) {
  const box=document.createElement('details'), title=document.createElement('summary');
  box.dataset.id=call.id; box.open=opened;
  title.textContent=[call.fromNumber || 'Llamada',new Date(call.startedAt).toLocaleString('es-ES')].join(' · ');
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
    p.textContent=`${line.timestamp || ''} ${line.role==='assistant'?'Clara':line.role==='caller'?'Interlocutor':'Sistema'}: ${line.text}`;
    box.append(p);
  }
  if (!call.transcript?.length) box.append('Sin texto transcrito.');
  return box;
}
async function refresh() {
  try {
    const r=await fetch('/api/transcripciones',{cache:'no-store'});
    if(!r.ok) throw new Error();
    const data=await r.json();
    const next=data.live.find(c=>c.source==='twilio' && c.status==='screening')?.id||'';
    if(next && next!==available && !pending)feedback.textContent='';
    available=next;take.hidden=!next;take.disabled=pending||requested===next;
    const a=JSON.stringify(data.live), b=JSON.stringify(data.history);
    if(a!==prevLive) {
      live.replaceChildren(...(data.live.length?data.live.map(c=>card(c,true)):['No hay llamadas en curso.']));
      prevLive=a;
    }
    if(b!==prevHistory) {
      const opened=new Set([...past.querySelectorAll('details[open]')].map(d=>d.dataset.id));
      past.replaceChildren(...(data.history.length?data.history.map(c=>card(c,opened.has(c.id))):['Todavía no hay llamadas guardadas.']));
      prevHistory=b;
    }
    notice.textContent='';
  } catch {available='';take.hidden=true;notice.textContent='Sin conexión con Clara. Reintentando…';}
  setTimeout(refresh,1500);
}
refresh();
