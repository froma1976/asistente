const byId = id => document.getElementById(id);
const sheet = byId('sheet'), notice = byId('notice'), mic = byId('mic'), goal = byId('goal');
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
byId('open').onclick = () => { notice.textContent=''; sheet.showModal(); };
byId('close').onclick = () => sheet.close();
sheet.onclose = () => recognition?.abort();
if (Recognition) {
  mic.hidden = false;
  mic.onclick = () => {
    recognition = new Recognition();
    recognition.lang = 'es-ES';
    recognition.onresult = e => { goal.value = (goal.value+' '+e.results[0][0].transcript).trim(); notice.textContent=''; };
    recognition.onerror = () => { notice.textContent='Puedes escribir el encargo.'; };
    recognition.onend = () => { mic.disabled=false; };
    try { recognition.start(); mic.disabled=true; notice.textContent='Escuchando…'; }
    catch { notice.textContent='No se pudo abrir el micrófono.'; }
  };
}
byId('order').onsubmit = async e => {
  e.preventDefault();
  const number = byId('tel').value.replace(/[\s()-]/g,'');
  if (!/^\+[1-9]\d{6,14}$/.test(number)) { notice.textContent='Añade el prefijo del país, por ejemplo +34.'; byId('tel').focus(); return; }
  byId('dial').disabled=true;
  try {
    const res = await fetch('/api/phone/dial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number,goal:goal.value.trim()})});
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    byId('state').textContent='Llamada solicitada a '+number;
    sheet.close(); byId('order').reset();
  } catch(err) { notice.textContent=err.message || 'No se pudo llamar.'; }
  finally { byId('dial').disabled=false; }
};
