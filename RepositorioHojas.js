/**
 * RepositorioHojas.js
 * Capa de acceso a datos sobre Google Sheets. No contiene logica de negocio.
 * Las escrituras se agrupan con conBloqueoEscritura() desde la capa de
 * servicio para cumplir RNF-03 (LockService en toda escritura).
 */

/**
 * Devuelve el libro maestro configurado en Propiedades del Script.
 * Si el script esta vinculado a una hoja, la usa y guarda su ID.
 */
function obtenerLibroMaestro() {
  const idGuardado = PropertiesService.getScriptProperties().getProperty(PROPIEDAD_LIBRO_MAESTRO);
  if (idGuardado) {
    return SpreadsheetApp.openById(idGuardado);
  }
  const libroActivo = SpreadsheetApp.getActiveSpreadsheet();
  if (libroActivo) {
    PropertiesService.getScriptProperties().setProperty(PROPIEDAD_LIBRO_MAESTRO, libroActivo.getId());
    return libroActivo;
  }
  throw crearError('CONFIGURACION', 'No hay libro maestro configurado. Ejecuta definirLibroMaestro("ID_DE_LA_HOJA") primero.');
}

/**
 * Guarda el ID de un libro existente despues de verificar el acceso
 * y lo prepara con todas las hojas (RF-26 y seccion 6).
 */
function definirLibroMaestro(idLibro) {
  let libro;
  try {
    libro = SpreadsheetApp.openById(idLibro);
  } catch (error) {
    throw crearError('CONFIGURACION', 'No se pudo abrir el libro con ese ID. Verifica el ID y tus permisos de acceso.');
  }
  PropertiesService.getScriptProperties().setProperty(PROPIEDAD_LIBRO_MAESTRO, String(idLibro).trim());
  const preparacion = inicializarBaseDeDatos();
  return { ok: true, id: idLibro, titulo: libro.getName(), hojasCreadas: preparacion.hojasCreadas };
}

/**
 * Crea las hojas y encabezados que falten. Idempotente: nunca borra datos.
 */
function inicializarBaseDeDatos() {
  const libro = obtenerLibroMaestro();
  const hojasCreadas = [];
  Object.keys(COLUMNAS_HOJAS).forEach(function (claveHoja) {
    const nombre = HOJAS[claveHoja];
    let hoja = libro.getSheetByName(nombre);
    if (!hoja) {
      hoja = libro.insertSheet(nombre);
      hojasCreadas.push(nombre);
    }
    if (hoja.getLastRow() === 0) {
      const encabezados = COLUMNAS_HOJAS[claveHoja];
      hoja.appendRow(encabezados);
      hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
    }
  });
  return { ok: true, hojasCreadas: hojasCreadas };
}

/**
 * Lee una hoja completa como objetos. Agrega _fila (numero de fila) como
 * metadato interno; nunca se envia tal cual al navegador.
 */
function leerHoja(nombreHoja) {
  const libro = obtenerLibroMaestro();
  const hoja = libro.getSheetByName(nombreHoja);
  if (!hoja || hoja.getLastRow() < 2) {
    return [];
  }
  const datos = hoja.getDataRange().getValues();
  const encabezados = datos[0];
  const filas = [];
  for (let i = 1; i < datos.length; i++) {
    const fila = { _fila: i + 1 };
    for (let j = 0; j < encabezados.length; j++) {
      fila[encabezados[j]] = datos[i][j];
    }
    filas.push(fila);
  }
  return filas;
}

/**
 * Busca la primera fila cuyo valor en nombreColumna coincida
 * sin distinguir mayusculas ni espacios. Devuelve null si no existe.
 */
function buscarPorClave(nombreHoja, nombreColumna, valorBuscado) {
  const esperado = String(valorBuscado === undefined || valorBuscado === null ? '' : valorBuscado).trim().toLowerCase();
  const filas = leerHoja(nombreHoja);
  for (let i = 0; i < filas.length; i++) {
    const valor = String(filas[i][nombreColumna] === undefined ? '' : filas[i][nombreColumna]).trim().toLowerCase();
    if (valor === esperado) {
      return filas[i];
    }
  }
  return null;
}

/**
 * Inserta registros al final de la hoja respetando sus encabezados.
 * Sin lock: el llamador debe envolverlo con conBloqueoEscritura().
 */
function insertarRegistros(nombreHoja, registros) {
  if (!registros.length) {
    return 0;
  }
  const libro = obtenerLibroMaestro();
  const hoja = libro.getSheetByName(nombreHoja);
  if (!hoja) {
    throw crearError('CONFIGURACION', 'La hoja ' + nombreHoja + ' no existe. Ejecuta inicializarBaseDeDatos().');
  }
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const filas = registros.map(function (registro) {
    return encabezados.map(function (encabezado) {
      const valor = registro[encabezado];
      return valor === undefined || valor === null ? '' : valor;
    });
  });
  hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, encabezados.length).setValues(filas);
  return filas.length;
}

/**
 * Actualiza columnas de una fila existente. Sin lock: el llamador debe
 * envolverlo con conBloqueoEscritura().
 */
function actualizarRegistro(nombreHoja, numeroFila, cambios) {
  const libro = obtenerLibroMaestro();
  const hoja = libro.getSheetByName(nombreHoja);
  if (!hoja) {
    throw crearError('CONFIGURACION', 'La hoja ' + nombreHoja + ' no existe. Ejecuta inicializarBaseDeDatos().');
  }
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  Object.keys(cambios).forEach(function (clave) {
    const indice = encabezados.indexOf(clave);
    if (indice === -1) {
      throw crearError('CONFIGURACION', 'Columna desconocida en la hoja ' + nombreHoja + ': ' + clave);
    }
    const valor = cambios[clave];
    hoja.getRange(numeroFila, indice + 1).setValue(valor === undefined || valor === null ? '' : valor);
  });
}

/**
 * Ejecuta una funcion dentro del lock de escritura del script (RNF-03).
 * Evita que dos dictaminadores o administradores pisen la misma celda.
 */
function conBloqueoEscritura(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(TIEMPO_ESPERA_BLOQUEO_MS);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Genera un identificador unico con prefijo (seccion 6).
 */
function generarId(prefijo) {
  return prefijo + Utilities.getUuid().toUpperCase();
}
