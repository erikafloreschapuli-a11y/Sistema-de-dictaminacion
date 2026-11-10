/**
 * ServicioEstudiante.js
 * Panel del Estudiante: consulta y actualizacion de datos (RF-07, RF-08),
 * carga de documentos (RF-09 a RF-14) y almacenamiento en Drive (RF-32 a RF-35).
 * Toda escritura en Sheets ocurre dentro de conBloqueoEscritura (RNF-03).
 */

/* ------------------------------------------------------------------ */
/* RF-07 y RF-08: datos del estudiante                                */
/* ------------------------------------------------------------------ */

/**
 * Devuelve el expediente del estudiante de la sesion: datos personales,
 * documentos con su estatus y parametros de configuracion para la vista.
 */
function apiObtenerMiExpediente(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ESTUDIANTE]);
    const estudiante = obtenerEstudianteParaUsuario(usuario, datos && datos.matricula);
    return {
      ok: true,
      estudiante: convertirEstudianteParaVista(estudiante),
      documentos: obtenerDocumentosParaVista(estudiante.matricula),
      configuracion: {
        tamanoMaximoMb: obtenerTamanoMaximoMb(),
        tiposPermitidos: obtenerTiposPermitidos(),
        generacionActiva: String(obtenerValorConfiguracion('GENERACION_ACTIVA') || ''),
        tiposDocumento: TIPOS_DOCUMENTO.slice()
      }
    };
  });
}

/**
 * Actualiza telefono y correo personal del estudiante autenticado (RF-08).
 * Solo se modifican esas dos columnas; el resto de los datos es de solo lectura.
 */
function apiActualizarMisDatos(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ESTUDIANTE]);
    const telefono = String((datos && datos.telefono) || '').trim();
    const correoPersonal = normalizarCorreo(datos && datos.correoPersonal);
    validarTelefonoEstudiante(telefono);
    validarCorreoPersonalEstudiante(correoPersonal);

    return conBloqueoEscritura(function () {
      const actual = obtenerEstudianteParaUsuario(usuario, datos && datos.matricula);
      const telefonoAnterior = String(actual.telefono || '').trim();
      const correoAnterior = normalizarCorreo(actual.correo_personal);

      if (telefonoAnterior === telefono && correoAnterior === correoPersonal) {
        return { ok: true, sinCambios: true, estudiante: convertirEstudianteParaVista(actual) };
      }

      actualizarRegistro(HOJAS.ESTUDIANTES, actual._fila, {
        telefono: telefono,
        correo_personal: correoPersonal
      });
      registrarEnHistorial({
        usuario: usuario.correo,
        matricula: String(actual.matricula),
        tipo_documento: 'DATOS',
        estatus_anterior: 'Telefono: ' + (telefonoAnterior || '-') + ' / Correo personal: ' + (correoAnterior || '-'),
        estatus_nuevo: 'Telefono: ' + (telefono || '-') + ' / Correo personal: ' + (correoPersonal || '-'),
        observacion: 'Actualizacion de datos de contacto por el estudiante'
      });

      const actualizado = Object.assign({}, actual, {
        telefono: telefono,
        correo_personal: correoPersonal
      });
      return { ok: true, estudiante: convertirEstudianteParaVista(actualizado) };
    });
  });
}

/* ------------------------------------------------------------------ */
/* RF-09 a RF-14: carga de documentos                                 */
/* ------------------------------------------------------------------ */

/**
 * Carga o reemplaza un documento del estudiante.
 * Valida formato y tamano en el servidor, guarda el archivo en Drive y
 * actualiza la hoja Documentos con estatus En Revision.
 */
function apiSubirDocumento(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ESTUDIANTE]);
    const tipoDocumento = obtenerTipoDocumentoValido(datos && datos.tipoDocumento);
    const archivo = prepararArchivoParaCarga(datos || {});

    return conBloqueoEscritura(function () {
      const estudiante = obtenerEstudianteParaUsuario(usuario, datos && datos.matricula);
      const documentoActual = buscarDocumentoDeEstudiante(estudiante.matricula, tipoDocumento);
      const estatusAnterior = documentoActual
        ? normalizarEstatusDocumento(documentoActual.estatus)
        : ESTATUS_DOCUMENTO.PENDIENTE;
      validarEstatusParaCarga(estatusAnterior);

      const carpeta = obtenerCarpetaExpediente(estudiante);
      const nombreArchivo = construirNombreArchivo(estudiante.matricula, tipoDocumento, archivo.extension);
      const archivoDrive = carpeta.createFile(Utilities.newBlob(archivo.bytes, archivo.mime, nombreArchivo));
      const ahora = new Date();
      const cambios = {
        url_archivo: archivoDrive.getUrl(),
        estatus: ESTATUS_DOCUMENTO.EN_REVISION,
        observaciones: '',
        fecha_carga: ahora,
        fecha_dictamen: '',
        dictaminador: ''
      };

      let registro;
      if (documentoActual) {
        actualizarRegistro(HOJAS.DOCUMENTOS, documentoActual._fila, cambios);
        registro = Object.assign({}, documentoActual, cambios);
      } else {
        registro = Object.assign({
          id_documento: generarId(PREFIJOS_ID.DOCUMENTO),
          matricula: String(estudiante.matricula),
          tipo_documento: tipoDocumento
        }, cambios);
        insertarRegistros(HOJAS.DOCUMENTOS, [registro]);
      }

      registrarEnHistorial({
        usuario: usuario.correo,
        matricula: String(estudiante.matricula),
        tipo_documento: tipoDocumento,
        estatus_anterior: estatusAnterior,
        estatus_nuevo: ESTATUS_DOCUMENTO.EN_REVISION,
        observacion: construirObservacionCarga(estatusAnterior, documentoActual)
      });

      return {
        ok: true,
        mensaje: 'Documento cargado. Queda en revision por el dictaminador.',
        documento: convertirDocumento(registro, tipoDocumento)
      };
    });
  });
}

/* ------------------------------------------------------------------ */
/* Funciones auxiliares del estudiante                                */
/* ------------------------------------------------------------------ */

/**
 * Localiza al estudiante por su correo institucional. Si no fue importado
 * por el Administrador, el acceso al panel no puede continuar.
 */
function obtenerEstudiantePorCorreo(correoInstitucional) {
  const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'correo_institucional', correoInstitucional);
  if (!estudiante) {
    throw crearError(
      'NO_REGISTRADO',
      'Tu correo institucional no aparece en la lista de estudiantes de nuevo ingreso. Contacta a Servicios Escolares.'
    );
  }
  return estudiante;
}

/**
 * Resuelve el estudiante de la operacion. El Administrador puede operar
 * sobre cualquier matricula indicada de forma explicita; el Estudiante solo
 * sobre su propio registro.
 */
function obtenerEstudianteParaUsuario(usuario, matriculaSolicitada) {
  if (usuario.rol !== ROLES.ADMINISTRADOR) {
    return obtenerEstudiantePorCorreo(usuario.correo);
  }
  const matricula = String(matriculaSolicitada === undefined || matriculaSolicitada === null ? '' : matriculaSolicitada).trim();
  if (!matricula) {
    throw crearError(
      'VALIDACION',
      'El Administrador debe indicar la matricula del estudiante sobre el que desea operar.'
    );
  }
  const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'matricula', matricula);
  if (!estudiante) {
    throw crearError('NO_REGISTRADO', 'No existe un estudiante con la matricula ' + matricula + '.');
  }
  return estudiante;
}

/**
 * Convierte una fila de Estudiantes en datos seguros para la vista.
 */
function convertirEstudianteParaVista(estudiante) {
  return {
    matricula: String(estudiante.matricula || ''),
    nombre: String(estudiante.nombre || ''),
    correo_institucional: String(estudiante.correo_institucional || ''),
    correo_personal: String(estudiante.correo_personal || ''),
    telefono: String(estudiante.telefono || ''),
    carrera: String(estudiante.carrera || ''),
    generacion: String(estudiante.generacion || ''),
    estatus_general: String(estudiante.estatus_general || '')
  };
}

/**
 * Devuelve los tres documentos requeridos, aunque todavia no exista fila
 * en la hoja Documentos (se muestran como Pendiente).
 */
function obtenerDocumentosParaVista(matricula) {
  const matriculaBuscada = String(matricula || '').trim().toLowerCase();
  const filas = leerHoja(HOJAS.DOCUMENTOS).filter(function (fila) {
    return String(fila.matricula || '').trim().toLowerCase() === matriculaBuscada;
  });
  const porTipo = {};
  filas.forEach(function (fila) {
    const clave = String(fila.tipo_documento || '').trim().toLowerCase();
    if (clave && !porTipo[clave]) {
      porTipo[clave] = fila;
    }
  });
  return TIPOS_DOCUMENTO.map(function (tipo) {
    return convertirDocumento(porTipo[tipo.toLowerCase()] || null, tipo);
  });
}

/**
 * Convierte una fila de Documentos en datos seguros para la vista.
 */
function convertirDocumento(registro, tipoDocumento) {
  const fila = registro || {};
  const estatus = normalizarEstatusDocumento(fila.estatus);
  return {
    id_documento: String(fila.id_documento || ''),
    tipo_documento: String(fila.tipo_documento || tipoDocumento || ''),
    url_archivo: String(fila.url_archivo || ''),
    estatus: estatus,
    observaciones: String(fila.observaciones === undefined || fila.observaciones === null ? '' : fila.observaciones).trim(),
    fecha_carga: convertirFechaTexto(fila.fecha_carga),
    fecha_dictamen: convertirFechaTexto(fila.fecha_dictamen),
    dictaminador: String(fila.dictaminador || ''),
    puedeCargar: ESTATUS_CARGA_PERMITIDA.indexOf(estatus) !== -1,
    motivoBloqueo: obtenerMotivoBloqueo(estatus)
  };
}

/**
 * Normaliza el estatus y tolera el alias Rechazado como Observado.
 */
function normalizarEstatusDocumento(valor) {
  const texto = String(valor === undefined || valor === null ? '' : valor).trim();
  const validos = [
    ESTATUS_DOCUMENTO.PENDIENTE,
    ESTATUS_DOCUMENTO.EN_REVISION,
    ESTATUS_DOCUMENTO.APROBADO,
    ESTATUS_DOCUMENTO.OBSERVADO
  ];
  if (validos.indexOf(texto) !== -1) {
    return texto;
  }
  if (texto.toLowerCase() === ESTATUS_RECHAZADO_ALIAS.toLowerCase()) {
    return ESTATUS_DOCUMENTO.OBSERVADO;
  }
  return ESTATUS_DOCUMENTO.PENDIENTE;
}

/**
 * Explica por que el estudiante no puede subir el documento en su estatus actual.
 */
function obtenerMotivoBloqueo(estatus) {
  if (estatus === ESTATUS_DOCUMENTO.APROBADO) {
    return 'Documento aprobado: no se puede reemplazar.';
  }
  if (estatus === ESTATUS_DOCUMENTO.EN_REVISION) {
    return 'Documento en revision: espera el dictamen del dictaminador.';
  }
  return '';
}

/**
 * Impide cargas cuando el documento ya fue aprobado o esta en revision.
 */
function validarEstatusParaCarga(estatus) {
  if (estatus === ESTATUS_DOCUMENTO.APROBADO) {
    throw crearError('VALIDACION', 'El documento ya fue aprobado y no se puede reemplazar (RF-14).');
  }
  if (estatus === ESTATUS_DOCUMENTO.EN_REVISION) {
    throw crearError('VALIDACION', 'El documento ya esta en revision. Espera el dictamen del dictaminador.');
  }
}

/**
 * Busca la fila de un documento por matricula y tipo.
 */
function buscarDocumentoDeEstudiante(matricula, tipoDocumento) {
  const matriculaBuscada = String(matricula || '').trim().toLowerCase();
  const tipoBuscado = String(tipoDocumento || '').trim().toLowerCase();
  const filas = leerHoja(HOJAS.DOCUMENTOS);
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    if (String(fila.matricula || '').trim().toLowerCase() === matriculaBuscada &&
        String(fila.tipo_documento || '').trim().toLowerCase() === tipoBuscado) {
      return fila;
    }
  }
  return null;
}

/**
 * Valida el tipo de documento recibido y regresa su nombre canonico.
 */
function obtenerTipoDocumentoValido(valor) {
  const buscado = String(valor || '').trim().toLowerCase();
  const encontrado = TIPOS_DOCUMENTO.find(function (tipo) {
    return tipo.toLowerCase() === buscado;
  });
  if (!encontrado) {
    throw crearError('VALIDACION', 'Tipo de documento no valido. Debe ser: ' + TIPOS_DOCUMENTO.join(', ') + '.');
  }
  return encontrado;
}

/**
 * Valida extension, contenido, tamano y firma binaria del archivo (RF-09, RF-10).
 */
function prepararArchivoParaCarga(datos) {
  const nombreArchivo = String(datos.nombreArchivo || '').trim();
  const extension = obtenerExtensionArchivo(nombreArchivo);
  const tiposPermitidos = obtenerTiposPermitidos();
  if (!extension || tiposPermitidos.indexOf(extension) === -1) {
    throw crearError('VALIDACION', 'Formato no permitido. Solo se aceptan: ' + tiposPermitidos.join(', ') + '.');
  }

  const contenido = String(datos.contenidoBase64 || '').replace(/\s+/g, '');
  if (!contenido) {
    throw crearError('VALIDACION', 'El archivo esta vacio o no se pudo leer.');
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(contenido);
  } catch (error) {
    throw crearError('VALIDACION', 'El contenido del archivo no es valido.');
  }
  if (!bytes || !bytes.length) {
    throw crearError('VALIDACION', 'El archivo esta vacio.');
  }

  const maximoBytes = obtenerTamanoMaximoMb() * BYTES_POR_MEGABYTE;
  if (bytes.length > maximoBytes) {
    throw crearError('VALIDACION', 'El archivo supera el tamano maximo de ' + obtenerTamanoMaximoMb() + ' MB.');
  }

  validarFirmaArchivo(extension, bytes);
  return {
    extension: extension,
    mime: TIPOS_MIME_ARCHIVO[extension],
    bytes: bytes
  };
}

/**
 * Confirma que los primeros bytes correspondan al formato declarado.
 */
function validarFirmaArchivo(extension, bytes) {
  const firma = FIRMAS_ARCHIVO[extension];
  if (!firma) {
    return;
  }
  if (bytes.length < firma.length) {
    throw crearError('VALIDACION', 'El archivo no corresponde al formato ' + extension + '.');
  }
  for (let i = 0; i < firma.length; i++) {
    if ((Number(bytes[i]) & 0xFF) !== firma[i]) {
      throw crearError('VALIDACION', 'El archivo no corresponde al formato ' + extension + '.');
    }
  }
}

/**
 * Devuelve la extension en mayusculas a partir del nombre del archivo.
 */
function obtenerExtensionArchivo(nombreArchivo) {
  const partes = String(nombreArchivo || '').split('.');
  if (partes.length < 2) {
    return '';
  }
  return partes.pop().trim().toUpperCase();
}

/**
 * Tamano maximo vigente en MB, acotado al rango permitido (RF-10).
 */
function obtenerTamanoMaximoMb() {
  const valor = Number(obtenerValorConfiguracion('TAMANIO_MAXIMO_ARCHIVO_MB'));
  const predeterminado = Number(CONFIGURACION_PREDETERMINADA.TAMANIO_MAXIMO_ARCHIVO_MB);
  if (isNaN(valor) || valor < RANGO_TAMANIO_ARCHIVO_MB.MINIMO || valor > RANGO_TAMANIO_ARCHIVO_MB.MAXIMO) {
    return predeterminado;
  }
  return valor;
}

/**
 * Formatos permitidos vigentes; si la configuracion es invalida usa los de fabrica.
 */
function obtenerTiposPermitidos() {
  const texto = String(obtenerValorConfiguracion('TIPOS_PERMITIDOS') || '');
  const tipos = texto.split(',').map(function (tipo) {
    return tipo.trim().toUpperCase();
  }).filter(function (tipo) {
    return FORMATOS_ARCHIVO.indexOf(tipo) !== -1;
  });
  return tipos.length ? tipos : FORMATOS_ARCHIVO.slice();
}

/**
 * Valida el telefono capturado por el estudiante (RF-08).
 */
function validarTelefonoEstudiante(telefono) {
  if (telefono && !/^[0-9+\-() ]{5,20}$/.test(telefono)) {
    throw crearError('VALIDACION', 'El telefono debe tener entre 5 y 20 caracteres numericos, espacios, guiones o parentesis.');
  }
}

/**
 * Valida el correo personal capturado por el estudiante (RF-08).
 */
function validarCorreoPersonalEstudiante(correo) {
  if (!correo) {
    return;
  }
  if (correo.length > 120 || !esCorreoValido(correo)) {
    throw crearError('VALIDACION', 'El correo personal no tiene un formato valido.');
  }
}

/**
 * Texto de auditoria para la carga de un documento.
 */
function construirObservacionCarga(estatusAnterior, documentoActual) {
  const observacionAnterior = documentoActual
    ? String(documentoActual.observaciones || '').trim()
    : '';
  if (estatusAnterior === ESTATUS_DOCUMENTO.OBSERVADO && observacionAnterior) {
    return 'Recarga tras observacion: ' + observacionAnterior.slice(0, 200);
  }
  return 'Carga de documento por el estudiante';
}

/* ------------------------------------------------------------------ */
/* RF-32 a RF-35: almacenamiento en Google Drive                      */
/* ------------------------------------------------------------------ */

/**
 * Devuelve la carpeta raiz compartida. El ID se configura en Propiedades
 * del Script para que todos los usuarios guarden en el mismo lugar.
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
        'No se pudo abrir la carpeta raiz de Drive. Verifica que este compartida con los usuarios y que el ID sea correcto.'
      );
    }
  }
  const raiz = DriveApp.getRootFolder();
  const existentes = raiz.getFoldersByName(NOMBRE_CARPETA_RAIZ_DRIVE);
  if (existentes.hasNext()) {
    return existentes.next();
  }
  return raiz.createFolder(NOMBRE_CARPETA_RAIZ_DRIVE);
}

/**
 * Crea la ruta Generacion -> Carrera -> Matricula (RF-32).
 */
function obtenerCarpetaExpediente(estudiante) {
  const matricula = String(estudiante.matricula || '').trim();
  if (!matricula) {
    throw crearError('VALIDACION', 'El estudiante no tiene matricula registrada.');
  }
  const generacion = String(estudiante.generacion || '').trim() || CARPETA_SIN_GENERACION;
  const carrera = String(estudiante.carrera || '').trim() || CARPETA_SIN_CARRERA;

  const carpetaGeneracion = obtenerOCrearCarpeta(obtenerCarpetaRaizDrive(), generacion);
  const carpetaCarrera = obtenerOCrearCarpeta(carpetaGeneracion, carrera);
  return obtenerOCrearCarpeta(carpetaCarrera, matricula);
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
 * Construye el nombre matricula_tipoDocumento_fecha.extension (RF-33).
 */
function construirNombreArchivo(matricula, tipoDocumento, extension) {
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  return limpiarSegmentoNombre(matricula) + '_' +
    limpiarSegmentoNombre(tipoDocumento) + '_' +
    fecha + '.' + String(extension || '').toLowerCase();
}

/**
 * Quita acentos, espacios y caracteres no seguros de un nombre de archivo.
 */
function limpiarSegmentoNombre(valor) {
  const limpio = String(valor === undefined || valor === null ? '' : valor)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return limpio || 'documento';
}
