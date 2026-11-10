REQUERIMIENTOS DEL SISTEMA WEB PARA EL PROCESO DE DICTAMINACION DE DOCUMENTOS
ESTUDIANTES DE NUEVO INGRESO 2026
Universidad Tecnologica de Puebla (@utpuebla.edu.mx y @alumno.utpuebla.edu.mx)
 
======================================================================
1. OBJETIVO
======================================================================
Construir una aplicacion web que permita a los estudiantes de nuevo ingreso cargar su documentacion (CURP, Acta de nacimiento, Certificado) y a los dictaminadores revisarla, aprobarla u observarla, con seguimiento de estatus, historial de cambios y notificaciones automaticas por correo.
 
======================================================================
2. ALCANCE
======================================================================
Incluye:
- Autenticacion con cuenta institucional de Google.
- Panel de Estudiante, Panel de Dictaminador y Panel de Administrador.
- Carga y almacenamiento de archivos.
- Flujo de dictaminacion con historial y notificaciones.
- Reportes generales.
 
No incluye:
- Registro propio de usuarios ni contrasenas (se delega a Google).
- Pagos, inscripcion u otros tramites academicos.
 
======================================================================
3. ROLES Y USUARIOS
======================================================================
- Estudiante: cuenta @alumno.utpuebla.edu.mx. Su informacion se consulta en la hoja Estudiantes.
- Dictaminador: personal de Servicios Escolares / Titulacion y Becas con cuenta @utpuebla.edu.mx, registrado en Usuarios como Dictaminador y activo.
- Administrador: personal con cuenta @utpuebla.edu.mx, registrado en Usuarios como Administrador y activo. Gestiona usuarios, configuracion, reportes e historial, y puede usar las funciones de dictaminacion.
- Cualquier cuenta de otro dominio se rechaza.
- Una cuenta @utpuebla.edu.mx que no este registrada como Administrador o Dictaminador activo se rechaza; no se asume Estudiante.
 
======================================================================
4. REQUERIMIENTOS FUNCIONALES
======================================================================
 
4.1 Autenticacion y ruteo
RF-01  El acceso se restringe a cuentas @utpuebla.edu.mx para personal y @alumno.utpuebla.edu.mx para estudiantes.
RF-02  El sistema identifica al usuario con Session.getActiveUser().getEmail(). Si el correo no esta disponible, se deniega el acceso; nunca se acepta un correo enviado por el navegador.
RF-03  Si el correo esta en Usuarios como Administrador y esta activo, se muestra el panel de Administrador.
RF-04  Si el correo esta en Usuarios como Dictaminador y esta activo, se muestra el panel de Dictaminador.
RF-05  Si el correo pertenece a @alumno.utpuebla.edu.mx, se asume Estudiante y se muestra su perfil. Un correo @utpuebla.edu.mx que no este registrado como Administrador o Dictaminador activo se rechaza.
RF-06  Un usuario sin permisos no puede acceder a vistas ni acciones de otro rol (validacion tambien del lado del servidor). El Administrador puede usar las funciones de Administrador y Dictaminador; para operar sobre un estudiante debe indicar la matricula objetivo y la accion queda registrada a su nombre.
 
4.2 Panel del Estudiante
RF-07  Consultar sus datos: nombre, matricula, carrera y generacion.
RF-08  Actualizar telefono y correo personal con validacion de formato.
RF-09  Cargar documentos (CURP, Acta, Certificado) en formato PDF, JPG o PNG.
RF-10  Validar tipo y tamano maximo del archivo (2 MB a 5 MB, valor configurable) antes de enviarlo.
RF-11  Visualizar el estatus de cada documento con semaforo de colores.
RF-12  Leer las observaciones dejadas por el dictaminador.
RF-13  Volver a subir un documento cuando su estatus sea Observado o Rechazado.
RF-14  No poder reemplazar un documento cuyo estatus sea Aprobado.
 
4.3 Panel del Dictaminador
RF-15  Ver una tabla de estudiantes con expedientes pendientes de revision.
RF-16  Filtrar y buscar por carrera, matricula, nombre y estatus.
RF-17  Abrir el expediente con el documento visible en un lado de la pantalla y las acciones de dictamen en el otro.
RF-18  Aprobar un documento.
RF-19  Rechazar u observar un documento, con observacion obligatoria.
RF-20  Al dictaminar, actualizar el estatus del documento y registrar el cambio en Historial.
RF-21  Evitar que dos dictaminadores modifiquen el mismo documento a la vez.
 
4.4 Panel del Administrador
RF-22  Dar de alta, baja y cambio de rol de dictaminadores.
RF-23  Ver reportes generales: total de alumnos, pendientes, en revision, aprobados, observados, expedientes completos.
RF-24  Consultar el historial completo de cambios.
RF-25  Cargar o importar la lista de estudiantes de nuevo ingreso.
RF-26  Configurar parametros: tamano maximo de archivo, tipos permitidos y generacion activa.
 
4.5 Notificaciones
RF-27  Enviar correo automatico al estudiante cuando un documento sea Observado o Rechazado.
RF-28  Enviar correo al estudiante cuando su expediente quede completo y aprobado.
RF-29  Usar plantillas de correo configurables y en espanol.
 
4.6 Historial y auditoria
RF-30  Registrar en Historial cada cambio: fecha y hora, usuario que lo hizo, estudiante, documento, estatus anterior, estatus nuevo y observacion.
RF-31  El historial no se puede editar ni eliminar desde la aplicacion.
 
======================================================================
5. FLUJO DE ESTATUS DE DOCUMENTOS
======================================================================
Estatus: Pendiente, En Revision, Aprobado, Observado.
 
- Pendiente      -> En Revision : el estudiante carga el documento.
- En Revision    -> Aprobado    : el dictaminador aprueba.
- En Revision    -> Observado   : el dictaminador observa o rechaza (con comentario) y se notifica al estudiante.
- Observado      -> En Revision : el estudiante vuelve a cargar el documento.
- Aprobado       : estado final.
 
======================================================================
6. MODELO DE DATOS (GOOGLE SHEETS)
======================================================================
Hoja Usuarios:
  correo, nombre, rol, activo, fecha_alta
 
Hoja Estudiantes:
  matricula, nombre, correo_institucional, correo_personal, telefono, carrera, generacion, estatus_general
 
Hoja Documentos:
  id_documento, matricula, tipo_documento, url_archivo, estatus, observaciones, fecha_carga, fecha_dictamen, dictaminador
 
Hoja Historial:
  id_registro, fecha_hora, usuario, matricula, tipo_documento, estatus_anterior, estatus_nuevo, observacion
 
Hoja Configuracion:
  clave, valor
 
======================================================================
7. ALMACENAMIENTO DE ARCHIVOS (GOOGLE DRIVE)
======================================================================
RF-32  Estructura de carpetas: Generacion -> Carrera -> Matricula.
RF-33  Nombres de archivo estandarizados: matricula_tipoDocumento_fecha.extension.
RF-34  Solo administradores, dictaminadores y el script tienen acceso de edicion a la carpeta raiz.
RF-35  La URL del archivo se guarda en la hoja Documentos.
 
======================================================================
8. REQUERIMIENTOS NO FUNCIONALES
======================================================================
RNF-01  Costo de infraestructura cero: Google Apps Script, Sheets, Drive y Gmail.
RNF-02  Interfaz responsiva (celular y computadora) .
RNF-03  Concurrencia: usar LockService en toda escritura sobre Sheets.
RNF-04  Los scripts no deben superar el limite de 6 minutos de ejecucion.
RNF-05  Seguridad: autorizacion por rol en el servidor, sin confiar en el cliente.
RNF-06  Validar y sanear todos los datos recibidos del navegador.
RNF-07  Manejo de errores con mensajes claros al usuario y registro del error.
RNF-08  Usabilidad: el estudiante debe poder completar la carga sin capacitacion.
RNF-09  Mantenibilidad: codigo documentado para que el personal pueda dar soporte.
RNF-10  Cuotas de Google: considerar el limite diario de correos de MailApp.
 
======================================================================
9. ESTANDARES DE CODIGO (TODO EN ESPANOL, CODIGO LIMPIO)
======================================================================
- Todo el codigo se escribe en espanol: variables, funciones, clases, constantes, comentarios, mensajes y nombres de archivo.
- Sin acentos ni eno en identificadores (ej. "anio", "contrasena"); en textos visibles al usuario si se usan acentos.
- Nombres descriptivos y sin abreviaturas ambiguas.
- Funciones en camelCase con verbo (obtenerRolUsuario, guardarDocumento, registrarHistorial).
- Constantes en MAYUSCULAS_CON_GUION_BAJO (ESTATUS_APROBADO, TAMANIO_MAXIMO_ARCHIVO).
- Una funcion, una responsabilidad. Funciones cortas y sin duplicacion de codigo.
- Sin numeros ni textos "magicos": usar constantes o la hoja Configuracion.
- Separacion de capas: acceso a datos, logica de negocio, controladores y vistas.
- Comentarios solo para explicar el por que, no el que.
- Manejo de errores con try/catch y mensajes en espanol.
- Estructura sugerida de archivos:
    Codigo.js               (punto de entrada: doGet, ruteo)
    Autenticacion.js        (usuarios y roles)
    RepositorioHojas.js     (lectura y escritura en Sheets)
    ServicioDocumentos.js   (carga y dictamen)
    ServicioNotificaciones.js (correos)
    ServicioReportes.js     (estadisticas)
    Configuracion.js        (constantes)
    vistas: estudiante.html, dictaminador.html, administrador.html, estilos.html, scripts.html
 
======================================================================
11. CRITERIOS DE ACEPTACION
======================================================================
- Cada rol ve unicamente su panel y sus acciones.
- Un correo de un dominio no permitido, o de personal no registrado/inactivo, es rechazado con mensaje claro.
- Un correo @alumno.utpuebla.edu.mx solo puede acceder al panel de Estudiante, aunque exista en Usuarios.
- Un archivo valido queda en la carpeta correcta de Drive y su URL en Documentos.
- Cada cambio de estatus genera un registro en Historial.
- El estudiante recibe correo al ser observado.
- 200 cargas simultaneas no producen perdida ni sobreescritura de datos.
- Archivos que excedan el tamano o con formato no permitido son rechazados con mensaje claro.
- El piloto concluye sin errores criticos y con manual de usuario entregado.