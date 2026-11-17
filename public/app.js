// Frontend Controller: Secretaria Personal IA 360º de Fernando + Web Audio (16kHz in / 24kHz out)
let currentConfig = {};
let activeCall = null;
let dashboardWs = null;
let secretaryData = {
  reservations: [],
  appointments: [],
  messages: [],
  invoices: [],
  contacts: [],
  blockedDates: [],
  stats: { spamBlocked: 4, timeSavedMinutes: 18, estimatedValueEur: 480 },
  history: [],
};

// Web Microphone & Audio Playback state
let webCallWs = null;
let audioCtx = null;
let micStream = null;
let scriptProcessor = null;
let nextPlayTime = 0;
const activeAudioSources = new Set();

function ensureAudioReady() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    nextPlayTime = audioCtx.currentTime;
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function stopAllPlayback() {
  for (const src of activeAudioSources) {
    try {
      src.stop();
      src.disconnect();
    } catch {}
  }
  activeAudioSources.clear();
  if (audioCtx) {
    nextPlayTime = audioCtx.currentTime;
  }
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

function speakBrowserFallback(role, text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-ES';
    utter.rate = 1.04;
    utter.pitch = role === 'assistant' ? 1.06 : 0.94;
    const allVoices = window.speechSynthesis.getVoices();
    const spainVoices = allVoices.filter(
      (v) => v.lang.toLowerCase() === 'es-es' || v.lang.toLowerCase() === 'es_es'
    );
    const pool = spainVoices.length > 0 ? spainVoices : allVoices.filter((v) => v.lang.startsWith('es'));
    if (pool.length > 0) {
      utter.voice = role === 'assistant' ? pool[0] : pool[pool.length - 1];
    }
    window.speechSynthesis.speak(utter);
  } catch {}
}

// DOM Elements
const ownerHeaderName = document.getElementById('ownerHeaderName');
const apiStatusBadge = document.getElementById('apiStatusBadge');
const testTelegramTopBtn = document.getElementById('testTelegramTopBtn');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');

const businessTemplateSelect = document.getElementById('businessTemplateSelect');
const statSpamBlocked = document.getElementById('statSpamBlocked');
const statTimeSaved = document.getElementById('statTimeSaved');
const statCapturedCount = document.getElementById('statCapturedCount');
const statEstimatedValue = document.getElementById('statEstimatedValue');

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

// Secretary Hub Elements
const badgeReservations = document.getElementById('badgeReservations');
const badgeAppointments = document.getElementById('badgeAppointments');
const badgeMessages = document.getElementById('badgeMessages');
const badgeInvoices = document.getElementById('badgeInvoices');
const badgeContacts = document.getElementById('badgeContacts');

const blockedDatesBar = document.getElementById('blockedDatesBar');
const reservationsList = document.getElementById('reservationsList');
const appointmentsList = document.getElementById('appointmentsList');
const messagesList = document.getElementById('messagesList');
const invoicesList = document.getElementById('invoicesList');
const contactsList = document.getElementById('contactsList');

const addBlockedDateBtn = document.getElementById('addBlockedDateBtn');
const addReservationBtn = document.getElementById('addReservationBtn');
const addAppointmentBtn = document.getElementById('addAppointmentBtn');
const addMessageBtn = document.getElementById('addMessageBtn');
const addContactBtn = document.getElementById('addContactBtn');
const uploadInvoiceBtn = document.getElementById('uploadInvoiceBtn');
const invoiceFileInput = document.getElementById('invoiceFileInput');

// ============================================================================
// Initialize Dashboard & Real-Time WebSocket
// ============================================================================
async function loadInitialState() {
  const res = await fetch('/api/state');
  const data = await res.json();
  applyConfigToUI(data.config);
  if (data.secretaryData) {
    secretaryData = data.secretaryData;
    renderSecretaryHub();
  }
  if (data.activeCall && data.activeCall.status !== 'ended') {
    activeCall = data.activeCall;
    renderCallState(activeCall);
  }
}

function applyConfigToUI(cfg) {
  currentConfig = cfg || {};
  const owner = cfg.ownerName || 'Fernando';
  if (ownerHeaderName) ownerHeaderName.textContent = owner;
  targetMobileLabel.textContent = `Pasar llamada en caliente a ${cfg.personalPhoneNumber || '639403998'}`;

  if (cfg.hasApiKey) {
    apiStatusBadge.className = 'status-pill ok';
    apiStatusBadge.textContent = '✅ Secretaria Gemini 3.8 Live (es-ES) Activa';
  } else {
    apiStatusBadge.className = 'status-pill warn';
    apiStatusBadge.textContent = '⚙️ Configura tu API Key';
  }

  if (businessTemplateSelect && cfg.businessTemplate) {
    businessTemplateSelect.value = cfg.businessTemplate;
  }

  document.getElementById('cfgGeminiKey').value = cfg.geminiApiKey || '';
  document.getElementById('cfgVoiceName').value = cfg.voiceName || 'Aoede';
  document.getElementById('cfgOwnerName').value = owner;
  document.getElementById('cfgPersonalPhone').value = cfg.personalPhoneNumber || '639403998';
  document.getElementById('cfgOwnerEmail').value = cfg.ownerEmail || '';
  const rateEl = document.getElementById('cfgNightlyRate');
  if (rateEl) rateEl.value = cfg.nightlyRate || '120 €/noche (mínimo 2 noches)';
  document.getElementById('cfgFilterRules').value = cfg.filterRules || '';
  const contractsEl = document.getElementById('cfgContractsContext');
  if (contractsEl) contractsEl.value = cfg.contractsContext || '';
  const tgTokenEl = document.getElementById('cfgTelegramToken');
  if (tgTokenEl) tgTokenEl.value = cfg.telegramBotToken || '';
  const tgChatEl = document.getElementById('cfgTelegramChatId');
  if (tgChatEl) tgChatEl.value = cfg.telegramChatId || '';
  const twilioPhoneEl = document.getElementById('cfgTwilioPhone');
  if (twilioPhoneEl) twilioPhoneEl.value = cfg.twilioPhoneNumber || '';
  document.getElementById('cfgTwilioSid').value = cfg.twilioAccountSid || '';
  document.getElementById('cfgTwilioToken').value = cfg.twilioAuthToken || '';
  updateGsmForwardingCodes(cfg.twilioPhoneNumber || '');
}

function updateGsmForwardingCodes(rawPhone) {
  const clean = String(rawPhone || '').replace(/\s+/g, '') || '+34TUNUMERO';
  const busyEl = document.getElementById('gsmCodeBusy');
  const noAnsEl = document.getElementById('gsmCodeNoAnswer');
  if (busyEl) busyEl.textContent = `**67*${clean}#`;
  if (noAnsEl) noAnsEl.textContent = `**61*${clean}*11*15#`;
}

function connectDashboardWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  dashboardWs = new WebSocket(`${proto}://${location.host}/ws/dashboard`);

  dashboardWs.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'init') {
      if (msg.secretaryData) {
        secretaryData = msg.secretaryData;
        renderSecretaryHub();
      }
      if (msg.activeCall && msg.activeCall.status !== 'ended') {
        activeCall = msg.activeCall;
        renderCallState(activeCall);
      }
    } else if (msg.type === 'call_started') {
      stopAllPlayback();
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
    } else if (msg.type === 'secretary_update') {
      if (msg.secretaryData) {
        secretaryData = msg.secretaryData;
        renderSecretaryHub();
      }
    } else if (msg.type === 'call_audio' && msg.data) {
      playPcm24kBase64(msg.data);
    } else if (msg.type === 'speak_fallback' && msg.text) {
      speakBrowserFallback(msg.role, msg.text);
    } else if (msg.type === 'call_transferred') {
      activeCall = msg.call;
      renderCallState(activeCall);
    } else if (msg.type === 'call_ended') {
      stopAllPlayback();
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
// UI Renderers: Call State, Classification, Transcript & Secretary Hub
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
      : '🎭 Simulación con Voz';

  if (isScreening) {
    callStateBanner.className = 'call-banner active';
    callBannerTitle.textContent = '👩‍💼 Tu secretaria está atendiendo la llamada en directo...';
    callBannerSub.textContent =
      'Escuchando, comprobando disponibilidad, anotando recados/citas o comparando facturas. Pulsa el botón verde si quieres cogerla tú.';
    liveIndicator.classList.remove('hidden');
  } else if (isTransferred) {
    callStateBanner.className = 'call-banner transferred';
    callBannerTitle.textContent =
      call.status === 'transferred'
        ? `📲 Llamada desviada en caliente a tu móvil (${currentConfig.personalPhoneNumber})`
        : '🎙️ Has tomado el control de la llamada desde este panel';
    callBannerSub.textContent = 'Tu secretaria IA te ha pasado al interlocutor.';
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
  categoryVal.textContent = cls.category || 'Atendiendo...';
  summaryVal.textContent = cls.summary || '';
  recommendationVal.textContent = cls.recommendation || '';

  const score = Number(cls.relevanceScore || 5);
  relevanceBar.style.width = `${Math.min(100, Math.max(10, score * 10))}%`;
  scoreBadge.textContent = `Prioridad: ${score}/10`;

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
        ? '📞 Quien llama'
        : item.role === 'assistant'
        ? `👩‍💼 Tu Secretaria IA`
        : item.role === 'owner_whisper'
        ? '🤫 Tu orden privada a la secretaria'
        : '🔔 Registro de Secretaria';

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
// Secretary Hub Renderer (Reservas, Agenda, Recados, Facturas IA & CRM)
// ============================================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildWhatsAppUrl(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9 && /^[6789]/.test(digits)) {
    digits = '34' + digits;
  }
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function renderSecretaryHub() {
  const reservations = secretaryData.reservations || [];
  const appointments = secretaryData.appointments || [];
  const messages = secretaryData.messages || [];
  const invoices = secretaryData.invoices || [];
  const contacts = secretaryData.contacts || [];
  const blockedDates = secretaryData.blockedDates || [];
  const stats = secretaryData.stats || {};

  badgeReservations.textContent = reservations.length;
  badgeAppointments.textContent = appointments.length;
  badgeMessages.textContent = messages.length;
  if (badgeInvoices) badgeInvoices.textContent = invoices.length;
  if (badgeContacts) badgeContacts.textContent = contacts.length;

  // Update KPI Bar
  if (statSpamBlocked) statSpamBlocked.textContent = stats.spamBlocked || 4;
  if (statTimeSaved) statTimeSaved.textContent = `${stats.timeSavedMinutes || 18} min`;
  if (statCapturedCount) statCapturedCount.textContent = reservations.length + appointments.length;
  if (statEstimatedValue) {
    const val = Number(stats.estimatedValueEur || 480);
    statEstimatedValue.textContent = `${val} €`;
  }

  // Blocked Dates Pills
  if (blockedDatesBar) {
    blockedDatesBar.innerHTML = blockedDates
      .map(
        (b) => `
      <div class="blocked-pill">
        <span>🚫 Ocupado: <strong>${escapeHtml(b.from)} a ${escapeHtml(b.to)}</strong> (${escapeHtml(b.reason)})</span>
        <button onclick="deleteSecItem('blockedDates', '${b.id}')" title="Quitar bloqueo">✕</button>
      </div>`
      )
      .join('');
  }

  // 1. Render Reservations
  if (reservations.length === 0) {
    reservationsList.innerHTML = `
      <div class="sec-empty">
        🏡 No hay reservas registradas todavía. Pulsa arriba en <strong>"🏡 Simular: Reserva + Disponibilidad"</strong> para ver cómo tu secretaria comprueba fechas en el calendario, da el precio y guarda la reserva.
      </div>`;
  } else {
    reservationsList.innerHTML = reservations
      .map((r) => {
        const isDone = r.status === 'completado';
        const waUrl = buildWhatsAppUrl(
          r.phone,
          `Hola ${r.guestName}, soy ${currentConfig.ownerName || 'Fernando'}. Te escribo para confirmar tu solicitud de reserva para ${r.guestsCount} personas del ${r.checkIn} al ${r.checkOut}.`
        );
        return `
        <div class="sec-item ${isDone ? 'completed' : ''}">
          <div class="sec-item-top">
            <div class="sec-item-title">🏡 ${escapeHtml(r.guestName)} (${escapeHtml(r.guestsCount)} pers.)</div>
            <span class="sec-badge ${isDone ? 'done' : 'pending'}">${isDone ? '✅ Confirmada' : '⏳ Pendiente'}</span>
          </div>
          <div class="sec-meta">
            <span>📅 Entrada: <strong>${escapeHtml(r.checkIn)}</strong></span>
            <span>📅 Salida: <strong>${escapeHtml(r.checkOut)}</strong></span>
            <span>📞 ${escapeHtml(r.phone)}</span>
          </div>
          <div class="sec-body">
            <div><strong>Alojamiento/Servicio:</strong> ${escapeHtml(r.propertyOrService)}</div>
            <div><strong>Notas:</strong> ${escapeHtml(r.specialRequests)}</div>
          </div>
          <div class="sec-actions">
            <span class="sec-time">Anotada: ${escapeHtml(r.createdAt)}</span>
            <div class="sec-btn-group">
              ${
                waUrl
                  ? `<a class="btn-xs whatsapp" href="${waUrl}" target="_blank" rel="noopener">💬 WhatsApp</a>`
                  : ''
              }
              <button class="btn-xs" onclick="toggleSecItem('reservations', '${r.id}')">${
          isDone ? '↩️ Reabrir' : '✅ Confirmar'
        }</button>
              <button class="btn-xs danger" onclick="deleteSecItem('reservations', '${r.id}')">🗑️</button>
            </div>
          </div>
        </div>`;
      })
      .join('');
  }

  // 2. Render Appointments / Calendar
  if (appointments.length === 0) {
    appointmentsList.innerHTML = `
      <div class="sec-empty">
        📅 No hay citas agendadas todavía. Pulsa arriba en <strong>"📅 Simular: Contacto VIP (Cita + Recado)"</strong> para ver cómo tu secretaria reconoce a quien llama y agenda la cita.
      </div>`;
  } else {
    appointmentsList.innerHTML = appointments
      .map((a) => {
        const isDone = a.status === 'completado';
        const waUrl = buildWhatsAppUrl(
          a.phone,
          `Hola ${a.withPerson}, soy ${currentConfig.ownerName || 'Fernando'}. Te confirmo nuestra cita (${a.title}) para el ${a.date} a las ${a.time}.`
        );
        return `
        <div class="sec-item ${isDone ? 'completed' : ''}">
          <div class="sec-item-top">
            <div class="sec-item-title">📅 ${escapeHtml(a.title)}</div>
            <span class="sec-badge ${isDone ? 'done' : 'pending'}">${isDone ? '✅ Realizada' : '🗓️ En Agenda'}</span>
          </div>
          <div class="sec-meta">
            <span>👤 Con: <strong>${escapeHtml(a.withPerson)}</strong></span>
            <span>🕒 <strong>${escapeHtml(a.date)} - ${escapeHtml(a.time)}</strong></span>
            <span>📍 ${escapeHtml(a.locationOrChannel)}</span>
            <span>📞 ${escapeHtml(a.phone)}</span>
          </div>
          <div class="sec-body">${escapeHtml(a.notes || 'Sin notas adicionales')}</div>
          <div class="sec-actions">
            <span class="sec-time">Agendada: ${escapeHtml(a.createdAt)}</span>
            <div class="sec-btn-group">
              ${
                waUrl
                  ? `<a class="btn-xs whatsapp" href="${waUrl}" target="_blank" rel="noopener">💬 WhatsApp</a>`
                  : ''
              }
              <button class="btn-xs" onclick="downloadIcsAppointment('${a.id}')">📥 Calendario (.ics)</button>
              <button class="btn-xs" onclick="toggleSecItem('appointments', '${a.id}')">${
          isDone ? '↩️ Pendiente' : '✅ Hecha'
        }</button>
              <button class="btn-xs danger" onclick="deleteSecItem('appointments', '${a.id}')">🗑️</button>
            </div>
          </div>
        </div>`;
      })
      .join('');
  }

  // 3. Render Messages / Recados
  if (messages.length === 0) {
    messagesList.innerHTML = `
      <div class="sec-empty">
        📝 No hay recados pendientes. Cuando alguien llame y no puedas ponerte, tu secretaria guardará aquí el recado con nombre y teléfono.
      </div>`;
  } else {
    messagesList.innerHTML = messages
      .map((m) => {
        const isDone = m.status === 'completado';
        const isUrgent = m.urgency === 'alta';
        const waUrl = buildWhatsAppUrl(
          m.phone,
          `Hola ${m.callerName}, soy ${currentConfig.ownerName || 'Fernando'}. Mi secretaria me acaba de pasar tu recado sobre "${m.subject}".`
        );
        return `
        <div class="sec-item ${isDone ? 'completed' : ''}">
          <div class="sec-item-top">
            <div class="sec-item-title">📝 ${escapeHtml(m.subject)}</div>
            <span class="sec-badge ${isDone ? 'done' : isUrgent ? 'urgent' : 'pending'}">${
          isDone ? '✅ Atendido' : isUrgent ? '🔥 Urgente' : '📬 Pendiente'
        }</span>
          </div>
          <div class="sec-meta">
            <span>👤 De: <strong>${escapeHtml(m.callerName)}</strong></span>
            <span>📞 Tel: <strong>${escapeHtml(m.phone)}</strong></span>
          </div>
          <div class="sec-body">${escapeHtml(m.message)}</div>
          <div class="sec-actions">
            <span class="sec-time">Recibido: ${escapeHtml(m.createdAt)}</span>
            <div class="sec-btn-group">
              ${
                waUrl
                  ? `<a class="btn-xs whatsapp" href="${waUrl}" target="_blank" rel="noopener">💬 WhatsApp</a>`
                  : ''
              }
              <button class="btn-xs" onclick="toggleSecItem('messages', '${m.id}')">${
          isDone ? '↩️ Reabrir' : '✅ Leído'
        }</button>
              <button class="btn-xs danger" onclick="deleteSecItem('messages', '${m.id}')">🗑️</button>
            </div>
          </div>
        </div>`;
      })
      .join('');
  }

  // 4. Render Dynamic Invoices (Repsol, Yoigo & any uploaded PDF/Photo)
  if (invoicesList) {
    invoicesList.innerHTML = invoices
      .map((inv) => {
        const specsHtml = (inv.keyRates || [])
          .map((rate) => `<li>• ${escapeHtml(rate)}</li>`)
          .join('');
        return `
        <div class="invoice-card ${inv.theme === 'telco' ? 'telco' : 'energy'}">
          <div class="invoice-card-head">
            <span class="invoice-icon">${escapeHtml(inv.icon || '📄')}</span>
            <div>
              <h3>${escapeHtml(inv.category)} — ${escapeHtml(inv.provider)}</h3>
              <small>${escapeHtml(inv.subtitle || '')}</small>
            </div>
            <span class="invoice-total">${escapeHtml(inv.monthlyTotal)}</span>
          </div>
          <ul class="invoice-specs">
            ${specsHtml}
            <li><strong>Regla de tu secretaria:</strong> <span class="highlight-val">${escapeHtml(
              inv.negotiationRule
            )}</span></li>
          </ul>
          <div class="sec-actions" style="margin-top: 10px;">
            <span class="sec-time">Cargada: ${escapeHtml(inv.uploadedAt || 'Reciente')}</span>
            <button class="btn-xs danger" onclick="deleteSecItem('invoices', '${inv.id}')">🗑️ Quitar factura</button>
          </div>
        </div>`;
      })
      .join('');
  }

  // 5. Render Contacts CRM & Caller Memory
  if (contactsList) {
    contactsList.innerHTML = contacts
      .map((c) => {
        return `
        <div class="sec-item">
          <div class="sec-item-top">
            <div class="sec-item-title">${c.vip ? '🌟 ' : '👤 '}${escapeHtml(c.name)}</div>
            <span class="sec-badge ${c.vip ? 'urgent' : 'done'}">${
          c.vip ? '🌟 VIP Prioritario' : 'Memoria Activa'
        }</span>
          </div>
          <div class="sec-meta">
            <span>📞 <strong>${escapeHtml(c.phone)}</strong></span>
            <span>🏷️ ${escapeHtml(c.relation || 'Contacto')}</span>
          </div>
          <div class="sec-body">${escapeHtml(c.notes || 'Sin notas')}</div>
          <div class="sec-actions">
            <span class="sec-time">Reconocimiento automático al llamar</span>
            <div class="sec-btn-group">
              <button class="btn-xs" onclick="toggleSecItem('contacts', '${c.id}')">${
          c.vip ? 'Quitar VIP' : '🌟 Hacer VIP'
        }</button>
              <button class="btn-xs danger" onclick="deleteSecItem('contacts', '${c.id}')">🗑️</button>
            </div>
          </div>
        </div>`;
      })
      .join('');
  }
}

window.toggleSecItem = async function (collection, id) {
  await fetch('/api/secretary/item/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, id }),
  });
};

window.deleteSecItem = async function (collection, id) {
  await fetch('/api/secretary/item/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection, id }),
  });
};

window.downloadIcsAppointment = function (id) {
  const apt = (secretaryData.appointments || []).find((x) => x.id === id);
  if (!apt) return;
  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Secretaria Personal IA Fernando//ES',
    'BEGIN:VEVENT',
    `UID:${apt.id}@secretaria.local`,
    `DTSTAMP:${nowStamp}`,
    `SUMMARY:${apt.title} (${apt.withPerson})`,
    `DESCRIPTION:Fecha acordada: ${apt.date} a las ${apt.time}\\nTeléfono: ${apt.phone}\\nNotas: ${apt.notes || ''}`,
    `LOCATION:${apt.locationOrChannel || ''}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cita-${apt.id}.ics`;
  a.click();
  URL.revokeObjectURL(url);
};

// Secretary Hub Tab Switching
document.querySelectorAll('.hub-tab').forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => {
    const target = tabBtn.getAttribute('data-tab');
    document.querySelectorAll('.hub-tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.hub-pane').forEach((p) => p.classList.remove('active'));
    tabBtn.classList.add('active');
    const pane = document.getElementById(`tab-${target}`);
    if (pane) pane.classList.add('active');
  });
});

// Upload Invoice PDF / Photo & Analyze with Gemini Vision
if (uploadInvoiceBtn && invoiceFileInput) {
  uploadInvoiceBtn.addEventListener('click', () => invoiceFileInput.click());

  invoiceFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const originalText = uploadInvoiceBtn.textContent;
    uploadInvoiceBtn.disabled = true;
    uploadInvoiceBtn.textContent = '⏳ Analizando factura con Gemini Vision...';

    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || '');
          resolve(res.includes(',') ? res.split(',')[1] : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const resp = await fetch('/api/invoices/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          base64Data,
        }),
      });
      const result = await resp.json();
      if (!result.ok) throw new Error(result.error || 'Error analizando documento');

      secretaryData = result.secretaryData;
      renderSecretaryHub();
      if (result.contractsContext) {
        const contractsEl = document.getElementById('cfgContractsContext');
        if (contractsEl) contractsEl.value = result.contractsContext;
      }
      uploadInvoiceBtn.textContent = '✅ ¡Factura añadida a la memoria de tu secretaria!';
      setTimeout(() => {
        uploadInvoiceBtn.textContent = originalText;
        uploadInvoiceBtn.disabled = false;
      }, 3000);
    } catch (err) {
      alert('No se pudo analizar la factura: ' + err.message);
      uploadInvoiceBtn.textContent = originalText;
      uploadInvoiceBtn.disabled = false;
    } finally {
      invoiceFileInput.value = '';
    }
  });
}

// SaaS Template Selector
if (businessTemplateSelect) {
  businessTemplateSelect.addEventListener('change', async (e) => {
    const templateKey = e.target.value;
    const res = await fetch('/api/template/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateKey }),
    });
    const data = await res.json();
    if (data.ok) {
      applyConfigToUI(data.config);
    }
  });
}

// Test Telegram Notification Button
if (testTelegramTopBtn) {
  testTelegramTopBtn.addEventListener('click', async () => {
    const prev = testTelegramTopBtn.textContent;
    testTelegramTopBtn.disabled = true;
    testTelegramTopBtn.textContent = '⏳ Enviando a Telegram...';
    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.ok) {
        testTelegramTopBtn.textContent = '✅ ¡Enviado a tu Telegram!';
      } else {
        testTelegramTopBtn.textContent = '⚠️ Revisa Token en Ajustes';
      }
    } catch {
      testTelegramTopBtn.textContent = '⚠️ Error de conexión';
    }
    setTimeout(() => {
      testTelegramTopBtn.textContent = prev;
      testTelegramTopBtn.disabled = false;
    }, 3000);
  });
}

// Manual Add Handlers for Blocked Dates, Reservations, Appointments, Messages & Contacts
if (addBlockedDateBtn) {
  addBlockedDateBtn.addEventListener('click', async () => {
    const from = prompt('Fecha inicio ocupada (ej. 05/12/2026):', '05/12/2026');
    if (!from) return;
    const to = prompt('Fecha fin ocupada (ej. 08/12/2026):', '08/12/2026') || from;
    const reason = prompt('Motivo (ej. Reservado en Booking / Uso propio):', 'Completo') || 'Ocupado';
    await fetch('/api/secretary/item/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'blockedDates',
        item: { from, to, reason },
      }),
    });
  });
}

if (addReservationBtn) {
  addReservationBtn.addEventListener('click', async () => {
    const guestName = prompt('Nombre del huésped / cliente:');
    if (!guestName) return;
    const phone = prompt('Teléfono de contacto:', '+34 ');
    const checkIn = prompt('Fecha de entrada (Check-in):', 'Viernes 20/11/2026');
    const checkOut = prompt('Fecha de salida (Check-out):', 'Domingo 22/11/2026');
    const guestsCount = Number(prompt('Número de personas:', '2') || 2);
    const specialRequests = prompt('Notas o peticiones especiales:', '') || '';
    await fetch('/api/secretary/item/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'reservations',
        item: { guestName, phone, checkIn, checkOut, guestsCount, specialRequests },
      }),
    });
  });
}

if (addAppointmentBtn) {
  addAppointmentBtn.addEventListener('click', async () => {
    const title = prompt('Motivo de la cita:');
    if (!title) return;
    const withPerson = prompt('¿Con quién es la cita?:') || '';
    const date = prompt('Fecha de la cita:', 'Jueves 19/11/2026') || '';
    const time = prompt('Hora:', '11:30') || '';
    const phone = prompt('Teléfono:', '') || '';
    const notes = prompt('Notas adicionales:', '') || '';
    await fetch('/api/secretary/item/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'appointments',
        item: { title, withPerson, date, time, phone, notes },
      }),
    });
  });
}

if (addMessageBtn) {
  addMessageBtn.addEventListener('click', async () => {
    const callerName = prompt('¿De parte de quién es el recado?:');
    if (!callerName) return;
    const phone = prompt('Teléfono:', '') || '';
    const subject = prompt('Asunto:', 'Llamada pendiente') || 'Recado';
    const message = prompt('Mensaje o recado:') || '';
    await fetch('/api/secretary/item/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'messages',
        item: { callerName, phone, subject, message, urgency: 'normal' },
      }),
    });
  });
}

if (addContactBtn) {
  addContactBtn.addEventListener('click', async () => {
    const name = prompt('Nombre del contacto:');
    if (!name) return;
    const phone = prompt('Teléfono (ej. +34 600...):', '+34 ');
    const relation = prompt('Relación / Empresa (ej. Familia, Asesoría, Cliente):', 'Cliente');
    const notes = prompt('Notas para que tu secretaria recuerde cuando llame:', '');
    const vip = confirm('¿Marcar como Contacto VIP Prioritario?');
    await fetch('/api/secretary/item/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'contacts',
        item: { name, phone, relation, notes, vip },
      }),
    });
  });
}

// ============================================================================
// Actions: Simulate Scenarios, Whisper, Transfer to Mobile, Hangup
// ============================================================================
document.querySelectorAll('.sim-scenario-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const scenario = btn.getAttribute('data-scenario') || 'reservation_request';
    ensureAudioReady();
    stopAllPlayback();
    stopWebMicSession(false);

    if (scenario === 'reservation_request') {
      document.querySelector('.hub-tab[data-tab="reservations"]')?.click();
    } else if (scenario === 'appointment_message') {
      document.querySelector('.hub-tab[data-tab="appointments"]')?.click();
    } else if (scenario === 'energy_comparison' || scenario === 'telco_comparison') {
      document.querySelector('.hub-tab[data-tab="invoices"]')?.click();
    }

    await fetch('/api/call/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario }),
    });
  });
});

transferMobileBtn.addEventListener('click', async () => {
  ensureAudioReady();
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
  stopAllPlayback();
  await fetch('/api/call/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'web' }),
  });
});

hangupBtn.addEventListener('click', async () => {
  stopAllPlayback();
  stopWebMicSession(false);
  await fetch('/api/call/hangup', { method: 'POST' });
});

async function sendWhisperOrder(instruction) {
  if (!instruction) return;
  ensureAudioReady();
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
    stopAllPlayback();
    stopWebMicSession(true);
    return;
  }

  if (!currentConfig.hasApiKey) {
    settingsModal.classList.remove('hidden');
    document.getElementById('cfgGeminiKey').focus();
    return;
  }

  try {
    ensureAudioReady();
    stopAllPlayback();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    ensureAudioReady();
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
        stopAllPlayback();
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
  const ctx = ensureAudioReady();
  if (!ctx) return;

  const binary = atob(base64);
  const sampleCount = Math.floor(binary.length / 2);
  if (sampleCount <= 0) return;

  const bytes = new Uint8Array(sampleCount * 2);
  for (let i = 0; i < sampleCount * 2; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer, 0, sampleCount);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = int16[i] / 32768;
  }

  const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
  audioBuffer.getChannelData(0).set(float32);

  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(ctx.destination);
  activeAudioSources.add(src);
  src.onended = () => activeAudioSources.delete(src);

  const now = ctx.currentTime;
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
  startWebMicBtn.textContent = '🎙️ Hablar con mi Micrófono (Gemini Live)';
}

// ============================================================================
// Settings Modal Handlers
// ============================================================================
openSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
cancelSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

const cfgTwilioPhoneInput = document.getElementById('cfgTwilioPhone');
if (cfgTwilioPhoneInput) {
  cfgTwilioPhoneInput.addEventListener('input', (e) => {
    updateGsmForwardingCodes(e.target.value);
  });
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    geminiApiKey: document.getElementById('cfgGeminiKey').value.trim(),
    voiceName: document.getElementById('cfgVoiceName').value,
    ownerName: document.getElementById('cfgOwnerName').value.trim(),
    personalPhoneNumber: document.getElementById('cfgPersonalPhone').value.trim(),
    ownerEmail: document.getElementById('cfgOwnerEmail').value.trim(),
    nightlyRate: (document.getElementById('cfgNightlyRate')?.value || '').trim(),
    filterRules: document.getElementById('cfgFilterRules').value.trim(),
    contractsContext: document.getElementById('cfgContractsContext').value.trim(),
    telegramBotToken: (document.getElementById('cfgTelegramToken')?.value || '').trim(),
    telegramChatId: (document.getElementById('cfgTelegramChatId')?.value || '').trim(),
    twilioPhoneNumber: (document.getElementById('cfgTwilioPhone')?.value || '').trim(),
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
