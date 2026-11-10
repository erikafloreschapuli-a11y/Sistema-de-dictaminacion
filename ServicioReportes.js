/**
 * ServicioReportes.js
 * Estadisticas generales del panel del Administrador (RF-23).
 * Cuenta sobre la version mas reciente de cada documento por estudiante.
 */

/**
 * Devuelve los 6 indicadores del panel: total de alumnos, pendientes,
 * en revision, aprobados, observados y expedientes completos (RF-23).
 */
function apiObtenerReportesGenerales() {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const estudiantes = leerHoja(HOJAS.ESTUDIANTES);
    const documentos = leerHoja(HOJAS.DOCUMENTOS);
    return { ok: true, reportes: construirReportesGenerales(estudiantes, documentos) };
  });
}

/**
 * Calcula los indicadores a partir de estudiantes y documentos.
 * Separado de la API para poder probarlo sin sesion.
 */
function construirReportesGenerales(estudiantes, documentos) {
  const ultimasVersiones = obtenerUltimaVersionPorTipo(documentos);
  const reportes = {
    totalAlumnos: estudiantes.length,
    pendientes: 0,
    enRevision: 0,
    aprobados: 0,
    observados: 0,
    expedientesCompletos: 0
  };

  const estatusPorEstudiante = {};
  Object.keys(ultimasVersiones).forEach(function (clave) {
    const documento = ultimasVersiones[clave];
    const estatus = String(documento.estatus);
    if (estatus === ESTATUS_DOCUMENTO.PENDIENTE) {
      reportes.pendientes++;
    } else if (estatus === ESTATUS_DOCUMENTO.EN_REVISION) {
      reportes.enRevision++;
    } else if (estatus === ESTATUS_DOCUMENTO.APROBADO) {
      reportes.aprobados++;
    } else if (estatus === ESTATUS_DOCUMENTO.OBSERVADO) {
      reportes.observados++;
    }
    const matricula = String(documento.matricula);
    if (!estatusPorEstudiante[matricula]) {
      estatusPorEstudiante[matricula] = {};
    }
    estatusPorEstudiante[matricula][String(documento.tipo_documento)] = estatus;
  });

  estudiantes.forEach(function (estudiante) {
    const estatusDeTipos = estatusPorEstudiante[String(estudiante.matricula)] || {};
    const completo = TIPOS_DOCUMENTO.every(function (tipo) {
      return estatusDeTipos[tipo] === ESTATUS_DOCUMENTO.APROBADO;
    });
    if (completo) {
      reportes.expedientesCompletos++;
    }
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
