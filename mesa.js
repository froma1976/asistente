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
const margen=`Distingue la hora preferida de la franja alternativa. Si el titular pide «a las 14:00 y, si no hay, entre las 13:30 y las 15:00», pide primero mesa a las 14:00, sin ofrecer la franja de entrada. Si recepción propone otra hora sin aclarar si hay a las 14:00, pregunta primero por las 14:00. Solo si esa hora no está disponible usa la franja autorizada: entre varias opciones válidas elige la más cercana a la preferida. Si el titular solo indicó una franja, cualquier hora de inicio dentro de sus límites inclusive es válida. Antes de aceptar comprueba el hueco en la agenda. Repite la fecha y hora exactas acordadas y pide confirmación a recepción. Fuera de la franja, o si el titular solo autorizó una hora exacta, recoge la alternativa para consultarla sin comprometer la reserva.`;
module.exports={tool,recorder,margen};
