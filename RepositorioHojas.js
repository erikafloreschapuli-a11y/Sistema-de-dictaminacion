/**
 * RepositorioHojas.js
 * Capa de acceso a datos sobre Google Sheets. No contiene logica de negocio.
 * Las escrituras se agrupan con conBloqueoEscritura() desde la capa de
 * servicio para cumplir RNF-03 (LockService en toda escritura).
 */

// Objetos reutilizados durante UNA ejecucion. En Apps Script las variables
// globales se crean de nuevo en cada llamada, asi que nunca se comparten
// entre usuarios. Abrir el libro y leer encabezados cuesta llamadas a Google;
// repetirlo dentro del bloqueo alargaba la espera de las cargas simultaneas.
// Solo se guardan libro, hojas y encabezados: los datos siempre se leen frescos.
const cacheEjecucion = { libro: null, hojas: {}, encabezados: {} };

/**
 * Devuelve el libro maestro configurado en Propiedades del Script.
 * Si el script esta vinculado a una hoja, la usa y guarda su ID.
 */
function obtenerLibroMaestro() {
  if (cacheEjecucion.libro) {
    return cacheEjecucion.libro;
  }
  const idGuardado = PropertiesService.getScriptProperties().getProperty(PROPIEDAD_LIBRO_MAESTRO);
  if (idGuardado) {
    cacheEjecucion.libro = SpreadsheetApp.openById(idGuardado);
    return cacheEjecucion.libro;
  }
  const libroActivo = SpreadsheetApp.getActiveSpreadsheet();
  if (libroActivo) {
    PropertiesService.getScriptProperties().setProperty(PROPIEDAD_LIBRO_MAESTRO, libroActivo.getId());
    cacheEjecucion.libro = libroActivo;
    return libroActivo;
  }
  throw crearError('CONFIGURACION', 'No hay libro maestro configurado. Ejecuta definirLibroMaestro("ID_DE_LA_HOJA") primero.');
}

/**
 * Devuelve una hoja del libro maestro, o null si no existe.
 */
function obtenerHoja(nombreHoja) {
  if (!cacheEjecucion.hojas[nombreHoja]) {
    cacheEjecucion.hojas[nombreHoja] = obtenerLibroMaestro().getSheetByName(nombreHoja);
  }
  return cacheEjecucion.hojas[nombreHoja];
}

/**
 * Igual que obtenerHoja pero lanza un error claro si la hoja no existe.
 */
function obtenerHojaObligatoria(nombreHoja) {
  const hoja = obtenerHoja(nombreHoja);
  if (!hoja) {
    throw crearError('CONFIGURACION', 'La hoja ' + nombreHoja + ' no existe. Ejecuta instalarSistema() desde el editor.');
  }
  return hoja;
}

/**
 * Encabezados de la fila 1 de una hoja, leidos una sola vez por ejecucion.
 */
function obtenerEncabezados(nombreHoja) {
  if (!cacheEjecucion.encabezados[nombreHoja]) {
    const hoja = obtenerHojaObligatoria(nombreHoja);
    cacheEjecucion.encabezados[nombreHoja] = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  }
  return cacheEjecucion.encabezados[nombreHoja];
}

/**
 * Posicion (base 0) de una columna o error si no existe.
 */
function obtenerIndiceColumna(nombreHoja, nombreColumna) {
  const indice = obtenerEncabezados(nombreHoja).indexOf(nombreColumna);
  if (indice === -1) {
    throw crearError('CONFIGURACION', 'Columna desconocida en la hoja ' + nombreHoja + ': ' + nombreColumna);
  }
  return indice;
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
  cacheEjecucion.libro = null;
  cacheEjecucion.hojas = {};
  cacheEjecucion.encabezados = {};
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
    const encabezados = COLUMNAS_HOJAS[claveHoja];
    if (hoja.getLastRow() === 0) {
      hoja.appendRow(encabezados);
      hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
      hoja.setFrozenRows(1);
    }
    quitarColumnasVacias(hoja, encabezados.length);
  });
  return { ok: true, hojasCreadas: hojasCreadas };
}

/**
 * Una hoja nueva trae 26 columnas y todas cuentan para el limite de
 * 10 millones de celdas del libro. Se eliminan las que sobran, solo si
 * estan vacias.
 */
function quitarColumnasVacias(hoja, columnasUsadas) {
  const totalColumnas = hoja.getMaxColumns();
  if (totalColumnas > columnasUsadas && hoja.getLastColumn() <= columnasUsadas) {
    hoja.deleteColumns(columnasUsadas + 1, totalColumnas - columnasUsadas);
  }
}

/**
 * Devuelve las filas cuyo valor en una columna coincide exactamente (sin
 * distinguir mayusculas). Usa TextFinder para no leer toda la hoja: con
 * decenas de miles de registros de historial la diferencia es grande.
 * maximo limita a las ultimas coincidencias (las mas recientes).
 */
function buscarFilasPorValor(nombreHoja, nombreColumna, valorBuscado, maximo) {
  const valor = String(valorBuscado === undefined || valorBuscado === null ? '' : valorBuscado).trim();
  const hoja = obtenerHoja(nombreHoja);
  if (!valor || !hoja || hoja.getLastRow() < 2) {
    return [];
  }
  const encabezados = obtenerEncabezados(nombreHoja);
  const indice = obtenerIndiceColumna(nombreHoja, nombreColumna);
  let coincidencias = hoja.getRange(2, indice + 1, hoja.getLastRow() - 1, 1)
    .createTextFinder(valor)
    .matchEntireCell(true)
    .matchCase(false)
    .findAll();
  if (maximo && coincidencias.length > maximo) {
    coincidencias = coincidencias.slice(coincidencias.length - maximo);
  }
  const numerosFila = coincidencias.map(function (celda) {
    return celda.getRow();
  });
  // Pocas filas: se leen una por una. Muchas: una sola lectura completa es
  // mas rapida que decenas de llamadas a getValues.
  const todas = numerosFila.length > MAXIMO_LECTURAS_INDIVIDUALES ? hoja.getDataRange().getValues() : null;
  return numerosFila.map(function (numeroFila) {
    const valores = todas ? todas[numeroFila - 1] : hoja.getRange(numeroFila, 1, 1, encabezados.length).getValues()[0];
    const fila = { _fila: numeroFila };
    encabezados.forEach(function (encabezado, posicion) {
      fila[encabezado] = valores[posicion];
    });
    return fila;
  });
}

/**
 * Lee una hoja completa como objetos. Agrega _fila (numero de fila) como
 * metadato interno; nunca se envia tal cual al navegador.
 */
function leerHoja(nombreHoja) {
  const hoja = obtenerHoja(nombreHoja);
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
 * Primero usa TextFinder (no lee toda la hoja); si no encuentra nada,
 * revisa la hoja completa por si la celda tiene espacios de mas.
 */
function buscarPorClave(nombreHoja, nombreColumna, valorBuscado) {
  const encontradas = buscarFilasPorValor(nombreHoja, nombreColumna, valorBuscado);
  if (encontradas.length) {
    return encontradas[0];
  }
  return buscarPorClaveRecorriendo(nombreHoja, nombreColumna, valorBuscado);
}

function buscarPorClaveRecorriendo(nombreHoja, nombreColumna, valorBuscado) {
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
  const hoja = obtenerHojaObligatoria(nombreHoja);
  const encabezados = obtenerEncabezados(nombreHoja);
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
 * Actualiza columnas de una fila existente con una lectura y una escritura
 * del tramo afectado, en vez de una llamada por celda. Sin lock: el llamador
 * debe envolverlo con conBloqueoEscritura().
 */
function actualizarRegistro(nombreHoja, numeroFila, cambios) {
  const hoja = obtenerHojaObligatoria(nombreHoja);
  const claves = Object.keys(cambios);
  if (!claves.length) {
    return;
  }
  const indices = claves.map(function (clave) {
    return obtenerIndiceColumna(nombreHoja, clave);
  });
  const primera = Math.min.apply(null, indices);
  const ultima = Math.max.apply(null, indices);
  const rango = hoja.getRange(numeroFila, primera + 1, 1, ultima - primera + 1);
  const valores = rango.getValues()[0];
  claves.forEach(function (clave, posicion) {
    const valor = cambios[clave];
    valores[indices[posicion] - primera] = valor === undefined || valor === null ? '' : valor;
  });
  rango.setValues([valores]);
}

/**
 * Elimina filas por numero, de abajo hacia arriba para que los numeros no
 * se recorran, agrupando filas contiguas en una sola llamada.
 * Nunca se usa sobre Historial (RF-31). Sin lock: el llamador debe
 * envolverlo con conBloqueoEscritura().
 */
function eliminarFilas(nombreHoja, numerosFila) {
  if (nombreHoja === HOJAS.HISTORIAL) {
    throw crearError('AUTORIZACION', 'El historial no se puede eliminar (RF-31).');
  }
  const hoja = obtenerHoja(nombreHoja);
  if (!hoja || !numerosFila.length) {
    return 0;
  }
  const ordenadas = numerosFila.slice().sort(function (a, b) { return b - a; });
  let inicioBloque = ordenadas[0];
  let tamanoBloque = 1;
  for (let i = 1; i <= ordenadas.length; i++) {
    if (i < ordenadas.length && ordenadas[i] === inicioBloque - 1) {
      inicioBloque = ordenadas[i];
      tamanoBloque++;
    } else {
      hoja.deleteRows(inicioBloque, tamanoBloque);
      if (i < ordenadas.length) {
        inicioBloque = ordenadas[i];
        tamanoBloque = 1;
      }
    }
  }
  return ordenadas.length;
}

/**
 * Borra todas las filas de datos y deja solo los encabezados. Solo la usa
 * reiniciarDatosDelSistema, que se ejecuta a mano desde el editor. Sin lock:
 * el llamador debe envolverlo con conBloqueoEscritura().
 */
function vaciarHoja(nombreHoja) {
  const hoja = obtenerHoja(nombreHoja);
  if (!hoja || hoja.getLastRow() < 2) {
    return 0;
  }
  const filas = hoja.getLastRow() - 1;
  // Sheets no permite borrar todas las filas no congeladas: si la hoja
  // termina justo en la ultima fila con datos, se agrega una vacia antes.
  if (hoja.getMaxRows() === hoja.getLastRow()) {
    hoja.insertRowsAfter(hoja.getMaxRows(), 1);
  }
  hoja.deleteRows(2, filas);
  return filas;
}

/**
 * Sobrescribe una columna completa desde la fila 2, en el mismo orden que
 * devuelve leerHoja(). Una sola llamada evita agotar el tiempo con miles de
 * filas (RNF-04). Sin lock: el llamador debe envolverlo con conBloqueoEscritura().
 */
function escribirColumna(nombreHoja, nombreColumna, valores) {
  if (!valores.length) {
    return 0;
  }
  const hoja = obtenerHojaObligatoria(nombreHoja);
  const indice = obtenerIndiceColumna(nombreHoja, nombreColumna);
  const filas = valores.map(function (valor) {
    return [valor === undefined || valor === null ? '' : valor];
  });
  hoja.getRange(2, indice + 1, filas.length, 1).setValues(filas);
  return filas.length;
}

/**
 * Ejecuta una funcion dentro del lock de escritura del script (RNF-03).
 * Evita que dos dictaminadores o administradores pisen la misma celda.
 */
function conBloqueoEscritura(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(TIEMPO_ESPERA_BLOQUEO_MS)) {
    // Codigo OCUPADO: el navegador reintenta solo (ver api() en scripts.html).
    throw crearError('OCUPADO', 'Hay muchas personas usando el sistema en este momento. Intenta de nuevo en unos segundos.');
  }
  try {
    return callback();
  } finally {
    // Sin flush, la siguiente ejecucion podria leer la hoja antes de que
    // se apliquen estas escrituras y sobrescribirlas (RNF-03).
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/**
 * Genera un identificador unico con prefijo (seccion 6).
 */
function generarId(prefijo) {
  return prefijo + Utilities.getUuid().toUpperCase();
}
