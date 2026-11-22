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
  const carpetas = crearCarpetasConContinuacion(leerHoja(HOJAS.ESTUDIANTES), TIEMPO_CARPETAS_SEGUNDO_PLANO_MS);

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
  const carpetaAnterior = enviarCarpetaRaizAPapelera();
  const carpetaNueva = obtenerCarpetaRaizDrive();
  const permisos = sincronizarPermisosCarpeta();

  const resumen = [
    'Respaldo del libro: ' + respaldo.getName() + ' (' + respaldo.getUrl() + ')',
    'Filas borradas: ' + HOJAS_REINICIABLES.map(function (nombreHoja) {
      return nombreHoja + ' ' + filasBorradas[nombreHoja];
    }).join(', '),
    'Carpeta anterior: ' + (carpetaAnterior ? 'enviada a la papelera de Drive (recuperable por 30 días)' : 'no había carpeta'),
    'Carpeta raíz nueva: ' + carpetaNueva.getUrl(),
    'Personal con acceso a la carpeta nueva: ' + permisos.conAcceso,
    'Listo: importa la lista de alumnos y se crearán sus carpetas por carrera y matrícula.'
  ].concat(permisos.avisos);
  console.log(resumen.join('\n'));
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
 * Manda a la papelera la carpeta raiz actual y olvida su ID, para que la
 * siguiente ejecucion cree una nueva. Devuelve false si no habia carpeta.
 */
function enviarCarpetaRaizAPapelera() {
  const propiedades = PropertiesService.getScriptProperties();
  const idGuardado = propiedades.getProperty(PROPIEDAD_CARPETA_RAIZ_DRIVE);
  propiedades.deleteProperty(PROPIEDAD_CARPETA_RAIZ_DRIVE);
  if (!idGuardado) {
    return false;
  }
  try {
    DriveApp.getFolderById(idGuardado).setTrashed(true);
    return true;
  } catch (error) {
    console.warn('No se pudo enviar a la papelera la carpeta raíz: ' + error.message);
    return false;
  }
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
