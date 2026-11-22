/**
 * Autenticacion.js
 * Identidad del usuario, roles y autorizacion en el servidor (RF-01 a RF-06).
 * El navegador nunca es fuente de verdad: todo se decide aqui (RNF-05).
 */

/**
 * Crea un Error con codigo para devolver mensajes seguros al cliente (RNF-07).
 */
function crearError(codigo, mensaje) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  return error;
}

/**
 * Normaliza un correo para comparaciones seguras.
 */
function normalizarCorreo(correo) {
  return String(correo === undefined || correo === null ? '' : correo).trim().toLowerCase();
}

/**
 * Valida el formato basico de un correo electronico (RNF-06).
 */
function esCorreoValido(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}

/**
 * Convierte el rol leido de la hoja Usuarios a su valor canonico.
 * Devuelve una cadena vacia si el rol no es reconocido.
 */
function normalizarRol(valor) {
  const texto = String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
  if (!texto) {
    return '';
  }
  const roles = Object.keys(ROLES).map(function (clave) {
    return ROLES[clave];
  });
  for (let i = 0; i < roles.length; i++) {
    if (roles[i].toLowerCase() === texto) {
      return roles[i];
    }
  }
  return '';
}

/**
 * Indica si un correo pertenece exactamente a un dominio permitido.
 * El dominio incluye la arroba para no confundir subdominios.
 */
function esCorreoDeDominio(correo, dominio) {
  const correoNormalizado = normalizarCorreo(correo);
  const dominioNormalizado = String(dominio === undefined || dominio === null ? '' : dominio).trim().toLowerCase();
  return Boolean(correoNormalizado && dominioNormalizado && correoNormalizado.endsWith(dominioNormalizado));
}

/**
 * Indica si el correo pertenece al personal administrativo (RF-01).
 */
function esCorreoTrabajador(correo) {
  return esCorreoDeDominio(correo, DOMINIO_TRABAJADORES);
}

/**
 * Indica si el correo pertenece al alumnado (RF-01).
 */
function esCorreoEstudiante(correo) {
  return esCorreoDeDominio(correo, DOMINIO_ESTUDIANTE);
}

/**
 * Devuelve el correo de la sesion activa (RF-02).
 */
function obtenerCorreoUsuario() {
  const correo = normalizarCorreo(Session.getActiveUser().getEmail());
  if (!correo) {
    throw crearError(
      'IDENTIDAD',
      'No se pudo identificar al usuario. Despliega la app como "Ejecutar como: usuario que accede a la aplicacion".'
    );
  }
  return correo;
}

/**
 * Interpreta las celdas de la columna activo (TRUE/FALSE, 1/0, si/no).
 */
function esUsuarioActivo(valor) {
  const texto = String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
  return texto === 'true' || texto === '1' || texto === 'si' || texto === 'verdadero';
}

/**
 * Devuelve el usuario de la sesion aplicando la matriz de dominios:
 * - @alumno.utpuebla.edu.mx: Estudiante, solo si esta en la hoja Estudiantes.
 * - @utpuebla.edu.mx: Administrador o Dictaminador registrado y activo.
 * - Cualquier otro dominio: rechazado.
 */
function obtenerUsuarioActual() {
  const correo = obtenerCorreoUsuario();

  if (esCorreoEstudiante(correo)) {
    // Solo entra quien el Administrador importo en la lista de nuevo ingreso.
    const estudiante = buscarPorClave(HOJAS.ESTUDIANTES, 'correo_institucional', correo);
    if (!estudiante) {
      throw crearError(
        'NO_REGISTRADO',
        'Tu correo institucional no aparece en la lista de estudiantes de nuevo ingreso. ' +
        'Si crees que es un error, acude a Servicios Escolares.'
      );
    }
    return {
      correo: correo,
      nombre: String(estudiante.nombre || correo.split('@')[0]),
      rol: ROLES.ESTUDIANTE,
      activo: true
    };
  }

  if (!esCorreoTrabajador(correo)) {
    throw crearError(
      'DOMINIO',
      'El acceso esta restringido a las cuentas ' + DOMINIO_TRABAJADORES +
      ' (personal) y ' + DOMINIO_ESTUDIANTE + ' (estudiantes).'
    );
  }

  const registrado = buscarPorClave(HOJAS.USUARIOS, 'correo', correo);
  if (!registrado) {
    throw crearError(
      'NO_AUTORIZADO',
      'Tu correo no esta registrado como personal autorizado. Contacta al Administrador del sistema.'
    );
  }
  if (!esUsuarioActivo(registrado.activo)) {
    throw crearError('INACTIVO', 'Tu usuario esta inactivo. Contacta al Administrador del sistema.');
  }

  const rol = normalizarRol(registrado.rol);
  if (rol !== ROLES.ADMINISTRADOR && rol !== ROLES.DICTAMINADOR) {
    throw crearError(
      'ROL',
      'Tu usuario no tiene un rol valido para el panel de personal. Contacta al Administrador del sistema.'
    );
  }

  return {
    correo: correo,
    nombre: String(registrado.nombre || correo.split('@')[0]),
    rol: rol,
    activo: true
  };
}

/**
 * Exige uno de los roles permitidos o lanza error de autorizacion (RF-06).
 * El Administrador tiene acceso a todas las funciones; en las operaciones
 * sobre estudiantes debe indicar la matricula objetivo.
 */
function asegurarRol(rolesPermitidos) {
  const usuario = obtenerUsuarioActual();
  asegurarSesionActiva(usuario.correo);
  if (usuario.rol === ROLES.ADMINISTRADOR) {
    return usuario;
  }
  const permitidos = (rolesPermitidos || []).map(normalizarRol);
  if (permitidos.indexOf(usuario.rol) === -1) {
    throw crearError('AUTORIZACION', 'Tu rol (' + usuario.rol + ') no tiene permiso para esta accion.');
  }
  return usuario;
}

/* ------------------------------------------------------------------ */
/* Sesion de la aplicacion                                             */
/* ------------------------------------------------------------------ */
// Google ya verifico la identidad; la sesion solo registra que la persona
// paso por la pantalla de inicio y permite cerrarla sin salir de Google.

function obtenerClaveSesion(correo) {
  return PREFIJO_CACHE_SESION + normalizarCorreo(correo);
}

/**
 * Abre o renueva la sesion del correo por DURACION_SESION_SEGUNDOS.
 */
function iniciarSesion(correo) {
  CacheService.getScriptCache().put(obtenerClaveSesion(correo), String(Date.now()), DURACION_SESION_SEGUNDOS);
}

function cerrarSesion(correo) {
  CacheService.getScriptCache().remove(obtenerClaveSesion(correo));
}

function tieneSesionActiva(correo) {
  return Boolean(CacheService.getScriptCache().get(obtenerClaveSesion(correo)));
}

/**
 * Exige sesion abierta en cada llamada al servidor y renueva su plazo,
 * para que la expiracion cuente desde la ultima actividad.
 */
function asegurarSesionActiva(correo) {
  if (!tieneSesionActiva(correo)) {
    throw crearError('SESION', 'Tu sesión terminó. Vuelve a iniciar sesión para continuar.');
  }
  iniciarSesion(correo);
}

/**
 * URL publica de la app; los enlaces deben ser absolutos porque la vista
 * corre dentro de un iframe de googleusercontent.com.
 */
function obtenerUrlApp() {
  return ScriptApp.getService().getUrl();
}

/**
 * Ejecuta una operacion y devuelve una respuesta uniforme {ok:...}.
 * Los errores de validacion/autorizacion viajan con su mensaje visible;
 * los inesperados se registran y se enmascaran (RNF-07).
 */
function protegerApi(callback) {
  try {
    return callback();
  } catch (error) {
    console.error('Error en API: ' + error.message + (error.stack ? ' | ' + error.stack : ''));
    if (error.codigo) {
      return { ok: false, codigo: error.codigo, mensaje: error.message };
    }
    // Saturacion o fallas pasajeras de Google: el navegador reintenta solo.
    if (PATRON_ERROR_TEMPORAL_GOOGLE.test(String(error.message || ''))) {
      return { ok: false, codigo: 'OCUPADO', mensaje: 'El sistema está ocupado en este momento. Intenta de nuevo en unos segundos.' };
    }
    return { ok: false, codigo: 'SERVIDOR', mensaje: 'Ocurrio un error inesperado en el servidor. Intenta de nuevo.' };
  }
}
