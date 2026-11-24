const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const VOZ_NANDO = 'kGCm8wstdNxJGRfKqfHQ';
const SALUDO = 'Hola, soy Fernando. Dime, ¿qué necesitabas?';
const MULETILLAS = [
  'Un segundo, que lo miro.',
  'A ver, déjame comprobarlo.',
];
const VOICE_SETTINGS = {
  stability: 0.50,
  similarity_boost: 0.80,
  speed: 1.04,
  use_speaker_boost: true,
};

// Adapta cifras, unidades y teléfonos españoles para que eleven_flash_v2_5 los pronuncie con naturalidad.
function normalizarTextoVoz(texto) {
  if (!texto) return '';
  const ini = /^\s+/u.exec(texto)?.[0] || '';
  const fin = /\s+$/u.exec(texto)?.[0] || '';
  let s = texto.trim();
  if (!s) return texto;
  s = s
    .replace(/€\s*\/\s*kWh\b/giu, ' euros el kilovatio hora')
    .replace(/€\s*\/\s*mes\b/giu, ' euros al mes')
    .replace(/€\s*\/\s*d[ií]a\b/giu, ' euros al día')
    .replace(/€\s*\/\s*año\b/giu, ' euros al año')
    .replace(/€\s*\/\s*noche\b/giu, ' euros la noche')
    .replace(/\bkWh\b/giu, 'kilovatios hora')
    .replace(/\bkW\b/gu, 'kilovatios')
    .replace(/\bGbps\b/giu, 'gigas')
    .replace(/\bMbps\b/giu, 'megas')
    .replace(/(\d)\s*GB\b/gu, '$1 gigas')
    .replace(/(\d)\s*MB\b/gu, '$1 megas')
    .replace(/\bIVA\b/gu, 'iva')
    .replace(/(?<!\w)\+34\s*([6789]\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{2})\b/gu, 'más 34, $1, $2, $3, $4')
    .replace(/(?<![+\d])([6789]\d{2})(\d{2})(\d{2})(\d{2})(?!\d)/gu, '$1, $2, $3, $4')
    .replace(/(\d)\.(\d{1,4})(?=\s*(?:€|euros?\b|kilovatios?|por ciento|%))/giu, '$1,$2')
    .replace(/(\d)\s*€/gu, '$1 euros')
    .replace(/€\s*(\d)/gu, '$1 euros')
    .replace(/(\d)\s*%/gu, '$1 por ciento')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
  return ini + s + fin;
}

function servicioVoz() {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || VOZ_NANDO;
  const client = new ElevenLabsClient();
  let saldo, actualizado = 0, consulta;
  return {
    voiceId,
    sintetizar(text, signal) {
      return client.textToSpeech.stream(voiceId,
        {
          text: normalizarTextoVoz(text),
          modelId: 'eleven_flash_v2_5',
          languageCode: 'es',
          outputFormat: 'pcm_24000',
          voiceSettings: {
            stability: VOICE_SETTINGS.stability,
            similarityBoost: VOICE_SETTINGS.similarity_boost,
            speed: VOICE_SETTINGS.speed,
            useSpeakerBoost: VOICE_SETTINGS.use_speaker_boost,
          },
        },
        {abortSignal:signal, maxRetries:0, timeoutInSeconds:12});
    },
    abrirStream({onAudio, onError, onClose, formato = 'pcm_24000'}) {
      const esPcm = formato.startsWith('pcm_');
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?model_id=eleven_flash_v2_5&output_format=${encodeURIComponent(formato)}&language_code=es&auto_mode=true&apply_text_normalization=on&inactivity_timeout=180`;
      const ws = new WebSocket(url);
      let abierto = false, cerrado = false, resto = Buffer.alloc(0);
      const cola = [];
      ws.addEventListener('open', () => {
        if (cerrado) { try { ws.close(); } catch {} return; }
        abierto = true;
        ws.send(JSON.stringify({
          text: ' ',
          xi_api_key: apiKey,
          voice_settings: VOICE_SETTINGS,
        }));
        while (cola.length && ws.readyState === WebSocket.OPEN) ws.send(cola.shift());
      });
      ws.addEventListener('message', async (ev) => {
        if (cerrado) return;
        try {
          const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer?.() ?? ev.data).toString('utf8');
          const m = JSON.parse(raw);
          if (m.error) { cerrado = true; try { ws.close(); } catch {} onError?.(new Error(m.message || m.error)); return; }
          if (m.audio) {
            const chunk = Buffer.from(m.audio, 'base64');
            if (!esPcm) {
              if (chunk.length) onAudio?.(chunk);
            } else {
              const bytes = Buffer.concat([resto, chunk]);
              const n = bytes.length - (bytes.length % 2);
              if (n) onAudio?.(bytes.subarray(0, n));
              resto = bytes.subarray(n);
            }
          }
        } catch (e) { if (!cerrado) onError?.(e); }
      });
      ws.addEventListener('error', (e) => { if (!cerrado) { cerrado = true; onError?.(e); } });
      ws.addEventListener('close', () => { if (!cerrado) { cerrado = true; onClose?.(); } });
      return {
        enviar(payload) {
          if (cerrado) return false;
          const json = JSON.stringify(payload);
          if (abierto && ws.readyState === WebSocket.OPEN) ws.send(json);
          else cola.push(json);
          return true;
        },
        cerrar() {
          cerrado = true;
          cola.length = 0;
          try { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); } catch {}
        },
      };
    },
    async cuota() {
      if (saldo && Date.now()-actualizado < 30000) return saldo;
      if (!consulta) consulta = (async () => {
        const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
          headers:{'xi-api-key':apiKey}, signal:AbortSignal.timeout(6000)
        });
        if (!r.ok) throw Error('Cuota no disponible');
        const {character_limit, character_count} = await r.json();
        if (![character_limit,character_count].every(Number.isFinite)) throw Error('Saldo desconocido');
        const creditos = Math.max(0, character_limit-character_count);
        saldo = {creditos, minutos:Math.floor(creditos/500)};
        actualizado = Date.now();
        return saldo;
      })().finally(()=>{consulta=null;});
      return consulta;
    }
  };
}

// Modo HTTP por frase (respaldo y pruebas unitarias clásicas).
function locutor(sintetizar, emitir, alFallar) {
  let pendiente='', cola=Promise.resolve(), controller=new AbortController();
  function frase(text) {
    const signal=controller.signal;
    const limpio=normalizarTextoVoz(text).trim();
    if (!limpio) return;
    cola=cola.then(async()=>{
      if (signal.aborted) return;
      const stream=await sintetizar(limpio,signal);
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
      let fin;
      while ((fin=/[.!?…]\s+/u.exec(pendiente))) {
        const n=fin.index+fin[0].length;
        frase(pendiente.slice(0,n)); pendiente=pendiente.slice(n);
      }
    },
    terminar() {frase(pendiente);pendiente='';return cola;},
    cortar() {controller.abort();controller=new AbortController();pendiente='';cola=Promise.resolve();},
    cerrar() {this.cortar();}
  };
}

// Modo WebSocket persistente precalentado con auto_mode y normalización española.
function locutorContinuo(abrirStream, emitir, alFallar) {
  let canal = null, pendiente = '', cerrado = false, epoca = 0;
  function asegurarCanal() {
    if (cerrado) return null;
    if (canal) return canal;
    const miEpoca = epoca;
    const inst = abrirStream({
      onAudio(audio) { if (!cerrado && miEpoca === epoca) emitir(audio); },
      onError() {
        if (canal === inst) canal = null;
        if (!cerrado && miEpoca === epoca) alFallar?.();
      },
      onClose() { if (canal === inst) canal = null; },
    });
    canal = inst;
    return canal;
  }
  asegurarCanal();

  function despacharTrozo(text, flush = false) {
    if (!text || !text.trim()) return;
    const c = asegurarCanal();
    if (!c) return;
    const norm = normalizarTextoVoz(text);
    const limpio = flush && !/\s$/u.test(norm) ? norm + ' ' : norm;
    c.enviar(flush ? {text: limpio, flush: true} : {text: limpio, try_trigger_generation: true});
  }

  return {
    texto(fragmento) {
      if (cerrado || !fragmento) return;
      pendiente += fragmento;
      let corte;
      // Espera a frase (.!?), cláusula con >= 12 caracteres, o >= 22 caracteres con espacio sin partir números.
      while (
        (corte = /[.!?…]\s+/u.exec(pendiente)) ||
        (pendiente.length >= 12 && (corte = /[,;:—]\s+/u.exec(pendiente.slice(10)))) ||
        (pendiente.length >= 22 && !/\d\s*$/u.test(pendiente) && (corte = /\s+/u.exec(pendiente.slice(16))))
      ) {
        const offset = corte.input === pendiente ? 0 : corte.input.length === pendiente.length - 10 ? 10 : 16;
        const idx = offset + corte.index + corte[0].length;
        despacharTrozo(pendiente.slice(0, idx), false);
        pendiente = pendiente.slice(idx);
      }
    },
    terminar() {
      if (cerrado) return Promise.resolve();
      if (pendiente.trim()) despacharTrozo(pendiente, true);
      else if (canal) canal.enviar({text: ' ', flush: true});
      pendiente = '';
      return Promise.resolve();
    },
    cortar() {
      epoca++;
      pendiente = '';
      const viejo = canal;
      canal = null;
      viejo?.cerrar();
      if (!cerrado) asegurarCanal();
    },
    cerrar() {
      cerrado = true;
      epoca++;
      pendiente = '';
      const viejo = canal;
      canal = null;
      viejo?.cerrar();
    },
  };
}

// Detector local de voz entrante para cortar el audio saliente en ~80 ms cuando interrumpen.
function detectorInterrupcion(alInterrumpir, reloj = () => Date.now()) {
  let hablandoHasta = 0, ruidoBase = 220, seguidos = 0, yaCortado = false;
  return {
    notificarVozAsistente(duracionMs) {
      const ahora = reloj();
      const base = Math.max(ahora, hablandoHasta);
      hablandoHasta = base + Math.max(0, duracionMs);
      yaCortado = false;
    },
    silenciar() {
      hablandoHasta = 0;
      seguidos = 0;
      yaCortado = false;
    },
    hablando() {
      return reloj() < hablandoHasta;
    },
    analizarEntrada(pcm16kBuf) {
      const muestras = Math.floor(pcm16kBuf.length / 2);
      if (muestras < 80) return false;
      let suma = 0, cruces = 0, prev = pcm16kBuf.readInt16LE(0);
      for (let i = 0; i < muestras; i++) {
        const s = pcm16kBuf.readInt16LE(i * 2);
        suma += s * s;
        if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) cruces++;
        prev = s;
      }
      const rms = Math.sqrt(suma / muestras);
      const zcr = cruces / muestras;
      const ahora = reloj();
      if (ahora >= hablandoHasta) {
        seguidos = 0;
        if (rms < 1200) ruidoBase = Math.max(120, Math.min(900, ruidoBase * 0.92 + rms * 0.08));
        return false;
      }
      const esVoz = rms > Math.max(1350, ruidoBase * 3.8) && zcr >= 0.02 && zcr <= 0.45;
      seguidos = esVoz ? seguidos + 1 : Math.max(0, seguidos - 1);
      if (!yaCortado && seguidos >= 4) {
        yaCortado = true;
        hablandoHasta = 0;
        seguidos = 0;
        alInterrumpir?.();
        return true;
      }
      return false;
    },
  };
}

// Bucle de 2 s (20 tramas de 100 ms a 8 kHz μ-law) de ambiente suave (~-48 dBFS) para evitar vacío digital.
function generarRuidoConfortMulaw(encodeMuLawSample) {
  const total = 16000, samples = new Float64Array(total);
  let seed = 0x6d2b79f5, lp = 0, hp = 0, prevIn = 0;
  for (let i = 0; i < total; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 0x80000000) - 1;
    lp = lp * 0.72 + white * 0.28;
    hp = 0.96 * (hp + lp - prevIn);
    prevIn = lp;
    samples[i] = hp * 95;
  }
  for (let i = 0; i < 160; i++) {
    const w = i / 160;
    samples[i] = samples[i] * w + samples[total - 160 + i] * (1 - w);
  }
  const out = Buffer.allocUnsafe(total);
  for (let i = 0; i < total; i++) out[i] = encodeMuLawSample(Math.round(samples[i]));
  return out;
}

module.exports = {
  servicioVoz,
  locutor,
  locutorContinuo,
  normalizarTextoVoz,
  detectorInterrupcion,
  generarRuidoConfortMulaw,
  SALUDO,
  MULETILLAS,
  VOICE_SETTINGS,
};
