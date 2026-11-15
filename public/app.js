// Frontend Controller: Live Call Screener Dashboard + Web Audio (16kHz in / 24kHz out)
let currentConfig = {};
let activeCall = null;
let dashboardWs = null;

// Web Microphone Call state
let webCallWs = null;
let audioCtx = null;
let micStream = null;
let scriptProcessor = null;
let nextPlayTime = 0;

// DOM Elements
const apiStatusBadge = document.getElementById('apiStatusBadge');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');

const simB2bBtn = document.getElementById('simB2bBtn');
const simSpamBtn = document.getElementById('simSpamBtn');
const startWebMicBtn = document.getElementById('startWebMicBtn');

const callStateBanner = document.getElementById('callStateBanner');
const callBannerTitle = document.getElementById('callBannerTitle');
const callBannerSub = document.getElementById('callBannerSub');
const callOriginBadge = document.getElementById('callOriginBadge');

const scoreBadge = document.getElementById('scoreBadge');
const relevanceBar = document.getElementById('relevanceBar');
const callerNameVal = document.getElementById('callerNameVal');
const companyVal = document.getElementById('companyVal');
const fromNumberVal = document.getElementById('fromNumberVal');
const categoryVal = document.getElementById('categoryVal');
const summaryVal = document.getElementById('summaryVal');
const recommendationBox = document.getElementById('recommendationBox');
const recommendationVal = document.getElementById('recommendationVal');

const transferMobileBtn = document.getElementById('transferMobileBtn');
const targetMobileLabel = document.getElementById('targetMobileLabel');
const takeoverWebBtn = document.getElementById('takeoverWebBtn');
const hangupBtn = document.getElementById('hangupBtn');

const liveIndicator = document.getElementById('liveIndicator');
const transcriptContainer = document.getElementById('transcriptContainer');
const whisperForm = document.getElementById('whisperForm');
const whisperInput = document.getElementById('whisperInput');
const whisperSendBtn = document.getElementById('whisperSendBtn');

// ============================================================================
// Initialize Dashboard & Real-Time WebSocket
// ============================================================================
async function loadInitialState() {
  const res = await fetch('/api/state');
  const data = await res.json();
  applyConfigToUI(data.config);
  if (data.activeCall && data.activeCall.status !== 'ended') {
    activeCall = data.activeCall;
    renderCallState(activeCall);
  }
}

function applyConfigToUI(cfg) {
  currentConfig = cfg;
  targetMobileLabel.textContent = `Pasar llamada en caliente a ${cfg.personalPhoneNumber || '+34600000000'}`;

  if (cfg.hasApiKey) {
    apiStatusBadge.className = 'status-pill ok';
    apiStatusBadge.textContent = '✅ Gemini 3.8 Live Conectado';
  } else {
    apiStatusBadge.className = 'status-pill warn';
    apiStatusBadge.textContent = '⚙️ Configura tu API Key (Modo Simulador Activo)';
  }

  document.getElementById('cfgGeminiKey').value = cfg.geminiApiKey || '';
  document.getElementById('cfgVoiceName').value = cfg.voiceName || 'Aoede';
  document.getElementById('cfgOwnerName').value = cfg.ownerName || 'Carlos';
  document.getElementById('cfgPersonalPhone').value = cfg.personalPhoneNumber || '+34600000000';
  document.getElementById('cfgOwnerEmail').value = cfg.ownerEmail || '';
  document.getElementById('cfgFilterRules').value = cfg.filterRules || '';
  document.getElementById('cfgTwilioSid').value = cfg.twilioAccountSid || '';
  document.getElementById('cfgTwilioToken').value = cfg.twilioAuthToken || '';
}

function connectDashboardWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  dashboardWs = new WebSocket(`${proto}://${location.host}/ws/dashboard`);

  dashboardWs.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'init') {
      if (msg.activeCall && msg.activeCall.status !== 'ended') {
        activeCall = msg.activeCall;
        renderCallState(activeCall);
      }
    } else if (msg.type === 'call_started') {
      activeCall = msg.call;
      renderCallState(activeCall);
    } else if (msg.type === 'transcript_update') {
      if (activeCall) {
        activeCall.transcript = msg.transcript;
        renderTranscript(activeCall.transcript);
      }
    } else if (msg.type === 'classification_update') {
      if (activeCall) {
        activeCall.classification = msg.classification;
        renderClassification(activeCall.classification);
      }
    } else if (msg.type === 'call_transferred') {
      activeCall = msg.call;
      renderCallState(activeCall);
    } else if (msg.type === 'call_ended') {
      activeCall = msg.call;
      stopWebMicSession(false);
      renderCallState(activeCall);
    }
  };

  dashboardWs.onclose = () => {
    setTimeout(connectDashboardWebSocket, 2000);
  };
}

// ============================================================================
// UI Renderers
// ============================================================================
function renderCallState(call) {
  if (!call) return;

  const isScreening = call.status === 'screening';
  const isTransferred = call.status === 'transferred' || call.status === 'taken_over_web';

  transferMobileBtn.disabled = !isScreening;
  takeoverWebBtn.disabled = !isScreening;
  hangupBtn.disabled = call.status === 'ended';
  whisperSendBtn.disabled = !isScreening;

  fromNumberVal.textContent = call.fromNumber || 'Desconocido';
  callOriginBadge.textContent =
    call.source === 'twilio'
      ? '📞 Red Telefónica'
      : call.source === 'web-mic'
      ? '🎙️ Micrófono en Vivo'
      : '🎭 Simulación';

  if (isScreening) {
    callStateBanner.className = 'call-banner active';
    callBannerTitle.textContent = '🤖 Tu asistente está atendiendo y filtrando la llamada...';
    callBannerSub.textContent =
      'Observa la transcripción en vivo. Si te interesa, pulsa el botón verde para pasarla a tu móvil.';
    liveIndicator.classList.remove('hidden');
  } else if (isTransferred) {
    callStateBanner.className = 'call-banner transferred';
    callBannerTitle.textContent =
      call.status === 'transferred'
        ? `📲 Llamada desviada en caliente a tu móvil (${currentConfig.personalPhoneNumber})`
        : '🎙️ Has tomado el control de la llamada desde este panel';
    callBannerSub.textContent = 'El asistente IA se ha retirado de la conversación.';
    liveIndicator.classList.remove('hidden');
  } else {
    callStateBanner.className = 'call-banner idle';
    callBannerTitle.textContent = 'Llamada finalizada';
    callBannerSub.textContent = 'Esperando la siguiente llamada entrante...';
    liveIndicator.classList.add('hidden');
  }

  renderClassification(call.classification);
  renderTranscript(call.transcript);
}

function renderClassification(cls) {
  if (!cls) return;
  callerNameVal.textContent = cls.callerName || 'Identificando...';
  companyVal.textContent = cls.company || 'Analizando...';
  categoryVal.textContent = cls.category || 'Filtrando...';
  summaryVal.textContent = cls.summary || '';
  recommendationVal.textContent = cls.recommendation || '';

  const score = Number(cls.relevanceScore || 5);
  relevanceBar.style.width = `${Math.min(100, Math.max(10, score * 10))}%`;
  scoreBadge.textContent = `Interés: ${score}/10`;

  if (score >= 7) {
    scoreBadge.className = 'score-badge high';
    recommendationBox.className = 'recommendation-box high';
  } else if (score <= 3) {
    scoreBadge.className = 'score-badge low';
    recommendationBox.className = 'recommendation-box low';
  } else {
    scoreBadge.className = 'score-badge neutral';
    recommendationBox.className = 'recommendation-box';
  }
}

function renderTranscript(items) {
  if (!items || items.length === 0) return;
  transcriptContainer.innerHTML = '';

  for (const item of items) {
    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${item.role}`;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const roleLabel =
      item.role === 'caller'
        ? '📞 Quien llama (Comercial / Interlocutor)'
        : item.role === 'assistant'
        ? `🤖 Tu Asistente IA`
        : item.role === 'owner_whisper'
        ? '🤫 Tu orden privada al asistente'
        : '🔔 Sistema';

    meta.innerHTML = `<span>${roleLabel}</span><span>${item.timestamp || ''}</span>`;

    const textDiv = document.createElement('div');
    textDiv.textContent = item.text;

    bubble.appendChild(meta);
    bubble.appendChild(textDiv);
    transcriptContainer.appendChild(bubble);
  }

  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

// ============================================================================
// Actions: Simulate, Whisper, Transfer to Mobile, Hangup
// ============================================================================
simB2bBtn.addEventListener('click', async () => {
  stopWebMicSession(false);
  await fetch('/api/call/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: 'b2b_opportunity' }),
  });
});

simSpamBtn.addEventListener('click', async () => {
  stopWebMicSession(false);
  await fetch('/api/call/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: 'spam_energy' }),
  });
});

transferMobileBtn.addEventListener('click', async () => {
  transferMobileBtn.disabled = true;
  await fetch('/api/call/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'mobile',
      phoneNumber: currentConfig.personalPhoneNumber,
    }),
  });
});

takeoverWebBtn.addEventListener('click', async () => {
  await fetch('/api/call/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'web' }),
  });
});

hangupBtn.addEventListener('click', async () => {
  stopWebMicSession(false);
  await fetch('/api/call/hangup', { method: 'POST' });
});

async function sendWhisperOrder(instruction) {
  if (!instruction) return;
  await fetch('/api/call/whisper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
  });
}

whisperForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = whisperInput.value.trim();
  if (!text) return;
  whisperInput.value = '';
  await sendWhisperOrder(text);
});

document.querySelectorAll('.chip-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const order = btn.getAttribute('data-whisper');
    sendWhisperOrder(order);
  });
});

// ============================================================================
// Live Microphone Session with Gemini 3.8 Live (16kHz PCM input, 24kHz PCM out)
// ============================================================================
startWebMicBtn.addEventListener('click', async () => {
  if (webCallWs) {
    stopWebMicSession(true);
    return;
  }

  if (!currentConfig.hasApiKey) {
    settingsModal.classList.remove('hidden');
    document.getElementById('cfgGeminiKey').focus();
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    nextPlayTime = audioCtx.currentTime;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    webCallWs = new WebSocket(`${proto}://${location.host}/ws/web-call`);

    startWebMicBtn.classList.add('recording');
    startWebMicBtn.textContent = '⏹️ Finalizar llamada de micrófono';

    webCallWs.onopen = () => {
      const source = audioCtx.createMediaStreamSource(micStream);
      scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);

      scriptProcessor.onaudioprocess = (e) => {
        if (!webCallWs || webCallWs.readyState !== WebSocket.OPEN) return;
        const inputFloat = e.inputBuffer.getChannelData(0);
        // Downsample from audioCtx.sampleRate (24000) to 16000 PCM16LE
        const ratio = audioCtx.sampleRate / 16000;
        const outLength = Math.floor(inputFloat.length / ratio);
        const pcm16 = new Int16Array(outLength);
        for (let i = 0; i < outLength; i++) {
          const s = Math.max(-1, Math.min(1, inputFloat[Math.floor(i * ratio)]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        webCallWs.send(JSON.stringify({ type: 'audio', data: btoa(binary) }));
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(audioCtx.destination);
    };

    webCallWs.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'audio' && msg.data) {
        playPcm24kBase64(msg.data);
      } else if (msg.type === 'interrupted') {
        if (audioCtx) nextPlayTime = audioCtx.currentTime;
      }
    };

    webCallWs.onclose = () => {
      stopWebMicSession(false);
    };
  } catch (err) {
    alert('No se pudo acceder al micrófono: ' + err.message);
  }
});

function playPcm24kBase64(base64) {
  if (!audioCtx) return;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }

  const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
  audioBuffer.getChannelData(0).set(float32);

  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  if (nextPlayTime < now) nextPlayTime = now;
  src.start(nextPlayTime);
  nextPlayTime += audioBuffer.duration;
}

function stopWebMicSession(notifyServer = true) {
  if (scriptProcessor) {
    try { scriptProcessor.disconnect(); } catch {}
    scriptProcessor = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (webCallWs) {
    const ws = webCallWs;
    webCallWs = null;
    if (notifyServer) {
      try { ws.close(); } catch {}
    }
  }
  startWebMicBtn.classList.remove('recording');
  startWebMicBtn.textContent = '🎙️ Llamada Real con mi Micrófono (Gemini Live)';
}

// ============================================================================
// Settings Modal Handlers
// ============================================================================
openSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
cancelSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    geminiApiKey: document.getElementById('cfgGeminiKey').value.trim(),
    voiceName: document.getElementById('cfgVoiceName').value,
    ownerName: document.getElementById('cfgOwnerName').value.trim(),
    personalPhoneNumber: document.getElementById('cfgPersonalPhone').value.trim(),
    ownerEmail: document.getElementById('cfgOwnerEmail').value.trim(),
    filterRules: document.getElementById('cfgFilterRules').value.trim(),
    twilioAccountSid: document.getElementById('cfgTwilioSid').value.trim(),
    twilioAuthToken: document.getElementById('cfgTwilioToken').value.trim(),
  };

  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.ok) {
    applyConfigToUI(data.config);
    settingsModal.classList.add('hidden');
  }
});

// Boot
loadInitialState();
connectDashboardWebSocket();
