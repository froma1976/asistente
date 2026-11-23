const {datosParaVoz,contratoParaVoz}=require('./datos-voz');

function contratosDelSector(sector,invoices) {
  if(!Object.hasOwn(sectores,sector)) return [];
  return invoices.filter(inv=>sectores[sector].test(inv.category+' '+(inv.subtitle||''))).map(inv=>({
    compania:contratoParaVoz(inv.provider),producto:contratoParaVoz(inv.category),
    detalle:contratoParaVoz(inv.subtitle),importe:contratoParaVoz(inv.monthlyTotal),
    condiciones:(inv.keyRates||[]).map(contratoParaVoz)
  }));
}
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
const sectores={luz:/\b(luz|electricidad|el[eé]ctrica|energ[ií]a|kwh|kilovatios?)\b/i,telefonia:/\b(fibra|telefon[ií]a|tel[eé]fono|m[oó]vil(?:es)?|internet|telecomunicaciones)\b/i};
const preguntas={
  compania:/compañ[ií]a|operador|proveedor|comercializadora|con qui[eé]n|empresa/i,
  tarifa:/tarifa|plan|producto/i, potencia:/potencia|kilovatios? contratados/i,
  consumo:/consum|gast.*(?:kwh|gigas)|us[ao].*gigas/i,
  kwh:/precio|pag[ao]|kwh|kilovatio|tarifa/i,
  cuota:/precio|pag[ao]|pag[aá]is|cuota|cuesta|coste|mensual|importe/i,
  paquete:/tien[eé]|contratad|incluy|paquete|servicios|l[ií]neas|velocidad|incluid/i,
};
const herramientaComercial={name:'dato_comercial_pedido',description:'Recupera las facturas de luz o telefonía para contestar lo que preguntan sobre los contratos actuales.',parameters:{type:'OBJECT',properties:{sector:{type:'STRING',enum:Object.keys(sectores)}},required:['sector']}};
function etiqueta(value) {
  // Solo nombres breves, no identificadores, teléfonos, direcciones ni notas libres.
  const s=String(value||'').trim();
  return /^[\p{L}\d ()+.-]{2,75}$/u.test(s)&&!/\d{4}|(?:\d[\s.-]*){7}|\b(?:CUPS|DNI|NIE|IBAN|ES\s*\d|titular|direcci[oó]n|cuenta|cliente|domicilio|calle|avenida|contraseña|c[oó]digo)\b/i.test(s)?s:null;
}
function datoComercial(sector,campo,conversation,turn,invoices) {
  if(!Object.hasOwn(sectores,sector)||!sectores[sector].test(conversation)||
     !Object.hasOwn(preguntas,campo)||!preguntas[campo].test(turn)||
     !/(?:[¿?]|\b(?:cu[aá]nt[oa]s?|cu[aá]l(?:es)?|qu[eé]|qui[eé]n|puede|podr[ií]a|dime|d[ií]game|necesito|facilite|indique|me da)\b)/i.test(turn)) return null;
  if(Object.entries(sectores).some(([otro,re])=>otro!==sector&&re.test(turn)&&!sectores[sector].test(turn))) return null;
  const candidatas=invoices.filter(x=>sectores[sector].test(x.category));
  if(candidatas.length!==1) return null;
  const invoice=candidatas[0], lines=invoice.terms||[], terms=lines.join(' ');
  const valores=(s,re)=>[...new Set(s.match(re)||[])].join(', ')||null;
  if(campo==='compania') return etiqueta(invoice.provider);
  if(campo==='tarifa') return etiqueta(lines.find(s=>/^(?:producto|tarifa|plan)\s*:/i.test(s))?.split(/:\s*/).slice(1).join(':'));
  if(campo==='cuota') return valores(invoice.price||'',/\d+(?:[.,]\d+)?\s*(?:€|euros?)(?:\s*\/\s*mes)?/gi);
  if(sector==='luz'&&campo==='potencia') return valores(terms,/\b\d+(?:[.,]\d+)?\s*kw\b(?:\s+(?:punta|valle|llano|P[123]))?/gi);
  if(sector==='luz'&&campo==='kwh') return valores(terms,/\b\d+(?:[.,]\d+)?\s*(?:€|euros?)\s*\/\s*kwh\b/gi);
  if(campo==='consumo'){
    const line=lines.find(s=>/consum/i.test(s)) || (sector==='luz'&&lines.find(s=>/\bkwh\s*=/i.test(s))) || '';
    return valores(line,sector==='luz'?/\b\d+(?:[.,]\d+)?\s*kwh\b/gi:/\b\d+(?:[.,]\d+)?\s*gb\b/gi);
  }
  if(sector==='luz'&&campo==='paquete') return etiqueta(lines.find(s=>/^servicios (?:incluidos|añadidos):/i.test(s))?.split(':')[1]?.split('(')[0]);
  if(sector==='telefonia'&&campo==='paquete')
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
module.exports={disponibilidad,pistas,contratosDelSector,datoComercial,herramientaComercial,experiencia,lecciones,notaSeguimiento,seguimientosDelNumero};
