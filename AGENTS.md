# Contexto del Proyecto para el Agente (Antigravity / OpenCode)

Este archivo contiene toda la memoria arquitectónica y de producto del proyecto **Asistente Personal de Filtrado de Llamadas (Call Screener)** para que cualquier agente en otro ordenador (por ejemplo, el Antigravity del PC de casa del usuario) pueda continuar el desarrollo sin perder contexto.

## 🎯 Objetivo del Usuario
El usuario recibe habitualmente llamadas comerciales de todo tipo y quiere un **recepcionista/filtro personal de llamadas por voz**:
1. Cuando entra una llamada, **la atiende primero el asistente IA de voz** en español.
2. El usuario puede **ver en tiempo real la transcripción** (desde el navegador del PC o desde la web en su móvil) y una **ficha resumen** generada automáticamente por la IA (quién llama, empresa, motivo y puntuación de interés del 1 al 10).
3. El usuario tiene un **botón destacado (`📲 ¡ME INTERESA! DESVIAR A MI MÓVIL`)**: si ve en la transcripción que la llamada comercial le interesa, lo pulsa y la llamada se desvía en caliente a su número de móvil personal (o puede atenderla desde el web/PC).
4. También puede **susurrar órdenes en vivo** al asistente mediante botones rápidos o texto libre (ej. *"pregúntale precios"*, *"pídele que lo mande por email"*, *"dile que no me interesa"*).

## 🏗️ Arquitectura Actual
- **`server.js`**:
  - Escrito en Node.js puro (cero dependencias externas obligatorias, funciona directamente con `agy-node server.js` que ejecuta Node v24 integrado en Antigravity, o con `node server.js`).
  - Implementa servidor HTTP + WebSocket RFC 6455 nativo (`/ws/dashboard`, `/ws/web-call`, `/twilio/stream`).
  - Se conecta a **Google Gemini Live API** usando el modelo **`models/gemini-3.8-live`** por WebSockets (`BidiGenerateContent`).
  - Cumple con las especificaciones de **Gemini 3.8 Live** (skill `gemini-live-api-dev` del plugin oficial `antigravity-plugins-official/plugin/gemini-api`):
    - `responseModalities: ["AUDIO"]`, `inputAudioTranscription: {}`, `outputAudioTranscription: {}`.
    - Herramientas asíncronas con `behavior: "NON_BLOCKING"`: `classify_call` y `reject_and_hangup`.
    - Inyección de órdenes del propietario en caliente mediante `clientContent` con `turnComplete: true`.
    - Conversión de audio telefónico G.711 mu-law 8kHz ↔ PCM 16-bit (16kHz entrada / 24kHz salida) para **Twilio Media Streams**.
    - Desvío en caliente (`POST /api/call/transfer`) actualizando la llamada activa en Twilio REST API con `<Response><Say>...</Say><Dial>+34...</Dial></Response>`.
- **`public/index.html`, `public/styles.css`, `public/app.js`**:
  - Interfaz responsive (PC y móvil) con panel de transcripción en directo, tarjeta de clasificación de interés, botones de susurro rápido, simulador de llamadas comerciales (`b2b_opportunity` y `spam_energy`), prueba real con micrófono y modal de ajustes.

## 🛠️ Cómo ejecutar y verificar
1. Para iniciar el servidor en segundo plano en Antigravity:
   ```powershell
   agy-node server.js
   ```
2. El panel queda disponible en `http://localhost:3030` (y en la IP local en el puerto `3030` para abrirlo desde el móvil en la misma Wi-Fi).
3. **Importante para Git**: Nunca subir `config.json` ni `.env` al repositorio porque contienen `GEMINI_API_KEY`, `TWILIO_AUTH_TOKEN` y el teléfono personal del usuario (ya están excluidos en `.gitignore`).

## 🔜 Próximas mejoras sugeridas cuando el usuario continúe en casa
- Configurar **PWA (Progressive Web App)** + notificaciones push/sonoras en el navegador del móvil cuando entre una llamada nueva.
- Configurar túnel seguro (**Cloudflare Tunnel / ngrok**) o despliegue en la nube (**Railway / Render**) para tener una URL `https://` permanente donde conectar el número de teléfono de Twilio y acceder desde el móvil con 4G/5G.
- Guardar historial persistente de llamadas filtradas en un archivo JSON/SQLite con buscador.
