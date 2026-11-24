(() => {
  const $=id=>document.getElementById(id);
  const panel=$('directo'), escuchar=$('escuchar'), retomar=$('retomar'), estado=$('escucha-estado');
  let id='', session, solicitud='';
  function parar(mensaje=''){
    const s=session;session=null;
    s?.events?.close();s?.ctx.close().catch(()=>{});
    escuchar.textContent='🎧 Escuchar en directo';estado.textContent=mensaje;
  }
  escuchar.onclick=async()=>{
    if(session)return parar();
    if(!id)return;
    const elegido=id;
    let s;
    try{
      const ctx=new (window.AudioContext||window.webkitAudioContext)();
      s=session={ctx,next:{},voz:new Set()};
      escuchar.textContent='Dejar de escuchar';estado.textContent='Conectando…';
      await ctx.resume();
      if(session!==s||id!==elegido)return;
      const events=s.events=new EventSource('/api/directo/audio?id='+encodeURIComponent(id));
      events.onopen=()=>{if(session===s)estado.textContent='Escuchando. Tu micrófono está apagado.';};
      events.onerror=()=>{if(session===s)parar('Escucha finalizada.');};
      events.onmessage=e=>{
        if(session!==s)return;
        const {role,data}=JSON.parse(e.data);
        if(role==='clear'){
          for(const sound of s.voz)sound.stop();
          s.voz.clear();s.next.assistant=0;return;
        }
        const raw=atob(data), n=raw.length>>1;
        if(!n)return;
        const buf=ctx.createBuffer(1,n,role==='caller'?16000:24000), samples=buf.getChannelData(0);
        for(let i=0;i<n;i++){
          const word=raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8);
          samples[i]=(word<<16>>16)/32768;
        }
        const sound=ctx.createBufferSource();sound.buffer=buf;sound.connect(ctx.destination);
        if(role==='assistant'){s.voz.add(sound);sound.onended=()=>s.voz.delete(sound);}
        const at=Math.max(ctx.currentTime+.035,s.next[role]||0);
        sound.start(at);s.next[role]=at+buf.duration;
      };
    }catch{if(session===s||!s)parar('No se ha podido iniciar el audio.');}
  };
  if(retomar)retomar.onclick=async()=>{
    const elegido=id;
    if(!elegido||solicitud===elegido)return;
    solicitud=elegido;retomar.disabled=true;parar('Pasando la llamada a tu móvil…');
    try{
      const r=await fetch('/api/call/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'mobile',liveId:elegido})});
      const result=await r.json();
      if(!r.ok||!result.ok)throw Error(result.error||'No se pudo desviar.');
      if(id===elegido)estado.textContent='Contesta cuando suene tu móvil.';
    }catch(e){if(id===elegido){solicitud='';retomar.disabled=false;estado.textContent=e.message;}}
  };
  function mostrar(call){
    const next=call?.id||'';
    if(id!==next){parar();id=next;solicitud='';if(retomar)retomar.disabled=false;}
    panel.hidden=!id;
    if(id&&$('quien'))$('quien').textContent='En directo · '+call.numero;
  }
  async function refresh(){
    let call;
    try{const r=await fetch('/api/directo',{cache:'no-store'});if(r.ok)call=await r.json();}catch{}
    mostrar(call);
    setTimeout(refresh,2000);
  }
  window.addEventListener('pagehide',()=>parar());
  if(retomar)refresh();
  else document.addEventListener('llamada-directo',e=>mostrar(e.detail));
})();
