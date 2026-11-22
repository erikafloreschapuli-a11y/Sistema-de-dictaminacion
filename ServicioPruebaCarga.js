/**
 * ServicioPruebaCarga.js
 * Prueba del criterio "200 cargas simultaneas no producen perdida ni
 * sobreescritura de datos" (seccion 11) con el codigo real de carga.
 *
 * Flujo desde el panel del Administrador:
 *   1. apiPrepararPruebaCarga: crea N alumnos PRUEBA-0001... y sus carpetas.
 *   2. El navegador lanza N llamadas a apiEjecutarCargaPrueba a la vez.
 *   3. apiVerificarPruebaCarga: revisa que haya exactamente un documento y
 *      un registro de historial por alumno, sin duplicados.
 *   4. apiLimpiarPruebaCarga: borra alumnos y documentos de prueba y manda
 *      su carpeta a la papelera. El historial se conserva (RF-31).
 */

function esMatriculaDePrueba(matricula) {
  return String(matricula || '').trim().toUpperCase().indexOf(PREFIJO_MATRICULA_PRUEBA) === 0;
}

function construirMatriculaPrueba(numero) {
  return PREFIJO_MATRICULA_PRUEBA + ('0000000000' + numero).slice(-DIGITOS_MATRICULA_PRUEBA);
}

/**
 * Crea los alumnos de prueba. Exige que no quede una prueba anterior para
 * que la verificacion no mezcle resultados.
 */
function apiPrepararPruebaCarga(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const cantidad = Number(datos && datos.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAXIMO_ALUMNOS_PRUEBA) {
      throw crearError('VALIDACION', 'La cantidad debe ser un número entre 1 y ' + MAXIMO_ALUMNOS_PRUEBA + '.');
    }

    const alumnos = [];
    for (let numero = 1; numero <= cantidad; numero++) {
      const matricula = construirMatriculaPrueba(numero);
      alumnos.push({
        matricula: matricula,
        nombre: 'Alumno de prueba ' + numero,
        correo_institucional: matricula.toLowerCase().replace('-', '.') + DOMINIO_ESTUDIANTE,
        correo_personal: '',
        telefono: '',
        carrera: NOMBRE_GRUPO_PRUEBA,
        generacion: NOMBRE_GRUPO_PRUEBA,
        estatus_general: ESTATUS_EXPEDIENTE.PENDIENTE
      });
    }

    conBloqueoEscritura(function () {
      const existentes = leerHoja(HOJAS.ESTUDIANTES).filter(function (estudiante) {
        return esMatriculaDePrueba(estudiante.matricula);
      });
      if (existentes.length) {
        throw crearError('VALIDACION', 'Quedan ' + existentes.length + ' alumnos de una prueba anterior. Primero limpia la prueba.');
      }
      insertarRegistros(HOJAS.ESTUDIANTES, alumnos);
    });

    // Igual que una importacion real: las carpetas se crean antes de las cargas.
    const carpetas = crearCarpetasConContinuacion(alumnos, TIEMPO_CARPETAS_IMPORTACION_MS);
    return {
      ok: true,
      matriculas: alumnos.map(function (alumno) { return alumno.matricula; }),
      carpetas: carpetas
    };
  });
}

/**
 * Una carga de prueba: mismo camino que apiSubirDocumento (validacion,
 * Drive, bloqueo, hoja, historial y estatus_general).
 */
function apiEjecutarCargaPrueba(datos) {
  return protegerApi(function () {
    const inicio = Date.now();
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const matricula = String((datos && datos.matricula) || '').trim();
    if (!esMatriculaDePrueba(matricula)) {
      throw crearError('VALIDACION', 'Solo se puede usar con alumnos de prueba.');
    }
    const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'matricula', matricula);
    if (!estudiante) {
      throw crearError('NO_REGISTRADO', 'No existe el alumno de prueba ' + matricula + '.');
    }
    procesarCargaDocumento(usuario, estudiante, TIPOS_DOCUMENTO[0], datos);
    return { ok: true, milisegundos: Date.now() - inicio };
  });
}

/**
 * Compara lo esperado (un documento y un registro por alumno) contra lo
 * que quedo en las hojas.
 */
function apiVerificarPruebaCarga() {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const esDePrueba = function (fila) { return esMatriculaDePrueba(fila.matricula); };
    const alumnos = leerHoja(HOJAS.ESTUDIANTES).filter(esDePrueba);
    const documentos = leerHoja(HOJAS.DOCUMENTOS).filter(esDePrueba);
    const historial = leerHoja(HOJAS.HISTORIAL).filter(esDePrueba);

    const documentosPorAlumno = contarPorMatricula(documentos);
    const historialPorAlumno = contarPorMatricula(historial);
    const resultado = {
      alumnos: alumnos.length,
      alumnosConDocumento: 0,
      alumnosSinDocumento: [],
      documentosDuplicados: [],
      documentosSinArchivo: 0,
      registrosHistorial: historial.length,
      alumnosSinHistorial: [],
      estatusGeneralIncorrecto: []
    };

    alumnos.forEach(function (alumno) {
      const clave = String(alumno.matricula).trim().toUpperCase();
      const cantidadDocumentos = documentosPorAlumno[clave] || 0;
      if (cantidadDocumentos === 0) {
        resultado.alumnosSinDocumento.push(alumno.matricula);
        return;
      }
      resultado.alumnosConDocumento++;
      if (cantidadDocumentos > 1) {
        resultado.documentosDuplicados.push(alumno.matricula);
      }
      if (!historialPorAlumno[clave]) {
        resultado.alumnosSinHistorial.push(alumno.matricula);
      }
      if (String(alumno.estatus_general) !== ESTATUS_EXPEDIENTE.EN_REVISION) {
        resultado.estatusGeneralIncorrecto.push(alumno.matricula);
      }
    });
    resultado.documentosSinArchivo = documentos.filter(function (documento) {
      return !documento.url_archivo;
    }).length;
    resultado.correcto = resultado.alumnos > 0 &&
      !resultado.alumnosSinDocumento.length &&
      !resultado.documentosDuplicados.length &&
      !resultado.documentosSinArchivo &&
      !resultado.alumnosSinHistorial.length &&
      !resultado.estatusGeneralIncorrecto.length;
    return { ok: true, verificacion: resultado };
  });
}

function contarPorMatricula(filas) {
  const conteo = {};
  filas.forEach(function (fila) {
    const clave = String(fila.matricula).trim().toUpperCase();
    conteo[clave] = (conteo[clave] || 0) + 1;
  });
  return conteo;
}

/**
 * Borra alumnos y documentos de prueba y manda su carpeta a la papelera.
 * El historial NO se borra (RF-31): sus registros quedan identificados por
 * la matricula PRUEBA-.
 */
function apiLimpiarPruebaCarga() {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const eliminados = conBloqueoEscritura(function () {
      const filasDe = function (nombreHoja) {
        return leerHoja(nombreHoja).filter(function (fila) {
          return esMatriculaDePrueba(fila.matricula);
        });
      };
      const alumnos = filasDe(HOJAS.ESTUDIANTES);
      const documentos = filasDe(HOJAS.DOCUMENTOS);
      eliminarFilas(HOJAS.DOCUMENTOS, documentos.map(function (fila) { return fila._fila; }));
      eliminarFilas(HOJAS.ESTUDIANTES, alumnos.map(function (fila) { return fila._fila; }));
      return { alumnos: alumnos, documentos: documentos.length };
    });

    const cache = CacheService.getScriptCache();
    cache.removeAll(eliminados.alumnos.map(function (alumno) {
      return obtenerClaveCacheCarpeta(alumno.matricula);
    }));
    const carpetaEnPapelera = enviarCarpetaPruebaAPapelera();
    return {
      ok: true,
      alumnos: eliminados.alumnos.length,
      documentos: eliminados.documentos,
      carpetaEnPapelera: carpetaEnPapelera
    };
  });
}

function enviarCarpetaPruebaAPapelera() {
  try {
    const carpetas = obtenerCarpetaRaizDrive().getFoldersByName(NOMBRE_GRUPO_PRUEBA);
    let enviada = false;
    while (carpetas.hasNext()) {
      carpetas.next().setTrashed(true);
      enviada = true;
    }
    return enviada;
  } catch (error) {
    console.error('No se pudo enviar a la papelera la carpeta de prueba: ' + error.message);
    return false;
  }
}
