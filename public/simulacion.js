const get = id => document.getElementById(id);
const mode = get('mode'), statusLine = get('status');
let current;
mode.onchange = () => {
  get('brief').hidden = mode.value !== 'out';
  get('start').textContent = mode.value === 'out' ? 'Recibir llamada de Clara' : 'Llamar a Clara';
  get('tableResult').textContent=mode.value==='out'?'Si confirmas una mesa como recepción, se anotará como simulación en Calendar y recibirás un Telegram.':'';
};
function silence(s) {
  for (const sound of s.sounds) { try { sound.stop(); } catch {} }
  s.sounds.clear(); s.next = 0;
}
function finish(message) {
  const s = current;
  if (!s) return;
  current = null;
  clearInterval(s.ring); clearTimeout(s.timeout);
  s.processor?.disconnect(); s.input?.disconnect();
  s.stream?.getTracks().forEach(t => t.stop()); silence(s);
  s.ws?.close(); s.ctx?.close().catch(()=>{});
  get('roles').hidden = false; get('accept').hidden = get('end').hidden = true;
  statusLine.textContent = message;
}
function ring(s) {
  const tone = s.ctx.createOscillator(), gain = s.ctx.createGain();
  const now = s.ctx.currentTime;
  tone.frequency.value = 440; gain.gain.setValueAtTime(.045,now); gain.gain.exponentialRampToValueAtTime(.001,now+.55);
  tone.connect(gain).connect(s.ctx.destination); s.sounds.add(tone);
  tone.onended = () => s.sounds.delete(tone); tone.start(); tone.stop(now+.55);
}
async function connect(s) {
  clearInterval(s.ring); silence(s); get('accept').hidden = true;
  statusLine.textContent = 'Permite el uso del micrófono…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Abre la prueba en localhost o HTTPS para usar el micrófono.');
    const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    if (current !== s) { stream.getTracks().forEach(t => t.stop()); return; }
    s.stream = stream;
    statusLine.textContent = 'Conectando con Clara…';
    const ws = s.ws = new WebSocket(`${location.protocol === 'https:'?'wss':'ws'}://${location.host}/ws/ensayo`);
    s.timeout = setTimeout(()=>{if(current===s) finish('Clara no ha respondido. Comprueba la configuración de Gemini Live.');},25000);
    ws.onopen = () => { if(current===s) ws.send(JSON.stringify({type:'start',mode:mode.value,goal:get('goal').value.trim()})); };
    ws.onmessage = e => {
      if (current !== s) return;
      const m = JSON.parse(e.data);
      if (m.type === 'ready') {
        clearTimeout(s.timeout);
        statusLine.textContent = 'En conversación · Puedes hablar';
        s.input = s.ctx.createMediaStreamSource(stream);
        s.processor = s.ctx.createScriptProcessor(2048,1,1);
        s.processor.onaudioprocess = event => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const samples = event.inputBuffer.getChannelData(0);
          const pcm = Int16Array.from(samples,x=>Math.max(-1,Math.min(1,x))*32767);
          ws.send(JSON.stringify({type:'audio',data:btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)))}));
        };
        s.input.connect(s.processor).connect(s.ctx.destination);
      } else if (m.type === 'table') {
        get('tableResult').textContent=`Mesa de prueba confirmada. Calendario: ${m.data.calendario}. Telegram: ${m.data.telegram}.`;
      } else if (m.type === 'transcript') {
        get('words').replaceChildren(...m.data.map(turn => {
          const p=document.createElement('p');
          p.textContent=(turn.role==='assistant'?'Clara: ':turn.role==='system'?'Resultado: ':'Tú: ')+turn.text;
          return p;
        }));
      } else if (m.type === 'audio') {
        const bytes = Uint8Array.from(atob(m.data),c=>c.charCodeAt(0)), pcm = new Int16Array(bytes.buffer);
        const buffer = s.ctx.createBuffer(1,pcm.length,24000);
        buffer.copyToChannel(Float32Array.from(pcm,x=>x/32768),0);
        const sound = s.ctx.createBufferSource(); sound.buffer=buffer; sound.connect(s.ctx.destination);
        s.sounds.add(sound); sound.onended=()=>s.sounds.delete(sound);
        const at=Math.max(s.ctx.currentTime,s.next); sound.start(at); s.next=at+buffer.duration;
      } else if (m.type === 'interrupted') silence(s);
      else if (m.type === 'error') finish(m.data);
    };
    ws.onerror = ws.onclose = () => { if(current===s) finish('La conexión de voz se ha cerrado. Comprueba que Clara está en marcha.'); };
  } catch(e) { if(current===s) finish(e.name==='NotAllowedError'?'Permite el micrófono para hablar con Clara.':e.message); }
}
get('roles').onsubmit = async e => {
  e.preventDefault();
  if(current) return;
  if(mode.value==='out' && !get('goal').value.trim()) { statusLine.textContent='Escribe el encargo para Clara.'; return; }
  const s=current={sounds:new Set(),next:0};
  get('words').replaceChildren();
  get('tableResult').textContent='';
  get('roles').hidden=true; get('end').hidden=false;
  try {
    s.ctx=new AudioContext({sampleRate:16000}); await s.ctx.resume();
    if(current!==s) return;
    if(mode.value==='out') {
      statusLine.textContent='Clara te está llamando…'; get('accept').hidden=false;
      ring(s); s.ring=setInterval(()=>ring(s),2000);
    } else await connect(s);
  } catch { if(current===s) finish('El navegador no ha podido iniciar el audio.'); }
};
get('accept').onclick=()=>{if(current) connect(current);};
get('end').onclick=()=>finish('Simulación finalizada.');
window.addEventListener('pagehide',()=>finish('Simulación finalizada.'));
