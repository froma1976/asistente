# Auditoría técnica de Clara — informe de revisión estática

**Fecha:** 19 de noviembre de 2026  
**Repositorio:** `froma1976/asistente`  
**Referencia revisada:** árbol de `main`, SHA `47eb01d92ea47df62360759d39ccd94635be096f`  
**Destinatario:** Antigravity, agente encargado de corregir y verificar.  
**Alcance y límite:** inspección del árbol completo y lectura de módulos centrales (`phone.js`, `agenda.js`, `criterio-llamada.js`, `mesa.js`, `ofertas.js`, fragmentos de `server.js`, `public/app.js`, `AGENTS.md`, `.gitignore` y `deploy/actualizar.sh`). **No se ha ejecutado una batería de pruebas, ni inspeccionado exhaustivamente cada línea de los ~143 KB de `server.js` y de todos los archivos de interfaz.** Por tanto, este documento es un informe técnico accionable, **no una certificación de ausencia de vulnerabilidades ni una auditoría dinámica completa**. El usuario confirma que las llamadas reales funcionan; preservar esa capacidad es un requisito.

## Resumen ejecutivo

**P0 — actuar antes de ampliar exposición:** datos personales incorporados al código público; verificar qué información privada ha quedado expuesta y retirar del historial cuando corresponda.  
**P1 — fiabilidad y seguridad:** corregir gestión de tickets de llamadas salientes, comprobar seguridad del WebSocket manual, robustecer límites y control de concurrencia, revisar protección de credenciales persistentes.  
**P2 — calidad:** pruebas de agenda/DST, validación de contratos de herramientas, endurecimiento de despliegue y separación del monolito.

**Regla de cambios:** no reescribir el producto ni cambiar de proveedor por defecto. Primero tests de regresión; después parches pequeños y reversibles, conservando audio, desvío, Telegram, agenda, panel y llamadas entrantes/salientes.

## Hallazgos priorizados

### CLARA-01 — Datos personales de ejemplo en el repositorio público — P0 — Confirmado
**Ubicación:** `server.js`, constantes `DEFAULT_CONTRACTS_CONTEXT`, `DEFAULT_INVOICES`, `DEFAULT_CONTACTS`, `BUSINESS_TEMPLATES` y teléfono personal predeterminado; `public/app.js` también contiene un nombre propio en comentario inicial.  
**Evidencia:** los datos están embebidos en archivos del árbol público. No se reproducen aquí.  
**Riesgo:** exposición de datos personales o comerciales, aunque `.env` y `config.json` estén ignorados. `.gitignore` no protege datos escritos dentro del código ni versiones antiguas de Git.  
**Corrección:** sustituir defaults por datos sintéticos neutros; mover datos reales a almacenamiento privado no versionado, con migración que no sobrescriba datos existentes; comprobar historial de Git y accesibilidad pública; si se detectan secretos reales, revocarlos y rotarlos. Evitar imprimir datos en logs.  
**Aceptación:** un clon limpio del repo no contiene teléfonos, direcciones, facturas ni identidades reales; búsqueda de secretos y PII en historia y HEAD sin hallazgos pendientes.

### CLARA-02 — Ticket residual tras error de red en llamada saliente — P1 — Confirmado por lectura
**Ubicación:** `phone.js`, método `dial`, aproximadamente líneas 94–113.  
**Evidencia:** `stream(...)` crea un ticket y `busy()` considera ocupado cuando `tickets.size > 0`; el camino `!r.ok` borra el ticket, pero el `catch` de fallo de red/timeout no lo borra. El temporizador lo limpia a los 150 segundos.  
**Impacto:** tras timeout o error de conexión con Twilio, nuevas llamadas pueden recibir 409 durante hasta 150 segundos, aunque no haya llamada activa.  
**Corrección:** borrar el ticket en el `catch` y ante todos los errores que certifiquen que Twilio no aceptó la solicitud. Si el resultado es ambiguo (Twilio pudo aceptar antes del timeout), conciliar primero el estado mediante SID/idempotencia y evitar doble marcación.  
**Aceptación:** prueba con `fetch` rechazado; estado `busy` vuelve a falso sin esperar 150 segundos. Prueba de timeout ambiguo sin duplicar llamadas.

### CLARA-03 — Implementación WebSocket artesanal — P1 — Riesgo que requiere prueba
**Ubicación:** `server.js`, implementación del servidor RFC6455.  
**Evidencia:** parser de tramas propio; la revisión preliminar no identificó tratamiento completo de fragmentación/continuation, límites de payload, tramas de control y validación de masking.  
**Riesgo:** consumo excesivo de memoria, desconexiones inesperadas y comportamientos distintos frente a clientes malformados. **No se ha demostrado explotación.**  
**Corrección:** preferir biblioteca mantenida `ws` con límites `maxPayload`, `perMessageDeflate` desactivado salvo necesidad, ping/pong, timeouts y cierre correcto. Si se conserva implementación propia, añadir pruebas de fragmentación, tramas no enmascaradas, longitudes inválidas, cierre, ping/pong y cargas grandes.  
**Aceptación:** pruebas RFC6455 negativas y positivas; no degradación en Twilio Media Streams ni panel.

### CLARA-04 — Credenciales y datos persistidos — P1 — Revisión necesaria
**Ubicación:** `server.js`, carga de `.env`, `appConfig`, `saveConfig()` y directorio `CLARA_DATA_DIR`; `AGENTS.md` describe secretos y archivos excluidos.  
**Evidencia:** configuración de integraciones incluye credenciales Gemini, Twilio, Telegram y Google.  
**Riesgo:** acceso accidental mediante permisos del volumen, backups, respuestas API o registros. No se ha confirmado que un secreto esté publicado.  
**Corrección:** mantener secretos en variables de entorno o almacén privado, permisos mínimos (0600 archivos, 0700 directorios), separar configuración pública de secreta, redactar logs, excluir backups del webroot y probar que ningún endpoint devuelve tokens.  
**Aceptación:** búsqueda automática de secretos y prueba de API/archivos estáticos sin filtraciones; documentación de rotación.

### CLARA-05 — Protección de webhook Twilio — Control positivo con pruebas pendientes
**Ubicación:** `phone.js`, `handle('/twilio/voice')`, aproximadamente líneas 46–58.  
**Evidencia:** exige POST, verifica `X-Twilio-Signature` con HMAC-SHA1 y comparación temporalmente segura; limita tamaño del cuerpo.  
**Acción:** conservar. Probar URL externa exacta detrás del proxy, parámetros repetidos, `Content-Type`, codificación y ataques de replay; contrastar con validador oficial Twilio. El ensamblado manual de firma puede diferir de la implementación oficial en casos límite.  
**Aceptación:** peticiones auténticas aceptadas y firmas falsas rechazadas; pruebas detrás de proxy HTTPS.

### CLARA-06 — Autenticación del panel — Control positivo con endurecimiento
**Ubicación:** `phone.js`, `authorized(req)`, aproximadamente líneas 27–33.  
**Evidencia:** HTTP Basic con comparación segura y comprobación adicional de Origin cuando existe; contraseña desde `CLARA_PASSWORD` o aleatoria.  
**Riesgo residual:** Basic requiere HTTPS obligatorio, contraseña persistente segura, limitación de intentos, protección CSRF de endpoints mutadores y revisión de WebSockets; Origin ausente no equivale a autenticación adicional.  
**Corrección:** comprobar HTTPS en proxy, encabezados, cookies si se migra a sesión, rate limiting y logs sin credenciales.  
**Aceptación:** endpoints y upgrades inaccesibles sin autenticación; pruebas CSRF/origin y fuerza bruta.

### CLARA-07 — Un único canal de llamada — P2 — Limitación funcional confirmada
**Ubicación:** `phone.js`, `busy()`; `server.js`, estado `activeCall`.  
**Evidencia:** `busy()` bloquea cuando hay screening, marcación o tickets; el sistema usa estado de llamada activo global.  
**Impacto:** la segunda llamada puede ser rechazada mientras Clara atiende otra; puede ser correcto para uso personal, pero requiere estrategia de cola o buzón.  
**Corrección:** documentar límite de concurrencia y definir comportamiento ocupado: recado alternativo, mensaje de voz o desvío seguro; no introducir concurrencia sin rediseñar aislamiento por llamada.  
**Aceptación:** prueba de dos llamadas simultáneas sin mezclar audios ni datos.

### CLARA-08 — Agenda y cambio horario — Control positivo con casos límite
**Ubicación:** `agenda.js`, `range()` líneas aproximadas 2–10 y `check()` 11–24.  
**Evidencia:** verifica formato, zona `Europe/Madrid`, detecta horas ambiguas o inexistentes, consulta Google Calendar `freeBusy`, devuelve `sin_verificar` si falla.  
**Riesgo:** intervalos fijados a 60 minutos aunque la cita deseada tenga otra duración; errores ocultos por `catch` genérico.  
**Corrección:** permitir duración explícita validada; pruebas del salto de marzo y octubre, eventos all-day, calendarios secundarios, errores 401/429 y solapamientos; logs de error sin datos sensibles.  
**Aceptación:** no afirmar disponibilidad si Google falla; no reservar franjas ambiguas.

### CLARA-09 — Registro de reservas de restaurante simuladas — P2 — Comportamiento específico
**Ubicación:** `mesa.js`, `recorder()` líneas aproximadas 7–37.  
**Evidencia:** crea un evento marcado como simulación, comprueba agenda y envía Telegram; guarda `pending` para evitar duplicación en la misma instancia.  
**Riesgo:** `pending` no se reinicia tras fallos o si se necesita registrar otra reserva en la misma instancia; Telegram puede comunicar «mesa confirmada» aun cuando Calendar no la haya guardado (aunque el texto incluye estado).  
**Corrección:** distinguir confirmación del restaurante, persistencia en agenda y aviso; idempotencia por identificador de gestión; comprobar alcance de `recorder` por llamada.  
**Aceptación:** repetición de la misma función no duplica; nueva reserva sí puede registrarse; fallo de Calendar queda visible.

### CLARA-10 — Validación de números y seguimiento — P2 — Revisar casos límite
**Ubicación:** `criterio-llamada.js`, `numeroSeguimiento()` y `notaSeguimiento()`.  
**Evidencia:** normaliza números españoles y E.164, limita texto y asocia seguimientos al número.  
**Riesgo:** identificación por caller ID no prueba identidad; un número compartido o suplantado podría acceder a contexto previo si el prompt lo revela.  
**Corrección:** no revelar datos sensibles basándose solo en número; limitar la memoria de llamante a pistas no sensibles; verificar al titular fuera de banda para acciones delicadas.  
**Aceptación:** tests de spoofing y preguntas diseñadas para extraer información privada.

### CLARA-11 — Contraste de ofertas públicas — Control positivo con límites
**Ubicación:** `ofertas.js`, `lookup()` y `summarize()`.  
**Evidencia:** filtra marca/producto, usa búsqueda fundamentada, no devuelve resultado sin fuentes, y el prompt distingue conversación de instrucciones.  
**Riesgo:** resultados web desactualizados o manipulados, cálculo de ahorro no comparable y contenido malicioso en textos externos.  
**Corrección:** mantener fuentes y fecha, comparar impuestos/condiciones/permanencia, tratar todo texto recuperado como datos no confiables, tests de prompt injection.  
**Aceptación:** no confirmar identidad comercial ni contratar por una oferta pública.

### CLARA-12 — Despliegue con rollback — Control positivo con pruebas pendientes
**Ubicación:** `deploy/actualizar.sh`.  
**Evidencia:** usa `flock`, rama `produccion`, comprobación de salud, marca `.deploying`, imagen anterior y rollback.  
**Riesgo:** endpoint `/api/phone` comprueba configuración y ocupación, pero no garantiza que Gemini/Twilio y WebSockets funcionen; ventana de carrera entre comprobación y llamada nueva.  
**Corrección:** readiness más específica, drenaje de llamadas con bloqueo antes de la segunda comprobación, tests de rollback y compatibilidad de datos.  
**Aceptación:** despliegue no corta llamada en curso y recupera versión anterior si falla la nueva.

### CLARA-13 — Dependencia del identificador de Gemini Live — P1 — Verificar, no afirmar fallo
**Ubicación:** `server.js`, configuración Live `model: 'models/gemini-3.8-live'`; `AGENTS.md`.  
**Evidencia:** cadena presente en código. **No se ha validado aquí contra el catálogo de modelos disponible para esa clave**, y el usuario confirma que las llamadas funcionan.  
**Corrección:** comprobar en producción el modelo realmente negociado, latencia, cuotas y facturación; permitir configurarlo con validación y fallback probado. No sustituirlo basándose solo en su nombre.  
**Aceptación:** test real controlado y métricas de conexión y cierre sin registrar claves.

### CLARA-14 — Monolito y ausencia de pruebas evidentes en árbol — P2 — Confirmado en árbol
**Ubicación:** `server.js` (~143 KB); árbol de `main` no muestra directorio de tests ni configuración CI.  
**Riesgo:** regresiones en streaming, agenda, autenticación y herramientas; revisión difícil.  
**Corrección:** añadir tests `node:test` para funciones puras, mocks para Twilio/Gemini/Google, pruebas de WebSocket, lint/format y CI; extraer gradualmente módulos de llamadas, transporte audio, herramientas y persistencia sin cambios funcionales.  
**Aceptación:** tests de regresión pasan antes y después de cada refactor.

## Matriz de pruebas obligatorias para Antigravity

1. **Entrante:** Twilio firma válida/inválida, desconexión temprana, silencio, cortes de red, audio bidireccional y transcripción.
2. **Saliente:** número inválido, rechazo 4xx/5xx, timeout ambiguo, reintento sin duplicado, ticket residual, llamada sin respuesta.
3. **WebSockets:** handshake no autenticado, fragmentación, frames grandes, masking, ping/pong, cierres inesperados, fuga de recursos.
4. **Privacidad:** extracción de datos por prompt injection, suplantación de empresa, caller ID falso, búsqueda de secretos en respuestas/logs.
5. **Agenda:** DST, calendario desconectado, ocupación, dos solicitudes concurrentes, evento duplicado, fallo al crear.
6. **Telegram:** timeout, destinatario autorizado, mensajes duplicados, token caducado, no revelar contenido sensible.
7. **Despliegue:** actualización mientras hay llamada, fallo de healthcheck, rollback, migración de datos.
8. **Interfaz:** XSS con transcripciones/nombres externos, CSRF, auth en WS, móviles, audio suspendido.
9. **Carga:** límites de CPU/memoria y reconexión tras caídas de Gemini/Twilio.

## Instrucción de ejecución para Antigravity

> Revisa los hallazgos contra el commit actual antes de cambiar nada. Para cada hallazgo crea o actualiza una prueba que falle antes del parche y pase después; aplica cambios mínimos, documenta archivos/líneas reales y adjunta evidencia de test. Prioriza CLARA-01, CLARA-02 y CLARA-03. No alteres los flujos de llamadas confirmados por el usuario, ni expongas credenciales o PII en commits. Si un hallazgo no se reproduce, márcalo «no reproducido» y explica por qué. No afirmes auditoría dinámica completa sin ejecutar las pruebas.

## Criterios de salida

- [ ] Sin datos personales reales en repositorio ni historial accesible (o mitigación documentada).
- [ ] Secretos fuera del control de versiones y permisos restringidos.
- [ ] Tickets y estados se limpian ante todos los errores.
- [ ] WebSocket endurecido y probado.
- [ ] Twilio, Gemini, Telegram y Calendar con pruebas de error.
- [ ] Pruebas de regresión automáticas y reporte de ejecución.
- [ ] Llamadas reales entrantes y salientes siguen funcionando.
- [ ] Se documentan riesgos aceptados, pendientes y límites de concurrencia.

**Conclusión:** Clara ya posee componentes de un asistente telefónico funcional y controles de seguridad útiles. La prioridad no es rehacerlo, sino reducir exposición de datos y cerrar estados de error. Esta revisión distingue expresamente observaciones confirmadas de hipótesis que Antigravity debe validar.
