/**
 * ServicioEstudiante.js
 * Panel del Estudiante: consulta y actualizacion de datos (RF-07, RF-08),
 * carga de documentos (RF-09 a RF-14) y almacenamiento en Drive (RF-32 a RF-35).
 * Toda escritura en Sheets ocurre dentro de conBloqueoEscritura (RNF-03).
 */

/* ------------------------------------------------------------------ */
/* RF-07 y RF-08: datos del estudiante                                */
/* ------------------------------------------------------------------ */

/**
 * Devuelve los datos del estudiante de la sesion, los tramites encendidos
 * en los que esta habilitado y el expediente del tramite elegido
 * (datos.idProceso; sin valor, el primero).
 */
function apiObtenerMiExpediente(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ESTUDIANTE]);
    const estudiante = obtenerEstudianteParaUsuario(usuario, datos && datos.matricula);
    const expedientes = construirExpedientesDelAlumno(estudiante);
    const pedido = String((datos && datos.idProceso) || '').trim();
    const elegido = expedientes.find(function (expediente) { return expediente.id_proceso === pedido; }) || expedientes[0] || null;
    return {
      ok: true,
      estudiante: convertirEstudianteParaVista(estudiante),
      procesos: expedientes.map(convertirResumenProceso),
      expediente: elegido,
      configuracion: {
        tamanoMaximoMb: obtenerTamanoMaximoMb()
      }
    };
  });
}

/**
 * Expedientes del alumno en cada tramite encendido donde esta habilitado,
 * en el orden en que se le habilitaron.
 */
function construirExpedientesDelAlumno(estudiante) {
  const procesos = {};
  leerProcesos().forEach(function (proceso) {
    if (proceso.activo) {
      procesos[proceso.id_proceso] = proceso;
    }
  });
  const requisitos = leerRequisitosPorProceso();
  const documentos = leerDocumentosDeEstudiante(estudiante.matricula);
  return leerInscripcionesDeAlumno(estudiante.matricula).filter(function (inscripcion) {
    return procesos[inscripcion.id_proceso];
  }).map(function (inscripcion) {
    const proceso = procesos[inscripcion.id_proceso];
    const expediente = construirExpedienteProceso(proceso, requisitos[proceso.id_proceso] || [], estudiante, inscripcion, documentos);
    expediente.fecha_apertura = formatearFechaSolo(proceso.fecha_apertura);
    expediente.fecha_cierre = formatearFechaSolo(proceso.fecha_cierre);
    return expediente;
  });
}

function convertirResumenProceso(expediente) {
  return {
    id_proceso: expediente.id_proceso,
    nombre: expediente.nombre_proceso,
    estatus: expediente.estatus,
    abierto: expediente.abierto,
    fecha_cierre: expediente.fecha_cierre,
    aprobados: expediente.conteos.aprobados,
    total: expediente.totalDocumentos
  };
}

/**
 * Actualiza telefono y correo personal del estudiante autenticado (RF-08).
 * Solo se modifican esas dos columnas; el resto de los datos es de solo lectura.
 */
function apiActualizarMisDatos(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ESTUDIANTE]);
    const telefono = String((datos && datos.telefono) || '').trim();
    const correoPersonal = normalizarCorreo(datos && datos.correoPersonal);
    validarTelefonoEstudiante(telefono);
    validarCorreoPersonalEstudiante(correoPersonal);

    return conBloqueoEscritura(function () {
      const actual = obtenerEstudianteParaUsuario(usuario, datos && datos.matricula);
      const telefonoAnterior = String(actual.telefono || '').trim();
      const correoAnterior = normalizarCorreo(actual.correo_personal);

      if (telefonoAnterior === telefono && correoAnterior === correoPersonal) {
        return { ok: true, sinCambios: true, estudiante: convertirEstudianteParaVista(actual) };
      }

      actualizarRegistro(HOJAS.ESTUDIANTES, actual._fila, {
        telefono: telefono,
        correo_personal: correoPersonal
      });
      registrarEnHistorial({
        usuario: usuario.correo,
        matricula: String(actual.matricula),
        tipo_documento: 'DATOS',
        estatus_anterior: 'Telefono: ' + (telefonoAnterior || '-') + ' / Correo personal: ' + (correoAnterior || '-'),
        estatus_nuevo: 'Telefono: ' + (telefono || '-') + ' / Correo personal: ' + (correoPersonal || '-'),
        observacion: 'Actualizacion de datos de contacto por el estudiante'
      });

      const actualizado = Object.assign({}, actual, {
        telefono: telefono,
        correo_personal: correoPersonal
      });
      return { ok: true, estudiante: convertirEstudianteParaVista(actualizado) };
    });
  });
}

/* ------------------------------------------------------------------ */
/* RF-09 a RF-14: carga de documentos                                 */
/* ------------------------------------------------------------------ */

/**
 * Carga o reemplaza un documento del estudiante en un tramite.
 * Para soportar muchas cargas simultaneas, el archivo se guarda en Drive
 * FUERA del bloqueo; dentro solo se revalida el estatus y se escribe la hoja.
 * Si la revalidacion falla, el archivo recien creado se manda a la papelera.
 */
function apiSubirDocumento(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ESTUDIANTE]);
    const estudiante = obtenerEstudianteParaUsuario(usuario, datos && datos.matricula);
    const contexto = obtenerContextoProceso(estudiante.matricula, datos && datos.idProceso, true);
    if (!estaProcesoAbierto(contexto.proceso)) {
      throw crearError('VALIDACION', 'El periodo de carga del trámite ' + contexto.proceso.nombre + ' está cerrado.');
    }
    const requisito = obtenerRequisito(contexto, datos && datos.tipoDocumento);
    const resultado = procesarCargaDocumento(usuario, estudiante, contexto, requisito, datos || {});
    // Acuse de recibo despues de guardar: si el correo falla, la carga ya
    // quedo registrada y el alumno ve su estatus en el sistema.
    resultado.acuseEnviado = notificarDocumentoRecibido(estudiante, resultado.expediente, requisito.tipo_documento).enviado;
    return resultado;
  });
}

/**
 * Valida, guarda en Drive y registra un documento. La usan la carga real y
 * la prueba de carga (ServicioPruebaCarga.js), para medir el mismo codigo.
 */
function procesarCargaDocumento(usuario, estudiante, contexto, requisito, datos) {
  const archivo = prepararArchivoParaCarga(datos, obtenerTipoCatalogo(requisito.tipo_documento).formatos);
  const fechaEmision = validarFechaEmision(requisito, datos.fechaEmision);

  // Revision previa sin bloqueo para no subir un archivo que se rechazara.
  validarCargaPermitida(requisito, contexto.proceso, leerDocumentosDeEstudiante(estudiante.matricula));

  const carpeta = obtenerCarpetaExpediente(construirDatosCarpeta(estudiante, contexto));
  const nombreArchivo = construirNombreArchivo(estudiante.matricula, requisito.tipo_documento, archivo.extension);
  const archivoDrive = carpeta.createFile(Utilities.newBlob(archivo.bytes, archivo.mime, nombreArchivo));

  let resultado;
  try {
    resultado = conBloqueoEscritura(function () {
      return registrarCargaDocumento(usuario, estudiante, contexto, requisito, archivoDrive.getUrl(), fechaEmision);
    });
  } catch (error) {
    descartarArchivo(archivoDrive);
    throw error;
  }

  // El archivo observado ya no sirve una vez que llega el corregido: no se
  // conserva en Drive. Se hace fuera del bloqueo para no retener la hoja.
  if (resultado.urlArchivoReemplazado) {
    descartarArchivoPorUrl(resultado.urlArchivoReemplazado);
  }
  delete resultado.urlArchivoReemplazado;
  return resultado;
}

/**
 * Un documento reutilizado ya esta aprobado y no se sustituye; uno propio
 * solo se carga si esta Pendiente u Observado (RF-13 y RF-14).
 * Devuelve el documento resuelto para el requisito.
 */
function validarCargaPermitida(requisito, proceso, documentos) {
  const resuelto = resolverRequisito(requisito, proceso, documentos);
  if (resuelto.origen === ORIGEN_DOCUMENTO.REUTILIZADO) {
    throw crearError('VALIDACION', 'Tu ' + requisito.tipo_documento + ' se toma de tu expediente y ya está aprobado; no necesitas subirlo.');
  }
  if (resuelto.origen === ORIGEN_DOCUMENTO.PROPIO) {
    validarEstatusParaCarga(normalizarEstatusDocumento(resuelto.registro.estatus));
  }
  return resuelto;
}

/**
 * Parte critica de la carga (requiere lock): revalida el estatus con datos
 * frescos y escribe Documentos, Historial y el estatus del alumno en el
 * tramite con una sola lectura de sus documentos.
 */
function registrarCargaDocumento(usuario, estudiante, contexto, requisito, urlArchivo, fechaEmision) {
  const documentos = leerDocumentosDeEstudiante(estudiante.matricula);
  const resuelto = validarCargaPermitida(requisito, contexto.proceso, documentos);
  const documentoActual = resuelto.origen === ORIGEN_DOCUMENTO.PROPIO ? resuelto.registro : null;
  const estatusAnterior = documentoActual
    ? normalizarEstatusDocumento(documentoActual.estatus)
    : ESTATUS_DOCUMENTO.PENDIENTE;
  // Se toma antes de actualizar el registro, que sobrescribe url_archivo.
  const urlArchivoReemplazado = documentoActual && documentoActual.url_archivo
    ? String(documentoActual.url_archivo)
    : '';

  const cambios = {
    url_archivo: urlArchivo,
    estatus: ESTATUS_DOCUMENTO.EN_REVISION,
    observaciones: '',
    fecha_carga: new Date(),
    fecha_dictamen: '',
    dictaminador: '',
    fecha_emision: fechaEmision || ''
  };

  if (documentoActual) {
    actualizarRegistro(HOJAS.DOCUMENTOS, documentoActual._fila, cambios);
    Object.assign(documentoActual, cambios);
  } else {
    const registro = Object.assign({
      id_documento: generarId(PREFIJOS_ID.DOCUMENTO),
      matricula: String(estudiante.matricula),
      tipo_documento: requisito.tipo_documento,
      id_proceso: contexto.proceso.id_proceso
    }, cambios);
    insertarRegistros(HOJAS.DOCUMENTOS, [registro]);
    documentos.push(registro);
  }

  registrarEnHistorial({
    usuario: usuario.correo,
    matricula: String(estudiante.matricula),
    tipo_documento: requisito.tipo_documento,
    estatus_anterior: estatusAnterior,
    estatus_nuevo: ESTATUS_DOCUMENTO.EN_REVISION,
    observacion: construirObservacionCarga(estatusAnterior, documentoActual) + ' (' + contexto.proceso.nombre + ')'
  });
  const expediente = actualizarEstatusInscripcion(contexto, estudiante, documentos);

  return {
    ok: true,
    mensaje: 'Documento cargado. Queda en revisión por el dictaminador.',
    expediente: expediente,
    // Uso interno: procesarCargaDocumento lo manda a la papelera y lo quita.
    urlArchivoReemplazado: urlArchivoReemplazado !== urlArchivo ? urlArchivoReemplazado : ''
  };
}

/**
 * Manda a la papelera el archivo anterior de un documento. Si falla, solo se
 * registra: la carga nueva ya quedo guardada y es lo que importa al alumno.
 */
function descartarArchivoPorUrl(urlArchivo) {
  try {
    abrirArchivoDrive(urlArchivo).setTrashed(true);
  } catch (error) {
    console.error('No se pudo descartar el archivo reemplazado ' + urlArchivo + ': ' + error.message);
  }
}

/**
 * Manda a la papelera un archivo que no llego a registrarse en la hoja.
 */
function descartarArchivo(archivoDrive) {
  try {
    archivoDrive.setTrashed(true);
  } catch (error) {
    console.error('No se pudo descartar el archivo huerfano ' + archivoDrive.getId() + ': ' + error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Funciones auxiliares del estudiante                                */
/* ------------------------------------------------------------------ */

/**
 * Localiza al estudiante por su correo institucional. Si no fue importado
 * por el Administrador, el acceso al panel no puede continuar.
 */
function obtenerEstudiantePorCorreo(correoInstitucional) {
  const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'correo_institucional', correoInstitucional);
  if (!estudiante) {
    throw crearError(
      'NO_REGISTRADO',
      'Tu correo institucional no aparece en la lista de estudiantes. Contacta a Servicios Escolares.'
    );
  }
  return estudiante;
}

/**
 * Resuelve el estudiante de la operacion. El Administrador puede operar
 * sobre cualquier matricula indicada de forma explicita; el Estudiante solo
 * sobre su propio registro.
 */
function obtenerEstudianteParaUsuario(usuario, matriculaSolicitada) {
  if (usuario.rol !== ROLES.ADMINISTRADOR) {
    return obtenerEstudiantePorCorreo(usuario.correo);
  }
  const matricula = String(matriculaSolicitada === undefined || matriculaSolicitada === null ? '' : matriculaSolicitada).trim();
  if (!matricula) {
    throw crearError(
      'VALIDACION',
      'El Administrador debe indicar la matricula del estudiante sobre el que desea operar.'
    );
  }
  const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'matricula', matricula);
  if (!estudiante) {
    throw crearError('NO_REGISTRADO', 'No existe un estudiante con la matricula ' + matricula + '.');
  }
  return estudiante;
}

/**
 * Convierte una fila de Estudiantes en datos seguros para la vista.
 */
function convertirEstudianteParaVista(estudiante) {
  return {
    matricula: String(estudiante.matricula || ''),
    nombre: String(estudiante.nombre || ''),
    correo_institucional: String(estudiante.correo_institucional || ''),
    correo_personal: String(estudiante.correo_personal || ''),
    telefono: String(estudiante.telefono || ''),
    carrera: String(estudiante.carrera || ''),
    generacion: String(estudiante.generacion || ''),
    estatus_general: String(estudiante.estatus_general || '')
  };
}

/**
 * Normaliza el estatus y tolera el alias Rechazado como Observado.
 */
function normalizarEstatusDocumento(valor) {
  const texto = String(valor === undefined || valor === null ? '' : valor).trim();
  const validos = [
    ESTATUS_DOCUMENTO.PENDIENTE,
    ESTATUS_DOCUMENTO.EN_REVISION,
    ESTATUS_DOCUMENTO.APROBADO,
    ESTATUS_DOCUMENTO.OBSERVADO
  ];
  if (validos.indexOf(texto) !== -1) {
    return texto;
  }
  if (texto.toLowerCase() === ESTATUS_RECHAZADO_ALIAS.toLowerCase()) {
    return ESTATUS_DOCUMENTO.OBSERVADO;
  }
  return ESTATUS_DOCUMENTO.PENDIENTE;
}

/**
 * Explica por que el estudiante no puede subir el documento en su estatus actual.
 */
function obtenerMotivoBloqueo(estatus) {
  if (estatus === ESTATUS_DOCUMENTO.APROBADO) {
    return 'Documento aprobado: no se puede reemplazar.';
  }
  if (estatus === ESTATUS_DOCUMENTO.EN_REVISION) {
    return 'Documento en revision: espera el dictamen del dictaminador.';
  }
  return '';
}

/**
 * Impide cargas cuando el documento ya fue aprobado o esta en revision.
 */
function validarEstatusParaCarga(estatus) {
  if (estatus === ESTATUS_DOCUMENTO.APROBADO) {
    throw crearError('VALIDACION', 'El documento ya fue aprobado y no se puede reemplazar (RF-14).');
  }
  if (estatus === ESTATUS_DOCUMENTO.EN_REVISION) {
    throw crearError('VALIDACION', 'El documento ya esta en revision. Espera el dictamen del dictaminador.');
  }
}

/**
 * Filas de Documentos de una sola matricula, sin leer la hoja completa
 * (con miles de alumnos la lectura completa alargaba el bloqueo).
 */
function leerDocumentosDeEstudiante(matricula) {
  return buscarFilasPorValor(HOJAS.DOCUMENTOS, 'matricula', matricula);
}

/**
 * Valida el tipo de documento recibido y regresa su nombre canonico.
 */
function obtenerTipoDocumentoValido(valor) {
  const buscado = String(valor || '').trim().toLowerCase();
  const encontrado = TIPOS_DOCUMENTO.find(function (tipo) {
    return tipo.toLowerCase() === buscado;
  });
  if (!encontrado) {
    throw crearError('VALIDACION', 'Tipo de documento no valido. Debe ser: ' + TIPOS_DOCUMENTO.join(', ') + '.');
  }
  return encontrado;
}

/**
 * Valida extension, contenido, tamano y firma binaria del archivo (RF-09,
 * RF-10). tiposPermitidos son los formatos del documento en el catalogo.
 */
function prepararArchivoParaCarga(datos, tiposPermitidos) {
  const nombreArchivo = String(datos.nombreArchivo || '').trim();
  const extension = normalizarExtension(obtenerExtensionArchivo(nombreArchivo));
  if (!extension || tiposPermitidos.indexOf(extension) === -1) {
    throw crearError('VALIDACION', 'Formato no permitido. Solo se aceptan: ' + tiposPermitidos.join(', ') + '.');
  }

  const contenido = String(datos.contenidoBase64 || '').replace(/\s+/g, '');
  if (!contenido) {
    throw crearError('VALIDACION', 'El archivo esta vacio o no se pudo leer.');
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(contenido);
  } catch (error) {
    throw crearError('VALIDACION', 'El contenido del archivo no es valido.');
  }
  if (!bytes || !bytes.length) {
    throw crearError('VALIDACION', 'El archivo esta vacio.');
  }

  const maximoBytes = obtenerTamanoMaximoMb() * BYTES_POR_MEGABYTE;
  if (bytes.length > maximoBytes) {
    throw crearError('VALIDACION', 'El archivo supera el tamano maximo de ' + obtenerTamanoMaximoMb() + ' MB.');
  }

  validarFirmaArchivo(extension, bytes);
  return {
    extension: extension,
    mime: TIPOS_MIME_ARCHIVO[extension],
    bytes: bytes
  };
}

/**
 * Confirma que los primeros bytes correspondan al formato declarado.
 */
function validarFirmaArchivo(extension, bytes) {
  const firma = FIRMAS_ARCHIVO[extension];
  if (!firma) {
    return;
  }
  if (bytes.length < firma.length) {
    throw crearError('VALIDACION', 'El archivo no corresponde al formato ' + extension + '.');
  }
  for (let i = 0; i < firma.length; i++) {
    if ((Number(bytes[i]) & 0xFF) !== firma[i]) {
      throw crearError('VALIDACION', 'El archivo no corresponde al formato ' + extension + '.');
    }
  }
}

/**
 * JPEG y JPG son el mismo formato; el catalogo usa JPG.
 */
function normalizarExtension(extension) {
  return extension === 'JPEG' ? 'JPG' : extension;
}

/**
 * Devuelve la extension en mayusculas a partir del nombre del archivo.
 */
function obtenerExtensionArchivo(nombreArchivo) {
  const partes = String(nombreArchivo || '').split('.');
  if (partes.length < 2) {
    return '';
  }
  return partes.pop().trim().toUpperCase();
}

/**
 * Tamano maximo vigente en MB, acotado al rango permitido (RF-10).
 */
function obtenerTamanoMaximoMb() {
  const valor = Number(obtenerValorConfiguracion('TAMANIO_MAXIMO_ARCHIVO_MB'));
  const predeterminado = Number(CONFIGURACION_PREDETERMINADA.TAMANIO_MAXIMO_ARCHIVO_MB);
  if (isNaN(valor) || valor < RANGO_TAMANIO_ARCHIVO_MB.MINIMO || valor > RANGO_TAMANIO_ARCHIVO_MB.MAXIMO) {
    return predeterminado;
  }
  return valor;
}

/**
 * Valida el telefono capturado por el estudiante (RF-08).
 */
function validarTelefonoEstudiante(telefono) {
  if (telefono && !/^[0-9+\-() ]{5,20}$/.test(telefono)) {
    throw crearError('VALIDACION', 'El telefono debe tener entre 5 y 20 caracteres numericos, espacios, guiones o parentesis.');
  }
}

/**
 * Valida el correo personal capturado por el estudiante (RF-08).
 */
function validarCorreoPersonalEstudiante(correo) {
  if (!correo) {
    return;
  }
  if (correo.length > 120 || !esCorreoValido(correo)) {
    throw crearError('VALIDACION', 'El correo personal no tiene un formato valido.');
  }
}

/**
 * Texto de auditoria para la carga de un documento.
 */
function construirObservacionCarga(estatusAnterior, documentoActual) {
  const observacionAnterior = documentoActual
    ? String(documentoActual.observaciones || '').trim()
    : '';
  if (estatusAnterior === ESTATUS_DOCUMENTO.OBSERVADO && observacionAnterior) {
    return 'Recarga tras observacion: ' + observacionAnterior.slice(0, 200);
  }
  return 'Carga de documento por el estudiante';
}

/* ------------------------------------------------------------------ */
/* RF-33: nombre del archivo (las carpetas viven en ServicioCarpetas)  */
/* ------------------------------------------------------------------ */

/**
 * Construye el nombre matricula_tipoDocumento_fecha.extension (RF-33).
 */
function construirNombreArchivo(matricula, tipoDocumento, extension) {
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  return limpiarSegmentoNombre(matricula) + '_' +
    limpiarSegmentoNombre(tipoDocumento) + '_' +
    fecha + '.' + String(extension || '').toLowerCase();
}

/**
 * Quita acentos, espacios y caracteres no seguros de un nombre de archivo
 * ("Fotografía digital" -> "Fotografia_digital").
 */
function limpiarSegmentoNombre(valor) {
  const limpio = String(valor === undefined || valor === null ? '' : valor)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return limpio || 'documento';
}
