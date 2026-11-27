/**
 * ServicioGeneraciones.js
 * El sistema conserva varias generaciones a la vez (2027, 2028...). Las
 * carpetas de Drive salen de la generacion de cada alumno; los reportes,
 * la lista del dictaminador y el recordatorio muestran por defecto la
 * generacion activa de Configuracion y permiten consultar las demas.
 */

/**
 * Generacion activa de la hoja Configuracion (RF-26).
 */
function obtenerGeneracionActiva() {
  return String(obtenerValorConfiguracion('GENERACION_ACTIVA') || '').trim();
}

/**
 * Traduce el filtro recibido del navegador (RNF-06): sin valor se usa la
 * generacion activa; FILTRO_TODAS_GENERACIONES quita el filtro.
 * Devuelve la generacion elegida, o cadena vacia para "todas".
 */
function resolverFiltroGeneracion(valor) {
  if (valor === undefined || valor === null) {
    return obtenerGeneracionActiva();
  }
  const texto = String(valor).trim().slice(0, LONGITUD_MAXIMA_GENERACION);
  return texto === FILTRO_TODAS_GENERACIONES ? '' : texto;
}

/**
 * Deja solo los alumnos de la generacion indicada; vacia = todos.
 */
function filtrarPorGeneracion(estudiantes, generacion) {
  if (!generacion) {
    return estudiantes;
  }
  return estudiantes.filter(function (estudiante) {
    return String(estudiante.generacion || '').trim() === generacion;
  });
}

/**
 * Generaciones con alumnos, la mas reciente primero. Incluye la activa
 * aunque todavia no se haya importado ningun alumno de ella.
 */
function obtenerGeneracionesRegistradas(estudiantes) {
  const generaciones = {};
  const activa = obtenerGeneracionActiva();
  if (activa) {
    generaciones[activa] = true;
  }
  estudiantes.forEach(function (estudiante) {
    const generacion = String(estudiante.generacion || '').trim();
    if (generacion && !esMatriculaDePrueba(estudiante.matricula)) {
      generaciones[generacion] = true;
    }
  });
  return Object.keys(generaciones).sort(function (a, b) {
    return b.localeCompare(a, 'es', { numeric: true });
  });
}

/**
 * Datos que el panel necesita para pintar el selector de generacion.
 */
function construirOpcionesGeneracion(estudiantes, generacionElegida) {
  return {
    generacion: generacionElegida,
    generaciones: obtenerGeneracionesRegistradas(estudiantes),
    generacionActiva: obtenerGeneracionActiva(),
    valorTodasGeneraciones: FILTRO_TODAS_GENERACIONES
  };
}
