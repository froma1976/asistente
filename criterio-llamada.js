const {datosParaVoz}=require('./datos-voz');

function dia(value) {
  let s=String(value||'').trim();
  const es=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if(es) s=`${es[3]}-${es[2].padStart(2,'0')}-${es[1].padStart(2,'0')}`;
  if(!/^\d{4}-\d\d-\d\d$/.test(s)) return null;
  const n=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(n)&&new Date(n).toISOString().startsWith(s)?n:null;
}
function disponibilidad({checkIn,checkOut},blocks,reservations) {
  const a=dia(checkIn), b=dia(checkOut);
  if(a===null||b===null||a>=b) return 'sin_verificar';
  let unknown=false;
  // El último día bloqueado es inclusivo; la salida de un huésped no ocupa esa noche.
  for(const [from,to,block] of [
    ...blocks.map(x=>[x.from,x.to,true]),
    ...reservations.filter(x=>!['cancelado','cancelada','rechazada'].includes(x.status)).map(x=>[x.checkIn,x.checkOut,false])
  ]) {
    const start=dia(from), last=dia(to);
    if(start===null||last===null||last<start||(!block&&last===start)){unknown=true;continue;}
    if(a<last+(block?86400000:0)&&start<b) return 'ocupado';
  }
  return unknown?'sin_verificar':'libre';
}
const temas={
  taller:/\b(taller|coche|veh[ií]culo|mec[aá]nic[oa])\b/i,
  salud:/\b(cl[ií]nica|m[eé]dic[oa]|dentista|consulta m[eé]dica)\b/i,
  mesa:/\b(restaurante|mesa|cenar|comensales)\b/i,
  reparto:/\b(reparto|repartidor|paquete|mensajer[ií]a)\b/i,
  alojamiento:/\b(hu[eé]sped|alojamiento|casa rural)\b/i,
};
function pistas(text,{tasks,profile,memory}) {
  const matches=Object.values(temas).filter(re=>re.test(text));
  const lines=[...tasks.filter(t=>t.status==='pending').slice(0,5).map(t=>t.text),profile,memory]
    .flatMap(s=>String(s||'').split(/[\n;]+/)).filter(s=>matches.some(re=>re.test(s)));
  return [...new Set(lines.map(s=>datosParaVoz(s).trim().slice(0,180)))].slice(0,3);
}
const sectores={luz:/\b(luz|electricidad|el[eé]ctrica|energ[ií]a|kwh|kilovatio)\b/i,telefonia:/\b(fibra|telefon[ií]a|m[oó]vil(?:es)?|internet|telecomunicaciones)\b/i};
function datoComercial(sector,campo,conversation,turn,invoices,profile) {
  if(!Object.hasOwn(sectores,sector)||!sectores[sector].test(conversation)||
    !/(?:[¿?]|\b(?:cu[aá]nto|cu[aá]l|qu[eé]|d[oó]nde|puede|podr[ií]a|dime|d[ií]game|necesito|facilite|indique|me da)\b)/i.test(turn)) return null;
  if(campo==='direccion' && /direcci[oó]n|domicilio/i.test(turn))
    return datosParaVoz(String(profile||'').match(/^\s*Dirección comercial autorizada:\s*([^\r\n]+)/im)?.[1]||'').slice(0,180)||null;
  const invoice=invoices.find(x=>sectores[sector].test(x.category));
  if(!invoice) return null;
  const terms=invoice.terms.join(' ');
  if(sector==='luz'&&campo==='kwh'&&/precio|pag[ao]|kwh|kilovatio|tarifa/i.test(turn))
    return terms.match(/\d+(?:[.,]\d+)?\s*(?:€|euros?)\s*\/\s*kwh\b/i)?.[0]||null;
  if(sector==='telefonia'&&campo==='cuota'&&/precio|pag[ao]|cuota|cuesta|coste/i.test(turn))
    return invoice.price.match(/\d+(?:[.,]\d+)?\s*(?:€|euros?)(?:\s*\/\s*mes)?/gi)?.join(' + ')||null;
  if(sector==='telefonia'&&campo==='paquete'&&/tien[eé]|contratad|incluy|paquete|servicios|l[ií]neas|velocidad/i.test(turn))
    return [terms.match(/fibra\s+\d+(?:[.,]\d+)?\s*[gm]b(?:ps)?/i)?.[0],
      invoice.category.match(/\d+\s+(?:m[oó]viles|l[ií]neas)/i)?.[0],/televisi[oó]n|\bTV\b/i.test(terms)?'TV':null,
      /GB ilimitados/i.test(terms)?'datos ilimitados en la línea correspondiente':null].filter(Boolean).join(', ')||null;
  return null;
}
const lecciones={condiciones:'Pide antes el precio definitivo, permanencia y extras.',contacto:'Comprueba que quede una vía de respuesta antes de cerrar el recado.',fecha:'Aclara la fecha y hora exactas antes de comprobar disponibilidad.',objetivo:'Aclara al principio qué resultado necesita el interlocutor.'};
function experiencia(history) {
  const counts=new Map();
  for(const c of history) if(c.source==='twilio'&&Object.hasOwn(lecciones,c.leccion)) counts.set(c.leccion,(counts.get(c.leccion)||0)+1);
  return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k])=>lecciones[k]);
}
function numeroSeguimiento(value) {
  const n=String(value||'').replace(/[\s()-]/g,'').replace(/^00/,'+');
  if(/^[6789]\d{8}$/.test(n)) return '+34'+n;
  return /^\+[1-9]\d{6,14}$/.test(n)?n:null;
}
function notaSeguimiento(number,args,now=new Date()) {
  const numero=numeroSeguimiento(number);
  const [asunto,paso,cuando]=['asunto','paso','cuando'].map(k=>typeof args[k]==='string'?datosParaVoz(args[k]).trim().slice(0,180):'');
  if(!numero||!asunto||!paso||!cuando) return null;
  return {numero,fecha:now.toLocaleDateString('es-ES',{timeZone:'Europe/Madrid'}),asunto,paso,cuando};
}
function seguimientosDelNumero(notes,number) {
  const numero=numeroSeguimiento(number);
  return numero?notes.filter(n=>n.numero===numero).slice(0,3).map(({fecha,asunto,paso,cuando})=>({fecha,asunto,paso,cuando})):[];
}
module.exports={disponibilidad,pistas,datoComercial,experiencia,lecciones,notaSeguimiento,seguimientosDelNumero};
