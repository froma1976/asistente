# 🛡️ Asistente Personal de Filtrado de Llamadas (Gemini 3.8 Live)

Secretario personal de voz en tiempo real diseñado para **atender llamadas entrantes (especialmente comerciales o desconocidas)**, averiguar quién llama y qué quiere mientras tú lees la **transcripción en vivo** desde el móvil o el PC, y permitirte **desviar la llamada en caliente a tu móvil personal** con un solo botón si ves que te interesa.

---

## ✨ Características Principales

1. **Voz en Tiempo Real de Baja Latencia (`models/gemini-3.8-live`)**:
   - Conversación bidireccional en español con soporte nativo de interrupciones (*barge-in*).
   - Transcripción en directo tanto de lo que dice el interlocutor (`inputAudioTranscription`) como de lo que responde tu asistente (`outputAudioTranscription`).
2. **Clasificación y Filtro Automático en Segundo Plano (`NON_BLOCKING`)**:
   - Herramienta asíncrona `classify_call` que rellena en vivo la ficha del interlocutor: **Nombre, Empresa, Categoría, Resumen, Nota de Interés (1-10) y Recomendación**.
   - Descarta automáticamente llamadas de spam/telemarketing genérico (luz, gas, fibra, seguros) según tus reglas.
3. **Botón "¡ME INTERESA! DESVIAR A MI MÓVIL" (Hot Transfer)**:
   - Si ves en la transcripción que es una oportunidad o cliente que te interesa, pulsas el botón verde:
     - El asistente avisa al interlocutor de que te pasa la llamada.
     - Vía **Twilio REST API** (`Calls/{CallSid}.json`), la llamada activa se redirige con `<Dial>` directamente a tu número de móvil personal sin colgarle.
   - También permite tomar la llamada desde el micrófono del navegador (`Atender desde este PC`).
4. **Susurrar Órdenes en Vivo al Asistente (`clientContent`)**:
   - Botones rápidos (*"💰 Preguntar precios"*, *"📧 Pedir por email"*, *"⏳ Pedir teléfono directo"*, *"🚫 No me interesa"*) y campo libre para darle instrucciones en caliente a tu asistente sin hablar tú.
5. **Simulador Integrado y Modo Micrófono Web**:
   - Permite probar todo el flujo con escenarios comerciales simulados o hablando por el micrófono del PC/móvil antes de conectar la línea telefónica.

---

## 🚀 Cómo arrancarlo en Antigravity (PC de Casa o Trabajo)

No requiere instalar dependencias pesadas (`node_modules`) ya que incluye servidor WebSocket RFC 6455 nativo compatible con `agy-node` (Node v24 integrado en Antigravity) o con Node.js estándar.

### Opción A: Pedírselo al agente de Antigravity
Abre esta carpeta en Antigravity (`Workspace -> Open Folder`) y escribe en el chat:
> *"Lee AGENTS.md y pon en marcha el servidor del asistente de llamadas"*

### Opción B: Desde la terminal de Antigravity
```powershell
agy-node server.js
```
*(O `node server.js` si tienes Node.js instalado).*

Después abre en tu navegador (PC o móvil):
👉 **http://localhost:3030**

---

## ⚙️ Configuración

Puedes configurar todo desde el botón **"⚙️ Configurar Mi Móvil y Reglas"** dentro de la interfaz web (se guarda localmente en `config.json`, ignorado por Git por seguridad), o creando un archivo `.env` a partir de `.env.example`:

- `GEMINI_API_KEY`: Tu clave de Google AI Studio (`https://aistudio.google.com/apikey`).
- `OWNER_NAME`: Tu nombre (para que el asistente se presente como *"el asistente personal de..."*).
- `PERSONAL_PHONE_NUMBER`: Tu número de móvil personal en formato internacional (ej. `+34600000000`) adonde se desvía la llamada cuando pulsas el botón verde.
- `OWNER_EMAIL`: Tu email para cuando pidas que te envíen la propuesta por escrito.
- `FILTER_RULES`: Tus reglas sobre qué llamadas comerciales descartar y cuáles investigar.
- `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN`: Credenciales de Twilio para conectar un número telefónico real apuntando su webhook de voz a `https://tu-dominio/twilio/voice`.
### Actualización de privacidad

Antes de actualizar el VPS, verifica que el móvil de desvío está en la configuración privada o en `PERSONAL_PHONE_NUMBER`. Si dependías de contactos, facturas o reglas incorporados en el código antiguo, guárdalos primero desde el panel en el volumen privado. Las instalaciones nuevas empiezan sin esos datos; las existentes siguen leyendo `config.json` y `secretary_data.json` de `CLARA_DATA_DIR`.

El webhook firmado de estado `/twilio/status/...` debe llegar al mismo servidor HTTPS que `/twilio/voice`. Sirve para liberar la línea si Twilio finaliza una llamada saliente aunque se haya perdido la respuesta inicial. Ante un resultado incierto no se repite la marcación automáticamente.
