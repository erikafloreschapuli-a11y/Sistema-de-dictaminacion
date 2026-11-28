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
 * Habilita en un tramite (datos.idProceso) a los alumnos de un CSV
 * (separado por coma o punto y coma). La matricula identifica al alumno:
 *   - si no existe, se da de alta;
 *   - si ya existe, se conserva su registro y solo se le habilita el tramite
 *     (sus datos se actualizan unicamente con datos.actualizarExistentes);
 *   - si ya estaba habilitado en ese tramite, se omite.
 * Todo o nada: si hay errores no se guarda ningun registro (RNF-06).
 */
function apiImportarEstudiantes(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const proceso = obtenerProceso(datos && datos.idProceso);
    if (proceso.id_proceso === ID_PROCESO_PRUEBA) {
      throw crearError('VALIDACION', 'Elige un trámite para habilitar a los alumnos.');
    }
    const actualizarExistentes = Boolean(datos && datos.actualizarExistentes);
    const texto = String((datos && datos.texto) || '').trim();
    if (!texto) {
      throw crearError('VALIDACION', 'Pega o carga un archivo CSV con la lista de estudiantes.');
    }

    const parseo = parsearCsv(texto);
    const faltantes = COLUMNAS_IMPORTACION_OBLIGATORIAS.filter(function (columna) {
      return parseo.encabezados.indexOf(columna) === -1;
    });
    if (faltantes.length) {
      throw crearError('VALIDACION', 'Faltan columnas obligatorias: ' + faltantes.join(', ') + '.');
    }
    if (!parseo.filas.length) {
      throw crearError('VALIDACION', 'El archivo no contiene registros.');
    }

    const validacion = validarFilasImportacion(parseo.filas, leerHoja(HOJAS.ESTUDIANTES));
    if (validacion.errores.length) {
      return {
        ok: false,
        codigo: 'VALIDACION',
        mensaje: 'Se encontraron ' + validacion.errores.length + ' error(es). No se importo ningun registro.',
        errores: validacion.errores
      };
    }

    const resultado = conBloqueoEscritura(function () {
      return guardarImportacion(proceso, validacion.filas, actualizarExistentes, usuario);
    });

    // Fuera del lock: crear carpetas en Drive es lento y no toca la hoja.
    resultado.carpetas = crearCarpetasConContinuacion(resultado.habilitados.map(function (fila) {
      return { matricula: fila.matricula, carrera: fila.carrera, grupo: proceso.nombre };
    }), TIEMPO_CARPETAS_IMPORTACION_MS);
    resultado.habilitados = resultado.habilitados.length;
    return resultado;
  });
}

/**
 * Revisa cada fila del CSV contra si misma y contra los alumnos existentes.
 * Devuelve { errores, filas } con las filas ya normalizadas.
 */
function validarFilasImportacion(filasCsv, existentes) {
  const porMatricula = {};
  const matriculaPorCorreo = {};
  existentes.forEach(function (estudiante) {
    const matricula = String(estudiante.matricula).trim().toLowerCase();
    porMatricula[matricula] = estudiante;
    matriculaPorCorreo[normalizarCorreo(estudiante.correo_institucional)] = matricula;
  });

  const errores = [];
  const filas = [];
  const matriculasCsv = {};
  const correosCsv = {};
  filasCsv.forEach(function (fila, indice) {
    const numeroFila = indice + 2;
    const registro = {
      matricula: String(fila.matricula || '').trim(),
      nombre: String(fila.nombre || '').trim(),
      correo_institucional: normalizarCorreo(fila.correo_institucional),
      correo_personal: normalizarCorreo(fila.correo_personal),
      telefono: String(fila.telefono || '').trim(),
      carrera: String(fila.carrera || '').trim(),
      generacion: String(fila.generacion || '').trim()
    };
    const clave = registro.matricula.toLowerCase();
    const agregarError = function (mensaje) { errores.push({ fila: numeroFila, mensaje: mensaje }); };

    if (!registro.matricula) {
      agregarError('matricula vacia');
    } else if (matriculasCsv[clave]) {
      agregarError('matricula repetida en el archivo: ' + registro.matricula);
    }
    if (!registro.nombre) {
      agregarError('nombre vacio');
    }
    if (!registro.correo_institucional) {
      agregarError('correo_institucional vacio');
    } else if (!esCorreoValido(registro.correo_institucional)) {
      agregarError('correo_institucional con formato invalido: ' + registro.correo_institucional);
    } else if (!esCorreoEstudiante(registro.correo_institucional)) {
      agregarError('correo_institucional fuera del dominio ' + DOMINIO_ESTUDIANTE + ': ' + registro.correo_institucional);
    } else if (correosCsv[registro.correo_institucional]) {
      agregarError('correo_institucional repetido en el archivo: ' + registro.correo_institucional);
    } else if (matriculaPorCorreo[registro.correo_institucional] && matriculaPorCorreo[registro.correo_institucional] !== clave) {
      agregarError('correo_institucional ya pertenece a otra matricula: ' + registro.correo_institucional);
    }
    if (registro.correo_personal && !esCorreoValido(registro.correo_personal)) {
      agregarError('correo_personal con formato invalido: ' + registro.correo_personal);
    }
    if (registro.telefono && !/^[0-9+\-() ]{5,20}$/.test(registro.telefono)) {
      agregarError('telefono invalido: ' + registro.telefono);
    }
    if (!registro.carrera) {
      agregarError('carrera vacia');
    }
    if (!registro.generacion) {
      agregarError('generacion vacia');
    }

    matriculasCsv[clave] = true;
    correosCsv[registro.correo_institucional] = true;
    registro.existente = porMatricula[clave] || null;
    filas.push(registro);
  });
  return { errores: errores, filas: filas };
}

/**
 * Escribe la importacion (requiere lock): altas, actualizaciones opcionales
 * y habilitacion en el tramite. Relee la hoja del tramite para no duplicar
 * si otra persona importo al mismo tiempo.
 */
function guardarImportacion(proceso, filas, actualizarExistentes, usuario) {
  const yaHabilitados = {};
  leerInscripcionesDeProceso(proceso.id_proceso).forEach(function (inscripcion) {
    yaHabilitados[inscripcion.matricula.toLowerCase()] = true;
  });
  const existentesAhora = {};
  leerHoja(HOJAS.ESTUDIANTES).forEach(function (estudiante) {
    existentesAhora[String(estudiante.matricula).trim().toLowerCase()] = estudiante;
  });

  const nuevos = [];
  const habilitados = [];
  let actualizados = 0;
  let conDiferencias = 0;
  let omitidos = 0;
  filas.forEach(function (fila) {
    const clave = fila.matricula.toLowerCase();
    if (yaHabilitados[clave]) {
      omitidos++;
      return;
    }
    const existente = existentesAhora[clave];
    const datosAlumno = {
      matricula: fila.matricula,
      nombre: fila.nombre,
      correo_institucional: fila.correo_institucional,
      correo_personal: fila.correo_personal,
      telefono: fila.telefono,
      carrera: fila.carrera,
      generacion: fila.generacion
    };
    if (!existente) {
      nuevos.push(Object.assign({ estatus_general: '' }, datosAlumno));
    } else {
      const cambios = obtenerCambiosAlumno(existente, datosAlumno);
      if (Object.keys(cambios).length) {
        if (actualizarExistentes) {
          actualizarRegistro(HOJAS.ESTUDIANTES, existente._fila, cambios);
          actualizados++;
        } else {
          conDiferencias++;
        }
      }
    }
    yaHabilitados[clave] = true;
    habilitados.push({
      id_proceso: proceso.id_proceso,
      matricula: fila.matricula,
      carrera: fila.carrera,
      generacion: fila.generacion,
      estatus: ESTATUS_EXPEDIENTE.PENDIENTE,
      fecha_alta: new Date()
    });
  });

  insertarRegistros(HOJAS.ESTUDIANTES, nuevos);
  insertarRegistros(HOJAS.ALUMNOS_PROCESO, habilitados);
  registrarEnHistorial({
    usuario: usuario.correo,
    tipo_documento: 'IMPORTACION',
    estatus_anterior: '-',
    estatus_nuevo: habilitados.length + ' habilitados',
    observacion: 'Importacion al tramite ' + proceso.nombre + ': ' + nuevos.length + ' alumnos nuevos, ' +
      (habilitados.length - nuevos.length) + ' existentes, ' + actualizados + ' actualizados, ' + omitidos + ' ya habilitados'
  });
  return {
    ok: true,
    insertados: nuevos.length,
    habilitados: habilitados,
    existentes: habilitados.length - nuevos.length,
    actualizados: actualizados,
    conDiferencias: conDiferencias,
    omitidos: omitidos,
    errores: []
  };
}

/**
 * Columnas cuyo valor en el CSV difiere del registro del alumno. Un valor
 * vacio en el CSV no borra el dato guardado.
 */
function obtenerCambiosAlumno(existente, datosAlumno) {
  const cambios = {};
  COLUMNAS_ACTUALIZABLES_IMPORTACION.forEach(function (columna) {
    const nuevo = String(datosAlumno[columna] || '').trim();
    const actual = String(existente[columna] === undefined || existente[columna] === null ? '' : existente[columna]).trim();
    if (nuevo && nuevo.toLowerCase() !== actual.toLowerCase()) {
      cambios[columna] = nuevo;
    }
  });
  return cambios;
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
 * Valida y guarda los parametros: tamano maximo y generacion activa (RF-26).
 * Los formatos permitidos los define cada documento del catalogo.
 * Solo el Administrador puede escribir.
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

    const generacion = String(parametros.GENERACION_ACTIVA || '').trim();
    if (!generacion || generacion.length > LONGITUD_MAXIMA_GENERACION || !/^[A-Za-z0-9\s\-/.]+$/.test(generacion)) {
      throw crearError('VALIDACION', 'La generacion activa es obligatoria (maximo 30 caracteres).');
    }

    const valores = {
      TAMANIO_MAXIMO_ARCHIVO_MB: tamano,
      GENERACION_ACTIVA: generacion
    };

    return conBloqueoEscritura(function () {
      guardarClavesConfiguracion(valores);
      registrarEnHistorial({
        usuario: usuario.correo,
        tipo_documento: 'CONFIGURACION',
        estatus_anterior: '-',
        estatus_nuevo: 'Parametros actualizados',
        observacion: 'Tamano ' + tamano + ' MB, generacion ' + generacion
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
