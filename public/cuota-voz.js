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
setInterval(()=>{if(!document.hidden)loadCuota();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadCuota();});
