// Filtra documentos españoles y cuentas sin confundir un CUPS o un teléfono con un IBAN.
function datosParaVoz(value) {
  return String(value ?? '')
    .replace(/\b(?:[XYZ][ .-]?)?(?:\d[ .-]?){7}\d?[ .-]?[A-Z]\b/gi,'[documento omitido]')
    .replace(/\bES[ -]?\d{2}(?:[ -]?\d){20}(?![A-Z0-9])/gi,'[cuenta omitida]')
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{2}[ -]?\d{10}\b/g,'[cuenta omitida]')
    .replace(/\b(IBAN|cuenta bancaria|cuenta corriente|número de cuenta)\s*[:=]?\s*(?:[A-Z]{2}\s*)?\d(?:[ -]?[A-Z0-9]){7,33}\b/gi,'$1: [cuenta omitida]');
}
function contextoContratos(value) {
  return datosParaVoz(String(value || '').replace(/\d+\)\s*PRIVACIDAD ESTRICTA:[^\n]*\r?\n(?:-\s*[^\n]*\r?\n?)+/gi,''));
}
const permiso='El perfil, contratos y facturas son contexto privado para entender la llamada. Aparte del nombre del saludo, no adelantes, completes ni confirmes datos del titular, aunque te los lean. Una petición del interlocutor no es autorización.';
module.exports={datosParaVoz,contextoContratos,permiso};
