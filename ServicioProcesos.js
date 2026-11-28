/**
 * ServicioProcesos.js
 * Tramites que el Administrador enciende o apaga (nuevo ingreso, titulacion
 * de TSU, titulacion de ING/LIC...). Cada proceso tiene:
 *   - requisitos: los documentos que pide y si se pueden reutilizar;
 *   - alumnos habilitados: solo ellos lo ven, y solo mientras esta activo;
 *   - fechas de apertura y cierre: fuera de ellas el alumno ve su estatus
 *     pero no puede subir archivos.
 * Los documentos pertenecen al alumno (hoja Documentos) y recuerdan en que
 * proceso se subieron, para reutilizarlos en tramites posteriores sin
 * pedirlos otra vez.
 */

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

/**
 * Convierte un valor de la hoja o del navegador (Date o "aaaa-mm-dd") en
 * Date, o null si esta vacio o no es una fecha.
 */
function convertirAFecha(valor) {
  if (valor instanceof Date) {
    return isNaN(valor.getTime()) ? null : valor;
  }
  const texto = String(valor === undefined || valor === null ? '' : valor).trim();
  if (!texto) {
    return null;
  }
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(texto) ? parsearFechaSolo(texto) : new Date(texto);
  return isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * "aaaa-mm-dd" en la zona horaria del script; asi el navegador no recorre
 * la fecha un dia por la diferencia horaria.
 */
function formatearFechaSolo(valor) {
  const fecha = convertirAFecha(valor);
  return fecha ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

function restarMeses(fecha, meses) {
  const resultado = new Date(fecha.getTime());
  resultado.setMonth(resultado.getMonth() - meses);
  return resultado;
}

function momentoDeDictamen(documento) {
  const fecha = convertirAFecha(documento.fecha_dictamen) || convertirAFecha(documento.fecha_carga);
  return fecha ? fecha.getTime() : 0;
}

/* ------------------------------------------------------------------ */
/* Lectura de procesos, requisitos y alumnos habilitados               */
/* ------------------------------------------------------------------ */

function convertirProceso(fila) {
  return {
    id_proceso: String(fila.id_proceso || '').trim(),
    nombre: String(fila.nombre || '').trim(),
    activo: esUsuarioActivo(fila.activo),
    fecha_apertura: convertirAFecha(fila.fecha_apertura),
    fecha_cierre: convertirAFecha(fila.fecha_cierre),
    _fila: fila._fila
  };
}

/**
 * Procesos que ve el personal; el de la prueba de carga queda oculto.
 */
function leerProcesos() {
  return leerHoja(HOJAS.PROCESOS).map(convertirProceso).filter(function (proceso) {
    return proceso.id_proceso && proceso.id_proceso !== ID_PROCESO_PRUEBA;
  });
}

/**
 * Proceso por id (incluido el de prueba) o error claro.
 */
function obtenerProceso(idProceso) {
  const id = String(idProceso === undefined || idProceso === null ? '' : idProceso).trim();
  const fila = id ? buscarPorClave(HOJAS.PROCESOS, 'id_proceso', id) : null;
  if (!fila) {
    throw crearError('NO_REGISTRADO', 'El trámite indicado no existe.');
  }
  return convertirProceso(fila);
}

/**
 * Documento del catalogo por nombre (sin distinguir mayusculas), o null.
 */
function obtenerTipoCatalogo(tipo) {
  const buscado = String(tipo || '').trim().toLowerCase();
  return CATALOGO_DOCUMENTOS.find(function (documento) {
    return documento.tipo.toLowerCase() === buscado;
  }) || null;
}

function normalizarRegla(valor) {
  const regla = String(valor || '').trim().toUpperCase();
  return REGLAS_REUTILIZACION[regla] ? regla : REGLAS_REUTILIZACION.NUEVO;
}

function convertirRequisito(fila) {
  const catalogo = obtenerTipoCatalogo(fila.tipo_documento);
  const vigencia = Math.max(0, Math.floor(Number(fila.vigencia_meses) || 0));
  return catalogo ? {
    tipo_documento: catalogo.tipo,
    regla: normalizarRegla(fila.regla),
    vigencia_meses: vigencia,
    orden: Number(fila.orden) || 0
  } : null;
}

/**
 * Requisitos agrupados por proceso con una sola lectura de la hoja.
 */
function leerRequisitosPorProceso() {
  const porProceso = {};
  leerHoja(HOJAS.REQUISITOS_PROCESO).forEach(function (fila) {
    const id = String(fila.id_proceso || '').trim();
    const requisito = convertirRequisito(fila);
    if (id && requisito) {
      porProceso[id] = porProceso[id] || [];
      porProceso[id].push(requisito);
    }
  });
  Object.keys(porProceso).forEach(function (id) {
    porProceso[id].sort(function (a, b) { return a.orden - b.orden; });
  });
  return porProceso;
}

function leerRequisitos(idProceso) {
  return leerRequisitosPorProceso()[idProceso] || [];
}

function convertirInscripcion(fila) {
  return {
    id_proceso: String(fila.id_proceso || '').trim(),
    matricula: String(fila.matricula || '').trim(),
    carrera: String(fila.carrera || '').trim(),
    generacion: String(fila.generacion || '').trim(),
    estatus: String(fila.estatus || '').trim(),
    _fila: fila._fila
  };
}

function leerInscripcionesDeProceso(idProceso) {
  return buscarFilasPorValor(HOJAS.ALUMNOS_PROCESO, 'id_proceso', idProceso).map(convertirInscripcion);
}

function leerInscripcionesDeAlumno(matricula) {
  return buscarFilasPorValor(HOJAS.ALUMNOS_PROCESO, 'matricula', matricula).map(convertirInscripcion);
}

function buscarInscripcion(matricula, idProceso) {
  return leerInscripcionesDeAlumno(matricula).find(function (inscripcion) {
    return inscripcion.id_proceso === idProceso;
  }) || null;
}

/* ------------------------------------------------------------------ */
/* Periodo de carga                                                    */
/* ------------------------------------------------------------------ */

/**
 * El alumno puede subir archivos si el proceso esta encendido y hoy cae
 * entre la apertura y el cierre (ambos dias incluidos; vacios = sin limite).
 */
function estaProcesoAbierto(proceso, ahora) {
  if (!proceso.activo) {
    return false;
  }
  const momento = (ahora || new Date()).getTime();
  if (proceso.fecha_apertura) {
    const inicio = new Date(proceso.fecha_apertura.getTime());
    inicio.setHours(0, 0, 0, 0);
    if (momento < inicio.getTime()) {
      return false;
    }
  }
  if (proceso.fecha_cierre) {
    const fin = new Date(proceso.fecha_cierre.getTime());
    fin.setHours(23, 59, 59, 999);
    if (momento > fin.getTime()) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Reutilizacion de documentos                                         */
/* ------------------------------------------------------------------ */

/**
 * Decide que documento usa el alumno para un requisito:
 *   1. El que subio en este mismo proceso (propio).
 *   2. Si la regla lo permite, el ultimo aprobado de otro proceso
 *      (reutilizado); con regla VIGENTE, solo si su fecha de emision sigue
 *      dentro de la vigencia contada desde la apertura del proceso.
 *   3. Ninguno: el alumno debe subirlo (motivo explica por que).
 */
function resolverRequisito(requisito, proceso, documentosAlumno) {
  const tipo = requisito.tipo_documento.toLowerCase();
  const delTipo = documentosAlumno.filter(function (documento) {
    return String(documento.tipo_documento || '').trim().toLowerCase() === tipo;
  });
  const propio = delTipo.find(function (documento) {
    return String(documento.id_proceso || '').trim() === proceso.id_proceso;
  });
  if (propio) {
    return { registro: propio, origen: ORIGEN_DOCUMENTO.PROPIO, motivo: '' };
  }
  const sinDocumento = { registro: null, origen: ORIGEN_DOCUMENTO.NINGUNO, motivo: '' };
  if (requisito.regla === REGLAS_REUTILIZACION.NUEVO) {
    return sinDocumento;
  }
  const aprobado = delTipo.filter(function (documento) {
    return normalizarEstatusDocumento(documento.estatus) === ESTATUS_DOCUMENTO.APROBADO;
  }).sort(function (a, b) {
    return momentoDeDictamen(b) - momentoDeDictamen(a);
  })[0];
  if (!aprobado) {
    return sinDocumento;
  }
  if (requisito.regla === REGLAS_REUTILIZACION.VIGENTE && !estaVigenteParaProceso(aprobado, requisito, proceso)) {
    sinDocumento.motivo = 'El documento que ya tenías no está vigente para este trámite (máximo ' +
      requisito.vigencia_meses + ' meses de antigüedad). Sube uno actualizado.';
    return sinDocumento;
  }
  return { registro: aprobado, origen: ORIGEN_DOCUMENTO.REUTILIZADO, motivo: '' };
}

/**
 * Sin fecha de emision registrada no se puede saber si sigue vigente: se pide de nuevo.
 */
function estaVigenteParaProceso(documento, requisito, proceso) {
  if (!requisito.vigencia_meses) {
    return true;
  }
  const emision = convertirAFecha(documento.fecha_emision);
  if (!emision) {
    return false;
  }
  const referencia = proceso.fecha_apertura || new Date();
  return emision.getTime() >= restarMeses(referencia, requisito.vigencia_meses).getTime();
}

/**
 * Valida la fecha de emision que captura el alumno al subir un documento
 * con vigencia (por ejemplo, CURP de maximo 3 meses). Devuelve un Date o null.
 */
function validarFechaEmision(requisito, valor) {
  if (!requisito.vigencia_meses) {
    return convertirAFecha(valor);
  }
  const emision = convertirAFecha(valor);
  if (!emision) {
    throw crearError('VALIDACION', 'Indica la fecha de emisión del documento ' + requisito.tipo_documento + '.');
  }
  const hoy = new Date();
  if (emision.getTime() > hoy.getTime()) {
    throw crearError('VALIDACION', 'La fecha de emisión no puede ser posterior a hoy.');
  }
  if (emision.getTime() < restarMeses(hoy, requisito.vigencia_meses).getTime()) {
    throw crearError('VALIDACION', 'El documento ' + requisito.tipo_documento + ' debe tener máximo ' +
      requisito.vigencia_meses + ' meses de antigüedad. Descarga o tramita uno actualizado.');
  }
  return emision;
}

/* ------------------------------------------------------------------ */
/* Expediente de un alumno en un proceso                               */
/* ------------------------------------------------------------------ */

/**
 * Convierte el documento resuelto de un requisito en datos seguros para
 * los paneles (sin URL de Drive: el visor la pide a apiObtenerArchivo).
 */
function convertirDocumentoProceso(resuelto, requisito, abierto) {
  const fila = resuelto.registro || {};
  const origen = resuelto.origen;
  const tieneRegistro = origen !== ORIGEN_DOCUMENTO.NINGUNO;
  const estatus = tieneRegistro ? normalizarEstatusDocumento(fila.estatus) : ESTATUS_DOCUMENTO.PENDIENTE;
  const catalogo = obtenerTipoCatalogo(requisito.tipo_documento);
  const permiteCarga = !tieneRegistro ||
    (origen === ORIGEN_DOCUMENTO.PROPIO && ESTATUS_CARGA_PERMITIDA.indexOf(estatus) !== -1);
  return {
    id_documento: tieneRegistro ? String(fila.id_documento || '') : '',
    tipo_documento: requisito.tipo_documento,
    origen: origen,
    tieneArchivo: tieneRegistro && Boolean(fila.url_archivo),
    estatus: estatus,
    observaciones: tieneRegistro ? String(fila.observaciones === undefined || fila.observaciones === null ? '' : fila.observaciones).trim() : '',
    motivo: resuelto.motivo,
    fecha_carga: tieneRegistro ? convertirFechaTexto(fila.fecha_carga) : '',
    fecha_dictamen: tieneRegistro ? convertirFechaTexto(fila.fecha_dictamen) : '',
    fecha_emision: tieneRegistro ? formatearFechaSolo(fila.fecha_emision) : '',
    dictaminador: tieneRegistro ? String(fila.dictaminador || '') : '',
    formatos: catalogo ? catalogo.formatos.slice() : ['PDF'],
    requiereFechaEmision: requisito.vigencia_meses > 0,
    vigenciaMeses: requisito.vigencia_meses,
    puedeDictaminar: origen === ORIGEN_DOCUMENTO.PROPIO && estatus === ESTATUS_DOCUMENTO.EN_REVISION,
    puedeSolicitarActualizacion: origen === ORIGEN_DOCUMENTO.REUTILIZADO,
    puedeCargar: abierto && permiteCarga,
    motivoBloqueo: permiteCarga && !abierto
      ? 'El periodo de carga de este trámite está cerrado.'
      : (origen === ORIGEN_DOCUMENTO.PROPIO ? obtenerMotivoBloqueo(estatus) : '')
  };
}

function contarEstatusDocumentos(documentos) {
  const conteos = { pendientes: 0, enRevision: 0, aprobados: 0, observados: 0 };
  documentos.forEach(function (documento) {
    if (documento.estatus === ESTATUS_DOCUMENTO.PENDIENTE) conteos.pendientes++;
    if (documento.estatus === ESTATUS_DOCUMENTO.EN_REVISION) conteos.enRevision++;
    if (documento.estatus === ESTATUS_DOCUMENTO.APROBADO) conteos.aprobados++;
    if (documento.estatus === ESTATUS_DOCUMENTO.OBSERVADO) conteos.observados++;
  });
  return conteos;
}

/**
 * Observado si algun documento lo esta; si no, En revision si alguno espera
 * dictamen; si no, Completo si todos estan aprobados; si no, Pendiente.
 */
function calcularEstatusExpediente(conteos, totalDocumentos) {
  if (conteos.observados > 0) {
    return ESTATUS_EXPEDIENTE.OBSERVADO;
  }
  if (conteos.enRevision > 0) {
    return ESTATUS_EXPEDIENTE.EN_REVISION;
  }
  if (totalDocumentos > 0 && conteos.aprobados === totalDocumentos) {
    return ESTATUS_EXPEDIENTE.COMPLETO;
  }
  return ESTATUS_EXPEDIENTE.PENDIENTE;
}

/**
 * Expediente de un alumno en un proceso: un documento por requisito.
 */
function construirExpedienteProceso(proceso, requisitos, estudiante, inscripcion, documentosAlumno) {
  const abierto = estaProcesoAbierto(proceso);
  const documentos = requisitos.map(function (requisito) {
    return convertirDocumentoProceso(resolverRequisito(requisito, proceso, documentosAlumno), requisito, abierto);
  });
  const conteos = contarEstatusDocumentos(documentos);
  return {
    id_proceso: proceso.id_proceso,
    nombre_proceso: proceso.nombre,
    matricula: String(estudiante.matricula || ''),
    nombre: String(estudiante.nombre || ''),
    correo_institucional: String(estudiante.correo_institucional || ''),
    carrera: (inscripcion && inscripcion.carrera) || String(estudiante.carrera || ''),
    generacion: (inscripcion && inscripcion.generacion) || String(estudiante.generacion || ''),
    estatus: calcularEstatusExpediente(conteos, documentos.length),
    conteos: conteos,
    totalDocumentos: documentos.length,
    abierto: abierto,
    documentos: documentos
  };
}

function agruparPorMatricula(filas) {
  const grupos = {};
  filas.forEach(function (fila) {
    const clave = String(fila.matricula || '').trim().toLowerCase();
    if (clave) {
      grupos[clave] = grupos[clave] || [];
      grupos[clave].push(fila);
    }
  });
  return grupos;
}

/**
 * Expedientes de todos los alumnos habilitados en un proceso, con una sola
 * lectura de Estudiantes y Documentos. Devuelve [{ expediente, estudiante }].
 */
function construirExpedientesDeProceso(proceso, requisitos) {
  const estudiantes = agruparPorMatricula(leerHoja(HOJAS.ESTUDIANTES));
  const documentos = agruparPorMatricula(leerHoja(HOJAS.DOCUMENTOS));
  return leerInscripcionesDeProceso(proceso.id_proceso).map(function (inscripcion) {
    const clave = inscripcion.matricula.toLowerCase();
    const estudiante = (estudiantes[clave] || [])[0] || { matricula: inscripcion.matricula };
    return {
      estudiante: estudiante,
      inscripcion: inscripcion,
      expediente: construirExpedienteProceso(proceso, requisitos, estudiante, inscripcion, documentos[clave] || [])
    };
  });
}

/* ------------------------------------------------------------------ */
/* Contexto de una operacion sobre un alumno                           */
/* ------------------------------------------------------------------ */

/**
 * Proceso, inscripcion y requisitos de un alumno. exigirActivo impide
 * operar (como estudiante) en un tramite apagado.
 */
function obtenerContextoProceso(matricula, idProceso, exigirActivo) {
  const proceso = obtenerProceso(idProceso);
  if (exigirActivo && !proceso.activo) {
    throw crearError('VALIDACION', 'El trámite ' + proceso.nombre + ' no está disponible en este momento.');
  }
  const inscripcion = buscarInscripcion(matricula, proceso.id_proceso);
  if (!inscripcion) {
    throw crearError('AUTORIZACION', 'El alumno ' + matricula + ' no está habilitado en el trámite ' + proceso.nombre + '.');
  }
  return { proceso: proceso, inscripcion: inscripcion, requisitos: leerRequisitos(proceso.id_proceso) };
}

function obtenerRequisito(contexto, tipoDocumento) {
  const buscado = String(tipoDocumento || '').trim().toLowerCase();
  const requisito = contexto.requisitos.find(function (item) {
    return item.tipo_documento.toLowerCase() === buscado;
  });
  if (!requisito) {
    throw crearError('VALIDACION', 'El trámite ' + contexto.proceso.nombre + ' no pide el documento ' + tipoDocumento + '.');
  }
  return requisito;
}

/**
 * Recalcula el estatus del alumno en el proceso y lo guarda si cambio.
 * Requiere lock activo.
 */
function actualizarEstatusInscripcion(contexto, estudiante, documentosAlumno) {
  const expediente = construirExpedienteProceso(contexto.proceso, contexto.requisitos, estudiante, contexto.inscripcion,
    documentosAlumno || leerDocumentosDeEstudiante(estudiante.matricula));
  if (contexto.inscripcion.estatus !== expediente.estatus) {
    actualizarRegistro(HOJAS.ALUMNOS_PROCESO, contexto.inscripcion._fila, { estatus: expediente.estatus });
    contexto.inscripcion.estatus = expediente.estatus;
  }
  return expediente;
}

/* ------------------------------------------------------------------ */
/* Selector de proceso en los paneles del personal                     */
/* ------------------------------------------------------------------ */

/**
 * Proceso pedido por el navegador; sin valor, el primero encendido (o el
 * primero que exista). Devuelve null si todavia no hay procesos.
 */
function resolverProcesoElegido(idProceso, procesos) {
  const id = String(idProceso === undefined || idProceso === null ? '' : idProceso).trim();
  if (id) {
    const elegido = procesos.find(function (proceso) { return proceso.id_proceso === id; });
    if (!elegido) {
      throw crearError('NO_REGISTRADO', 'El trámite indicado no existe.');
    }
    return elegido;
  }
  return procesos.find(function (proceso) { return proceso.activo; }) || procesos[0] || null;
}

function construirOpcionesProceso(procesos, elegido) {
  return {
    idProceso: elegido ? elegido.id_proceso : '',
    procesos: procesos.map(function (proceso) {
      return { id_proceso: proceso.id_proceso, nombre: proceso.nombre, activo: proceso.activo };
    })
  };
}

/* ------------------------------------------------------------------ */
/* Administracion de procesos (Administrador)                          */
/* ------------------------------------------------------------------ */

/**
 * Procesos con sus requisitos y cuantos alumnos tienen habilitados, mas el
 * catalogo de documentos y reglas para el formulario.
 */
function apiObtenerProcesos() {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const requisitos = leerRequisitosPorProceso();
    const alumnosPorProceso = {};
    leerHoja(HOJAS.ALUMNOS_PROCESO).forEach(function (fila) {
      const id = String(fila.id_proceso || '').trim();
      alumnosPorProceso[id] = (alumnosPorProceso[id] || 0) + 1;
    });
    return {
      ok: true,
      procesos: leerProcesos().map(function (proceso) {
        return {
          id_proceso: proceso.id_proceso,
          nombre: proceso.nombre,
          activo: proceso.activo,
          abierto: estaProcesoAbierto(proceso),
          fecha_apertura: formatearFechaSolo(proceso.fecha_apertura),
          fecha_cierre: formatearFechaSolo(proceso.fecha_cierre),
          alumnos: alumnosPorProceso[proceso.id_proceso] || 0,
          requisitos: requisitos[proceso.id_proceso] || []
        };
      }),
      catalogo: CATALOGO_DOCUMENTOS,
      reglas: Object.keys(REGLAS_REUTILIZACION).map(function (clave) {
        return { regla: clave, etiqueta: ETIQUETAS_REGLAS_REUTILIZACION[clave] };
      })
    };
  });
}

/**
 * Crea un proceso (apagado) o actualiza uno existente con sus requisitos.
 */
function apiGuardarProceso(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const parametros = datos || {};
    const idProceso = String(parametros.idProceso || '').trim();
    const nombre = String(parametros.nombre || '').trim();
    const apertura = convertirAFecha(parametros.fechaApertura);
    const cierre = convertirAFecha(parametros.fechaCierre);
    const requisitos = validarRequisitosRecibidos(parametros.requisitos);
    validarDatosProceso(nombre, apertura, cierre);

    const resultado = conBloqueoEscritura(function () {
      const existentes = leerProcesos();
      const repetido = existentes.find(function (proceso) {
        return proceso.nombre.toLowerCase() === nombre.toLowerCase() && proceso.id_proceso !== idProceso;
      });
      if (repetido) {
        throw crearError('VALIDACION', 'Ya existe un trámite llamado ' + nombre + '.');
      }
      const actual = idProceso ? obtenerProceso(idProceso) : null;
      const id = actual ? actual.id_proceso : generarId(PREFIJO_ID_PROCESO);
      if (actual) {
        actualizarRegistro(HOJAS.PROCESOS, actual._fila, { nombre: nombre, fecha_apertura: apertura || '', fecha_cierre: cierre || '' });
        eliminarFilas(HOJAS.REQUISITOS_PROCESO, buscarFilasPorValor(HOJAS.REQUISITOS_PROCESO, 'id_proceso', id).map(function (fila) {
          return fila._fila;
        }));
      } else {
        insertarRegistros(HOJAS.PROCESOS, [{
          id_proceso: id, nombre: nombre, activo: false,
          fecha_apertura: apertura || '', fecha_cierre: cierre || '', fecha_alta: new Date()
        }]);
      }
      insertarRegistros(HOJAS.REQUISITOS_PROCESO, requisitos.map(function (requisito, indice) {
        return Object.assign({ id_proceso: id, orden: indice + 1 }, requisito);
      }));
      registrarEnHistorial({
        usuario: usuario.correo,
        tipo_documento: TIPO_HISTORIAL_PROCESO,
        estatus_anterior: actual ? 'Editado' : '-',
        estatus_nuevo: actual ? 'Editado' : 'Creado',
        observacion: nombre + ': ' + requisitos.map(function (requisito) { return requisito.tipo_documento; }).join(', ')
      });
      return { idProceso: id, creado: !actual };
    });
    return {
      ok: true,
      idProceso: resultado.idProceso,
      mensaje: resultado.creado
        ? 'Trámite creado. Queda apagado hasta que lo enciendas.'
        : 'Trámite actualizado.'
    };
  });
}

function validarDatosProceso(nombre, apertura, cierre) {
  if (!nombre || nombre.length > LONGITUD_MAXIMA_NOMBRE_PROCESO) {
    throw crearError('VALIDACION', 'El nombre del trámite es obligatorio (máximo ' + LONGITUD_MAXIMA_NOMBRE_PROCESO + ' caracteres).');
  }
  if (apertura && cierre && cierre.getTime() < apertura.getTime()) {
    throw crearError('VALIDACION', 'La fecha de cierre no puede ser anterior a la de apertura.');
  }
}

/**
 * Valida los requisitos que llegan del navegador (RNF-06): documentos del
 * catalogo, sin repetir, con regla y vigencia validas.
 */
function validarRequisitosRecibidos(lista) {
  if (!Array.isArray(lista) || !lista.length) {
    throw crearError('VALIDACION', 'Elige al menos un documento para el trámite.');
  }
  const vistos = {};
  return lista.map(function (item) {
    const catalogo = obtenerTipoCatalogo(item && item.tipoDocumento);
    if (!catalogo) {
      throw crearError('VALIDACION', 'Documento no válido: ' + (item && item.tipoDocumento));
    }
    if (vistos[catalogo.tipo]) {
      throw crearError('VALIDACION', 'El documento ' + catalogo.tipo + ' está repetido.');
    }
    vistos[catalogo.tipo] = true;
    const regla = String(item.regla || '').trim().toUpperCase();
    if (!REGLAS_REUTILIZACION[regla]) {
      throw crearError('VALIDACION', 'Regla no válida para ' + catalogo.tipo + '.');
    }
    const vigencia = Number(item.vigenciaMeses || 0);
    if (!Number.isInteger(vigencia) || vigencia < 0 || vigencia > VIGENCIA_MAXIMA_MESES) {
      throw crearError('VALIDACION', 'La vigencia de ' + catalogo.tipo + ' debe ser un número de meses entre 0 y ' + VIGENCIA_MAXIMA_MESES + '.');
    }
    if (regla === REGLAS_REUTILIZACION.VIGENTE && !vigencia) {
      throw crearError('VALIDACION', 'Indica la vigencia en meses de ' + catalogo.tipo + ' para reutilizarlo solo si sigue vigente.');
    }
    return { tipo_documento: catalogo.tipo, regla: regla, vigencia_meses: vigencia };
  });
}

/**
 * Enciende o apaga un proceso. Apagado, desaparece del panel del alumno;
 * sus datos y documentos se conservan.
 */
function apiCambiarEstadoProceso(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const activo = Boolean(datos && datos.activo);
    const nombre = conBloqueoEscritura(function () {
      const proceso = obtenerProceso(datos && datos.idProceso);
      if (proceso.id_proceso === ID_PROCESO_PRUEBA) {
        throw crearError('VALIDACION', 'El trámite de la prueba de carga no se puede encender.');
      }
      if (activo && !leerRequisitos(proceso.id_proceso).length) {
        throw crearError('VALIDACION', 'Agrega al menos un documento antes de encender el trámite.');
      }
      actualizarRegistro(HOJAS.PROCESOS, proceso._fila, { activo: activo });
      registrarEnHistorial({
        usuario: usuario.correo,
        tipo_documento: TIPO_HISTORIAL_PROCESO,
        estatus_anterior: proceso.activo ? 'Encendido' : 'Apagado',
        estatus_nuevo: activo ? 'Encendido' : 'Apagado',
        observacion: proceso.nombre
      });
      return proceso.nombre;
    });
    return { ok: true, mensaje: nombre + (activo ? ' encendido: los alumnos habilitados ya lo ven.' : ' apagado: ya no aparece a los alumnos.') };
  });
}
