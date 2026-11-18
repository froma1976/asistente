const tool={name:'consultar_agenda',description:'Consulta en directo una hora de disponibilidad en Google Calendar, zona Europe/Madrid.',parameters:{type:'OBJECT',properties:{date:{type:'STRING',description:'AAAA-MM-DD'},time:{type:'STRING',description:'HH:MM'}},required:['date','time']}};
function range(date,time) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('Indica fecha AAAA-MM-DD y hora HH:MM.');
  const local=`${date}T${time}:00`, stamp=Date.parse(local+'Z');
  const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const matches=[1,2].map(h=>new Date(stamp-h*3600000)).filter(d=>Number.isFinite(+d)&&fmt.format(d).replace(' ','T')===local);
  if(matches.length!==1) throw Error('Fecha u hora no válida o ambigua en Madrid.');
  return {start:{dateTime:matches[0].toISOString(),timeZone:'Europe/Madrid'},end:{dateTime:new Date(+matches[0]+3600000).toISOString(),timeZone:'Europe/Madrid'}};
}
async function check({date,time},getToken,id='primary',request=fetch) {
  try {
    const {start,end}=range(date,time);
    const token=await getToken();
    if(!token) return {estado:'sin_verificar',motivo:'Google Calendar no está conectado.'};
    const r=await request('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({timeMin:start.dateTime,timeMax:end.dateTime,items:[{id}]})});
    if(!r.ok) throw Error();
    const c=(await r.json()).calendars?.[id];
    if(c?.errors?.length||!Array.isArray(c?.busy)) throw Error();
    return {estado:c.busy.length?'ocupado':'libre',date,time,duracionMinutos:60};
  } catch {return {estado:'sin_verificar',motivo:'Comprueba la fecha, la hora y la conexión con Calendar.'};}
}
module.exports={tool,range,check};
