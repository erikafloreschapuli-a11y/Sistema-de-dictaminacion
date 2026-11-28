/**
 * Instalacion.js
 * Preparacion del sistema. Se ejecuta a mano desde el editor de Apps Script
 * con la cuenta duena del proyecto (la misma que despliega la app web).
 *
 * Primera vez:  instalarSistema()
 * Si el libro maestro NO es la hoja que contiene este proyecto, ejecutar
 * antes definirLibroMaestro('ID_DEL_LIBRO') (ver RepositorioHojas.js).
 *
 * Es seguro ejecutarla varias veces: solo crea o corrige lo que falta.
 *
 * Antes del piloto, para empezar desde cero:  reiniciarDatosDelSistema()
 * (respalda el libro, vacia Estudiantes, Documentos e Historial y manda la
 * carpeta raiz a la papelera; conserva Usuarios y Configuracion).
 * Solo rehacer carpetas de los alumnos ya importados:  reiniciarCarpetas()
 *
 * Paso a tramites (una sola vez, con datos anteriores):  migrarAProcesos()
 * (crea el tramite de nuevo ingreso con los alumnos y documentos existentes).
 */

/**
 * Prepara libro, configuracion, carpeta raiz, permisos (RF-34) y carpetas
 * de los estudiantes ya importados (RF-32). Al ejecutarla por primera vez
 * Google pide autorizar todos los permisos que usa la app.
 */
function instalarSistema() {
  const libro = obtenerLibroMaestro();
  const hojas = inicializarBaseDeDatos();
  const clavesAgregadas = agregarConfiguracionFaltante();
  const carpeta = obtenerCarpetaRaizDrive();
  const permisos = sincronizarPermisosCarpeta();
  const carpetas = crearCarpetasConContinuacion(leerTodasLasCarpetas(), TIEMPO_CARPETAS_SEGUNDO_PLANO_MS);

  const resumen = [
    'Libro maestro: ' + libro.getName() + ' (' + libro.getUrl() + ')',
    'Hojas creadas: ' + (hojas.hojasCreadas.length ? hojas.hojasCreadas.join(', ') : 'ninguna, ya existían'),
    'Claves de configuración agregadas: ' + (clavesAgregadas.length ? clavesAgregadas.join(', ') : 'ninguna'),
    'Carpeta raíz: ' + carpeta.getName() + ' (' + carpeta.getUrl() + ')',
    'Personal con acceso a la carpeta: ' + permisos.conAcceso + '; sin acceso (inactivos): ' + permisos.sinAcceso,
    'Carpetas de estudiantes creadas: ' + carpetas.creadas + '; pendientes: ' + carpetas.pendientes
  ].concat(permisos.avisos);
  console.log(resumen.join('\n'));
  return resumen;
}

/**
 * Deja el sistema como recien instalado para empezar el piloto: borra
 * alumnos, documentos e historial y manda los expedientes de Drive a la
 * papelera. Al importar alumnos de nuevo se crean otra vez las carpetas.
 *
 * Solo se ejecuta a mano desde el editor; la app no tiene ningun boton que
 * la llame (RF-31: el historial no se borra desde la aplicacion). Antes de
 * borrar guarda una copia completa del libro en Drive.
 */
function reiniciarDatosDelSistema() {
  const libro = obtenerLibroMaestro();
  const respaldo = respaldarLibroMaestro(libro);

  const filasBorradas = conBloqueoEscritura(function () {
    const borradas = {};
    HOJAS_REINICIABLES.forEach(function (nombreHoja) {
      borradas[nombreHoja] = vaciarHoja(nombreHoja);
    });
    return borradas;
  });

  eliminarActivadoresCarpetas();
  eliminarActivadoresRecordatorio();
  PropertiesService.getScriptProperties().deleteProperty(PROPIEDAD_CAMPANIA_RECORDATORIO);
  const carpetaAnterior = enviarCarpetaRaizAPapelera();
  const carpetaNueva = obtenerCarpetaRaizDrive();
  const permisos = sincronizarPermisosCarpeta();

  const resumen = [
    'Respaldo del libro: ' + respaldo.getName() + ' (' + respaldo.getUrl() + ')',
    'Filas borradas: ' + HOJAS_REINICIABLES.map(function (nombreHoja) {
      return nombreHoja + ' ' + filasBorradas[nombreHoja];
    }).join(', '),
    'Carpetas anteriores enviadas a la papelera de Drive (recuperables por 30 días): ' + carpetaAnterior,
    'Carpeta raíz nueva: ' + carpetaNueva.getUrl(),
    'Personal con acceso a la carpeta nueva: ' + permisos.conAcceso,
    'Listo: importa la lista de alumnos a un trámite y se crearán sus carpetas por trámite, carrera y matrícula.'
  ].concat(permisos.avisos);
  console.log(resumen.join('\n'));
  return resumen;
}

/**
 * Solo carpetas: manda a la papelera las carpetas raiz y crea la estructura
 * de nuevo para los alumnos que ya estan en la hoja. No borra datos de las
 * hojas. Se niega si ya hay documentos subidos, porque sus archivos viven
 * en las carpetas viejas y el visor dejaria de encontrarlos.
 */
function reiniciarCarpetas() {
  const documentos = leerHoja(HOJAS.DOCUMENTOS).length;
  if (documentos) {
    throw new Error('Hay ' + documentos + ' documentos subidos. Usa reiniciarDatosDelSistema() para empezar de cero.');
  }
  eliminarActivadoresCarpetas();
  const enviadas = enviarCarpetaRaizAPapelera();
  const carpetaNueva = obtenerCarpetaRaizDrive();
  const permisos = sincronizarPermisosCarpeta();
  const carpetas = crearCarpetasConContinuacion(leerTodasLasCarpetas(), TIEMPO_CARPETAS_SEGUNDO_PLANO_MS);
  const resumen = [
    'Carpetas anteriores enviadas a la papelera de Drive: ' + enviadas,
    'Carpeta raíz nueva: ' + carpetaNueva.getUrl(),
    'Personal con acceso a la carpeta nueva: ' + permisos.conAcceso,
    'Carpetas de alumnos creadas: ' + carpetas.creadas + '; pendientes (se terminan en segundo plano): ' + carpetas.pendientes
  ].concat(permisos.avisos);
  console.log(resumen.join('\n'));
  return resumen;
}

/**
 * Pasa los datos anteriores a los tramites: crea el tramite "Nuevo ingreso
 * <generacion activa>" (encendido, con CURP, acta y certificado), habilita
 * en el a todos los alumnos y le asigna los documentos que ya tenian.
 * Solo se ejecuta si todavia no existe ningun tramite. Los archivos ya
 * subidos se quedan en sus carpetas de Drive; los nuevos van a la carpeta
 * del tramite.
 */
function migrarAProcesos() {
  inicializarBaseDeDatos();
  const resultado = conBloqueoEscritura(function () {
    if (leerProcesos().length) {
      throw new Error('Ya existen trámites; la migración solo se ejecuta una vez.');
    }
    const generacion = String(obtenerValorConfiguracion('GENERACION_ACTIVA') || '').trim();
    const idProceso = generarId(PREFIJO_ID_PROCESO);
    const nombre = 'Nuevo ingreso ' + generacion;
    insertarRegistros(HOJAS.PROCESOS, [{
      id_proceso: idProceso, nombre: nombre, activo: true, fecha_apertura: '', fecha_cierre: '', fecha_alta: new Date()
    }]);
    insertarRegistros(HOJAS.REQUISITOS_PROCESO, TIPOS_DOCUMENTO_NUEVO_INGRESO.map(function (tipo, indice) {
      return { id_proceso: idProceso, tipo_documento: tipo, regla: REGLAS_REUTILIZACION.NUEVO, vigencia_meses: 0, orden: indice + 1 };
    }));
    const alumnos = leerHoja(HOJAS.ESTUDIANTES).filter(function (estudiante) {
      return !esMatriculaDePrueba(estudiante.matricula);
    });
    insertarRegistros(HOJAS.ALUMNOS_PROCESO, alumnos.map(function (estudiante) {
      return {
        id_proceso: idProceso,
        matricula: String(estudiante.matricula).trim(),
        carrera: String(estudiante.carrera || '').trim(),
        generacion: String(estudiante.generacion || '').trim(),
        estatus: String(estudiante.estatus_general || '').trim() || ESTATUS_EXPEDIENTE.PENDIENTE,
        fecha_alta: new Date()
      };
    }));
    const documentos = leerHoja(HOJAS.DOCUMENTOS);
    escribirColumna(HOJAS.DOCUMENTOS, 'id_proceso', documentos.map(function (documento) {
      return String(documento.id_proceso || '').trim() || (esMatriculaDePrueba(documento.matricula) ? ID_PROCESO_PRUEBA : idProceso);
    }));
    return { nombre: nombre, alumnos: alumnos.length, documentos: documentos.length };
  });
  const resumen = 'Trámite creado: ' + resultado.nombre + ' (encendido). Alumnos habilitados: ' + resultado.alumnos +
    '. Documentos asignados: ' + resultado.documentos + '.';
  console.log(resumen);
  return resumen;
}

/**
 * Copia completa del libro en la misma carpeta de Drive, con fecha y hora.
 */
function respaldarLibroMaestro(libro) {
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm');
  return DriveApp.getFileById(libro.getId()).makeCopy(PREFIJO_RESPALDO_LIBRO + libro.getName() + ' ' + fecha);
}

/**
 * Manda a la papelera la carpeta raiz guardada y TODAS las carpetas propias
 * con el nombre de la carpeta raiz, y olvida el ID guardado para que la
 * siguiente ejecucion cree una nueva. Buscar por nombre cubre carpetas
 * creadas por versiones anteriores, que no guardaban su ID, y duplicados;
 * sin eso la carpeta vieja se volvia a usar. Devuelve cuantas envio.
 */
function enviarCarpetaRaizAPapelera() {
  const propiedades = PropertiesService.getScriptProperties();
  const idGuardado = propiedades.getProperty(PROPIEDAD_CARPETA_RAIZ_DRIVE);
  propiedades.deleteProperty(PROPIEDAD_CARPETA_RAIZ_DRIVE);

  const propietario = normalizarCorreo(Session.getEffectiveUser().getEmail());
  const candidatas = {};
  if (idGuardado) {
    try {
      const guardada = DriveApp.getFolderById(idGuardado);
      candidatas[guardada.getId()] = guardada;
    } catch (error) {
      console.warn('La carpeta raíz guardada ya no existe: ' + error.message);
    }
  }
  const porNombre = DriveApp.getFoldersByName(NOMBRE_CARPETA_RAIZ_DRIVE);
  while (porNombre.hasNext()) {
    const carpeta = porNombre.next();
    // Solo las propias: una carpeta compartida por otra persona no se toca.
    if (normalizarCorreo(carpeta.getOwner() && carpeta.getOwner().getEmail()) === propietario) {
      candidatas[carpeta.getId()] = carpeta;
    }
  }

  let enviadas = 0;
  Object.keys(candidatas).forEach(function (id) {
    const carpeta = candidatas[id];
    if (carpeta.isTrashed()) {
      return;
    }
    try {
      carpeta.setTrashed(true);
      enviadas++;
    } catch (error) {
      console.warn('No se pudo enviar a la papelera la carpeta ' + id + ': ' + error.message);
    }
  });
  return enviadas;
}

/**
 * Escribe en la hoja Configuracion los valores predeterminados que aun no
 * tengan fila, para que el Administrador los vea y edite. No toca los que
 * ya existen.
 */
function agregarConfiguracionFaltante() {
  return conBloqueoEscritura(function () {
    const existentes = {};
    leerHoja(HOJAS.CONFIGURACION).forEach(function (fila) {
      existentes[String(fila.clave || '').trim()] = true;
    });
    const faltantes = CLAVES_CONFIGURACION.filter(function (clave) {
      return !existentes[clave];
    });
    insertarRegistros(HOJAS.CONFIGURACION, faltantes.map(function (clave) {
      return { clave: clave, valor: CONFIGURACION_PREDETERMINADA[clave] };
    }));
    return faltantes;
  });
}
