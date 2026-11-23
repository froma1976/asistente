async function loadCuota(){
  const box=document.getElementById('cuota-voz');
  try{
    const r=await fetch('/api/cuota-voz',{cache:'no-store'});
    if(!r.ok)throw Error();
    const d=await r.json();
    box.textContent=d.configurada===false?'Voz de ElevenLabs sin configurar.':
      `ElevenLabs: ≈ ${d.minutos} min de voz generada · ${d.creditos.toLocaleString('es-ES')} créditos restantes`;
  }catch{box.textContent='Saldo de voz no disponible.';}
}
loadCuota();
async function loadGastoGemini(){
  const box=document.getElementById('gasto-gemini');
  if(!box)return;
  try{
    const r=await fetch('/api/gasto-gemini',{cache:'no-store'});
    if(!r.ok)throw Error();
    const d=await r.json();
    if(d.estado==='disponible'){
      const importe=d.importes.map(i=>new Intl.NumberFormat('es-ES',{style:'currency',currency:i.moneda,maximumFractionDigits:4}).format(i.total)).join(' + ');
      box.textContent=`Gemini · ${d.mes.slice(4)}/${d.mes.slice(0,4)}: ${importe} registrados en el proyecto (tras créditos; Google puede llevar retraso).`;
    }else if(d.estado==='sin_configurar')box.textContent='Gemini: facturación sin conectar.';
    else if(d.estado==='sin_registros')box.textContent='Gemini: sin cargos exportados este mes para el proyecto y servicio seleccionados.';
    else throw Error();
  }catch{box.textContent='Gemini: gasto no disponible.';}
}
loadGastoGemini();
setInterval(()=>{if(!document.hidden)loadGastoGemini();},300000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadGastoGemini();});
setInterval(()=>{if(!document.hidden)loadCuota();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadCuota();});
