/**
 * ServicioReportes.js
 * Estadisticas generales del panel del Administrador (RF-23).
 * Se calculan por tramite y por expediente: cada alumno cuenta con todos
 * los documentos que pide el tramite, aunque todavia no haya subido alguno
 * (cuenta como Pendiente). La prueba de carga vive en un tramite oculto.
 */

/**
 * Indicadores por alumno, por documento y por carrera de un tramite (RF-23).
 * datos.idProceso: sin valor = el primero encendido.
 */
function apiObtenerReportesGenerales(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const procesos = leerProcesos();
    const proceso = resolverProcesoElegido(datos && datos.idProceso, procesos);
    const expedientes = proceso
      ? construirExpedientesDeProceso(proceso, leerRequisitos(proceso.id_proceso)).map(function (fila) { return fila.expediente; })
      : [];
    const reportes = construirReportesGenerales(expedientes);
    // Se muestra para que el Administrador anticipe dias de mucho dictamen (RNF-10).
    reportes.cuotaCorreosRestante = obtenerCuotaCorreosRestante();
    return Object.assign({ ok: true, reportes: reportes }, construirOpcionesProceso(procesos, proceso));
  });
}

function crearContadoresReporte() {
  return {
    totalAlumnos: 0,
    alumnosSinDocumentos: 0,
    alumnosConFaltantes: 0,
    alumnosPorRevisar: 0,
    alumnosConObservaciones: 0,
    expedientesCompletos: 0,
    pendientes: 0,
    enRevision: 0,
    aprobados: 0,
    observados: 0
  };
}

/**
 * Suma un expediente a los contadores. Un alumno puede estar a la vez
 * "por revisar" y "con observaciones" si tiene documentos en ambos estatus.
 */
function sumarExpedienteAReporte(contadores, expediente) {
  const conteos = expediente.conteos;
  contadores.totalAlumnos++;
  contadores.pendientes += conteos.pendientes;
  contadores.enRevision += conteos.enRevision;
  contadores.aprobados += conteos.aprobados;
  contadores.observados += conteos.observados;
  if (conteos.pendientes === expediente.totalDocumentos) {
    contadores.alumnosSinDocumentos++;
  } else if (conteos.pendientes > 0) {
    contadores.alumnosConFaltantes++;
  }
  if (conteos.enRevision > 0) {
    contadores.alumnosPorRevisar++;
  }
  if (conteos.observados > 0) {
    contadores.alumnosConObservaciones++;
  }
  if (expediente.estatus === ESTATUS_EXPEDIENTE.COMPLETO) {
    contadores.expedientesCompletos++;
  }
}

/**
 * Calcula los indicadores generales y el desglose por carrera a partir de
 * los expedientes de un tramite. Separado de la API para poder probarlo sin sesion.
 */
function construirReportesGenerales(expedientes) {
  const reportes = crearContadoresReporte();
  const porCarrera = {};

  expedientes.forEach(function (expediente) {
    sumarExpedienteAReporte(reportes, expediente);
    const carrera = expediente.carrera || CARPETA_SIN_CARRERA;
    porCarrera[carrera] = porCarrera[carrera] || crearContadoresReporte();
    sumarExpedienteAReporte(porCarrera[carrera], expediente);
  });

  reportes.porCarrera = Object.keys(porCarrera).sort(function (a, b) {
    return a.localeCompare(b);
  }).map(function (carrera) {
    return Object.assign({ carrera: carrera }, porCarrera[carrera]);
  });
  return reportes;
}
