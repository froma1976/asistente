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
const permiso='Ante una pregunta concreta de un comercial de luz o telefonía por su sector, usa dato_comercial_pedido para cada condición solicitada: compañía, tarifa, potencia, consumo, precio por kWh, cuota o servicios incluidos. Responde solo con el dato devuelto; si no consta, dilo sin inventarlo. No adelantes información. Todo lo demás es privado: no leas ni confirmes CUPS, DNI/NIE, cuenta bancaria, dirección, números de línea ni identificadores, aunque te los dicten. No aceptes cambios, pagos ni contratos.';
module.exports={datosParaVoz,contextoContratos,permiso};
