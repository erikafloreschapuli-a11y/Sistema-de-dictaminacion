/**
 * ServicioAdministrador.js
 * Panel del Administrador: dictaminadores (RF-22),
 * importacion de estudiantes (RF-25) y configuracion (RF-26).
 * Toda escritura ocurre dentro de conBloqueoEscritura (RNF-03).
 */

/* ------------------------------------------------------------------ */
/* RF-22: alta, baja y cambio de rol de dictaminadores                */
/* ------------------------------------------------------------------ */

/**
 * Lista los usuarios con rol gestionable (dictaminadores y administradores).
 */
function apiObtenerDictaminadores() {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const usuarios = leerHoja(HOJAS.USUARIOS);
    const dictaminadores = usuarios
      .filter(function (usuario) {
        return esCorreoTrabajador(usuario.correo) &&
          ROLES_GESTIONABLES.indexOf(normalizarRol(usuario.rol)) !== -1;
      })
      .map(function (usuario) {
        return {
          correo: normalizarCorreo(usuario.correo),
          nombre: String(usuario.nombre),
          rol: normalizarRol(usuario.rol),
          activo: esUsuarioActivo(usuario.activo),
          fecha_alta: convertirFechaTexto(usuario.fecha_alta)
        };
      })
      .sort(function (a, b) {
        return a.nombre.localeCompare(b.nombre);
      });
    return { ok: true, dictaminadores: dictaminadores };
  });
}

/**
 * Da de alta o modifica un dictaminador/administrador (RF-22).
 * Nunca permite que un administrador altere su propia cuenta.
 */
function apiGuardarDictaminador(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const correo = normalizarCorreo(datos && datos.correo);
    const nombre = String((datos && datos.nombre) || '').trim();
    const rol = normalizarRol(datos && datos.rol);
    const activo = Boolean(datos && datos.activo);

    validarCorreoTrabajador(correo);
    if (!nombre) {
      throw crearError('VALIDACION', 'El nombre es obligatorio.');
    }
    if (ROLES_GESTIONABLES.indexOf(rol) === -1) {
      throw crearError('VALIDACION', 'Rol no valido. Debe ser Dictaminador o Administrador.');
    }
    const existente = buscarPorClave(HOJAS.USUARIOS, 'correo', correo);
    if (existente && normalizarCorreo(existente.correo) === usuario.correo) {
      throw crearError('VALIDACION', 'No puedes modificar tu propia cuenta desde este panel.');
    }

    const resultado = conBloqueoEscritura(function () {
      const actual = buscarPorClave(HOJAS.USUARIOS, 'correo', correo);
      let accion = 'Alta';
      if (actual) {
        actualizarRegistro(HOJAS.USUARIOS, actual._fila, { nombre: nombre, rol: rol, activo: activo });
        accion = 'Modificacion';
        registrarEnHistorial({
          usuario: usuario.correo,
          tipo_documento: 'USUARIO',
          estatus_anterior: String(actual.rol) + ' (' + (esUsuarioActivo(actual.activo) ? 'Activo' : 'Inactivo') + ')',
          estatus_nuevo: rol + ' (' + (activo ? 'Activo' : 'Inactivo') + ')',
          observacion: 'Cambio de usuario ' + correo + ': ' + accion
        });
      } else {
        insertarRegistros(HOJAS.USUARIOS, [
          { correo: correo, nombre: nombre, rol: rol, activo: activo, fecha_alta: new Date() }
        ]);
        registrarEnHistorial({
          usuario: usuario.correo,
          tipo_documento: 'USUARIO',
          estatus_anterior: '-',
          estatus_nuevo: rol + ' (Activo)',
          observacion: 'Alta de usuario ' + correo
        });
      }
      return { ok: true, accion: accion, correo: correo };
    });

    // RF-34: solo personal activo edita la carpeta raiz de expedientes.
    resultado.avisoCarpeta = actualizarPermisoCarpeta(correo, activo);
    return resultado;
  });
}

/**
 * Cambia el estado activo/inactivo de un dictaminador (baja logica, RF-22).
 */
function apiCambiarEstadoDictaminador(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const correo = normalizarCorreo(datos && datos.correo);
    const activo = Boolean(datos && datos.activo);
    validarCorreoTrabajador(correo);
    if (correo === usuario.correo) {
      throw crearError('VALIDACION', 'No puedes cambiar el estado de tu propia cuenta.');
    }

    const resultado = conBloqueoEscritura(function () {
      const actual = buscarPorClave(HOJAS.USUARIOS, 'correo', correo);
      if (!actual) {
        throw crearError('VALIDACION', 'No existe un usuario con ese correo.');
      }
      if (ROLES_GESTIONABLES.indexOf(normalizarRol(actual.rol)) === -1) {
        throw crearError('VALIDACION', 'Solo se pueden dar de baja dictaminadores o administradores.');
      }
      actualizarRegistro(HOJAS.USUARIOS, actual._fila, { activo: activo });
      registrarEnHistorial({
        usuario: usuario.correo,
        tipo_documento: 'USUARIO',
        estatus_anterior: activo ? 'Inactivo' : 'Activo',
        estatus_nuevo: activo ? 'Activo' : 'Inactivo',
        observacion: (activo ? 'Reactivacion de ' : 'Baja de ') + correo
      });
      return { ok: true, correo: correo, activo: activo };
    });

    resultado.avisoCarpeta = actualizarPermisoCarpeta(correo, activo);
    return resultado;
  });
}

/* ------------------------------------------------------------------ */
/* RF-25: importar la lista de estudiantes de nuevo ingreso           */
/* ------------------------------------------------------------------ */

/**
 * Importa estudiantes desde texto CSV (separado por coma o punto y coma).
 * Todo o nada: si hay errores no se guarda ningun registro (RNF-06).
 */
function apiImportarEstudiantes(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const texto = String((datos && datos.texto) || '').trim();
    if (!texto) {
      throw crearError('VALIDACION', 'Pega o carga un archivo CSV con la lista de estudiantes.');
    }

    const parseo = parsearCsv(texto);
    const columnasRequeridas = ['matricula', 'nombre', 'correo_institucional', 'carrera', 'generacion'];
    const faltantes = columnasRequeridas.filter(function (columna) {
      return parseo.encabezados.indexOf(columna) === -1;
    });
    if (faltantes.length) {
      throw crearError('VALIDACION', 'Faltan columnas obligatorias: ' + faltantes.join(', ') + '.');
    }
    if (!parseo.filas.length) {
      throw crearError('VALIDACION', 'El archivo no contiene registros.');
    }

    const existentes = leerHoja(HOJAS.ESTUDIANTES);
    const errores = [];
    const nuevos = [];
    const matriculasVistas = {};
    const correosVistos = {};

    existentes.forEach(function (estudiante) {
      matriculasVistas[String(estudiante.matricula).trim().toLowerCase()] = true;
      correosVistos[String(estudiante.correo_institucional).trim().toLowerCase()] = true;
    });

    parseo.filas.forEach(function (fila, indice) {
      const numeroFila = indice + 2;
      const matricula = String(fila.matricula || '').trim();
      const nombre = String(fila.nombre || '').trim();
      const correoInstitucional = normalizarCorreo(fila.correo_institucional);
      const correoPersonal = normalizarCorreo(fila.correo_personal);
      const telefono = String(fila.telefono || '').trim();
      const carrera = String(fila.carrera || '').trim();
      const generacion = String(fila.generacion || '').trim();
      const claveMatricula = matricula.toLowerCase();

      if (!matricula) {
        errores.push({ fila: numeroFila, mensaje: 'matricula vacia' });
      } else if (matriculasVistas[claveMatricula]) {
        errores.push({ fila: numeroFila, mensaje: 'matricula duplicada: ' + matricula });
      }
      if (!nombre) {
        errores.push({ fila: numeroFila, mensaje: 'nombre vacio' });
      }
      if (!correoInstitucional) {
        errores.push({ fila: numeroFila, mensaje: 'correo_institucional vacio' });
      } else if (!esCorreoValido(correoInstitucional)) {
        errores.push({ fila: numeroFila, mensaje: 'correo_institucional con formato invalido: ' + correoInstitucional });
      } else if (!esCorreoEstudiante(correoInstitucional)) {
        errores.push({ fila: numeroFila, mensaje: 'correo_institucional fuera del dominio ' + DOMINIO_ESTUDIANTE + ': ' + correoInstitucional });
      } else if (correosVistos[correoInstitucional]) {
        errores.push({ fila: numeroFila, mensaje: 'correo_institucional duplicado: ' + correoInstitucional });
      }
      if (correoPersonal && !esCorreoValido(correoPersonal)) {
        errores.push({ fila: numeroFila, mensaje: 'correo_personal con formato invalido: ' + correoPersonal });
      }
      if (telefono && !/^[0-9+\-() ]{5,20}$/.test(telefono)) {
        errores.push({ fila: numeroFila, mensaje: 'telefono invalido: ' + telefono });
      }
      if (!carrera) {
        errores.push({ fila: numeroFila, mensaje: 'carrera vacia' });
      }
      if (!generacion) {
        errores.push({ fila: numeroFila, mensaje: 'generacion vacia' });
      }

      matriculasVistas[claveMatricula] = true;
      correosVistos[correoInstitucional] = true;
      nuevos.push({
        matricula: matricula,
        nombre: nombre,
        correo_institucional: correoInstitucional,
        correo_personal: correoPersonal,
        telefono: telefono,
        carrera: carrera,
        generacion: generacion,
        // El estatus se calcula a partir de los documentos; un alumno nuevo no tiene ninguno.
        estatus_general: ESTATUS_EXPEDIENTE.PENDIENTE
      });
    });

    if (errores.length) {
      return {
        ok: false,
        codigo: 'VALIDACION',
        mensaje: 'Se encontraron ' + errores.length + ' error(es). No se importo ningun registro.',
        errores: errores
      };
    }

    const resultado = conBloqueoEscritura(function () {
      const actuales = leerHoja(HOJAS.ESTUDIANTES);
      const matriculasAhora = {};
      actuales.forEach(function (estudiante) {
        matriculasAhora[String(estudiante.matricula).trim().toLowerCase()] = true;
      });
      const enConflicto = nuevos.filter(function (estudiante) {
        return matriculasAhora[estudiante.matricula.toLowerCase()];
      });
      if (enConflicto.length) {
        throw crearError('VALIDACION', 'La lista cambio durante la importacion. Matriculas duplicadas: ' +
          enConflicto.map(function (estudiante) { return estudiante.matricula; }).join(', '));
      }
      insertarRegistros(HOJAS.ESTUDIANTES, nuevos);
      registrarEnHistorial({
        usuario: usuario.correo,
        tipo_documento: 'IMPORTACION',
        estatus_anterior: actuales.length + ' estudiantes',
        estatus_nuevo: (actuales.length + nuevos.length) + ' estudiantes',
        observacion: 'Importacion de lista de nuevo ingreso (' + nuevos.length + ' registros)'
      });
      return { ok: true, insertados: nuevos.length, errores: [] };
    });

    // Fuera del lock: crear carpetas en Drive es lento y no toca la hoja.
    resultado.carpetas = crearCarpetasConContinuacion(nuevos, TIEMPO_CARPETAS_IMPORTACION_MS);
    return resultado;
  });
}

/* ------------------------------------------------------------------ */
/* RF-26: configuracion de parametros                                  */
/* ------------------------------------------------------------------ */

/**
 * Devuelve los parametros vigentes del sistema (RF-26).
 */
function apiObtenerConfiguracion() {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const valores = obtenerValoresConfiguracion();
    const configuracion = {};
    CLAVES_CONFIGURACION.forEach(function (clave) {
      configuracion[clave] = valores[clave] || CONFIGURACION_PREDETERMINADA[clave];
    });
    // Se muestran los formatos que realmente se aplican, no los guardados en la hoja.
    configuracion.TIPOS_PERMITIDOS = obtenerTiposPermitidos().join(',');
    return {
      ok: true,
      configuracion: configuracion,
      marcadores: MARCADORES_PLANTILLA,
      plantillasPredeterminadas: PLANTILLAS_CORREO_PREDETERMINADAS
    };
  });
}

/**
 * Valida y guarda asuntos y cuerpos de los correos automaticos (RF-29).
 */
function apiGuardarPlantillasCorreo(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const parametros = datos || {};
    const valores = {};
    CLAVES_PLANTILLAS_CORREO.forEach(function (clave) {
      valores[clave] = validarPlantillaCorreo(clave, parametros[clave]);
    });

    return conBloqueoEscritura(function () {
      guardarClavesConfiguracion(valores);
      registrarEnHistorial({
        usuario: usuario.correo,
        tipo_documento: 'CONFIGURACION',
        estatus_anterior: '-',
        estatus_nuevo: 'Plantillas de correo actualizadas',
        observacion: 'Se actualizaron los asuntos y textos de los correos automaticos'
      });
      return { ok: true, configuracion: valores };
    });
  });
}

/**
 * Normaliza una plantilla y rechaza las vacias, muy largas o con marcadores
 * que no existen para ese correo (RNF-06).
 */
function validarPlantillaCorreo(clave, valor) {
  const esAsunto = clave.indexOf('ASUNTO_') === 0;
  const etiqueta = esAsunto ? 'El asunto' : 'El texto del correo';
  const limite = esAsunto ? LONGITUD_MAXIMA_ASUNTO_CORREO : LONGITUD_MAXIMA_CUERPO_CORREO;
  let texto = String(valor === undefined || valor === null ? '' : valor).replace(/\r\n?/g, '\n').trim();
  if (esAsunto) {
    texto = texto.replace(/\s*\n\s*/g, ' ');
  }
  if (!texto) {
    throw crearError('VALIDACION', etiqueta + ' no puede quedar vacio.');
  }
  if (texto.length > limite) {
    throw crearError('VALIDACION', etiqueta + ' no puede superar ' + limite + ' caracteres.');
  }
  const permitidos = MARCADORES_PLANTILLA[clave] || [];
  const desconocidos = [];
  texto.replace(/\{\{\s*(\w+)\s*\}\}/g, function (coincidencia, marcador) {
    if (permitidos.indexOf(marcador) === -1 && desconocidos.indexOf(marcador) === -1) {
      desconocidos.push(marcador);
    }
    return coincidencia;
  });
  if (desconocidos.length) {
    throw crearError('VALIDACION', etiqueta + ' usa marcadores no validos: {{' + desconocidos.join('}}, {{') +
      '}}. Disponibles: {{' + permitidos.join('}}, {{') + '}}.');
  }
  return texto;
}

/**
 * Valida y guarda los parametros: tamano maximo, tipos permitidos y
 * generacion activa (RF-26). Solo el Administrador puede escribir.
 */
function apiGuardarConfiguracion(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const parametros = datos || {};

    const tamano = String(parametros.TAMANIO_MAXIMO_ARCHIVO_MB || '').trim();
    if (!/^\d+$/.test(tamano)) {
      throw crearError('VALIDACION', 'El tamano maximo debe ser un numero entero de ' +
        RANGO_TAMANIO_ARCHIVO_MB.MINIMO + ' a ' + RANGO_TAMANIO_ARCHIVO_MB.MAXIMO + ' MB.');
    }
    const tamanoNumero = Number(tamano);
    if (tamanoNumero < RANGO_TAMANIO_ARCHIVO_MB.MINIMO || tamanoNumero > RANGO_TAMANIO_ARCHIVO_MB.MAXIMO) {
      throw crearError('VALIDACION', 'El tamano maximo debe estar entre ' +
        RANGO_TAMANIO_ARCHIVO_MB.MINIMO + ' y ' + RANGO_TAMANIO_ARCHIVO_MB.MAXIMO + ' MB (RF-10).');
    }

    const tipos = String(parametros.TIPOS_PERMITIDOS || '')
      .split(',')
      .map(function (tipo) { return tipo.trim().toUpperCase(); })
      .filter(function (tipo) { return tipo !== ''; });
    if (!tipos.length) {
      throw crearError('VALIDACION', 'Debes indicar al menos un tipo de archivo permitido.');
    }
    const noPermitidos = tipos.filter(function (tipo) {
      return FORMATOS_ARCHIVO.indexOf(tipo) === -1;
    });
    if (noPermitidos.length) {
      throw crearError('VALIDACION', 'Formatos no permitidos: ' + noPermitidos.join(', ') +
        '. Solo se aceptan ' + FORMATOS_ARCHIVO.join(', ') + '.');
    }

    const generacion = String(parametros.GENERACION_ACTIVA || '').trim();
    if (!generacion || generacion.length > LONGITUD_MAXIMA_GENERACION || !/^[A-Za-z0-9\s\-/.]+$/.test(generacion)) {
      throw crearError('VALIDACION', 'La generacion activa es obligatoria (maximo 30 caracteres).');
    }

    const valores = {
      TAMANIO_MAXIMO_ARCHIVO_MB: tamano,
      TIPOS_PERMITIDOS: tipos.join(','),
      GENERACION_ACTIVA: generacion
    };

    return conBloqueoEscritura(function () {
      guardarClavesConfiguracion(valores);
      registrarEnHistorial({
        usuario: usuario.correo,
        tipo_documento: 'CONFIGURACION',
        estatus_anterior: '-',
        estatus_nuevo: 'Parametros actualizados',
        observacion: 'Tamano ' + tamano + ' MB, tipos ' + tipos.join(',') + ', generacion ' + generacion
      });
      return { ok: true, configuracion: valores };
    });
  });
}

/**
 * Escribe o actualiza cada clave de configuracion en su hoja (RF-26).
 * Se ejecuta siempre dentro del lock de escritura.
 */
function guardarClavesConfiguracion(valores) {
  const existentes = leerHoja(HOJAS.CONFIGURACION);
  const filasNuevas = [];
  // Solo se tocan las claves recibidas: parametros y plantillas se guardan por separado.
  Object.keys(valores).forEach(function (clave) {
    const fila = existentes.find(function (registro) {
      return String(registro.clave).trim() === clave;
    });
    if (fila) {
      actualizarRegistro(HOJAS.CONFIGURACION, fila._fila, { valor: valores[clave] });
    } else {
      filasNuevas.push({ clave: clave, valor: valores[clave] });
    }
  });
  if (filasNuevas.length) {
    insertarRegistros(HOJAS.CONFIGURACION, filasNuevas);
  }
}

/* ------------------------------------------------------------------ */
/* Funciones auxiliares internas                                       */
/* ------------------------------------------------------------------ */

function validarCorreoTrabajador(correo) {
  if (!esCorreoValido(correo)) {
    throw crearError('VALIDACION', 'El correo no tiene un formato valido.');
  }
  if (!esCorreoTrabajador(correo)) {
    throw crearError('VALIDACION', 'El correo debe pertenecer a ' + DOMINIO_TRABAJADORES + ' (RF-01).');
  }
}

function convertirFechaTexto(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return valor.toISOString();
  }
  const texto = String(valor === undefined || valor === null ? '' : valor).trim();
  if (!texto) {
    return '';
  }
  const momento = new Date(texto).getTime();
  return isNaN(momento) ? texto : new Date(momento).toISOString();
}

/**
 * Convierte un valor "AAAA-MM-DD" (input type=date) a fecha local,
 * evitando que el desfase UTC corra el dia del filtro.
 */
function parsearFechaSolo(valor) {
  const partes = String(valor).split('-');
  if (partes.length === 3) {
    return new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
  }
  return new Date(valor);
}

/**
 * Detecta el separador del CSV contando comas o punto y coma en la cabecera.
 */
function detectarDelimitador(lineaCabecera) {
  const comas = (lineaCabecera.match(/,/g) || []).length;
  const puntoYComa = (lineaCabecera.match(/;/g) || []).length;
  return puntoYComa > comas ? ';' : ',';
}

/**
 * Parte una linea respetando campos entre comillas dobles.
 */
function partirLinea(linea, delimitador) {
  const partes = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const caracter = linea.charAt(i);
    if (caracter === '"') {
      if (entreComillas && linea.charAt(i + 1) === '"') {
        actual += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
    } else if (caracter === delimitador && !entreComillas) {
      partes.push(actual);
      actual = '';
    } else {
      actual += caracter;
    }
  }
  partes.push(actual);
  return partes;
}

/**
 * Convierte texto CSV en encabezados en minusculas y filas objeto.
 */
function parsearCsv(texto) {
  const lineas = texto.split(/\r\n|\n|\r/).filter(function (linea) {
    return linea.trim() !== '';
  });
  if (!lineas.length) {
    return { encabezados: [], filas: [] };
  }
  const delimitador = detectarDelimitador(lineas[0]);
  const encabezados = partirLinea(lineas[0], delimitador).map(function (encabezado) {
    return encabezado.trim().toLowerCase();
  });
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const valores = partirLinea(lineas[i], delimitador);
    const fila = {};
    encabezados.forEach(function (encabezado, indice) {
      fila[encabezado] = String(valores[indice] === undefined ? '' : valores[indice]).trim();
    });
    filas.push(fila);
  }
  return { encabezados: encabezados, filas: filas };
}
