/**
 * ServicioDictaminador.js
 * Panel del Dictaminador: consulta de expedientes (RF-15 a RF-17),
 * aprobacion u observacion de documentos (RF-18 a RF-21) y notificaciones
 * al estudiante (RF-27 y RF-28).
 * Toda escritura en Sheets ocurre dentro de conBloqueoEscritura (RNF-03).
 */

/* ------------------------------------------------------------------ */
/* RF-15 y RF-16: tabla y filtros de expedientes                      */
/* ------------------------------------------------------------------ */

/**
 * Devuelve los expedientes visibles para el dictaminador.
 * Filtros: texto (matricula o nombre), carrera y estatus del expediente.
 */
function apiObtenerExpedientesDictaminador(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.DICTAMINADOR]);
    const estudiantes = leerHoja(HOJAS.ESTUDIANTES);
    const documentos = leerHoja(HOJAS.DOCUMENTOS);
    const filtros = datos || {};
    const expedientes = construirExpedientes(estudiantes, documentos)
      .filter(function (expediente) {
        return coincideFiltrosExpediente(expediente, filtros);
      });
    return {
      ok: true,
      total: expedientes.length,
      expedientes: expedientes,
      carreras: obtenerCarrerasRegistradas(estudiantes)
    };
  });
}

/**
 * Devuelve un expediente completo por matricula (RF-17).
 */
function apiObtenerExpedienteDictaminador(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.DICTAMINADOR]);
    const matricula = String((datos && datos.matricula) || '').trim();
    if (!matricula) {
      throw crearError('VALIDACION', 'Debes indicar la matricula del expediente.');
    }
    const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'matricula', matricula);
    if (!estudiante) {
      throw crearError('NO_REGISTRADO', 'No existe un estudiante con la matricula ' + matricula + '.');
    }
    const expediente = construirExpedientes([estudiante], leerHoja(HOJAS.DOCUMENTOS))[0];
    return { ok: true, expediente: expediente };
  });
}

/* ------------------------------------------------------------------ */
/* RF-18 a RF-21: dictamen de documentos                              */
/* ------------------------------------------------------------------ */

/**
 * Aprueba u observa un documento. Valida el estatus y la version que el
 * dictaminador tenia a la vista para evitar sobrescrituras (RF-21).
 */
function apiDictaminarDocumento(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.DICTAMINADOR]);
    const matricula = String((datos && datos.matricula) || '').trim();
    const tipoDocumento = obtenerTipoDocumentoValido(datos && datos.tipoDocumento);
    const estatusNuevo = normalizarEstatusDocumento(datos && datos.estatusNuevo);
    const observacion = String((datos && datos.observacion) || '').trim();
    const estatusEsperado = String((datos && datos.estatusEsperado) || '').trim();
    const fechaCargaEsperada = String((datos && datos.fechaCargaEsperada) || '').trim();

    if (!matricula) {
      throw crearError('VALIDACION', 'Debes indicar la matricula del expediente.');
    }
    if (ESTATUS_DICTAMEN_PERMITIDOS.indexOf(estatusNuevo) === -1) {
      throw crearError('VALIDACION', 'El dictamen debe ser Aprobado u Observado.');
    }
    if (observacion.length > LONGITUD_MAXIMA_OBSERVACION) {
      throw crearError('VALIDACION', 'La observacion no puede superar ' + LONGITUD_MAXIMA_OBSERVACION + ' caracteres.');
    }
    if (estatusNuevo === ESTATUS_DOCUMENTO.OBSERVADO && !observacion) {
      throw crearError('VALIDACION', 'La observacion es obligatoria cuando el documento se marca como Observado.');
    }

    const resultado = conBloqueoEscritura(function () {
      const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'matricula', matricula);
      if (!estudiante) {
        throw crearError('NO_REGISTRADO', 'No existe un estudiante con la matricula ' + matricula + '.');
      }
      const documento = buscarDocumentoDeEstudiante(matricula, tipoDocumento);
      if (!documento) {
        throw crearError('VALIDACION', 'El estudiante no tiene cargado el documento ' + tipoDocumento + '.');
      }

      const estatusActual = normalizarEstatusDocumento(documento.estatus);
      const fechaCargaActual = convertirFechaTexto(documento.fecha_carga);
      if (estatusActual !== ESTATUS_DOCUMENTO.EN_REVISION) {
        throw crearError('CONFLICTO', 'El documento ya no esta en revision. Actualiza el expediente.');
      }
      if (estatusEsperado && estatusActual !== normalizarEstatusDocumento(estatusEsperado)) {
        throw crearError('CONFLICTO', 'Otro dictaminador modifico el documento. Actualiza el expediente.');
      }
      if (fechaCargaEsperada && fechaCargaActual !== fechaCargaEsperada) {
        throw crearError('CONFLICTO', 'El estudiante reemplazo el documento. Actualiza el expediente.');
      }

      const cambios = {
        estatus: estatusNuevo,
        observaciones: observacion,
        fecha_dictamen: new Date(),
        dictaminador: usuario.correo
      };
      actualizarRegistro(HOJAS.DOCUMENTOS, documento._fila, cambios);
      const documentoActualizado = Object.assign({}, documento, cambios);

      registrarEnHistorial({
        usuario: usuario.correo,
        matricula: String(estudiante.matricula),
        tipo_documento: tipoDocumento,
        estatus_anterior: estatusActual,
        estatus_nuevo: estatusNuevo,
        observacion: observacion || (estatusNuevo === ESTATUS_DOCUMENTO.APROBADO ? 'Documento aprobado' : '')
      });

      const expediente = construirExpedientes([estudiante], leerHoja(HOJAS.DOCUMENTOS))[0];
      return {
        estudiante: estudiante,
        documento: documentoActualizado,
        expediente: expediente
      };
    });

    let notificado = false;
    if (estatusNuevo === ESTATUS_DOCUMENTO.OBSERVADO) {
      notificado = notificarDocumentoObservado(resultado.estudiante, tipoDocumento, observacion, usuario);
    } else if (resultado.expediente.estatus === ESTATUS_EXPEDIENTE.COMPLETO) {
      notificado = notificarExpedienteCompleto(resultado.estudiante);
    }

    const mensaje = estatusNuevo === ESTATUS_DOCUMENTO.APROBADO
      ? (resultado.expediente.estatus === ESTATUS_EXPEDIENTE.COMPLETO
        ? (notificado
          ? 'Documento aprobado. El expediente quedo completo y se notifico al estudiante.'
          : 'Documento aprobado. El expediente quedo completo, pero no se pudo enviar el correo.')
        : 'Documento aprobado.')
      : (notificado
        ? 'Documento observado. Se notifico al estudiante.'
        : 'Documento observado. No se pudo enviar el correo; revisa la cuota de MailApp.');

    return {
      ok: true,
      mensaje: mensaje,
      notificado: notificado,
      documento: convertirDocumentoDictamen(resultado.documento, tipoDocumento),
      expediente: resultado.expediente
    };
  });
}

/* ------------------------------------------------------------------ */
/* Construccion de expedientes para la vista                          */
/* ------------------------------------------------------------------ */

/**
 * Agrupa estudiantes y documentos en la estructura que consume el panel.
 */
function construirExpedientes(estudiantes, documentos) {
  const ultimos = obtenerUltimaVersionPorTipo(documentos);
  const documentosPorMatricula = {};
  Object.keys(ultimos).forEach(function (clave) {
    const documento = ultimos[clave];
    const matricula = String(documento.matricula || '').trim().toLowerCase();
    if (!documentosPorMatricula[matricula]) {
      documentosPorMatricula[matricula] = [];
    }
    documentosPorMatricula[matricula].push(documento);
  });

  return estudiantes.map(function (estudiante) {
    const matricula = String(estudiante.matricula || '').trim();
    return construirExpedienteParaVista(estudiante, documentosPorMatricula[matricula.toLowerCase()] || []);
  });
}

/**
 * Calcula conteos y estatus general de un expediente.
 */
function construirExpedienteParaVista(estudiante, documentos) {
  const porTipo = {};
  documentos.forEach(function (documento) {
    porTipo[String(documento.tipo_documento || '').trim().toLowerCase()] = documento;
  });

  const documentosVista = TIPOS_DOCUMENTO.map(function (tipo) {
    return convertirDocumentoDictamen(porTipo[tipo.toLowerCase()] || null, tipo);
  });

  const conteos = {
    pendientes: 0,
    enRevision: 0,
    aprobados: 0,
    observados: 0
  };
  documentosVista.forEach(function (documento) {
    if (documento.estatus === ESTATUS_DOCUMENTO.PENDIENTE) conteos.pendientes++;
    if (documento.estatus === ESTATUS_DOCUMENTO.EN_REVISION) conteos.enRevision++;
    if (documento.estatus === ESTATUS_DOCUMENTO.APROBADO) conteos.aprobados++;
    if (documento.estatus === ESTATUS_DOCUMENTO.OBSERVADO) conteos.observados++;
  });

  let estatus = ESTATUS_EXPEDIENTE.PENDIENTE;
  if (conteos.observados > 0) {
    estatus = ESTATUS_EXPEDIENTE.OBSERVADO;
  } else if (conteos.enRevision > 0) {
    estatus = ESTATUS_EXPEDIENTE.EN_REVISION;
  } else if (conteos.aprobados === documentosVista.length) {
    estatus = ESTATUS_EXPEDIENTE.COMPLETO;
  }

  return {
    matricula: String(estudiante.matricula || ''),
    nombre: String(estudiante.nombre || ''),
    correo_institucional: String(estudiante.correo_institucional || ''),
    carrera: String(estudiante.carrera || ''),
    generacion: String(estudiante.generacion || ''),
    estatus: estatus,
    conteos: conteos,
    totalDocumentos: documentosVista.length,
    documentos: documentosVista
  };
}

/**
 * Convierte una fila de Documentos en datos seguros para el panel.
 */
function convertirDocumentoDictamen(registro, tipoDocumento) {
  const fila = registro || {};
  const estatus = normalizarEstatusDocumento(fila.estatus);
  const urlArchivo = String(fila.url_archivo || '');
  return {
    id_documento: String(fila.id_documento || ''),
    tipo_documento: String(fila.tipo_documento || tipoDocumento || ''),
    url_archivo: urlArchivo,
    url_vista_previa: construirUrlVistaPrevia(urlArchivo),
    estatus: estatus,
    observaciones: String(fila.observaciones === undefined || fila.observaciones === null ? '' : fila.observaciones).trim(),
    fecha_carga: convertirFechaTexto(fila.fecha_carga),
    fecha_dictamen: convertirFechaTexto(fila.fecha_dictamen),
    dictaminador: String(fila.dictaminador || ''),
    puedeDictaminar: estatus === ESTATUS_DOCUMENTO.EN_REVISION
  };
}

/**
 * Convierte una URL de Drive en una URL apta para el visor incrustado.
 */
function construirUrlVistaPrevia(urlArchivo) {
  const url = String(urlArchivo || '').trim();
  if (!url) {
    return '';
  }
  const porRuta = url.match(/\/d\/([A-Za-z0-9_-]+)/);
  const porParametro = url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  const identificador = porRuta ? porRuta[1] : (porParametro ? porParametro[1] : '');
  return identificador ? 'https://drive.google.com/file/d/' + identificador + '/preview' : url;
}

/**
 * Aplica los filtros del formulario sobre los expedientes.
 */
function coincideFiltrosExpediente(expediente, filtros) {
  const texto = String((filtros && filtros.texto) || '').trim().toLowerCase();
  const carrera = String((filtros && filtros.carrera) || '').trim().toLowerCase();
  const estatus = String((filtros && filtros.estatus) || '').trim();

  if (texto) {
    const base = (String(expediente.matricula) + ' ' + String(expediente.nombre)).toLowerCase();
    if (base.indexOf(texto) === -1) {
      return false;
    }
  }
  if (carrera && String(expediente.carrera).toLowerCase() !== carrera) {
    return false;
  }
  if (estatus && String(expediente.estatus) !== estatus) {
    return false;
  }
  return true;
}

/**
 * Devuelve las carreras presentes en la lista de estudiantes.
 */
function obtenerCarrerasRegistradas(estudiantes) {
  const carreras = {};
  estudiantes.forEach(function (estudiante) {
    const carrera = String(estudiante.carrera || '').trim();
    if (carrera) {
      carreras[carrera] = true;
    }
  });
  return Object.keys(carreras).sort(function (a, b) {
    return a.localeCompare(b);
  });
}
