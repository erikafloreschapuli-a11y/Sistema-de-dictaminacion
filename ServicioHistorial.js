/**
 * ServicioHistorial.js
 * Registro y consulta del historial de cambios (RF-20, RF-24, RF-30, RF-31).
 *
 * Todo se guarda en una sola hoja Historial (seccion 6); cada persona ve
 * una vista filtrada:
 *   - Administrador: historial completo con filtros, y el de cada usuario.
 *   - Dictaminador: el historial completo de cada alumno que revisa y su
 *     propia actividad.
 *   - Estudiante: el historial de su expediente, sin datos del personal.
 * Ninguna funcion de este archivo edita ni borra registros (RF-31).
 */

/* ------------------------------------------------------------------ */
/* Registro                                                            */
/* ------------------------------------------------------------------ */

/**
 * Agrega una fila de auditoria al historial. Requiere lock activo.
 */
function registrarEnHistorial(datos) {
  insertarRegistros(HOJAS.HISTORIAL, [
    {
      id_registro: generarId(PREFIJOS_ID.HISTORIAL),
      fecha_hora: new Date(),
      usuario: datos.usuario || '',
      matricula: datos.matricula || '',
      tipo_documento: datos.tipo_documento || '',
      estatus_anterior: datos.estatus_anterior || '',
      estatus_nuevo: datos.estatus_nuevo || '',
      observacion: datos.observacion || ''
    }
  ]);
}

/* ------------------------------------------------------------------ */
/* Historial de un alumno (dictaminador y administrador)               */
/* ------------------------------------------------------------------ */

/**
 * Todos los cambios del expediente de un alumno, del mas reciente al mas
 * antiguo: cargas del estudiante y dictamenes de cualquier dictaminador.
 */
function apiObtenerHistorialEstudiante(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.DICTAMINADOR]);
    const matricula = String((datos && datos.matricula) || '').trim();
    if (!matricula) {
      throw crearError('VALIDACION', 'Debes indicar la matrícula del expediente.');
    }
    const registros = buscarFilasPorValor(HOJAS.HISTORIAL, 'matricula', matricula, LIMITE_HISTORIAL_ESTUDIANTE);
    return { ok: true, registros: ordenarRecientesPrimero(registros).map(convertirRegistroHistorial) };
  });
}

/* ------------------------------------------------------------------ */
/* Historial propio del estudiante                                     */
/* ------------------------------------------------------------------ */

/**
 * Historial del expediente del estudiante de la sesion. El personal
 * aparece como "Servicios Escolares" para no exponer sus correos.
 */
function apiObtenerMiHistorial(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ESTUDIANTE]);
    const estudiante = obtenerEstudianteParaUsuario(usuario, datos && datos.matricula);
    const correoEstudiante = normalizarCorreo(estudiante.correo_institucional);
    const registros = buscarFilasPorValor(HOJAS.HISTORIAL, 'matricula', estudiante.matricula, LIMITE_HISTORIAL_ESTUDIANTE);
    return {
      ok: true,
      registros: ordenarRecientesPrimero(registros).map(function (registro) {
        const vista = convertirRegistroHistorial(registro);
        vista.usuario = normalizarCorreo(registro.usuario) === correoEstudiante ? 'Tú' : NOMBRE_PERSONAL_PARA_ESTUDIANTE;
        return vista;
      })
    };
  });
}

/* ------------------------------------------------------------------ */
/* Actividad de un usuario del personal                                */
/* ------------------------------------------------------------------ */

/**
 * Cambios hechos por el dictaminador o administrador de la sesion.
 */
function apiObtenerMiActividad() {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.DICTAMINADOR]);
    return { ok: true, registros: obtenerActividadDeUsuario(usuario.correo) };
  });
}

/**
 * Cambios hechos por cualquier usuario; solo para el Administrador.
 */
function apiObtenerActividadUsuario(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const correo = normalizarCorreo(datos && datos.correo);
    if (!esCorreoValido(correo)) {
      throw crearError('VALIDACION', 'Indica un correo válido.');
    }
    return { ok: true, registros: obtenerActividadDeUsuario(correo) };
  });
}

/**
 * Ultimos cambios de un usuario con el nombre del alumno afectado.
 */
function obtenerActividadDeUsuario(correo) {
  const registros = buscarFilasPorValor(HOJAS.HISTORIAL, 'usuario', correo, LIMITE_ACTIVIDAD_USUARIO);
  const nombres = {};
  if (registros.length) {
    leerHoja(HOJAS.ESTUDIANTES).forEach(function (estudiante) {
      nombres[String(estudiante.matricula).trim().toLowerCase()] = String(estudiante.nombre || '');
    });
  }
  return ordenarRecientesPrimero(registros).map(function (registro) {
    const vista = convertirRegistroHistorial(registro);
    vista.nombre_estudiante = nombres[String(registro.matricula).trim().toLowerCase()] || '';
    return vista;
  });
}

/* ------------------------------------------------------------------ */
/* RF-24: historial completo (Administrador)                           */
/* ------------------------------------------------------------------ */

/**
 * Devuelve el historial filtrado y paginado (RF-24, RF-31: solo lectura).
 * Filtros: fechaDesde, fechaHasta, matricula, usuario, tipoDocumento.
 */
function apiObtenerHistorial(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const parametros = datos || {};
    const filtrados = ordenarRecientesPrimero(filtrarHistorial(leerHoja(HOJAS.HISTORIAL), parametros));
    const desplazamiento = Math.max(0, Number(parametros.desplazamiento) || 0);
    const pagina = filtrados.slice(desplazamiento, desplazamiento + LIMITE_PAGINA_HISTORIAL);
    return {
      ok: true,
      total: filtrados.length,
      registros: pagina.map(convertirRegistroHistorial),
      hayMas: desplazamiento + pagina.length < filtrados.length
    };
  });
}

/**
 * Aplica los filtros del formulario sobre las filas del historial.
 */
function filtrarHistorial(registros, filtros) {
  const matricula = String(filtros.matricula || '').trim().toLowerCase();
  const usuario = String(filtros.usuario || '').trim().toLowerCase();
  const tipoDocumento = String(filtros.tipoDocumento || '').trim().toLowerCase();
  const desde = filtros.fechaDesde ? parsearFechaSolo(filtros.fechaDesde) : null;
  const hasta = filtros.fechaHasta ? parsearFechaSolo(filtros.fechaHasta) : null;
  if (desde) {
    desde.setHours(0, 0, 0, 0);
  }
  if (hasta) {
    hasta.setHours(23, 59, 59, 999);
  }

  return registros.filter(function (registro) {
    const momento = new Date(registro.fecha_hora).getTime();
    if (desde && !isNaN(momento) && momento < desde.getTime()) return false;
    if (hasta && !isNaN(momento) && momento > hasta.getTime()) return false;
    if (matricula && String(registro.matricula).toLowerCase().indexOf(matricula) === -1) return false;
    if (usuario && String(registro.usuario).toLowerCase().indexOf(usuario) === -1) return false;
    if (tipoDocumento && String(registro.tipo_documento).toLowerCase().indexOf(tipoDocumento) === -1) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function ordenarRecientesPrimero(registros) {
  return registros.slice().sort(function (a, b) {
    return new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime();
  });
}

/**
 * Convierte una fila interna en un registro seguro para el navegador.
 */
function convertirRegistroHistorial(registro) {
  return {
    id_registro: String(registro.id_registro),
    fecha_hora: convertirFechaTexto(registro.fecha_hora),
    usuario: String(registro.usuario),
    matricula: String(registro.matricula),
    tipo_documento: String(registro.tipo_documento),
    estatus_anterior: String(registro.estatus_anterior),
    estatus_nuevo: String(registro.estatus_nuevo),
    observacion: String(registro.observacion)
  };
}
