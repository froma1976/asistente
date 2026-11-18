const live=document.getElementById('live'), past=document.getElementById('past'), notice=document.getElementById('notice');
let prevLive, prevHistory;
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
  } catch {notice.textContent='Sin conexión con Clara. Reintentando…';}
  setTimeout(refresh,1500);
}
refresh();
