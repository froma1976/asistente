const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const VOZ_NANDO = 'kGCm8wstdNxJGRfKqfHQ';
const SALUDO = 'Hola, soy Fernando. Dime, ¿qué necesitabas?';

function servicioVoz() {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  const client = new ElevenLabsClient();
  let saldo, actualizado = 0, consulta;
  return {
    sintetizar(text, signal) {
      return client.textToSpeech.stream(process.env.ELEVENLABS_VOICE_ID || VOZ_NANDO,
        {text, modelId:'eleven_flash_v2_5', languageCode:'es', outputFormat:'pcm_24000'},
        {abortSignal:signal, maxRetries:0, timeoutInSeconds:12});
    },
    async cuota() {
      if (saldo && Date.now()-actualizado < 30000) return saldo;
      if (!consulta) consulta = (async () => {
        const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
          headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY}, signal:AbortSignal.timeout(6000)
        });
        if (!r.ok) throw Error('Cuota no disponible');
        const {character_limit, character_count} = await r.json();
        if (![character_limit,character_count].every(Number.isFinite)) throw Error('Saldo desconocido');
        const creditos = Math.max(0, character_limit-character_count);
        // Estimación: 1.000 caracteres de habla/minuto y 0,5 créditos/carácter con Flash.
        saldo = {creditos, minutos:Math.floor(creditos/500)};
        actualizado = Date.now();
        return saldo;
      })().finally(()=>{consulta=null;});
      return consulta;
    }
  };
}

// Gemini conserva la conversación y las herramientas. Solo su texto de salida se vocaliza.
function locutor(sintetizar, emitir, alFallar) {
  let pendiente='', cola=Promise.resolve(), controller=new AbortController();
  function frase(text) {
    const signal=controller.signal;
    if (!text.trim()) return;
    cola=cola.then(async()=>{
      if (signal.aborted) return;
      const stream=await sintetizar(text.trim(),signal);
      let resto=Buffer.alloc(0);
      for await(const chunk of stream) {
        if (signal.aborted) break;
        const bytes=Buffer.concat([resto,chunk]);
        const n=bytes.length-(bytes.length%2);
        if (n) emitir(bytes.subarray(0,n));
        resto=bytes.subarray(n);
      }
    }).catch(()=>{if(!signal.aborted) alFallar();});
  }
  return {
    texto(fragmento) {
      pendiente+=fragmento;
      // Esperar al espacio evita cortar decimales como «39.95».
      let fin;
      while ((fin=/[.!?…]\s+/u.exec(pendiente))) {
        const n=fin.index+fin[0].length;
        frase(pendiente.slice(0,n)); pendiente=pendiente.slice(n);
      }
    },
    terminar() {frase(pendiente);pendiente='';return cola;},
    cortar() {controller.abort();controller=new AbortController();pendiente='';cola=Promise.resolve();}
  };
}
module.exports={servicioVoz,locutor,SALUDO};
