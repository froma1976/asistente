// Filtra documentos españoles y cuentas sin confundir un CUPS o un teléfono con un IBAN.
function datosParaVoz(value) {
  return String(value ?? '')
    .replace(/\bES(?:[ -]?\d){16}(?:[ -]?[A-Z]){2}(?:[ -]?[0-9][A-Z])?\b/gi,'[suministro omitido]')
    .replace(/\b(?:[XYZ][ .-]?)?(?:\d[ .-]?){7}\d?[ .-]?[A-Z]\b/gi,'[documento omitido]')
    .replace(/\bES[ -]?\d{2}(?:[ -]?\d){20}(?![A-Z0-9])/gi,'[cuenta omitida]')
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{2}[ -]?\d{10}\b/g,'[cuenta omitida]')
    .replace(/\b(IBAN|cuenta bancaria|cuenta corriente|número de cuenta)\s*[:=]?\s*(?:[A-Z]{2}\s*)?\d(?:[ -]?[A-Z0-9]){7,33}\b/gi,'$1: [cuenta omitida]');
}
function contextoContratos(value) {
  return datosParaVoz(String(value || '').replace(/\d+\)\s*PRIVACIDAD ESTRICTA:[^\n]*\r?\n(?:-\s*[^\n]*\r?\n?)+/gi,''));
}
// En las facturas se pueden comunicar los datos del contrato, no los de pago.
function contratoParaVoz(value) {
  return String(value ?? '').split(/\r?\n/).map(line=>line
    .replace(/\b(ES\d{16}[A-Z]{2}(?:\d[A-Z])?)\b|\b[A-Z]{2}[ -]?\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi,
      (id,cups)=>cups || '[cuenta omitida]')
    .replace(/\b(?:\d[ -]?){12,19}\d\b/g,'[pago omitido]')
    .replace(/\b(?:IBAN|BIC|SWIFT|SEPA|CCC|banco|entidad bancaria|cuenta (?:bancaria|corriente)|domiciliaci[oó]n|tarjeta|CVV|CVC|PIN)\b.*$/i,'[datos bancarios omitidos]')
  ).join('\n');
}
const permiso='Cuando pregunten qué tenemos contratado de luz o telefonía, consulta dato_comercial_pedido y contesta directamente con los datos que pidan, también si preguntan en general por el paquete o por varios detalles. Puedes confirmar los datos no bancarios de esos contratos. Si hay varias facturas, distingue proveedor o periodo; si falta el dato, dilo sin inventarlo. Nunca leas ni confirmes datos bancarios, ni siquiera parcialmente. No aceptes cambios, pagos ni contratos.';
module.exports={datosParaVoz,contextoContratos,contratoParaVoz,permiso};
