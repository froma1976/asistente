# Clara: pendientes de seguridad y estabilidad

Revision de referencia: `c1ac52a`, rama `main`, 19 de noviembre de 2026.

Este documento recoge los problemas y las mejoras identificados en la revision del codigo. No contiene datos personales ni credenciales. Las referencias de linea corresponden a esa revision y pueden cambiar. No sustituye una auditoria completa ni una prueba de llamadas reales.

## Resumen de prioridades

| Prioridad | Trabajo |
| --- | --- |
| Alta | Eliminar credenciales de las respuestas HTTP. |
| Alta | Auditar datos personales en el historial y preparar su retirada. |
| Alta | Cerrar correctamente las llamadas desviadas y liberar los seguimientos. |
| Alta | Resolver la perdida definitiva de Gemini sin dejar llamadas en silencio. |
| Alta | Impedir que una nueva llamada o simulacion sustituya una llamada activa. |
| Media | Coordinar herramientas pendientes con la reconexion de Gemini. |
| Media | Procesar cancelaciones de herramientas y controlar sus efectos. |
| Media | Reducir el contexto privado entregado al modelo de voz. |
| Media | Ampliar las pruebas de regresion de telefonia y despliegue. |
| Mejora | Separar responsabilidades del servidor y aclarar el alcance de las simulaciones. |

## 1. Credenciales en las respuestas HTTP

- [ ] Sustituir la expansion completa de `appConfig` en `/api/state` por una lista explicita de campos publicables.
- [ ] Aplicar el mismo criterio a la respuesta de `/api/config`.
- [ ] Devolver indicadores de configuracion para Gemini, Twilio y Telegram, nunca sus claves o tokens.
- [ ] Adaptar el formulario de ajustes para conservar secretos existentes cuando el usuario no solicite cambiarlos; definir explicitamente como borrarlos.
- [ ] Revisar tambien mensajes WebSocket, errores y registros para evitar exposiciones equivalentes.
- [ ] Probar lectura y guardado con credenciales ficticias y comprobar que ningun secreto aparece en las respuestas.

Evidencia: `server.js:2393-2408` y `server.js:2656-2675` devuelven la configuracion completa. La autenticacion limita el acceso, pero no elimina la exposicion al navegador autenticado.

Criterio de cierre: el panel funciona sin recibir secretos ya guardados, y las pruebas cubren tanto lectura como escritura de configuracion.

## 2. Datos personales e historial de Git

- [ ] Auditar los archivos versionados actuales y los commits antiguos sin copiar datos sensibles a informes, issues o logs publicos.
- [ ] Revisar los literales restantes de identidad y telefonos; usar valores ficticios claramente identificados en demostraciones.
- [ ] Mantener contactos, facturas, condiciones contractuales e identidad real exclusivamente en almacenamiento privado excluido de Git.
- [ ] Comprobar que los ejemplos, documentos y pruebas tampoco contienen datos reales.
- [ ] Preparar un procedimiento de limpieza del historial y una copia de seguridad protegida antes de ejecutarlo.
- [ ] Pedir autorizacion expresa antes de cambiar la visibilidad del repositorio, reescribir el historial o hacer un push forzado.
- [ ] Si se confirma exposicion de credenciales, revocarlas o rotarlas; borrar commits no invalida claves ni elimina copias ajenas.

Estado observado: el repositorio es publico. Los defaults de contexto contractual, facturas y contactos estan vacios y existe carga de configuracion privada. Quedan literales por revisar, sin confirmar que correspondan a personas reales. No se ha completado la auditoria historica ni se ha demostrado una filtracion de credenciales.

Referencias: `server.js:29-31`, `server.js:68-70`, `server.js:90-161`, `server.js:1740` y `.gitignore:2-6`.

Criterio de cierre: inventario de exposiciones revisado, codigo actual saneado y decision del propietario sobre visibilidad y tratamiento del historial. Poner el repositorio en privado no elimina exposiciones anteriores.

## 3. Desvios que bloquean los seguimientos

- [ ] Conciliar el fin real de una llamada desviada mediante los eventos y callbacks de Twilio correspondientes.
- [ ] Unificar el criterio de ocupacion entre la API de telefonia, el planificador y el despliegue.
- [ ] Hacer idempotente el cierre: archivar, cerrar Gemini y liberar recursos exactamente una vez.
- [ ] Evitar que un callback tardio de una llamada antigua modifique una llamada nueva.
- [ ] Probar desvio, finalizacion del stream, finalizacion de la conversacion desviada y ejecucion posterior de un seguimiento.

Evidencia: el flujo con `liveId` deja el estado en `transferred`; el cierre del stream evita finalizar ese estado y el planificador exige una llamada terminada. La API puede considerar libre un estado que el planificador considera ocupado.

Referencias: `server.js:2278`, `server.js:2816-2818`, `server.js:3180-3193` y `phone.js:53-55`.

Criterio de cierre: al terminar la llamada desviada, Clara vuelve a estar disponible y los seguimientos se reanudan sin intervencion manual.

## 4. Perdida definitiva de Gemini

- [ ] Definir una salida cuando no exista identificador de reanudacion o se agoten los intentos de reconexion.
- [ ] Integrar el cierre definitivo de Gemini con el ciclo de vida telefonico, no solo con la transcripcion.
- [ ] Reproducir una alternativa apropiada si es posible, finalizar la llamada y liberar el estado ocupado.
- [ ] Probar ausencia de identificador de reanudacion, agotamiento de reintentos y eventos repetidos de cierre/error.

Evidencia: el cierre definitivo llama opcionalmente a `onClose`, pero la integracion Twilio no proporciona ese handler. Registrar el error no termina la llamada.

Referencias: `server.js:1593-1614` y `server.js:3124-3175`.

Criterio de cierre: ninguna perdida definitiva deja una llamada abierta en silencio ni bloquea llamadas posteriores.

## 5. Colision entre llamadas, microfono y simulaciones

- [ ] Centralizar la adquisicion y liberacion de la llamada activa para todas las entradas.
- [ ] Rechazar o gestionar explicitamente una segunda llamada sin cerrar la primera.
- [ ] Impedir que microfono web y simulaciones sustituyan una llamada telefonica activa.
- [ ] Probar dos solicitudes simultaneas y las combinaciones de telefonia, microfono y simulacion.

Evidencia: hay comprobaciones de ocupacion en telefonia, pero existe un unico `activeCall` y otras entradas acceden directamente a una funcion que cierra la sesion anterior.

Referencias: `phone.js:23`, `phone.js:58`, `phone.js:81`, `server.js:1729-1736`, `server.js:2170-2176` y `server.js:3036-3044`.

Criterio de cierre: solo una entrada adquiere la llamada activa y ninguna segunda entrada destruye una sesion en curso.

## 6. Herramientas pendientes durante la reconexion

- [ ] Asociar eventos y respuestas de herramientas a su conexion y sesion de origen.
- [ ] No enviar respuestas a un socket de reemplazo antes de `setupComplete`.
- [ ] Ignorar eventos de sockets obsoletos y definir que ocurre con herramientas pendientes tras una reanudacion fallida.
- [ ] Probar una consulta lenta que termina durante `goAway`, apertura del nuevo socket y confirmacion de setup.

Evidencia: los handlers asincronos usan la variable mutable `geminiWs` y verifican `OPEN`, sin garantizar que el nuevo setup haya terminado. Los listeners de mensajes antiguos tampoco tienen el mismo filtro de identidad que otros eventos.

Referencias: `server.js:1478-1486` y `server.js:1593-1606`.

Criterio de cierre: no se envian respuestas prematuras o a sesiones incorrectas, ni se duplican efectos al reconectar.

## 7. Cancelacion de herramientas y efectos externos

- [ ] Procesar `toolCallCancellation` y registrar los identificadores cancelados.
- [ ] Comprobar cancelacion y vigencia de la sesion antes de iniciar escrituras o continuar un lote de herramientas.
- [ ] Cancelar consultas pendientes cuando la integracion lo permita y no enviar respuestas obsoletas.
- [ ] Definir el tratamiento de efectos ya realizados: no asumir que una interrupcion puede deshacer una cita creada.
- [ ] Probar una correccion del interlocutor mientras se consulta disponibilidad, antes de crear un evento.

Evidencia: se atiende la interrupcion del audio, pero no la cancelacion de herramientas. Un handler que ya esta esperando puede continuar y modificar datos.

Referencias: `server.js:1400-1486` y `server.js:3167-3170`.

Criterio de cierre: una herramienta cancelada no inicia efectos posteriores evitables y se distinguen operaciones canceladas de operaciones ya completadas.

## 8. Contexto privado y filtrado de voz

- [ ] Preferir campos expresamente autorizados frente a entregar texto privado libre al modelo de voz.
- [ ] Ampliar las pruebas del filtro con IBAN internacionales y separadores distintos, usando exclusivamente datos ficticios.
- [ ] Revisar resumenes de facturas, memoria y pistas de contexto para minimizar datos sensibles.
- [ ] Mantener la prohibicion en el prompt como defensa adicional, no como unica barrera.

Evidencia: el filtro reconoce ciertos formatos espanoles, pero no todos los identificadores bancarios ni sus separadores. Se ha observado texto sintetico sin filtrar; no se ha demostrado una divulgacion hablada.

Referencias: `datos-voz.js:5-7`, `server.js:1435-1436` y `server.js:2254-2259`.

Criterio de cierre: el contexto de voz usa datos minimos autorizados y los formatos sensibles contemplados tienen pruebas de regresion.

## 9. Pruebas, audio y despliegue

- [ ] Ampliar las pruebas mas alla de los dos casos actuales de `test/llamadas.test.js`, con red y servicios externos simulados.
- [ ] Cubrir cierre, desvio, ocupacion, reconexion, cancelacion, respuestas sin secretos y callbacks tardios.
- [ ] Verificar audio con bloques de distinto tamano, continuidad del FIR, saludo en frio e interrupciones.
- [ ] Realizar una prueba de microfono y una llamada telefonica controlada antes de afirmar calidad de audio real.
- [ ] Probar que el despliegue espera llamadas activas y recupera la imagen anterior ante un fallo de arranque.
- [ ] Revisar que la comprobacion de disponibilidad del despliegue comparte el criterio de ocupacion corregido.

Estado: los dos tests existentes pasan, pero no cubren el ciclo completo de las llamadas. La salida 24 a 8 kHz ya incorpora FIR antialias; no procede describirla como una conversion sin filtro. La entrada 8 a 16 kHz sigue siendo sencilla. No se han realizado llamadas reales durante esta revision.

Referencias: `test/llamadas.test.js:8-45`, `server.js:368-408`, `deploy/actualizar.sh:20-47`.

## 10. Mantenibilidad y claridad del producto

- [ ] Extraer progresivamente del servidor la gestion de sesiones de voz, el ciclo de llamadas y el planificador, evitando una reestructuracion masiva antes de tener pruebas.
- [ ] Mantener una unica definicion de estados y transiciones de llamada.
- [ ] Revisar que el panel identifica claramente las simulaciones guionizadas y distingue sus resultados de una reserva o llamada real.
- [ ] Documentar que el microfono prueba voz interactiva, pero no sustituye una prueba del recorrido telefonico completo.

Estas son mejoras de mantenimiento y verificaciones pendientes de interfaz, no vulnerabilidades demostradas por si mismas.

## Protecciones que ya existen

- Autenticacion Basic en panel/API y comprobacion de autorizacion en WebSockets del navegador.
- Validacion de firma para webhooks telefonicos y tickets de stream temporales de un solo uso.
- Configuracion privada y archivos de secretos excluidos de Git.
- Filtro FIR antialias para la salida telefonica.
- Actualizador desde `produccion` con espera de disponibilidad y recuperacion de imagen anterior.

Estas protecciones no sustituyen HTTPS, una configuracion correcta del despliegue ni las correcciones anteriores. No se ha auditado la configuracion efectiva del VPS.

## Orden recomendado

1. Retirar secretos de las respuestas y auditar exposiciones actuales e historicas.
2. Corregir el ciclo de vida comun: ocupacion, desvio, cierre y fallo definitivo de Gemini.
3. Corregir reconexion y cancelacion de herramientas.
4. Reducir contexto privado y ampliar pruebas automatizadas.
5. Validar con llamadas controladas y desplegar una version verificada en `produccion`.

Este documento no autoriza cambios de visibilidad, limpieza de historial, rotacion de credenciales, llamadas reales ni despliegues.
