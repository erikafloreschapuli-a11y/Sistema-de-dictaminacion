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
