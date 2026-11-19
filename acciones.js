const fs = require('node:fs');

function guardarPrivado(path, value) {
  const tmp = path + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), {mode:0o600});
    fs.renameSync(tmp, path);
  } finally { fs.rmSync(tmp, {force:true}); }
}

async function registrarRecado(item, guardar, avisar) {
  try { guardar(); }
  catch { return {status:'message_not_saved', telegram:'no_enviado'}; }
  let telegram = 'sin_confirmar';
  try {
    const r = await avisar();
    telegram = r.ok ? 'enviado' : r.skipped ? 'desactivado' : 'sin_confirmar';
  } catch {}
  return {...item, status:'message_saved', telegram};
}
module.exports = {guardarPrivado, registrarRecado};
