/**
 * ServicioDictaminador.js
 * Panel del Dictaminador: consulta de expedientes por tramite (RF-15 a
 * RF-17), aprobacion u observacion de documentos (RF-18 a RF-21),
 * solicitud de actualizacion de un documento reutilizado y notificaciones
 * al estudiante (RF-27 y RF-28).
 * Toda escritura en Sheets ocurre dentro de conBloqueoEscritura (RNF-03).
 */

/* ------------------------------------------------------------------ */
/* RF-15 y RF-16: tabla y filtros de expedientes                      */
/* ------------------------------------------------------------------ */

/**
 * Devuelve los expedientes de un tramite visibles para el dictaminador.
 * Filtros: idProceso (sin valor = el primero encendido), texto (matricula
 * o nombre), carrera y estatus del expediente.
 */
function apiObtenerExpedientesDictaminador(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.DICTAMINADOR]);
    const filtros = datos || {};
    const procesos = leerProcesos();
    const proceso = resolverProcesoElegido(filtros.idProceso, procesos);
    const opciones = construirOpcionesProceso(procesos, proceso);
    if (!proceso) {
      return Object.assign({ ok: true, total: 0, expedientes: [], carreras: [] }, opciones);
    }
    const filas = construirExpedientesDeProceso(proceso, leerRequisitos(proceso.id_proceso));
    const expedientes = filas.map(function (fila) { return fila.expediente; });
    const filtrados = expedientes.filter(function (expediente) {
      return coincideFiltrosExpediente(expediente, filtros);
    });
    return Object.assign({
      ok: true,
      total: filtrados.length,
      expedientes: filtrados,
      carreras: obtenerCarrerasRegistradas(expedientes)
    }, opciones);
  });
}

/**
 * Devuelve el expediente de un alumno en un tramite (RF-17).
 */
function apiObtenerExpedienteDictaminador(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.DICTAMINADOR]);
    const estudiante = obtenerEstudianteObligatorio(datos && datos.matricula);
    const contexto = obtenerContextoProceso(estudiante.matricula, datos && datos.idProceso, false);
    const expediente = construirExpedienteProceso(contexto.proceso, contexto.requisitos, estudiante, contexto.inscripcion,
      leerDocumentosDeEstudiante(estudiante.matricula));
    return { ok: true, expediente: expediente };
  });
}

function obtenerEstudianteObligatorio(matriculaRecibida) {
  const matricula = String(matriculaRecibida || '').trim();
  if (!matricula) {
    throw crearError('VALIDACION', 'Debes indicar la matricula del expediente.');
  }
  const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'matricula', matricula);
  if (!estudiante) {
    throw crearError('NO_REGISTRADO', 'No existe un estudiante con la matricula ' + matricula + '.');
  }
  return estudiante;
}

/* ------------------------------------------------------------------ */
/* RF-18 a RF-21: dictamen de documentos                              */
/* ------------------------------------------------------------------ */

/**
 * Aprueba u observa un documento que el alumno subio en el tramite. Valida
 * el estatus y la version que el dictaminador tenia a la vista para evitar
 * sobrescrituras (RF-21).
 */
function apiDictaminarDocumento(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.DICTAMINADOR]);
    const estatusNuevo = normalizarEstatusDocumento(datos && datos.estatusNuevo);
    const observacion = String((datos && datos.observacion) || '').trim();
    const estatusEsperado = String((datos && datos.estatusEsperado) || '').trim();
    const fechaCargaEsperada = String((datos && datos.fechaCargaEsperada) || '').trim();

    if (ESTATUS_DICTAMEN_PERMITIDOS.indexOf(estatusNuevo) === -1) {
      throw crearError('VALIDACION', 'El dictamen debe ser Aprobado u Observado.');
    }
    validarObservacion(observacion, estatusNuevo === ESTATUS_DOCUMENTO.OBSERVADO);

    const resultado = conBloqueoEscritura(function () {
      const estudiante = obtenerEstudianteObligatorio(datos && datos.matricula);
      const contexto = obtenerContextoProceso(estudiante.matricula, datos && datos.idProceso, false);
      const requisito = obtenerRequisito(contexto, datos && datos.tipoDocumento);
      const documentos = leerDocumentosDeEstudiante(estudiante.matricula);
      const resuelto = resolverRequisito(requisito, contexto.proceso, documentos);
      if (resuelto.origen !== ORIGEN_DOCUMENTO.PROPIO) {
        throw crearError('CONFLICTO', 'El alumno no ha cargado ' + requisito.tipo_documento + ' en este trámite. Actualiza el expediente.');
      }
      const documento = resuelto.registro;
      const estatusActual = normalizarEstatusDocumento(documento.estatus);
      if (estatusActual !== ESTATUS_DOCUMENTO.EN_REVISION) {
        throw crearError('CONFLICTO', 'El documento ya no esta en revision. Actualiza el expediente.');
      }
      if (estatusEsperado && estatusActual !== normalizarEstatusDocumento(estatusEsperado)) {
        throw crearError('CONFLICTO', 'Otro dictaminador modifico el documento. Actualiza el expediente.');
      }
      if (fechaCargaEsperada && convertirFechaTexto(documento.fecha_carga) !== fechaCargaEsperada) {
        throw crearError('CONFLICTO', 'El estudiante reemplazo el documento. Actualiza el expediente.');
      }

      const cambios = {
        estatus: estatusNuevo,
        observaciones: observacion,
        fecha_dictamen: new Date(),
        dictaminador: usuario.correo
      };
      actualizarRegistro(HOJAS.DOCUMENTOS, documento._fila, cambios);
      Object.assign(documento, cambios);

      registrarEnHistorial({
        usuario: usuario.correo,
        matricula: String(estudiante.matricula),
        tipo_documento: requisito.tipo_documento,
        estatus_anterior: estatusActual,
        estatus_nuevo: estatusNuevo,
        observacion: (observacion || (estatusNuevo === ESTATUS_DOCUMENTO.APROBADO ? 'Documento aprobado' : '')) +
          ' (' + contexto.proceso.nombre + ')'
      });

      return {
        estudiante: estudiante,
        tipoDocumento: requisito.tipo_documento,
        expediente: actualizarEstatusInscripcion(contexto, estudiante, documentos)
      };
    });

    const expedienteCompleto = resultado.expediente.estatus === ESTATUS_EXPEDIENTE.COMPLETO;
    let notificacion = null;
    if (estatusNuevo === ESTATUS_DOCUMENTO.OBSERVADO) {
      notificacion = notificarDocumentoObservado(resultado.estudiante, resultado.expediente, resultado.tipoDocumento, observacion, usuario);
    } else if (expedienteCompleto) {
      notificacion = notificarExpedienteCompleto(resultado.estudiante, resultado.expediente);
    }

    return {
      ok: true,
      mensaje: construirMensajeDictamen(estatusNuevo, expedienteCompleto, notificacion),
      notificado: Boolean(notificacion && notificacion.enviado),
      expediente: resultado.expediente
    };
  });
}

/**
 * Pide al alumno que vuelva a subir un documento que el tramite tomo de su
 * expediente (por ejemplo, un acta poco legible para titulacion). Se crea
 * en este tramite un registro Observado sin archivo: el alumno ve la
 * observacion y la carga se le abre solo para ese documento.
 */
function apiSolicitarActualizacionDocumento(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.DICTAMINADOR]);
    const observacion = String((datos && datos.observacion) || '').trim();
    validarObservacion(observacion, true);

    const resultado = conBloqueoEscritura(function () {
      const estudiante = obtenerEstudianteObligatorio(datos && datos.matricula);
      const contexto = obtenerContextoProceso(estudiante.matricula, datos && datos.idProceso, false);
      const requisito = obtenerRequisito(contexto, datos && datos.tipoDocumento);
      const documentos = leerDocumentosDeEstudiante(estudiante.matricula);
      if (resolverRequisito(requisito, contexto.proceso, documentos).origen !== ORIGEN_DOCUMENTO.REUTILIZADO) {
        throw crearError('CONFLICTO', 'Este documento ya no se toma del expediente del alumno. Actualiza el expediente.');
      }
      const registro = {
        id_documento: generarId(PREFIJOS_ID.DOCUMENTO),
        matricula: String(estudiante.matricula),
        tipo_documento: requisito.tipo_documento,
        url_archivo: '',
        estatus: ESTATUS_DOCUMENTO.OBSERVADO,
        observaciones: observacion,
        fecha_carga: '',
        fecha_dictamen: new Date(),
        dictaminador: usuario.correo,
        id_proceso: contexto.proceso.id_proceso,
        fecha_emision: ''
      };
      insertarRegistros(HOJAS.DOCUMENTOS, [registro]);
      documentos.push(registro);
      registrarEnHistorial({
        usuario: usuario.correo,
        matricula: String(estudiante.matricula),
        tipo_documento: requisito.tipo_documento,
        estatus_anterior: ESTATUS_DOCUMENTO.APROBADO,
        estatus_nuevo: ESTATUS_DOCUMENTO.OBSERVADO,
        observacion: 'Se pidió actualizar el documento del expediente: ' + observacion + ' (' + contexto.proceso.nombre + ')'
      });
      return {
        estudiante: estudiante,
        tipoDocumento: requisito.tipo_documento,
        expediente: actualizarEstatusInscripcion(contexto, estudiante, documentos)
      };
    });

    const notificacion = notificarDocumentoObservado(resultado.estudiante, resultado.expediente, resultado.tipoDocumento, observacion, usuario);
    return {
      ok: true,
      mensaje: construirMensajeDictamen(ESTATUS_DOCUMENTO.OBSERVADO, false, notificacion),
      notificado: notificacion.enviado,
      expediente: resultado.expediente
    };
  });
}

function validarObservacion(observacion, obligatoria) {
  if (observacion.length > LONGITUD_MAXIMA_OBSERVACION) {
    throw crearError('VALIDACION', 'La observacion no puede superar ' + LONGITUD_MAXIMA_OBSERVACION + ' caracteres.');
  }
  if (obligatoria && !observacion) {
    throw crearError('VALIDACION', 'La observacion es obligatoria cuando el documento se marca como Observado.');
  }
}

/* ------------------------------------------------------------------ */
/* Mensajes y filtros                                                  */
/* ------------------------------------------------------------------ */

/**
 * Arma el mensaje para el dictaminador, incluyendo por que no salio el
 * correo cuando falla, para que pueda avisar al estudiante por otro medio.
 */
function construirMensajeDictamen(estatusNuevo, expedienteCompleto, notificacion) {
  const motivo = notificacion && !notificacion.enviado ? ' No se envió el correo: ' + notificacion.motivo : '';
  if (estatusNuevo === ESTATUS_DOCUMENTO.OBSERVADO) {
    return motivo ? 'Documento observado.' + motivo : 'Documento observado. Se notificó al estudiante.';
  }
  if (!expedienteCompleto) {
    return 'Documento aprobado.';
  }
  return motivo
    ? 'Documento aprobado. El expediente quedó completo.' + motivo
    : 'Documento aprobado. El expediente quedó completo y se notificó al estudiante.';
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
 * Devuelve las carreras presentes en los expedientes del tramite.
 */
function obtenerCarrerasRegistradas(expedientes) {
  const carreras = {};
  expedientes.forEach(function (expediente) {
    const carrera = String(expediente.carrera || '').trim();
    if (carrera) {
      carreras[carrera] = true;
    }
  });
  return Object.keys(carreras).sort(function (a, b) {
    return a.localeCompare(b);
  });
}
