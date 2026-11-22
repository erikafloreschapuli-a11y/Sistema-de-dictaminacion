/**
 * ServicioReportes.js
 * Estadisticas generales del panel del Administrador (RF-23).
 * Se calculan por expediente: cada alumno tiene sus tres documentos, aunque
 * todavia no haya subido alguno (cuenta como Pendiente). Los alumnos de la
 * prueba de carga no se cuentan.
 */

/**
 * Indicadores por alumno, por documento y por carrera (RF-23).
 */
function apiObtenerReportesGenerales() {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const reportes = construirReportesGenerales(leerHoja(HOJAS.ESTUDIANTES), leerHoja(HOJAS.DOCUMENTOS));
    // Se muestra para que el Administrador anticipe dias de mucho dictamen (RNF-10).
    reportes.cuotaCorreosRestante = obtenerCuotaCorreosRestante();
    return { ok: true, reportes: reportes };
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
 * Calcula los indicadores generales y el desglose por carrera.
 * Separado de la API para poder probarlo sin sesion.
 */
function construirReportesGenerales(estudiantes, documentos) {
  const alumnosReales = estudiantes.filter(function (estudiante) {
    return !esMatriculaDePrueba(estudiante.matricula);
  });
  const reportes = crearContadoresReporte();
  const porCarrera = {};

  construirExpedientes(alumnosReales, documentos).forEach(function (expediente) {
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

/**
 * Devuelve un mapa "matricula|tipo_documento" con el documento mas reciente.
 */
function obtenerUltimaVersionPorTipo(documentos) {
  const ultimos = {};
  documentos.forEach(function (documento) {
    const clave = String(documento.matricula) + '|' + String(documento.tipo_documento);
    const actual = ultimos[clave];
    if (!actual || momentoDeCarga(documento) >= momentoDeCarga(actual)) {
      ultimos[clave] = documento;
    }
  });
  return ultimos;
}

/**
 * Momento en milisegundos de la fecha de carga; 0 si no es interpretable.
 */
function momentoDeCarga(documento) {
  const momento = new Date(documento.fecha_carga).getTime();
  return isNaN(momento) ? 0 : momento;
}
