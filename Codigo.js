/**
 * Codigo.js
 * Punto de entrada de la aplicacion web: doGet y ruteo por rol (RF-03 a RF-05).
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

/**
 * Sirve el panel que corresponde al rol de la sesion activa.
 * Un parametro ?panel= ajeno al rol se ignora: nunca otorga permisos.
 */
function doGet(e) {
  try {
    const usuario = obtenerUsuarioActual();
    const vistaEsperada = VISTAS_POR_ROL[usuario.rol];
    if (!vistaEsperada) {
      throw crearError('ROL', 'Tu usuario no tiene un panel asignado.');
    }
    const parametroPanel = e && e.parameter ? String(e.parameter.panel || '') : '';
    const vistaSolicitada = VISTAS_POR_ROL[parametroPanel.charAt(0).toUpperCase() + parametroPanel.slice(1)];
    const vistasPermitidas = obtenerVistasPermitidasPorRol(usuario.rol);
    const nombreVista = vistaSolicitada && vistasPermitidas.indexOf(vistaSolicitada) !== -1
      ? vistaSolicitada
      : vistaEsperada;
    return construirPagina(nombreVista, usuario);
  } catch (error) {
    console.error('Error al servir la pagina: ' + error.message);
    return construirPaginaDeAviso(
      'No se pudo iniciar la sesion: ' + (error.message || 'error inesperado'),
      'Error de acceso'
    );
  }
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
 * Construye la pagina del panel; si la vista aun no existe (desarrollo por
 * fases) entrega un aviso claro en vez de un error en blanco.
 */
function construirPagina(nombreVista, usuario) {
  try {
    const plantilla = HtmlService.createTemplateFromFile(nombreVista);
    plantilla.usuario = usuario;
    return plantilla
      .evaluate()
      .setTitle('Dictaminacion de documentos - UTP 2026')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    console.warn('Vista ' + nombreVista + ' no disponible: ' + error.message);
    return construirPaginaDeAviso('El panel de ' + usuario.rol + ' esta en construccion.', 'Por construir');
  }
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
