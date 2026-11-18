(() => {
  const get = name => document.getElementById('rt' + name);
  const task = get('Task'), start = get('Start'), end = get('End'), form = get('Form');
  const log = get('Log'), text = get('Text'), status = get('Status'), mic = get('Mic');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let turns = [], controller, recognition;
  const line = (who, words) => {
    const p = document.createElement('p');
    p.textContent = `${who}: ${words}`;
    log.append(p);
    log.scrollTop = log.scrollHeight;
  };
  function stopDictation() {
    if (recognition) { recognition.onresult = recognition.onerror = recognition.onend = null; recognition.abort(); recognition = null; }
  }
  function finish(message) {
    controller?.abort();
    controller = null;
    stopDictation();
    form.hidden = end.hidden = true;
    task.disabled = start.hidden = false;
    status.textContent = message;
  }
  start.onclick = () => {
    if (!task.value.trim()) { task.focus(); return; }
    window.speechSynthesis?.cancel();
    turns = [];
    log.replaceChildren();
    text.value = '';
    task.disabled = start.hidden = true;
    end.hidden = form.hidden = false;
    Array.from(form.elements).forEach(el => el.disabled = false);
    status.textContent = 'Has descolgado. Saluda a Clara como si fueras recepción.';
    text.focus();
  };
  end.onclick = () => { window.speechSynthesis?.cancel(); finish('Has colgado. Prueba terminada.'); };
  mic.hidden = !Recognition;
  mic.onclick = () => {
    window.speechSynthesis?.cancel();
    stopDictation();
    recognition = new Recognition();
    recognition.lang = 'es-ES';
    recognition.onresult = e => { text.value = (text.value + ' ' + e.results[0][0].transcript).trim(); status.textContent = 'Pulsa Responder para continuar.'; };
    recognition.onerror = () => { status.textContent = 'Puedes escribir tu respuesta si falla el micrófono.'; };
    recognition.onend = () => { mic.disabled = false; recognition = null; };
    try { recognition.start(); mic.disabled = true; status.textContent = 'Escuchando a recepción…'; }
    catch { status.textContent = 'No se pudo abrir el micrófono. Puedes escribir.'; }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const words = text.value.trim();
    if (!words || controller || form.hidden) return;
    stopDictation();
    window.speechSynthesis?.cancel();
    const pending = new AbortController();
    controller = pending;
    const next = turns.concat({role:'user',text:words});
    Array.from(form.elements).forEach(el => el.disabled = true);
    status.textContent = 'Clara está respondiendo…';
    try {
      const res = await fetch('/api/clara/restaurant-test', {method:'POST', signal:pending.signal,
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({task:task.value, turns:next})});
      const answer = await res.json();
      if (controller !== pending) return;
      if (!res.ok) throw new Error(answer.error);
      turns = next.concat({role:'model',text:answer.frase});
      text.value = '';
      line('Recepción (tú)', words);
      line('Clara', answer.frase);
      if (window.speechSynthesis) {
        const speech = new SpeechSynthesisUtterance(answer.frase);
        speech.lang = 'es-ES';
        window.speechSynthesis.speak(speech);
      }
      if (answer.estado !== 'en_curso' || turns.length >= 62)
        finish(answer.estado === 'confirmada' ? 'Resultado simulado: mesa confirmada.' : 'Prueba terminada sin reserva confirmada.');
      else status.textContent = 'Tu turno en recepción.';
    } catch (e) {
      if (controller === pending) status.textContent = e.message || 'No se pudo conectar. Vuelve a intentarlo.';
    } finally {
      if (controller === pending) {
        controller = null;
        Array.from(form.elements).forEach(el => el.disabled = false);
        text.focus();
      }
    }
  };
})();
