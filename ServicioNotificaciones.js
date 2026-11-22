/**
 * ServicioNotificaciones.js
 * Correos automaticos al estudiante (RF-27 a RF-29).
 * El mensaje sale de la hoja Configuracion (editable por el Administrador)
 * y se envuelve en el formato institucional de correo.html, con los datos
 * del alumno y la tabla de estatus de sus documentos.
 * Un fallo de correo nunca debe revertir un dictamen ya guardado (RNF-07).
 */

// Motivos por los que un correo no se envia; se muestran al dictaminador.
const MOTIVOS_CORREO_NO_ENVIADO = {
  SIN_DESTINO: 'el estudiante no tiene correo registrado.',
  SIN_CUOTA: 'se agotó la cuota diaria de correos de Google; avisa al estudiante por otro medio.',
  ERROR_ENVIO: 'Google rechazó el envío; revisa el registro de ejecuciones.'
};

// Vista del formato de correo y datos fijos del encabezado.
const VISTA_CORREO = 'correo';
const NOMBRE_REMITENTE_CORREO = 'Servicios Escolares UTP';
const AREA_CORREO = 'Subdirección de Servicios Escolares';

// Titulo y color de la barra superior de cada aviso.
const AVISOS_CORREO = {
  OBSERVADO: { titulo: 'Documento con observaciones', color: '#b91c1c' },
  COMPLETO: { titulo: 'Expediente completo', color: '#15803d' }
};

// Colores del semaforo en el correo (los clientes de correo no leen las
// variables CSS de la app, por eso van como valores fijos).
const COLORES_ESTATUS_CORREO = {
  'Pendiente': { etiqueta: 'Pendiente', fondo: '#eef2ef', texto: '#4b5563' },
  'En Revision': { etiqueta: 'En revisión', fondo: '#fef3c7', texto: '#b45309' },
  'Aprobado': { etiqueta: 'Aprobado', fondo: '#dcfce7', texto: '#166534' },
  'Observado': { etiqueta: 'Observado', fondo: '#fee2e2', texto: '#b91c1c' }
};

/**
 * Notifica al estudiante que un documento quedo observado (RF-27).
 * Devuelve { enviado, motivo }.
 */
function notificarDocumentoObservado(estudiante, expediente, tipoDocumento, observacion, usuario) {
  const valores = construirValoresPlantilla(estudiante, {
    documento: tipoDocumento,
    observacion: observacion,
    dictaminador: usuario && usuario.correo ? usuario.correo : NOMBRE_REMITENTE_CORREO
  });
  return enviarCorreoConPlantilla(estudiante, 'ASUNTO_CORREO_OBSERVADO', 'PLANTILLA_CORREO_OBSERVADO', valores, {
    aviso: AVISOS_CORREO.OBSERVADO,
    expediente: expediente,
    documentoDestacado: tipoDocumento,
    // Quien abre el correo sin HTML tambien debe ver que corregir.
    textoAdicional: 'Observación del dictaminador sobre ' + tipoDocumento + ': ' + observacion
  });
}

/**
 * Notifica al estudiante que su expediente quedo completo y aprobado (RF-28).
 * Devuelve { enviado, motivo }.
 */
function notificarExpedienteCompleto(estudiante, expediente) {
  const valores = construirValoresPlantilla(estudiante, {});
  return enviarCorreoConPlantilla(estudiante, 'ASUNTO_CORREO_COMPLETO', 'PLANTILLA_CORREO_COMPLETO', valores, {
    aviso: AVISOS_CORREO.COMPLETO,
    expediente: expediente,
    documentoDestacado: ''
  });
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
 * Lee asunto y mensaje de Configuracion, los completa y envia el correo
 * con formato (y su version de solo texto para clientes sin HTML).
 */
function enviarCorreoConPlantilla(estudiante, claveAsunto, claveCuerpo, valores, formato) {
  const destino = obtenerCorreoDestinoEstudiante(estudiante);
  if (!destino) {
    return { enviado: false, motivo: MOTIVOS_CORREO_NO_ENVIADO.SIN_DESTINO };
  }
  const configuracion = obtenerValoresConfiguracion();
  const asunto = aplicarPlantilla(configuracion[claveAsunto] || PLANTILLAS_CORREO_PREDETERMINADAS[claveAsunto], valores);
  const cuerpo = aplicarPlantilla(configuracion[claveCuerpo] || PLANTILLAS_CORREO_PREDETERMINADAS[claveCuerpo], valores);
  const html = construirCorreoHtml(estudiante, cuerpo, valores.generacion, formato);
  const textoPlano = formato.textoAdicional ? cuerpo + '\n\n' + formato.textoAdicional : cuerpo;
  return enviarCorreoNotificacion(destino, asunto, textoPlano, html);
}

/**
 * Llena correo.html. Si la plantilla falla, se envia solo el texto: es
 * preferible un correo sencillo a que el alumno no reciba aviso.
 */
function construirCorreoHtml(estudiante, cuerpo, generacion, formato) {
  try {
    const plantilla = HtmlService.createTemplateFromFile(VISTA_CORREO);
    plantilla.titulo = formato.aviso.titulo;
    plantilla.colorTitulo = formato.aviso.color;
    plantilla.area = AREA_CORREO;
    plantilla.generacion = generacion;
    plantilla.estudiante = {
      nombre: String(estudiante.nombre || ''),
      matricula: String(estudiante.matricula || ''),
      carrera: String(estudiante.carrera || ''),
      correo: String(estudiante.correo_institucional || '')
    };
    plantilla.parrafos = dividirEnParrafos(cuerpo);
    plantilla.documentos = construirFilasDocumentosCorreo(formato.expediente, formato.documentoDestacado);
    plantilla.urlApp = obtenerUrlApp();
    plantilla.fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy 'a las' HH:mm");
    return plantilla.evaluate().getContent();
  } catch (error) {
    console.error('No se pudo construir el correo con formato: ' + error.message);
    return '';
  }
}

/**
 * Separa el texto de la plantilla en parrafos (lineas en blanco) y une los
 * saltos sencillos, para que se lea igual que el texto que se edito.
 */
function dividirEnParrafos(texto) {
  return String(texto || '')
    .split(/\n\s*\n/)
    .map(function (parrafo) { return parrafo.replace(/\s*\n\s*/g, ' ').trim(); })
    .filter(Boolean);
}

/**
 * Filas de la tabla de documentos. Solo el documento observado lleva la
 * observacion, para no repetir comentarios viejos de otros documentos.
 */
function construirFilasDocumentosCorreo(expediente, documentoDestacado) {
  const documentos = expediente && expediente.documentos ? expediente.documentos : [];
  return documentos.map(function (documento) {
    const colores = COLORES_ESTATUS_CORREO[documento.estatus] || COLORES_ESTATUS_CORREO.Pendiente;
    const destacado = documento.tipo_documento === documentoDestacado;
    return {
      tipo: documento.tipo_documento,
      estatus: colores.etiqueta,
      colorFondo: colores.fondo,
      colorTexto: colores.texto,
      destacado: destacado,
      observacion: destacado ? documento.observaciones : ''
    };
  });
}

/**
 * Envia el correo si queda cuota y aisla los errores de envio (RNF-10).
 */
function enviarCorreoNotificacion(destino, asunto, cuerpo, html) {
  const cuotaRestante = obtenerCuotaCorreosRestante();
  if (cuotaRestante !== null && cuotaRestante < CUOTA_MINIMA_CORREOS) {
    console.error('Correo a ' + destino + ' omitido: cuota diaria de MailApp agotada.');
    return { enviado: false, motivo: MOTIVOS_CORREO_NO_ENVIADO.SIN_CUOTA };
  }
  try {
    const mensaje = { to: destino, subject: asunto, body: cuerpo, name: NOMBRE_REMITENTE_CORREO };
    if (html) {
      mensaje.htmlBody = html;
    }
    MailApp.sendEmail(mensaje);
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
