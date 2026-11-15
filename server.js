const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

// Runtime settings (editable from UI and persisted to config.json)
const configPath = path.join(__dirname, 'config.json');
let appConfig = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  ownerName: process.env.OWNER_NAME || 'Carlos',
  personalPhoneNumber: process.env.PERSONAL_PHONE_NUMBER || '+34600000000',
  ownerEmail: process.env.OWNER_EMAIL || 'contacto@ejemplo.com',
  voiceName: 'Aoede',
  filterRules:
    process.env.FILTER_RULES ||
    'Descartar telemarketing genérico de luz, gas, telefonía, fibra y seguros. Mostrar interés y pedir detalles concretos (empresa, presupuesto, propuesta) si son posibles clientes, partners estratégicos, inversores o servicios B2B relevantes.',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  publicWebhookUrl: process.env.PUBLIC_WEBHOOK_URL || '',
};

if (fs.existsSync(configPath)) {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    appConfig = { ...appConfig, ...saved };
  } catch (e) {
    console.error('Error leyendo config.json:', e.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Error guardando config.json:', e.message);
  }
}

// ============================================================================
// Lightweight RFC 6455 WebSocket Server implementation (zero npm dependencies)
// ============================================================================
class SimpleWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.readyState = 1; // OPEN
    this.listeners = { message: [], close: [], error: [] };
    this.buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => {
      this.readyState = 3;
      this._emit('close');
    });
    socket.on('error', (err) => this._emit('error', err));
  }

  on(event, fn) {
    if (this.listeners[event]) this.listeners[event].push(fn);
  }

  _emit(event, data) {
    for (const fn of this.listeners[event] || []) {
      try {
        fn(data);
      } catch (err) {
        console.error('WS handler error:', err);
      }
    }
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLength = isMasked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + payloadLength) return;

      let payload = this.buffer.subarray(
        offset + maskLength,
        offset + maskLength + payloadLength
      );

      if (isMasked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
          unmasked[i] = payload[i] ^ mask[i & 3];
        }
        payload = unmasked;
      }

      this.buffer = this.buffer.subarray(offset + maskLength + payloadLength);

      if (opcode === 0x08) {
        // Close frame
        this.close();
        return;
      } else if (opcode === 0x09) {
        // Ping -> Pong
        this._sendFrame(0x0a, payload);
      } else if (opcode === 0x01 || opcode === 0x02) {
        this._emit('message', opcode === 0x01 ? payload.toString('utf8') : payload);
      }
    }
  }

  send(data) {
    if (this.readyState !== 1) return;
    const isString = typeof data === 'string';
    const payload = isString ? Buffer.from(data, 'utf8') : Buffer.from(data);
    this._sendFrame(isString ? 0x01 : 0x02, payload);
  }

  _sendFrame(opcode, payload) {
    if (this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try {
      this._sendFrame(0x08, Buffer.alloc(0));
      this.socket.end();
    } catch {}
    this._emit('close');
  }
}

function upgradeToWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return null;
  }
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n',
    ].join('\r\n')
  );
  return new SimpleWebSocket(socket);
}

// ============================================================================
// G.711 mu-law (8kHz) <-> 16-bit PCM (16kHz / 24kHz) Audio Converters for Twilio
// ============================================================================
const MULAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i & 0xff;
  let sign = mu & 0x80;
  let exponent = (mu >> 4) & 0x07;
  let mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MULAW_DECODE_TABLE[i] = sign ? -sample : sample;
}

function encodeMuLawSample(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  let mantissa = (sample >> (exponent + 3)) & 0x0f;
  let ulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return ulawByte;
}

// Upsample 8kHz mu-law buffer -> 16kHz 16-bit PCM Buffer (for Gemini input)
function mulaw8kToPcm16k(mulawBuf) {
  const pcm16k = Buffer.allocUnsafe(mulawBuf.length * 4); // 2x samples * 2 bytes
  for (let i = 0; i < mulawBuf.length; i++) {
    const s1 = MULAW_DECODE_TABLE[mulawBuf[i]];
    const s2 = i + 1 < mulawBuf.length ? MULAW_DECODE_TABLE[mulawBuf[i + 1]] : s1;
    const mid = (s1 + s2) >> 1;
    pcm16k.writeInt16LE(s1, i * 4);
    pcm16k.writeInt16LE(mid, i * 4 + 2);
  }
  return pcm16k;
}

// Downsample 24kHz 16-bit PCM Buffer (from Gemini output) -> 8kHz mu-law Buffer (for Twilio)
function pcm24kToMulaw8k(pcm24kBuf) {
  const totalSamples = Math.floor(pcm24kBuf.length / 2);
  const outSamples = Math.floor(totalSamples / 3);
  const mulawBuf = Buffer.allocUnsafe(outSamples);
  for (let i = 0; i < outSamples; i++) {
    const sample = pcm24kBuf.readInt16LE(i * 3 * 2);
    mulawBuf[i] = encodeMuLawSample(sample);
  }
  return mulawBuf;
}

// ============================================================================
// Dashboard Clients & Call State Management
// ============================================================================
const dashboardClients = new Set();
const callHistory = [];
let activeCall = null;
let simulationTimers = [];

function broadcastToDashboard(event) {
  const payload = JSON.stringify(event);
  for (const client of dashboardClients) {
    client.send(payload);
  }
}

function clearSimulationTimers() {
  for (const t of simulationTimers) clearTimeout(t);
  simulationTimers = [];
}

function buildSystemInstruction() {
  return `Eres el asistente personal de filtrado de llamadas de ${appConfig.ownerName}.
Tu objetivo es atender llamadas entrantes (la mayoría comerciales, ventas o desconocidos), averiguar rápidamente quién llama y qué quiere, y proteger el tiempo de ${appConfig.ownerName}.

REGLAS DE COMPORTAMIENTO:
1. Saluda siempre en español con tono educado, natural, profesional y directo: "Hola, buenas. Habla con el asistente personal de ${appConfig.ownerName}, en este momento está ocupado pero él está viendo esta conversación en pantalla. ¿De parte de quién llaman y cuál es el motivo de la llamada?"
2. Haz preguntas breves y concretas (una a la vez):
   - Nombre de la persona y empresa de la que llama.
   - Qué ofrecen o necesitan exactamente (propuesta, condiciones o motivo concreto).
3. En cuanto tengas cualquier dato sobre quién llama o qué busca, EJECUTA SIEMPRE la herramienta 'classify_call' en segundo plano para actualizar la ficha en la pantalla de ${appConfig.ownerName}. Puedes llamarla varias veces conforme averigües más detalles.
4. Criterios personales de filtrado de ${appConfig.ownerName}:
   ${appConfig.filterRules}
5. Si detectas que es telemarketing genérico no deseado (cambio de compañía de luz/gas/fibra/seguros sin contacto previo), indícale amablemente que ${appConfig.ownerName} no está interesado en ofertas de ese tipo, despídete y usa 'reject_and_hangup'.
6. Si la llamada parece interesante o importante según los criterios, pídele un segundo de espera mientras ${appConfig.ownerName} decide si toma la llamada en su móvil, o pídele un correo/teléfono de contacto (el correo de ${appConfig.ownerName} es ${appConfig.ownerEmail}).
7. Si recibes un mensaje del sistema prefijado con [ORDEN EN VIVO DE ${appConfig.ownerName.toUpperCase()}], obedécelo de inmediato en tu siguiente respuesta hablada.`;
}

const GEMINI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'classify_call',
        description:
          'Actualiza en tiempo real la tarjeta de información de la llamada en la pantalla del propietario.',
        behavior: 'NON_BLOCKING',
        parameters: {
          type: 'OBJECT',
          properties: {
            callerName: {
              type: 'STRING',
              description: 'Nombre de la persona que llama',
            },
            company: {
              type: 'STRING',
              description: 'Empresa u organización desde la que llaman',
            },
            category: {
              type: 'STRING',
              description:
                'Categoría: "Telemarketing / Spam", "Propuesta B2B", "Cliente / Proyecto", "Proveedor", "Urgente / Personal", o "Desconocido"',
            },
            summary: {
              type: 'STRING',
              description: 'Resumen claro en 1 o 2 frases de lo que ofrecen o solicitan',
            },
            relevanceScore: {
              type: 'INTEGER',
              description:
                'Puntuación de 1 a 10 según el interés que puede tener para el propietario (1=Spam total, 10=Muy importante)',
            },
            recommendation: {
              type: 'STRING',
              description:
                'Recomendación corta: "Descartar / Spam", "Pedir info por email", o "¡Atender llamada! Parece interesante"',
            },
          },
          required: ['company', 'category', 'summary', 'relevanceScore', 'recommendation'],
        },
      },
      {
        name: 'reject_and_hangup',
        description:
          'Marca la llamada como descartada cuando se confirma que es spam o telemarketing no deseado.',
        behavior: 'NON_BLOCKING',
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: {
              type: 'STRING',
              description: 'Motivo del rechazo de la llamada',
            },
          },
          required: ['reason'],
        },
      },
    ],
  },
];

// ============================================================================
// Gemini 3.8 Live Session Manager (Raw WebSocket to Gemini Live API)
// ============================================================================
function createGeminiLiveSession({ onAudioChunk, onTranscript, onClassification, onInterrupted, onError, onClose }) {
  const apiKey = appConfig.geminiApiKey;
  if (!apiKey) {
    throw new Error('Falta configurar GEMINI_API_KEY en el panel de Ajustes.');
  }

  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  const geminiWs = new WebSocket(wsUrl);
  let isSetupComplete = false;

  geminiWs.addEventListener('open', () => {
    const setupMessage = {
      setup: {
        model: 'models/gemini-3.8-live',
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: appConfig.voiceName || 'Aoede',
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: buildSystemInstruction() }],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: GEMINI_TOOLS,
      },
    };
    geminiWs.send(JSON.stringify(setupMessage));
  });

  geminiWs.addEventListener('message', async (event) => {
    try {
      let rawText;
      if (typeof event.data === 'string') {
        rawText = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        rawText = Buffer.from(event.data).toString('utf8');
      } else if (event.data instanceof Blob) {
        rawText = await event.data.text();
      } else {
        rawText = Buffer.from(event.data).toString('utf8');
      }

      const msg = JSON.parse(rawText);

      if (msg.setupComplete !== undefined && !isSetupComplete) {
        isSetupComplete = true;
        // Trigger initial greeting from the assistant
        geminiWs.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: '[SISTEMA: Acaba de entrar la llamada y han descolgado. Saluda ahora mismo al interlocutor y pregúntale de parte de quién llama y el motivo.]',
                    },
                  ],
                },
              ],
              turnComplete: true,
            },
          })
        );
      }

      const content = msg.serverContent;
      if (content) {
        // Process ALL parts in modelTurn
        if (content.modelTurn?.parts) {
          for (const part of content.modelTurn.parts) {
            if (part.inlineData?.data) {
              onAudioChunk?.(part.inlineData.data);
            }
          }
        }

        // Caller transcription
        if (content.inputTranscription?.text) {
          onTranscript?.('caller', content.inputTranscription.text);
        }

        // Assistant transcription
        if (content.outputTranscription?.text) {
          onTranscript?.('assistant', content.outputTranscription.text);
        }

        // Barge-in / Interruption
        if (content.interrupted) {
          onInterrupted?.();
        }
      }

      // Handle asynchronous NON_BLOCKING tool calls
      if (msg.toolCall?.functionCalls) {
        const functionResponses = [];
        for (const call of msg.toolCall.functionCalls) {
          const args = call.args || {};
          if (call.name === 'classify_call') {
            onClassification?.(args);
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { status: 'updated_on_owner_screen' },
            });
          } else if (call.name === 'reject_and_hangup') {
            onClassification?.({
              recommendation: `Rechazada: ${args.reason || 'Telemarketing no deseado'}`,
              relevanceScore: 1,
            });
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { status: 'marked_as_rejected' },
            });
          }
        }

        if (functionResponses.length > 0 && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(
            JSON.stringify({
              toolResponse: { functionResponses },
            })
          );
        }
      }
    } catch (err) {
      console.error('Error procesando mensaje de Gemini Live:', err);
    }
  });

  geminiWs.addEventListener('error', (err) => {
    onError?.(err.message || 'Error en conexión con Gemini 3.8 Live');
  });

  geminiWs.addEventListener('close', (ev) => {
    onClose?.(ev.code, ev.reason);
  });

  return {
    sendPcm16k(base64Pcm) {
      if (geminiWs.readyState !== WebSocket.OPEN) return;
      geminiWs.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: base64Pcm,
              mimeType: 'audio/pcm;rate=16000',
            },
          },
        })
      );
    },
    sendWhisper(instructionText) {
      if (geminiWs.readyState !== WebSocket.OPEN) return;
      geminiWs.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text: `[ORDEN EN VIVO DE ${appConfig.ownerName.toUpperCase()}]: ${instructionText}`,
                  },
                ],
              },
            ],
            turnComplete: true,
          },
        })
      );
    },
    close() {
      try {
        geminiWs.close();
      } catch {}
    },
  };
}

// ============================================================================
// Twilio Live Call Redirect (Hot Transfer to Personal Mobile Phone)
// ============================================================================
async function redirectTwilioCallToMobile(callSid, targetPhoneNumber) {
  const { twilioAccountSid, twilioAuthToken } = appConfig;
  if (!twilioAccountSid || !twilioAuthToken || !callSid) {
    return {
      simulated: true,
      message: `Desvío ejecutado hacia ${targetPhoneNumber} (Modo local/simulado: configura TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN para desvíos reales en red telefónica).`,
    };
  }

  const twiml = `<Response><Say language="es-ES">Perfecto, le paso ahora mismo con ${appConfig.ownerName}. Un segundo.</Say><Dial>${targetPhoneNumber}</Dial></Response>`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    twilioAccountSid
  )}/Calls/${encodeURIComponent(callSid)}.json`;

  const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
  const body = new URLSearchParams({ Twiml: twiml });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de Twilio (${response.status}): ${errText}`);
  }

  return {
    simulated: false,
    message: `Llamada ${callSid} desviada en caliente a tu móvil ${targetPhoneNumber}. ¡Tu teléfono sonará en unos segundos!`,
  };
}

// ============================================================================
// Helper: Start / Update / End Call State & Notify Dashboard
// ============================================================================
function startNewCallState({ source, fromNumber, callSid }) {
  clearSimulationTimers();
  if (activeCall?.geminiSession) {
    activeCall.geminiSession.close();
  }
  activeCall = {
    id: 'call_' + Date.now(),
    callSid: callSid || null,
    source: source || 'web', // 'twilio' | 'web-mic' | 'simulation'
    fromNumber: fromNumber || '+34 910 55 42 18',
    startedAt: new Date().toISOString(),
    status: 'screening', // 'screening' | 'transferred' | 'taken_over_web' | 'ended'
    classification: {
      callerName: 'Identificando...',
      company: 'Analizando interlocutor...',
      category: 'Filtrando...',
      summary: 'El asistente está preguntando quién llama y el motivo de la llamada.',
      relevanceScore: 5,
      recommendation: 'Esperando respuesta del interlocutor...',
    },
    transcript: [],
    currentBuffer: { caller: '', assistant: '' },
    geminiSession: null,
    twilioWs: null,
    twilioStreamSid: null,
  };

  broadcastToDashboard({
    type: 'call_started',
    call: serializeCall(activeCall),
  });
  return activeCall;
}

function serializeCall(call) {
  if (!call) return null;
  return {
    id: call.id,
    callSid: call.callSid,
    source: call.source,
    fromNumber: call.fromNumber,
    startedAt: call.startedAt,
    status: call.status,
    classification: call.classification,
    transcript: call.transcript,
  };
}

function appendTranscriptChunk(role, textChunk) {
  if (!activeCall || !textChunk) return;
  const last = activeCall.transcript[activeCall.transcript.length - 1];
  if (last && last.role === role && Date.now() - last.updatedAt < 4500) {
    last.text += textChunk;
    last.updatedAt = Date.now();
  } else {
    activeCall.transcript.push({
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      role,
      text: textChunk,
      timestamp: new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      updatedAt: Date.now(),
    });
  }

  broadcastToDashboard({
    type: 'transcript_update',
    transcript: activeCall.transcript,
  });
}

function updateCallClassification(patch) {
  if (!activeCall) return;
  activeCall.classification = {
    ...activeCall.classification,
    ...patch,
  };
  broadcastToDashboard({
    type: 'classification_update',
    classification: activeCall.classification,
  });
}

function endActiveCall(reason = 'Llamada finalizada') {
  clearSimulationTimers();
  if (!activeCall) return;
  activeCall.status = 'ended';
  activeCall.endedReason = reason;
  if (activeCall.geminiSession) {
    activeCall.geminiSession.close();
    activeCall.geminiSession = null;
  }
  if (activeCall.twilioWs) {
    activeCall.twilioWs.close();
    activeCall.twilioWs = null;
  }
  const snapshot = serializeCall(activeCall);
  callHistory.unshift(snapshot);
  if (callHistory.length > 20) callHistory.pop();

  broadcastToDashboard({
    type: 'call_ended',
    call: snapshot,
    reason,
    history: callHistory,
  });
}

// ============================================================================
// Interactive Commercial Call Scenarios (For instant testing without phone)
// ============================================================================
const SIMULATION_SCENARIOS = {
  b2b_opportunity: {
    fromNumber: '+34 919 03 84 21',
    steps: [
      {
        delay: 600,
        role: 'assistant',
        text: `Hola, buenas. Habla con el asistente personal de ${appConfig.ownerName}; ahora mismo está ocupado pero ve esta transcripción en directo. ¿De parte de quién llaman y cuál es el motivo?`,
      },
      {
        delay: 3200,
        role: 'caller',
        text: 'Hola, qué tal. Soy Laura Méndez, directora de operaciones en Grupo Logístico Iberia. Quería hablar con él porque necesitamos contratar un proveedor externo para automatizar nuestros procesos este trimestre.',
      },
      {
        delay: 4200,
        classification: {
          callerName: 'Laura Méndez (Dir. Operaciones)',
          company: 'Grupo Logístico Iberia',
          category: 'Cliente / Proyecto B2B',
          summary:
            'Buscan contratar proveedor externo este trimestre para automatizar procesos operativos.',
          relevanceScore: 9,
          recommendation: '¡Atender llamada! Oportunidad comercial de alto valor',
        },
      },
      {
        delay: 5000,
        role: 'assistant',
        text: 'Encantada, Laura. Suena muy interesante. ¿Tienen ya definido un presupuesto o alcance aproximado para comentárselo ahora mismo en pantalla?',
      },
      {
        delay: 8200,
        role: 'caller',
        text: 'Sí, tenemos una partida aprobada de unos 18.000 euros para arrancar el piloto este mismo mes y queríamos saber si tiene disponibilidad para verlo hoy.',
      },
      {
        delay: 9000,
        classification: {
          callerName: 'Laura Méndez (Dir. Operaciones)',
          company: 'Grupo Logístico Iberia',
          category: 'Cliente / Proyecto B2B',
          summary:
            'Proyecto de automatización con presupuesto aprobado de 18.000€ para arrancar piloto este mes.',
          relevanceScore: 10,
          recommendation: '🔥 ¡Desviar a tu móvil ahora! Cliente con presupuesto aprobado (18.000€)',
        },
      },
      {
        delay: 10200,
        role: 'assistant',
        text: `Perfecto, Laura. Le estoy pasando la alerta en pantalla a ${appConfig.ownerName} por si puede tomar la llamada en su móvil ahora mismo. Un segundo, por favor.`,
      },
    ],
  },
  spam_energy: {
    fromNumber: '+34 911 88 00 92',
    steps: [
      {
        delay: 600,
        role: 'assistant',
        text: `Hola, buenas. Habla con el asistente personal de ${appConfig.ownerName}. En este momento no puede ponerse, ¿de qué empresa llaman y qué necesitan?`,
      },
      {
        delay: 3000,
        role: 'caller',
        text: 'Buenas tardes, le llamo del departamento de descuentos energéticos para informarle de un cambio obligatorio en su factura de luz con un 20% de descuento.',
      },
      {
        delay: 3800,
        classification: {
          callerName: 'Agente Comercial No Identificado',
          company: 'Telemarketing Energético',
          category: 'Telemarketing / Spam',
          summary: 'Llamada fría comercial ofreciendo cambio de tarifa de luz con supuesto descuento.',
          relevanceScore: 1,
          recommendation: '🚫 Descartar / Spam energético detectado',
        },
      },
      {
        delay: 5000,
        role: 'assistant',
        text: `Muchas gracias, pero ${appConfig.ownerName} tiene bloqueadas todas las ofertas comerciales de suministros de luz, gas y telefonía. No estamos interesados, que tenga buen día.`,
      },
    ],
  },
};

function runSimulatedCall(scenarioKey = 'b2b_opportunity') {
  const scenario = SIMULATION_SCENARIOS[scenarioKey] || SIMULATION_SCENARIOS.b2b_opportunity;
  startNewCallState({
    source: 'simulation',
    fromNumber: scenario.fromNumber,
    callSid: 'SIM_' + Date.now(),
  });

  for (const step of scenario.steps) {
    const timer = setTimeout(() => {
      if (!activeCall || activeCall.status !== 'screening') return;
      if (step.role && step.text) {
        appendTranscriptChunk(step.role, step.text);
      }
      if (step.classification) {
        updateCallClassification(step.classification);
      }
    }, step.delay);
    simulationTimers.push(timer);
  }
}

// ============================================================================
// HTTP & WebSocket Server
// ============================================================================
const publicDir = path.join(__dirname, 'public');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // --- API: Get Current Config & State ---
  if (pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        config: {
          ...appConfig,
          hasApiKey: Boolean(appConfig.geminiApiKey),
          hasTwilio: Boolean(appConfig.twilioAccountSid && appConfig.twilioAuthToken),
        },
        activeCall: serializeCall(activeCall),
        history: callHistory,
      })
    );
    return;
  }

  // --- API: Update Settings ---
  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      appConfig = {
        ...appConfig,
        ...body,
      };
      saveConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          config: {
            ...appConfig,
            hasApiKey: Boolean(appConfig.geminiApiKey),
            hasTwilio: Boolean(appConfig.twilioAccountSid && appConfig.twilioAuthToken),
          },
        })
      );
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // --- API: Start Simulated Commercial Call ---
  if (pathname === '/api/call/simulate' && req.method === 'POST') {
    const body = await readJsonBody(req);
    runSimulatedCall(body.scenario || 'b2b_opportunity');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, call: serializeCall(activeCall) }));
    return;
  }

  // --- API: Whisper Instruction to AI Assistant in Real Time ---
  if (pathname === '/api/call/whisper' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const instruction = (body.instruction || '').trim();
    if (!activeCall || !instruction) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'No hay llamada activa o falta instrucción.' }));
      return;
    }

    appendTranscriptChunk('owner_whisper', `⚡ Orden enviada al asistente: "${instruction}"`);

    if (activeCall.geminiSession) {
      activeCall.geminiSession.sendWhisper(instruction);
    } else if (activeCall.source === 'simulation') {
      // Simulated response to owner's live instruction
      setTimeout(() => {
        if (!activeCall || activeCall.status !== 'screening') return;
        appendTranscriptChunk(
          'assistant',
          `Me indica ${appConfig.ownerName} ahora mismo por pantalla lo siguiente: ${instruction}`
        );
      }, 900);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- API: Hot Transfer / Take Over Call ("Me interesa -> Pasar a mi móvil o web") ---
  if (pathname === '/api/call/transfer' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const mode = body.mode || 'mobile'; // 'mobile' | 'web'
      const targetPhone = body.phoneNumber || appConfig.personalPhoneNumber;

      if (!activeCall) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No hay ninguna llamada activa para transferir.' }));
        return;
      }

      clearSimulationTimers();

      if (mode === 'mobile') {
        if (activeCall.geminiSession) {
          activeCall.geminiSession.sendWhisper(
            `Dile al interlocutor exactamente: "Un momento por favor, ${appConfig.ownerName} me confirma que le interesa hablar con usted y le desvío la llamada a su móvil ahora mismo."`
          );
        } else {
          appendTranscriptChunk(
            'assistant',
            `Perfecto, ${appConfig.ownerName} me confirma en pantalla que le interesa atenderle. No cuelgue, le desvío la llamada a su móvil personal (${targetPhone}) ahora mismo.`
          );
        }

        const transferResult = await redirectTwilioCallToMobile(activeCall.callSid, targetPhone);
        activeCall.status = 'transferred';
        appendTranscriptChunk('system', `📲 ${transferResult.message}`);

        broadcastToDashboard({
          type: 'call_transferred',
          mode: 'mobile',
          targetPhone,
          message: transferResult.message,
          call: serializeCall(activeCall),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: transferResult }));
      } else {
        // Take over directly from the web dashboard
        if (activeCall.geminiSession) {
          activeCall.geminiSession.close();
          activeCall.geminiSession = null;
        }
        activeCall.status = 'taken_over_web';
        appendTranscriptChunk(
          'system',
          `🎙️ Has tomado el control de la llamada desde el panel web. El asistente IA se ha silenciado.`
        );
        broadcastToDashboard({
          type: 'call_transferred',
          mode: 'web',
          message: 'Has tomado la llamada en directo desde el panel. El asistente IA ya no interviene.',
          call: serializeCall(activeCall),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, mode: 'web' }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // --- API: Hangup / Reject Call ---
  if (pathname === '/api/call/hangup' && req.method === 'POST') {
    endActiveCall('Colgada por el propietario desde el panel');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- Twilio Incoming Call Webhook (Returns TwiML to open bidirectional Media Stream) ---
  if (pathname === '/twilio/voice' && (req.method === 'POST' || req.method === 'GET')) {
    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;
    const params = new URLSearchParams(rawBody);
    const from = params.get('From') || 'Número desconocido';
    const callSid = params.get('CallSid') || 'TW_' + Date.now();

    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const wsProtocol = (req.headers['x-forwarded-proto'] || '').includes('https') ? 'wss' : 'ws';
    const streamUrl = `${wsProtocol}://${host}/twilio/stream`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="from" value="${from}" />
      <Parameter name="callSid" value="${callSid}" />
    </Stream>
  </Connect>
</Response>`;

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    return;
  }

  // --- Static Frontend Assets ---
  let filePath = pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ============================================================================
// WebSocket Upgrade Router (/ws/dashboard, /ws/web-call, /twilio/stream)
// ============================================================================
server.on('upgrade', (req, socket) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  const ws = upgradeToWebSocket(req, socket);
  if (!ws) return;

  // 1. Live Dashboard Stream (Transcript, Call Status & Classification updates)
  if (pathname === '/ws/dashboard') {
    dashboardClients.add(ws);
    ws.send(
      JSON.stringify({
        type: 'init',
        activeCall: serializeCall(activeCall),
        history: callHistory,
      })
    );
    ws.on('close', () => dashboardClients.delete(ws));
    return;
  }

  // 2. Browser Microphone Live Call (Test Gemini 3.8 Live directly from PC Mic)
  if (pathname === '/ws/web-call') {
    const call = startNewCallState({
      source: 'web-mic',
      fromNumber: 'Llamada de prueba (Micrófono Web)',
      callSid: 'WEB_' + Date.now(),
    });

    try {
      call.geminiSession = createGeminiLiveSession({
        onAudioChunk(base64Pcm24k) {
          ws.send(JSON.stringify({ type: 'audio', data: base64Pcm24k }));
        },
        onTranscript(role, text) {
          appendTranscriptChunk(role, text);
        },
        onClassification(data) {
          updateCallClassification(data);
        },
        onInterrupted() {
          ws.send(JSON.stringify({ type: 'interrupted' }));
        },
        onError(errMsg) {
          ws.send(JSON.stringify({ type: 'error', message: errMsg }));
          appendTranscriptChunk('system', `⚠️ Error Gemini Live: ${errMsg}`);
        },
        onClose() {},
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      appendTranscriptChunk('system', `⚠️ ${err.message}`);
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
        if (msg.type === 'audio' && call.geminiSession && call.status === 'screening') {
          call.geminiSession.sendPcm16k(msg.data);
        }
      } catch {}
    });

    ws.on('close', () => {
      if (activeCall && activeCall.id === call.id && activeCall.status !== 'ended') {
        endActiveCall('Finalizada sesión de micrófono web');
      }
    });
    return;
  }

  // 3. Twilio Media Streams Bidirectional WebSocket (/twilio/stream)
  if (pathname === '/twilio/stream') {
    let call = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));

        if (msg.event === 'start') {
          const customParams = msg.start?.customParameters || {};
          call = startNewCallState({
            source: 'twilio',
            fromNumber: customParams.from || 'Llamada Telefónica Entrante',
            callSid: customParams.callSid || msg.start?.callSid,
          });
          call.twilioWs = ws;
          call.twilioStreamSid = msg.start?.streamSid;

          call.geminiSession = createGeminiLiveSession({
            onAudioChunk(base64Pcm24k) {
              if (!call.twilioStreamSid || ws.readyState !== 1) return;
              const pcm24kBuf = Buffer.from(base64Pcm24k, 'base64');
              const mulaw8kBuf = pcm24kToMulaw8k(pcm24kBuf);
              ws.send(
                JSON.stringify({
                  event: 'media',
                  streamSid: call.twilioStreamSid,
                  media: { payload: mulaw8kBuf.toString('base64') },
                })
              );
            },
            onTranscript(role, text) {
              appendTranscriptChunk(role, text);
            },
            onClassification(data) {
              updateCallClassification(data);
            },
            onInterrupted() {
              if (call.twilioStreamSid && ws.readyState === 1) {
                ws.send(JSON.stringify({ event: 'clear', streamSid: call.twilioStreamSid }));
              }
            },
            onError(errMsg) {
              appendTranscriptChunk('system', `⚠️ Error Gemini Live: ${errMsg}`);
            },
          });
        } else if (msg.event === 'media' && call?.geminiSession && call.status === 'screening') {
          const mulawBuf = Buffer.from(msg.media.payload, 'base64');
          const pcm16kBuf = mulaw8kToPcm16k(mulawBuf);
          call.geminiSession.sendPcm16k(pcm16kBuf.toString('base64'));
        } else if (msg.event === 'stop') {
          if (call && activeCall?.id === call.id && activeCall.status !== 'transferred') {
            endActiveCall('El interlocutor colgó la llamada');
          }
        }
      } catch (e) {
        console.error('Error en stream de Twilio:', e);
      }
    });

    ws.on('close', () => {
      if (call && activeCall?.id === call.id && activeCall.status === 'screening') {
        endActiveCall('Conexión telefónica cerrada');
      }
    });
  }
});

const PORT = Number(process.env.PORT || 3030);
server.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🛡️  Asistente Personal de Filtrado de Llamadas (Gemini 3.8 Live)`);
  console.log(`🌐 Panel en Vivo: http://localhost:${PORT}`);
  console.log(`📞 Webhook Twilio: http://localhost:${PORT}/twilio/voice`);
  console.log(`=============================================================\n`);
});
