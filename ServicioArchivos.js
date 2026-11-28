/**
 * ServicioArchivos.js
 * Entrega el contenido de un documento al navegador a traves del script.
 * Asi el dictaminador y el estudiante ven el archivo sin tener permisos en
 * Drive: el servidor decide quien puede verlo (RF-17, RNF-05).
 */

/**
 * Devuelve el archivo de un documento (por su id) en base64 para mostrarlo
 * en el visor. Estudiante: solo sus propios documentos. Dictaminador y
 * Administrador: cualquier matricula. El documento puede ser de otro
 * tramite cuando se reutiliza.
 */
function apiObtenerArchivo(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ESTUDIANTE, ROLES.DICTAMINADOR]);
    const idDocumento = String((datos && datos.idDocumento) || '').trim();
    const estudiante = obtenerEstudianteParaVerArchivo(usuario, datos && datos.matricula);
    const documento = leerDocumentosDeEstudiante(estudiante.matricula).find(function (fila) {
      return String(fila.id_documento || '').trim() === idDocumento;
    });
    if (!idDocumento || !documento || !documento.url_archivo) {
      throw crearError('VALIDACION', 'El documento aún no tiene archivo cargado.');
    }

    const archivo = abrirArchivoDrive(documento.url_archivo);
    const blob = archivo.getBlob();
    return {
      ok: true,
      nombre: archivo.getName(),
      tipoMime: blob.getContentType(),
      contenidoBase64: Utilities.base64Encode(blob.getBytes())
    };
  });
}

/**
 * El estudiante siempre se resuelve por su correo de sesion; la matricula
 * enviada por el navegador solo se respeta para el personal.
 */
function obtenerEstudianteParaVerArchivo(usuario, matriculaSolicitada) {
  if (usuario.rol === ROLES.ESTUDIANTE) {
    return obtenerEstudiantePorCorreo(usuario.correo);
  }
  const matricula = String(matriculaSolicitada === undefined || matriculaSolicitada === null ? '' : matriculaSolicitada).trim();
  if (!matricula) {
    throw crearError('VALIDACION', 'Debes indicar la matrícula del expediente.');
  }
  const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'matricula', matricula);
  if (!estudiante) {
    throw crearError('NO_REGISTRADO', 'No existe un estudiante con la matrícula ' + matricula + '.');
  }
  return estudiante;
}

/**
 * Extrae el identificador de una URL de Drive (/d/ID o ?id=ID).
 */
function obtenerIdArchivoDrive(urlArchivo) {
  const url = String(urlArchivo || '').trim();
  const porRuta = url.match(/\/d\/([A-Za-z0-9_-]+)/);
  const porParametro = url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return porRuta ? porRuta[1] : (porParametro ? porParametro[1] : '');
}

function abrirArchivoDrive(urlArchivo) {
  const identificador = obtenerIdArchivoDrive(urlArchivo);
  if (!identificador) {
    throw crearError('DRIVE', 'La dirección del archivo guardada en Documentos no es válida.');
  }
  try {
    return DriveApp.getFileById(identificador);
  } catch (error) {
    console.error('No se pudo abrir el archivo ' + identificador + ': ' + error.message);
    throw crearError('DRIVE', 'No se pudo abrir el archivo en Drive. Es posible que haya sido movido o eliminado.');
  }
}
