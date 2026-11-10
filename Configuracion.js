/**
 * Configuracion.js
 * Constantes del sistema y lectura de los parametros de la hoja Configuracion.
 * Regla: ningun texto "magico" vive fuera de este archivo (seccion 9).
 */

// ID del libro maestro guardado en Propiedades del Script.
const PROPIEDAD_LIBRO_MAESTRO = 'UTP_DICTAMEN_SPREADSHEET_ID';

// Nombres de las hojas del libro maestro (seccion 6).
const HOJAS = {
  USUARIOS: 'Usuarios',
  ESTUDIANTES: 'Estudiantes',
  DOCUMENTOS: 'Documentos',
  HISTORIAL: 'Historial',
  CONFIGURACION: 'Configuracion'
};

// Encabezados de cada hoja, en el orden exacto en que se crean (seccion 6).
const COLUMNAS_HOJAS = {
  USUARIOS: ['correo', 'nombre', 'rol', 'activo', 'fecha_alta'],
  ESTUDIANTES: ['matricula', 'nombre', 'correo_institucional', 'correo_personal', 'telefono', 'carrera', 'generacion', 'estatus_general'],
  DOCUMENTOS: ['id_documento', 'matricula', 'tipo_documento', 'url_archivo', 'estatus', 'observaciones', 'fecha_carga', 'fecha_dictamen', 'dictaminador'],
  HISTORIAL: ['id_registro', 'fecha_hora', 'usuario', 'matricula', 'tipo_documento', 'estatus_anterior', 'estatus_nuevo', 'observacion'],
  CONFIGURACION: ['clave', 'valor']
};

// Roles del sistema (seccion 3).
const ROLES = {
  ADMINISTRADOR: 'Administrador',
  DICTAMINADOR: 'Dictaminador',
  ESTUDIANTE: 'Estudiante'
};

// Roles que el Administrador puede dar de alta o modificar (RF-22).
const ROLES_GESTIONABLES = [ROLES.DICTAMINADOR, ROLES.ADMINISTRADOR];

// Estatus de los documentos (seccion 5).
const ESTATUS_DOCUMENTO = {
  PENDIENTE: 'Pendiente',
  EN_REVISION: 'En Revision',
  APROBADO: 'Aprobado',
  OBSERVADO: 'Observado'
};

// Estatus calculado de un expediente completo.
const ESTATUS_EXPEDIENTE = {
  PENDIENTE: 'Pendiente',
  EN_REVISION: 'En Revision',
  OBSERVADO: 'Observado',
  COMPLETO: 'Completo'
};

// Dominios permitidos (RF-01): personal administrativo y estudiantes.
const DOMINIO_TRABAJADORES = '@utpuebla.edu.mx';
const DOMINIO_ESTUDIANTE = '@alumno.utpuebla.edu.mx';

// Tipos de documento requeridos para el expediente completo (seccion 1).
const TIPOS_DOCUMENTO = ['CURP', 'Acta de nacimiento', 'Certificado'];

// Formatos de archivo aceptados en la carga (RF-09).
const FORMATOS_ARCHIVO = ['PDF', 'JPG', 'PNG'];

// Rango permitido del tamano maximo de archivo en megabytes (RF-10).
const RANGO_TAMANIO_ARCHIVO_MB = { MINIMO: 2, MAXIMO: 5 };

// Claves y valores por defecto de la hoja Configuracion (RF-26).
const CONFIGURACION_PREDETERMINADA = {
  TAMANIO_MAXIMO_ARCHIVO_MB: '5',
  TIPOS_PERMITIDOS: 'PDF,JPG,PNG',
  GENERACION_ACTIVA: '2026'
};

// Claves validas de configuracion (RF-26).
const CLAVES_CONFIGURACION = Object.keys(CONFIGURACION_PREDETERMINADA);

// Prefijos de los identificadores unicos (seccion 6).
const PREFIJOS_ID = {
  HISTORIAL: 'HIS-',
  DOCUMENTO: 'DOC-'
};

// Cantidad de registros por pagina del historial (RF-24).
const LIMITE_PAGINA_HISTORIAL = 50;

// Espera maxima del LockService en milisegundos (RNF-03).
const TIEMPO_ESPERA_BLOQUEO_MS = 30000;

// Carpeta raiz de Drive donde se guardan los expedientes (RF-32).
// El ID se configura en Propiedades del Script para usar una carpeta compartida.
const PROPIEDAD_CARPETA_RAIZ_DRIVE = 'UTP_DICTAMEN_CARPETA_RAIZ_ID';
const NOMBRE_CARPETA_RAIZ_DRIVE = 'Dictaminacion UTP - Nuevo ingreso';
const CARPETA_SIN_GENERACION = 'Sin generacion';
const CARPETA_SIN_CARRERA = 'Sin carrera';

// Conversion de unidades para validar el tamano maximo (RF-10).
const BYTES_POR_MEGABYTE = 1024 * 1024;

// Estatus en los que el estudiante puede cargar o reemplazar (RF-13 y RF-14).
const ESTATUS_CARGA_PERMITIDA = [ESTATUS_DOCUMENTO.PENDIENTE, ESTATUS_DOCUMENTO.OBSERVADO];

// Estatus que puede asignar un dictaminador (RF-18 y RF-19).
const ESTATUS_DICTAMEN_PERMITIDOS = [ESTATUS_DOCUMENTO.APROBADO, ESTATUS_DOCUMENTO.OBSERVADO];

// Alias tolerado: el modelo no define Rechazado, se trata como Observado.
const ESTATUS_RECHAZADO_ALIAS = 'Rechazado';

// Longitud maxima de una observacion de dictamen (RNF-06).
const LONGITUD_MAXIMA_OBSERVACION = 1000;

// Asuntos de las notificaciones automaticas (RF-27 y RF-28).
const ASUNTO_CORREO_OBSERVADO = 'Documento observado - Dictaminacion UTP 2026';
const ASUNTO_CORREO_EXPEDIENTE_COMPLETO = 'Expediente completo - Dictaminacion UTP 2026';

// Tipo MIME de cada formato aceptado (RF-09).
const TIPOS_MIME_ARCHIVO = {
  PDF: 'application/pdf',
  JPG: 'image/jpeg',
  PNG: 'image/png'
};

// Firmas binarias para confirmar que el contenido coincide con el formato (RNF-06).
const FIRMAS_ARCHIVO = {
  PDF: [0x25, 0x50, 0x44, 0x46],
  JPG: [0xFF, 0xD8, 0xFF],
  PNG: [0x89, 0x50, 0x4E, 0x47]
};

/**
 * Devuelve todos los parametros de configuracion uniendo la hoja
 * Configuracion con los valores predeterminados (RF-26).
 */
function obtenerValoresConfiguracion() {
  const valores = Object.assign({}, CONFIGURACION_PREDETERMINADA);
  try {
    leerHoja(HOJAS.CONFIGURACION).forEach(function (fila) {
      const clave = String(fila.clave || '').trim();
      if (clave) {
        valores[clave] = String(fila.valor === undefined || fila.valor === null ? '' : fila.valor);
      }
    });
  } catch (error) {
    // Mientras la hoja no exista se trabajan los valores predeterminados.
    console.warn('Hoja Configuracion no disponible: ' + error.message);
  }
  return valores;
}

/**
 * Devuelve el valor de una clave de configuracion o su predeterminado.
 */
function obtenerValorConfiguracion(clave) {
  const valores = obtenerValoresConfiguracion();
  return valores[clave] !== undefined ? valores[clave] : CONFIGURACION_PREDETERMINADA[clave];
}
