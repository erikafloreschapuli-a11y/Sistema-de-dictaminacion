/**
 * ServicioCarpetas.js
 * Estructura de carpetas en Google Drive (RF-32 a RF-34):
 *   Carpeta raiz -> Generacion -> Carrera -> Matricula
 * Las carpetas se crean al importar estudiantes; la carga de archivos solo
 * las busca (y las crea si faltara alguna).
 */

/* ------------------------------------------------------------------ */
/* Carpeta raiz                                                        */
/* ------------------------------------------------------------------ */

/**
 * Devuelve la carpeta raiz y guarda su ID en Propiedades del Script para
 * que todas las ejecuciones usen la misma.
 */
function obtenerCarpetaRaizDrive() {
  const propiedades = PropertiesService.getScriptProperties();
  const idGuardado = propiedades.getProperty(PROPIEDAD_CARPETA_RAIZ_DRIVE);
  if (idGuardado) {
    try {
      return DriveApp.getFolderById(idGuardado);
    } catch (error) {
      throw crearError(
        'DRIVE',
        'No se pudo abrir la carpeta raíz de Drive. Verifica que exista y que el ID guardado sea correcto.'
      );
    }
  }
  const raiz = DriveApp.getRootFolder();
  const existentes = raiz.getFoldersByName(NOMBRE_CARPETA_RAIZ_DRIVE);
  const carpeta = existentes.hasNext() ? existentes.next() : raiz.createFolder(NOMBRE_CARPETA_RAIZ_DRIVE);
  propiedades.setProperty(PROPIEDAD_CARPETA_RAIZ_DRIVE, carpeta.getId());
  return carpeta;
}

/* ------------------------------------------------------------------ */
/* Carpeta de cada estudiante                                          */
/* ------------------------------------------------------------------ */

function obtenerNombreCarpetaGeneracion(estudiante) {
  return String(estudiante.generacion || '').trim() || CARPETA_SIN_GENERACION;
}

function obtenerNombreCarpetaCarrera(estudiante) {
  return String(estudiante.carrera || '').trim() || CARPETA_SIN_CARRERA;
}

function obtenerClaveCacheCarpeta(matricula) {
  return PREFIJO_CACHE_CARPETA + String(matricula).trim().toLowerCase();
}

/**
 * Devuelve la carpeta Generacion -> Carrera -> Matricula del estudiante.
 * Primero usa el ID en cache; si no, la busca y solo crea lo que falte.
 */
function obtenerCarpetaExpediente(estudiante) {
  const matricula = String(estudiante.matricula || '').trim();
  if (!matricula) {
    throw crearError('VALIDACION', 'El estudiante no tiene matrícula registrada.');
  }
  const cache = CacheService.getScriptCache();
  const claveCache = obtenerClaveCacheCarpeta(matricula);
  const idEnCache = cache.get(claveCache);
  if (idEnCache) {
    try {
      return DriveApp.getFolderById(idEnCache);
    } catch (error) {
      // La carpeta fue movida o borrada: se vuelve a resolver por nombre.
      cache.remove(claveCache);
    }
  }

  const carpetaGeneracion = obtenerOCrearCarpeta(obtenerCarpetaRaizDrive(), obtenerNombreCarpetaGeneracion(estudiante));
  const carpetaCarrera = obtenerOCrearCarpeta(carpetaGeneracion, obtenerNombreCarpetaCarrera(estudiante));
  const carpetaMatricula = obtenerOCrearCarpeta(carpetaCarrera, matricula);
  cache.put(claveCache, carpetaMatricula.getId(), DURACION_CACHE_CARPETA_SEGUNDOS);
  return carpetaMatricula;
}

/**
 * Obtiene una subcarpeta por nombre o la crea si no existe.
 */
function obtenerOCrearCarpeta(carpetaPadre, nombre) {
  const nombreLimpio = String(nombre || '').trim() || CARPETA_SIN_GENERACION;
  const existentes = carpetaPadre.getFoldersByName(nombreLimpio);
  if (existentes.hasNext()) {
    return existentes.next();
  }
  return carpetaPadre.createFolder(nombreLimpio);
}

/**
 * Nombres de las subcarpetas que ya existen dentro de una carpeta.
 * Una sola lectura por carrera es mucho mas rapida que buscar alumno por alumno.
 */
function listarSubcarpetas(carpetaPadre) {
  const subcarpetas = {};
  const iterador = carpetaPadre.getFolders();
  while (iterador.hasNext()) {
    const carpeta = iterador.next();
    subcarpetas[carpeta.getName()] = carpeta;
  }
  return subcarpetas;
}

/* ------------------------------------------------------------------ */
/* Creacion masiva al importar estudiantes                             */
/* ------------------------------------------------------------------ */

/**
 * Agrupa estudiantes por generacion y carrera:
 * { generacion: { carrera: [matriculas] } }
 */
function agruparEstudiantesPorCarrera(estudiantes) {
  const grupos = {};
  estudiantes.forEach(function (estudiante) {
    const matricula = String(estudiante.matricula || '').trim();
    if (!matricula) {
      return;
    }
    const generacion = obtenerNombreCarpetaGeneracion(estudiante);
    const carrera = obtenerNombreCarpetaCarrera(estudiante);
    grupos[generacion] = grupos[generacion] || {};
    grupos[generacion][carrera] = grupos[generacion][carrera] || [];
    grupos[generacion][carrera].push(matricula);
  });
  return grupos;
}

/**
 * Crea las carpetas de carrera y de matricula que falten, hasta agotar el
 * plazo indicado. Es idempotente: volver a ejecutarla solo crea lo faltante.
 * Devuelve { creadas, pendientes, carreras }.
 */
function crearCarpetasDeEstudiantes(estudiantes, plazoMs) {
  const inicio = Date.now();
  const grupos = agruparEstudiantesPorCarrera(estudiantes);
  const resultado = { creadas: 0, pendientes: 0, carreras: 0 };
  const raiz = obtenerCarpetaRaizDrive();
  const cache = CacheService.getScriptCache();
  let sinTiempo = false;

  Object.keys(grupos).forEach(function (generacion) {
    const carpetaGeneracion = obtenerOCrearCarpeta(raiz, generacion);
    Object.keys(grupos[generacion]).forEach(function (carrera) {
      const matriculas = grupos[generacion][carrera];
      if (sinTiempo) {
        resultado.pendientes += matriculas.length;
        return;
      }
      resultado.carreras++;
      const carpetaCarrera = obtenerOCrearCarpeta(carpetaGeneracion, carrera);
      const existentes = listarSubcarpetas(carpetaCarrera);
      matriculas.forEach(function (matricula) {
        if (existentes[matricula]) {
          return;
        }
        if (sinTiempo || Date.now() - inicio > plazoMs) {
          sinTiempo = true;
          resultado.pendientes++;
          return;
        }
        const carpeta = carpetaCarrera.createFolder(matricula);
        existentes[matricula] = carpeta;
        cache.put(obtenerClaveCacheCarpeta(matricula), carpeta.getId(), DURACION_CACHE_CARPETA_SEGUNDOS);
        resultado.creadas++;
      });
    });
  });
  return resultado;
}

/**
 * Crea carpetas para los estudiantes recibidos y, si no alcanza el tiempo,
 * programa un activador que termine el trabajo. Nunca lanza errores: la
 * importacion ya quedo guardada y las carpetas tambien se crean al subir.
 */
function crearCarpetasConContinuacion(estudiantes, plazoMs) {
  try {
    const resultado = crearCarpetasDeEstudiantes(estudiantes, plazoMs);
    if (resultado.pendientes > 0) {
      programarContinuacionCarpetas();
    } else {
      eliminarActivadoresCarpetas();
    }
    return resultado;
  } catch (error) {
    console.error('No se pudieron crear las carpetas: ' + error.message);
    return { creadas: 0, pendientes: estudiantes.length, carreras: 0, error: error.message };
  }
}

/**
 * Activador de tiempo: retoma la creacion con todos los estudiantes de la
 * hoja. Se reprograma solo mientras queden carpetas pendientes.
 */
function continuarCreacionCarpetas() {
  const resultado = crearCarpetasConContinuacion(leerHoja(HOJAS.ESTUDIANTES), TIEMPO_CARPETAS_SEGUNDO_PLANO_MS);
  console.log('Carpetas creadas: ' + resultado.creadas + ', pendientes: ' + resultado.pendientes);
}

function programarContinuacionCarpetas() {
  eliminarActivadoresCarpetas();
  ScriptApp.newTrigger(FUNCION_CONTINUAR_CARPETAS)
    .timeBased()
    .after(ESPERA_ACTIVADOR_CARPETAS_MS)
    .create();
}

function eliminarActivadoresCarpetas() {
  ScriptApp.getProjectTriggers().forEach(function (activador) {
    if (activador.getHandlerFunction() === FUNCION_CONTINUAR_CARPETAS) {
      ScriptApp.deleteTrigger(activador);
    }
  });
}

/* ------------------------------------------------------------------ */
/* RF-34: acceso de edicion a la carpeta raiz                          */
/* ------------------------------------------------------------------ */

/**
 * Da o quita permiso de edicion sobre la carpeta raiz segun el estado del
 * usuario. Devuelve un aviso si Drive lo rechazo; el alta del usuario no
 * se revierte por eso.
 */
function actualizarPermisoCarpeta(correo, activo) {
  const correoNormalizado = normalizarCorreo(correo);
  const propietario = normalizarCorreo(Session.getEffectiveUser().getEmail());
  if (!correoNormalizado || correoNormalizado === propietario) {
    return '';
  }
  try {
    const carpeta = obtenerCarpetaRaizDrive();
    const esEditor = carpeta.getEditors().some(function (editor) {
      return normalizarCorreo(editor.getEmail()) === correoNormalizado;
    });
    if (activo && !esEditor) {
      carpeta.addEditor(correoNormalizado);
    } else if (!activo && esEditor) {
      carpeta.removeEditor(correoNormalizado);
    }
    return '';
  } catch (error) {
    console.error('No se pudo actualizar el permiso de ' + correoNormalizado + ': ' + error.message);
    return 'No se pudo actualizar su acceso a la carpeta de Drive; revísalo manualmente.';
  }
}

/**
 * Alinea los editores de la carpeta raiz con la hoja Usuarios: solo
 * administradores y dictaminadores activos (RF-34).
 */
function sincronizarPermisosCarpeta() {
  const resumen = { conAcceso: 0, sinAcceso: 0, avisos: [] };
  leerHoja(HOJAS.USUARIOS).forEach(function (usuario) {
    const rol = normalizarRol(usuario.rol);
    if (!esCorreoTrabajador(usuario.correo) || ROLES_GESTIONABLES.indexOf(rol) === -1) {
      return;
    }
    const activo = esUsuarioActivo(usuario.activo);
    const aviso = actualizarPermisoCarpeta(usuario.correo, activo);
    if (aviso) {
      resumen.avisos.push(usuario.correo + ': ' + aviso);
    } else if (activo) {
      resumen.conAcceso++;
    } else {
      resumen.sinAcceso++;
    }
  });
  return resumen;
}
