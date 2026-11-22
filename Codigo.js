/**
 * Codigo.js
 * Punto de entrada de la aplicacion web: doGet, pantalla de inicio de sesion
 * y ruteo por rol (RF-03 a RF-05).
 */

// Paneles disponibles por rol. El rol decidido en el servidor manda (RF-06).
const VISTAS_POR_ROL = {
  Administrador: 'administrador',
  Dictaminador: 'dictaminador',
  Estudiante: 'Estudiante/estudiante'
};

// El Administrador puede entrar al panel de Dictaminador (RF-06).
const VISTAS_ADICIONALES_POR_ROL = {
  Administrador: ['dictaminador']
};

// Vista de la pantalla de inicio de sesion y de acceso denegado.
const VISTA_INICIO = 'inicio';

// Modos de la pantalla de inicio.
const MODOS_INICIO = {
  INGRESAR: 'ingresar',
  SALIDA: 'salida',
  DENEGADO: 'denegado'
};

const TITULO_APLICACION = 'Dictaminación de documentos - UTP';

/**
 * Flujo: Google identifica la cuenta -> pantalla de inicio -> "Ingresar"
 * abre la sesion -> panel del rol. "Cerrar sesion" la elimina.
 * Un parametro ?panel= ajeno al rol se ignora: nunca otorga permisos.
 */
function doGet(e) {
  const parametros = e && e.parameter ? e.parameter : {};
  const accion = String(parametros.accion || '').trim().toLowerCase();
  const panel = String(parametros.panel || '').trim().toLowerCase();

  let usuario;
  try {
    usuario = obtenerUsuarioActual();
  } catch (error) {
    console.warn('Acceso denegado: ' + error.message);
    return construirPaginaInicio({ modo: MODOS_INICIO.DENEGADO, mensaje: error.message, usuario: null });
  }

  try {
    if (accion === ACCIONES_SESION.SALIR) {
      cerrarSesion(usuario.correo);
      return construirPaginaInicio({ modo: MODOS_INICIO.SALIDA, usuario: usuario, panel: panel });
    }
    if (accion === ACCIONES_SESION.INGRESAR) {
      iniciarSesion(usuario.correo);
    }
    if (!tieneSesionActiva(usuario.correo)) {
      return construirPaginaInicio({ modo: MODOS_INICIO.INGRESAR, usuario: usuario, panel: panel });
    }
    return construirPagina(resolverVista(usuario.rol, panel), usuario);
  } catch (error) {
    console.error('Error al servir la pagina: ' + error.message);
    return construirPaginaDeAviso(
      'No se pudo iniciar la sesión: ' + (error.message || 'error inesperado'),
      'Error de acceso'
    );
  }
}

/**
 * Elige la vista solicitada solo si el rol la tiene permitida.
 */
function resolverVista(rol, panelSolicitado) {
  const vistaEsperada = VISTAS_POR_ROL[rol];
  if (!vistaEsperada) {
    throw crearError('ROL', 'Tu usuario no tiene un panel asignado.');
  }
  const vistaSolicitada = VISTAS_POR_ROL[panelSolicitado.charAt(0).toUpperCase() + panelSolicitado.slice(1)];
  return vistaSolicitada && obtenerVistasPermitidasPorRol(rol).indexOf(vistaSolicitada) !== -1
    ? vistaSolicitada
    : vistaEsperada;
}

/**
 * Devuelve las vistas que puede abrir un rol. El Administrador conserva el
 * panel principal y ademas puede usar el panel de Dictaminador (RF-06).
 */
function obtenerVistasPermitidasPorRol(rol) {
  const principal = VISTAS_POR_ROL[rol];
  const adicionales = VISTAS_ADICIONALES_POR_ROL[rol] || [];
  return principal ? [principal].concat(adicionales) : [];
}

/**
 * Inyecta un archivo HTML de la vista dentro de una plantilla (estilos, scripts).
 */
function include(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

/**
 * Datos comunes de la cabecera de todos los paneles.
 */
function construirDatosCabecera(usuario) {
  const urlApp = obtenerUrlApp();
  return {
    urlApp: urlApp,
    urlSalir: urlApp + '?accion=' + ACCIONES_SESION.SALIR,
    iniciales: obtenerIniciales(usuario.nombre || usuario.correo),
    srcLogo: obtenerSrcLogo()
  };
}

/**
 * Escudo como data URI: la pagina corre en un iframe de googleusercontent.com
 * y no puede leer archivos del proyecto por URL. Las vistas lo imprimen con
 * <?!= ?> porque el escape automatico bloquea data: en atributos src.
 */
function obtenerSrcLogo() {
  return 'data:image/png;base64,' + LOGO_INSTITUCIONAL_BASE64;
}

function obtenerIniciales(texto) {
  const palabras = String(texto || '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const iniciales = palabras.slice(0, 2).map(function (palabra) {
    return palabra.charAt(0).toUpperCase();
  }).join('');
  return iniciales || '?';
}

/**
 * Construye la pagina del panel; si la vista aun no existe (desarrollo por
 * fases) entrega un aviso claro en vez de un error en blanco.
 */
function construirPagina(nombreVista, usuario) {
  try {
    const plantilla = HtmlService.createTemplateFromFile(nombreVista);
    plantilla.usuario = usuario;
    plantilla.cabecera = construirDatosCabecera(usuario);
    return finalizarPagina(plantilla.evaluate(), TITULO_APLICACION);
  } catch (error) {
    console.warn('Vista ' + nombreVista + ' no disponible: ' + error.message);
    return construirPaginaDeAviso('El panel de ' + usuario.rol + ' está en construcción.', 'Por construir');
  }
}

/**
 * Pantalla de inicio de sesion. En modo denegado explica el motivo y
 * ofrece cambiar de cuenta, el caso tipico de quien entra con su Gmail.
 */
function construirPaginaInicio(opciones) {
  const urlApp = obtenerUrlApp();
  const panel = opciones.panel && VISTAS_POR_ROL[opciones.panel.charAt(0).toUpperCase() + opciones.panel.slice(1)]
    ? '&panel=' + encodeURIComponent(opciones.panel)
    : '';
  const plantilla = HtmlService.createTemplateFromFile(VISTA_INICIO);
  plantilla.modo = opciones.modo;
  plantilla.mensaje = opciones.mensaje || '';
  const usuario = opciones.usuario;
  plantilla.usuario = usuario;
  plantilla.iniciales = usuario ? obtenerIniciales(usuario.nombre || usuario.correo) : '';
  plantilla.urlIngresar = urlApp + '?accion=' + ACCIONES_SESION.INGRESAR + panel;
  plantilla.urlCambiarCuenta = URL_CAMBIAR_CUENTA_GOOGLE + encodeURIComponent(urlApp);
  plantilla.dominioPersonal = DOMINIO_TRABAJADORES;
  plantilla.dominioEstudiante = DOMINIO_ESTUDIANTE;
  plantilla.generacion = String(obtenerValorConfiguracionSegura('GENERACION_ACTIVA'));
  plantilla.srcLogo = obtenerSrcLogo();
  return finalizarPagina(plantilla.evaluate(), 'Iniciar sesión - ' + TITULO_APLICACION);
}

/**
 * Lee configuracion sin romper la pantalla de inicio si el libro no esta listo.
 */
function obtenerValorConfiguracionSegura(clave) {
  try {
    return obtenerValorConfiguracion(clave);
  } catch (error) {
    return CONFIGURACION_PREDETERMINADA[clave];
  }
}

function finalizarPagina(salida, titulo) {
  return salida
    .setTitle(titulo)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Pagina minima de aviso/error sin dependencias externas.
 */
function construirPaginaDeAviso(texto, titulo) {
  const html =
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + titulo + '</title><style>' +
    'body{font-family:Arial,sans-serif;background:#f4f6f5;color:#1f2933;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}' +
    '.caja{background:#fff;border-radius:8px;padding:32px;max-width:480px;box-shadow:0 2px 10px rgba(0,0,0,.08);text-align:center}' +
    'h1{font-size:18px;color:#14532d}p{font-size:15px;line-height:1.5}</style></head><body>' +
    '<div class="caja"><h1>' + titulo + '</h1><p>' + texto + '</p></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(titulo)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
