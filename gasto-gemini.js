const {GoogleAuth}=require('google-auth-library');

// Cloud Billing agrupa por proyecto, no por clave. No convertir tokens en euros.
function crearConsulta(env=process.env, consultar=consultaBigQuery, reloj=()=>new Date()){
  let pendiente,cache,hasta=0;
  return async()=>{
    const tabla=env.GEMINI_BILLING_TABLE, proyecto=env.GEMINI_BILLING_PROJECT, servicio=env.GEMINI_BILLING_SERVICE_ID;
    if(!tabla || !proyecto || !servicio)return {estado:'sin_configurar'};
    if(!/^[a-z][a-z0-9-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(tabla))throw Error('Tabla no válida');
    const ahora=reloj(), mes=ahora.toISOString().slice(0,7).replace('-','');
    if(cache?.mes===mes && ahora.getTime()<hasta)return cache;
    if(!pendiente)pendiente=(async()=>{
      try{
        const rows=await consultar({tabla,proyecto,servicio,mes,location:env.GEMINI_BILLING_LOCATION});
        const importes=rows.map(({f})=>{
          const moneda=f[0].v,total=Number(f[1].v);
          if(!/^[A-Z]{3}$/.test(moneda)||f[1].v==null||!Number.isFinite(total))throw Error('Importe no válido');
          return {moneda,total};
        });
        cache={estado:importes.length?'disponible':'sin_registros',importes,mes,consultado:ahora.toISOString()};
        hasta=ahora.getTime()+3600000;
      }catch{
        cache={estado:'no_disponible',mes};hasta=ahora.getTime()+300000;
      }
      return cache;
    })().finally(()=>{pendiente=null;});
    return pendiente;
  };
}
async function consultaBigQuery({tabla,proyecto,servicio,mes,location}){
  const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/bigquery']});
  const client=await auth.getClient();
  const {data}=await client.request({method:'POST',url:`https://bigquery.googleapis.com/bigquery/v2/projects/${tabla.split('.')[0]}/queries`,
    timeout:20000,data:{useLegacySql:false,timeoutMs:12000,maximumBytesBilled:'1073741824',location,
      query:`SELECT currency, SUM(CAST(cost AS NUMERIC) + IFNULL((SELECT SUM(CAST(c.amount AS NUMERIC)) FROM UNNEST(credits) c),0)) AS importe
        FROM \`${tabla}\` WHERE invoice.month=@mes AND project.id=@proyecto AND service.id=@servicio GROUP BY currency`,
      parameterMode:'NAMED',queryParameters:Object.entries({mes,proyecto,servicio}).map(([name,value])=>({name,parameterType:{type:'STRING'},parameterValue:{value}}))}});
  if(!data.jobComplete||data.errors?.length)throw Error('Consulta incompleta');
  return data.rows||[];
}
module.exports={crearConsulta};
