const {range}=require('./agenda');
const tool={name:'registrar_mesa_confirmada',description:'Solo después de que recepción confirme explícitamente la mesa solicitada, registra el resultado de la simulación en Calendar y Telegram. Nunca ante mera disponibilidad, una alternativa sin aceptar o una negativa.',parameters:{type:'OBJECT',properties:{
  restaurante:{type:'STRING'},date:{type:'STRING',description:'Fecha confirmada AAAA-MM-DD'},time:{type:'STRING',description:'Hora local HH:MM'},personas:{type:'INTEGER'},nombre:{type:'STRING',description:'Nombre de la reserva'}
},required:['restaurante','date','time','personas','nombre']}};
const escapeHtml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function recorder({checkSlot,createEvent,notify}) {
  let pending;
  return args=>{
    if(pending) return pending;
    const {restaurante,date,time,personas,nombre}=args||{};
    if(![restaurante,nombre].every(s=>typeof s==='string'&&s.trim()&&s.length<=160)||!Number.isInteger(personas)||personas<1)
      return {error:'Faltan datos confirmados de la mesa.'};
    let interval;
    try {interval=range(date,time);} catch {return {error:'Fecha u hora no válida.'};}
    pending=(async()=>{
      let calendario='no guardado';
      const description=`Mesa para ${personas} a nombre de ${nombre}. Prueba de voz, no es una reserva real.`;
      try {
        const slot=await checkSlot({date,time});
        if(slot.estado==='libre') {
          await createEvent({...interval,summary:`[Simulación] Mesa en ${restaurante}`,description});
          calendario='guardado';
        } else calendario=slot.estado==='ocupado'?'no guardado: hora ocupada':'no guardado: calendario sin verificar';
      } catch {}
      let telegram='no enviado';
      try {
        const r=await notify(`<b>🍽️ Simulación · Mesa confirmada</b>\n${escapeHtml(restaurante)} · ${date} a las ${time}\n${personas} personas · A nombre de ${escapeHtml(nombre)}\nCalendario: ${calendario}.`);
        if(r.ok) telegram='enviado';
      } catch {}
      return {calendario,telegram};
    })();
    return pending;
  };
}
const margen='Para reservas de mesa, conserva la franja indicada por el titular sin convertirla en una hora fija. Una franja autoriza cualquier hora de inicio entre ambos límites inclusive. Si no hay mesa a la hora preferida, pregunta qué otras horas tienen dentro de esa franja; no des por fallido el encargo. Si ofrecen una hora dentro, comprueba ese hueco de agenda y, si está libre, acéptala sin volver a preguntar al titular. Repite la hora exacta acordada y pide confirmación a recepción. Si solo hay horas fuera de la franja, o el encargo era a una única hora sin margen, recoge la alternativa para consultarla, sin aceptarla ni rechazarla en nombre del titular.';
module.exports={tool,recorder,margen};
