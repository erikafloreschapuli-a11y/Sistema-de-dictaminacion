/**
 * ServicioNotificaciones.js
 * Correos automaticos al estudiante (RF-27 a RF-29).
 * Los textos salen de la hoja Configuracion para que el Administrador los
 * edite sin tocar codigo (RF-29).
 * Un fallo de correo nunca debe revertir un dictamen ya guardado (RNF-07).
 */

// Motivos por los que un correo no se envia; se muestran al dictaminador.
const MOTIVOS_CORREO_NO_ENVIADO = {
  SIN_DESTINO: 'el estudiante no tiene correo registrado.',
  SIN_CUOTA: 'se agotó la cuota diaria de correos de Google; avisa al estudiante por otro medio.',
  ERROR_ENVIO: 'Google rechazó el envío; revisa el registro de ejecuciones.'
};

/**
 * Notifica al estudiante que un documento quedo observado (RF-27).
 * Devuelve { enviado, motivo }.
 */
function notificarDocumentoObservado(estudiante, tipoDocumento, observacion, usuario) {
  const valores = construirValoresPlantilla(estudiante, {
    documento: tipoDocumento,
    observacion: observacion,
    dictaminador: usuario && usuario.correo ? usuario.correo : 'Servicios Escolares'
  });
  return enviarCorreoConPlantilla(estudiante, 'ASUNTO_CORREO_OBSERVADO', 'PLANTILLA_CORREO_OBSERVADO', valores);
}

/**
 * Notifica al estudiante que su expediente quedo completo y aprobado (RF-28).
 * Devuelve { enviado, motivo }.
 */
function notificarExpedienteCompleto(estudiante) {
  const valores = construirValoresPlantilla(estudiante, {});
  return enviarCorreoConPlantilla(estudiante, 'ASUNTO_CORREO_COMPLETO', 'PLANTILLA_CORREO_COMPLETO', valores);
}

/**
 * Reune los datos del estudiante que pueden usarse como marcadores.
 */
function construirValoresPlantilla(estudiante, adicionales) {
  return Object.assign({
    nombre: String(estudiante.nombre || 'estudiante').trim(),
    matricula: String(estudiante.matricula || '').trim(),
    generacion: String(estudiante.generacion || obtenerValorConfiguracion('GENERACION_ACTIVA') || '').trim()
  }, adicionales);
}

/**
 * Sustituye los marcadores {{clave}} de una plantilla. Un marcador sin valor
 * se deja tal cual; apiGuardarPlantillasCorreo impide guardar marcadores desconocidos.
 */
function aplicarPlantilla(plantilla, valores) {
  return String(plantilla || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (coincidencia, clave) {
    return Object.prototype.hasOwnProperty.call(valores, clave) ? String(valores[clave]) : coincidencia;
  });
}

/**
 * Lee asunto y cuerpo de Configuracion, los completa y envia el correo.
 */
function enviarCorreoConPlantilla(estudiante, claveAsunto, claveCuerpo, valores) {
  const destino = obtenerCorreoDestinoEstudiante(estudiante);
  if (!destino) {
    return { enviado: false, motivo: MOTIVOS_CORREO_NO_ENVIADO.SIN_DESTINO };
  }
  const configuracion = obtenerValoresConfiguracion();
  const asunto = aplicarPlantilla(configuracion[claveAsunto] || PLANTILLAS_CORREO_PREDETERMINADAS[claveAsunto], valores);
  const cuerpo = aplicarPlantilla(configuracion[claveCuerpo] || PLANTILLAS_CORREO_PREDETERMINADAS[claveCuerpo], valores);
  return enviarCorreoNotificacion(destino, asunto, cuerpo);
}

/**
 * Envia el correo si queda cuota y aisla los errores de envio (RNF-10).
 */
function enviarCorreoNotificacion(destino, asunto, cuerpo) {
  const cuotaRestante = obtenerCuotaCorreosRestante();
  if (cuotaRestante !== null && cuotaRestante < CUOTA_MINIMA_CORREOS) {
    console.error('Correo a ' + destino + ' omitido: cuota diaria de MailApp agotada.');
    return { enviado: false, motivo: MOTIVOS_CORREO_NO_ENVIADO.SIN_CUOTA };
  }
  try {
    MailApp.sendEmail({
      to: destino,
      subject: asunto,
      body: cuerpo
    });
    return { enviado: true, motivo: '' };
  } catch (error) {
    console.error('No se pudo enviar el correo a ' + destino + ': ' + error.message);
    return { enviado: false, motivo: MOTIVOS_CORREO_NO_ENVIADO.ERROR_ENVIO };
  }
}

/**
 * Devuelve los correos que aun se pueden enviar hoy, o null si Google no
 * responde; en ese caso se intenta el envio y sendEmail decide.
 */
function obtenerCuotaCorreosRestante() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (error) {
    console.warn('No se pudo consultar la cuota de MailApp: ' + error.message);
    return null;
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
