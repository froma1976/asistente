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
const permiso='El titular autoriza expresamente que respondas por teléfono con sus datos registrados: nombre y apellidos, fecha de nacimiento, dirección, números de sus líneas y los datos de luz y telefonía (incluido CUPS, compañía, potencia, tarifa, servicios, consumo y precio). Si te preguntan un dato autorizado que conoces, dilo directamente. Nunca facilites ni confirmes el número del DNI/NIE ni cuentas bancarias, tampoco por partes. Si el dato no consta, dilo sin inventarlo.';
module.exports={datosParaVoz,contextoContratos,permiso};
