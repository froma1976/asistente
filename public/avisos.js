const activarAvisos = document.getElementById('avisar');
const estadoAvisos = document.getElementById('aviso-estado');
if (!window.isSecureContext || !navigator.serviceWorker || !window.PushManager || !window.Notification) {
  activarAvisos.disabled = true;
  estadoAvisos.textContent = 'Para recibir avisos, abre el panel por HTTPS en un navegador compatible, como Chrome en Android.';
} else {
  async function registrarAvisos(pedir) {
    activarAvisos.disabled = true;
    try {
      if (pedir && Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission === 'denied') throw Error('Permite las notificaciones de este sitio en los ajustes del navegador.');
      if (Notification.permission !== 'granted') return;
      await navigator.serviceWorker.register('/avisos-worker.js');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub && !pedir) return;
      const r = await fetch('/api/avisos');
      if (!r.ok) throw Error('No se pudo conectar con Clara.');
      const {clave} = await r.json();
      const key = Uint8Array.from(atob(clave.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
      if (sub && new Uint8Array(sub.options.applicationServerKey).toString() !== key.toString()) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ||= await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      const result = await fetch('/api/avisos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});
      if (!result.ok) throw Error('Clara no ha podido guardar este dispositivo.');
      activarAvisos.textContent = 'Avisos de llamadas activados';
      estadoAvisos.textContent = 'Toca el aviso de Clara para leer esa llamada.';
    } catch(e) {
      estadoAvisos.textContent = Notification.permission==='denied' ? 'Permite las notificaciones de este sitio en los ajustes del navegador.' :
        `No se han activado los avisos. ${e.message}`;
    } finally { activarAvisos.disabled = activarAvisos.textContent === 'Avisos de llamadas activados'; }
  }
  activarAvisos.onclick = ()=>registrarAvisos(true);
  registrarAvisos(false);
}
