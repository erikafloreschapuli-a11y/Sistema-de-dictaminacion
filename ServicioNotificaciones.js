/**
 * ServicioNotificaciones.js
 * Correos automaticos al estudiante (RF-27 a RF-29).
 * Un fallo de correo nunca debe revertir un dictamen ya guardado (RNF-07).
 */

/**
 * Notifica al estudiante que un documento quedo observado.
 */
function notificarDocumentoObservado(estudiante, tipoDocumento, observacion, usuario) {
  const destino = obtenerCorreoDestinoEstudiante(estudiante);
  if (!destino) {
    return false;
  }
  const nombre = String(estudiante.nombre || 'estudiante').trim();
  const cuerpo = [
    'Hola ' + nombre + ':',
    '',
    'Tu documento "' + tipoDocumento + '" fue observado durante la revision de tu expediente.',
    '',
    'Observacion del dictaminador:',
    observacion,
    '',
    'Ingresa al sistema para corregir o volver a cargar el documento.',
    '',
    'Dictaminado por: ' + String(usuario && usuario.correo ? usuario.correo : 'Servicios Escolares'),
    'Universidad Tecnologica de Puebla'
  ].join('\n');
  return enviarCorreoNotificacion(destino, ASUNTO_CORREO_OBSERVADO, cuerpo);
}

/**
 * Notifica al estudiante que su expediente quedo completo y aprobado.
 */
function notificarExpedienteCompleto(estudiante) {
  const destino = obtenerCorreoDestinoEstudiante(estudiante);
  if (!destino) {
    return false;
  }
  const nombre = String(estudiante.nombre || 'estudiante').trim();
  const cuerpo = [
    'Hola ' + nombre + ':',
    '',
    'Tu expediente de nuevo ingreso quedo completo y todos tus documentos fueron aprobados.',
    '',
    'Ya no necesitas realizar ninguna accion en el sistema.',
    '',
    'Universidad Tecnologica de Puebla'
  ].join('\n');
  return enviarCorreoNotificacion(destino, ASUNTO_CORREO_EXPEDIENTE_COMPLETO, cuerpo);
}

/**
 * Envia el correo y aisla los errores de cuota o configuracion (RNF-10).
 */
function enviarCorreoNotificacion(destino, asunto, cuerpo) {
  try {
    MailApp.sendEmail({
      to: destino,
      subject: asunto,
      body: cuerpo
    });
    return true;
  } catch (error) {
    console.error('No se pudo enviar el correo a ' + destino + ': ' + error.message);
    return false;
  }
}

/**
 * Usa el correo institucional y, si no existe, el correo personal.
 */
function obtenerCorreoDestinoEstudiante(estudiante) {
  const institucional = normalizarCorreo(estudiante && estudiante.correo_institucional);
  if (institucional) {
    return institucional;
  }
  return normalizarCorreo(estudiante && estudiante.correo_personal);
}
