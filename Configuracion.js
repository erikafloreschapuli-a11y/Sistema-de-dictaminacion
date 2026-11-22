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
// CURP, Acta de nacimiento y Certificado se aceptan solo en PDF. Cualquier
// otro valor en la hoja Configuracion se ignora y el panel no permite guardarlo.
const FORMATOS_ARCHIVO = ['PDF'];

// Rango permitido del tamano maximo de archivo en megabytes (RF-10).
const RANGO_TAMANIO_ARCHIVO_MB = { MINIMO: 2, MAXIMO: 5 };

// Plantillas de correo predeterminadas (RF-29). Los marcadores {{clave}}
// se sustituyen al enviar; el Administrador puede editarlas en su panel.
// Son solo el mensaje: los datos del alumno, la tabla de documentos con la
// observacion y el pie los agrega el formato de correo.html.
const PLANTILLAS_CORREO_PREDETERMINADAS = {
  ASUNTO_CORREO_OBSERVADO: 'Documento observado - Dictaminación UTP {{generacion}}',
  PLANTILLA_CORREO_OBSERVADO: [
    'Hola {{nombre}}:',
    '',
    'Revisamos tu expediente y tu documento "{{documento}}" necesita corrección. Abajo encontrarás la observación del dictaminador.',
    '',
    'Ingresa al sistema, corrige el documento y vuelve a subirlo en formato PDF.'
  ].join('\n'),
  ASUNTO_CORREO_COMPLETO: 'Expediente completo - Dictaminación UTP {{generacion}}',
  PLANTILLA_CORREO_COMPLETO: [
    'Hola {{nombre}}:',
    '',
    '¡Felicidades! Todos tus documentos fueron aprobados y tu expediente de nuevo ingreso quedó completo.',
    '',
    'Ya no necesitas realizar ninguna acción en el sistema.'
  ].join('\n')
};

// Claves de configuracion de las plantillas de correo (RF-29).
const CLAVES_PLANTILLAS_CORREO = Object.keys(PLANTILLAS_CORREO_PREDETERMINADAS);

// Claves y valores por defecto de la hoja Configuracion (RF-26 y RF-29).
const CONFIGURACION_PREDETERMINADA = Object.assign({
  TAMANIO_MAXIMO_ARCHIVO_MB: '5',
  TIPOS_PERMITIDOS: 'PDF',
  GENERACION_ACTIVA: '2026'
}, PLANTILLAS_CORREO_PREDETERMINADAS);

// Claves validas de configuracion (RF-26).
const CLAVES_CONFIGURACION = Object.keys(CONFIGURACION_PREDETERMINADA);

// Marcadores que acepta cada plantilla; uno distinto se rechaza al guardar
// para que el estudiante nunca reciba un {{texto}} sin sustituir.
const MARCADORES_PLANTILLA = {
  ASUNTO_CORREO_OBSERVADO: ['nombre', 'matricula', 'documento', 'generacion'],
  PLANTILLA_CORREO_OBSERVADO: ['nombre', 'matricula', 'documento', 'observacion', 'dictaminador', 'generacion'],
  ASUNTO_CORREO_COMPLETO: ['nombre', 'matricula', 'generacion'],
  PLANTILLA_CORREO_COMPLETO: ['nombre', 'matricula', 'generacion']
};

// Longitudes maximas de las plantillas de correo (RNF-06).
const LONGITUD_MAXIMA_ASUNTO_CORREO = 150;
const LONGITUD_MAXIMA_CUERPO_CORREO = 3000;

// Minimo de correos disponibles en la cuota diaria de MailApp para intentar
// un envio; por debajo se omite y se registra el motivo (RNF-10).
const CUOTA_MINIMA_CORREOS = 1;

// Prefijos de los identificadores unicos (seccion 6).
const PREFIJOS_ID = {
  HISTORIAL: 'HIS-',
  DOCUMENTO: 'DOC-'
};

// Cantidad de registros por pagina del historial (RF-24).
const LIMITE_PAGINA_HISTORIAL = 50;

// Registros mas recientes que se muestran en el historial de un alumno y en
// la actividad de un usuario; el historial completo lo consulta el Administrador.
const LIMITE_HISTORIAL_ESTUDIANTE = 100;
const LIMITE_ACTIVIDAD_USUARIO = 100;

// Umbral para cambiar de lecturas fila por fila a una lectura completa.
const MAXIMO_LECTURAS_INDIVIDUALES = 20;

// Nombre con el que el estudiante ve las acciones del personal en su historial.
const NOMBRE_PERSONAL_PARA_ESTUDIANTE = 'Servicios Escolares';

// Sesion de la app sobre la identidad de Google. CacheService admite como
// maximo 6 horas; cada accion renueva el plazo, asi que expira por inactividad.
const DURACION_SESION_SEGUNDOS = 2 * 60 * 60;
const PREFIJO_CACHE_SESION = 'sesion_';

// Acciones del parametro ?accion= que entiende doGet (inicio y cierre de sesion).
const ACCIONES_SESION = {
  INGRESAR: 'ingresar',
  SALIR: 'salir'
};

// Pagina de Google para elegir otra cuenta sin cerrar las demas.
const URL_CAMBIAR_CUENTA_GOOGLE = 'https://accounts.google.com/AccountChooser?continue=';

// Mensajes de Google (en ingles o espanol) que indican saturacion o una
// falla pasajera de un servicio; se responden como OCUPADO para reintentar.
const PATRON_ERROR_TEMPORAL_GOOGLE = /too many|demasiad|simult|timed out|time ?out|tiempo de espera|temporar|unavailable|no (est[aá] )?disponible|try again|int[eé]ntalo de nuevo|service error|error de servicio|rate limit|lock/i;

// Espera maxima del LockService en milisegundos (RNF-03).
const TIEMPO_ESPERA_BLOQUEO_MS = 30000;

// Carpeta raiz de Drive donde se guardan los expedientes (RF-32).
// El ID se configura en Propiedades del Script para usar una carpeta compartida.
const PROPIEDAD_CARPETA_RAIZ_DRIVE = 'UTP_DICTAMEN_CARPETA_RAIZ_ID';
const NOMBRE_CARPETA_RAIZ_DRIVE = 'Dictaminacion UTP - Nuevo ingreso';
const CARPETA_SIN_GENERACION = 'Sin generacion';
const CARPETA_SIN_CARRERA = 'Sin carrera';

// Creacion de carpetas por estudiante (RF-32). Al importar se usa un plazo
// corto para no hacer esperar al Administrador; lo que falte lo termina un
// activador en segundo plano con un plazo menor al limite de 6 minutos (RNF-04).
const TIEMPO_CARPETAS_IMPORTACION_MS = 45 * 1000;
const TIEMPO_CARPETAS_SEGUNDO_PLANO_MS = 4 * 60 * 1000;
const ESPERA_ACTIVADOR_CARPETAS_MS = 60 * 1000;
const FUNCION_CONTINUAR_CARPETAS = 'continuarCreacionCarpetas';

// Cache del ID de la carpeta de cada matricula: evita tres busquedas en
// Drive por cada carga de archivo (criterio de 200 cargas simultaneas).
const PREFIJO_CACHE_CARPETA = 'carpeta_';
const DURACION_CACHE_CARPETA_SEGUNDOS = 6 * 60 * 60;

// Prueba de carga (criterio "200 cargas simultaneas"). Sus alumnos se
// distinguen por el prefijo de matricula, no aparecen en reportes ni para
// dictaminar y se guardan en una carpeta aparte de Drive.
const PREFIJO_MATRICULA_PRUEBA = 'PRUEBA-';
const NOMBRE_GRUPO_PRUEBA = 'Prueba de carga';
const MAXIMO_ALUMNOS_PRUEBA = 200;
const DIGITOS_MATRICULA_PRUEBA = 4;

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
