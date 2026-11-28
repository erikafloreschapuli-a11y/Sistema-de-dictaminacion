/**
 * ServicioRecordatorios.js
 * Correo de "documentos pendientes" a los alumnos que aun no suben todo.
 *
 * Google limita los correos por dia (unos 1,500) y son miles de alumnos,
 * asi que el envio se organiza en "campanas":
 *   - El Administrador inicia una campana desde su panel.
 *   - Cada corrida envia lo que permite la cuota (dejando una reserva para
 *     los avisos de acuse, observado y completo) y lo que permite el tiempo.
 *   - Lo que falte se envia solo: en un minuto si se acabo el tiempo, o al
 *     dia siguiente si se acabo la cuota.
 *   - Cada envio queda en Historial con la etiqueta de la campana; asi nadie
 *     recibe el mismo recordatorio dos veces y queda evidencia (RF-30).
 * Si el alumno sube sus documentos mientras tanto, ya no se le envia.
 * Cada campana es de un solo tramite: la reciben sus alumnos habilitados.
 */

/**
 * Inicia una campana nueva para el tramite datos.idProceso (o continua la
 * actual) y envia el primer lote.
 */
function apiIniciarRecordatorio(datos) {
  return protegerApi(function () {
    const usuario = asegurarRol([ROLES.ADMINISTRADOR]);
    const actual = leerCampaniaRecordatorio();
    if (!actual || actual.terminada || (datos && datos.nueva)) {
      const proceso = obtenerProceso(datos && datos.idProceso);
      if (!proceso.activo) {
        throw crearError('VALIDACION', 'Enciende el trámite ' + proceso.nombre + ' antes de enviar recordatorios.');
      }
      guardarCampaniaRecordatorio({
        id: 'REC-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm'),
        idProceso: proceso.id_proceso,
        nombreProceso: proceso.nombre,
        iniciadaPor: usuario.correo,
        inicio: new Date().toISOString(),
        terminada: false,
        proximoEnvio: ''
      });
    }
    return { ok: true, estado: enviarLoteRecordatorio() };
  });
}

/**
 * Estado de la campana sin enviar nada (para el panel). Sin campana, cuenta
 * los alumnos con pendientes del tramite datos.idProceso.
 */
function apiObtenerEstadoRecordatorio(datos) {
  return protegerApi(function () {
    asegurarRol([ROLES.ADMINISTRADOR]);
    const campania = leerCampaniaRecordatorio();
    const conteo = campania ? contarDestinatariosRecordatorio(campania) : null;
    const idProceso = String((datos && datos.idProceso) || '').trim();
    return {
      ok: true,
      estado: {
        campania: campania,
        enviados: conteo ? conteo.enviados : 0,
        faltan: conteo ? conteo.faltan : (idProceso ? contarAlumnosConPendientes(idProceso) : 0),
        cuotaRestante: obtenerCuotaCorreosRestante()
      }
    };
  });
}

/**
 * Activador de tiempo: continua la campana sin intervencion del Administrador.
 */
function continuarRecordatorioPendientes() {
  const estado = enviarLoteRecordatorio();
  console.log('Recordatorio ' + (estado.campania ? estado.campania.id : '-') + ': enviados ahora ' +
    estado.enviadosAhora + ', faltan ' + estado.faltan);
}

/* ------------------------------------------------------------------ */
/* Envio por lotes                                                     */
/* ------------------------------------------------------------------ */

/**
 * Envia recordatorios hasta agotar tiempo, cuota (menos la reserva) o
 * destinatarios, y programa la siguiente corrida si faltan.
 */
function enviarLoteRecordatorio() {
  const campania = leerCampaniaRecordatorio();
  if (!campania || campania.terminada) {
    eliminarActivadoresRecordatorio();
    return { campania: campania, enviadosAhora: 0, enviados: 0, faltan: 0, pausa: '' };
  }

  const inicio = Date.now();
  const destinatarios = obtenerDestinatariosRecordatorio(campania);
  const propietario = normalizarCorreo(Session.getEffectiveUser().getEmail());
  let lote = [];
  let enviadosAhora = 0;
  let pausa = '';

  for (let i = 0; i < destinatarios.pendientes.length; i++) {
    if (Date.now() - inicio > TIEMPO_RECORDATORIO_MS) {
      pausa = 'tiempo';
      break;
    }
    const cuota = obtenerCuotaCorreosRestante();
    if (cuota !== null && cuota <= RESERVA_CUOTA_RECORDATORIO) {
      pausa = 'cuota';
      break;
    }
    const pendiente = destinatarios.pendientes[i];
    const resultado = notificarDocumentosPendientes(pendiente.estudiante, pendiente.expediente);
    if (resultado.motivo === MOTIVOS_CORREO_NO_ENVIADO.SIN_CUOTA) {
      pausa = 'cuota';
      break;
    }
    if (resultado.enviado) {
      enviadosAhora++;
      lote.push(construirRegistroRecordatorio(campania, pendiente.estudiante, propietario));
    }
    // Se registra en lotes: si la ejecucion se corta, se pierde poco.
    if (lote.length >= LOTE_HISTORIAL_RECORDATORIO) {
      guardarRegistrosRecordatorio(lote);
      lote = [];
    }
  }
  guardarRegistrosRecordatorio(lote);

  const faltan = Math.max(0, destinatarios.pendientes.length - enviadosAhora);
  programarSiguienteRecordatorio(campania, faltan, pausa);
  return {
    campania: leerCampaniaRecordatorio(),
    enviadosAhora: enviadosAhora,
    enviados: destinatarios.yaEnviados + enviadosAhora,
    faltan: faltan,
    pausa: pausa
  };
}

/**
 * Expedientes de los alumnos habilitados en un tramite. Las campanas
 * anteriores a los tramites no tienen idProceso: ya terminaron y no
 * tienen destinatarios.
 */
function leerExpedientesParaRecordatorio(idProceso) {
  if (!idProceso) {
    return [];
  }
  const proceso = obtenerProceso(idProceso);
  return construirExpedientesDeProceso(proceso, leerRequisitos(proceso.id_proceso));
}

/**
 * Alumnos del tramite de la campana con al menos un documento Pendiente
 * que aun no recibieron el recordatorio de esta campana.
 */
function obtenerDestinatariosRecordatorio(campania) {
  const yaRecordados = {};
  buscarFilasPorValor(HOJAS.HISTORIAL, 'observacion', construirEtiquetaCampania(campania)).forEach(function (fila) {
    yaRecordados[String(fila.matricula).trim().toLowerCase()] = true;
  });
  const pendientes = [];
  let yaEnviados = 0;
  leerExpedientesParaRecordatorio(campania.idProceso).forEach(function (fila) {
    if (fila.expediente.conteos.pendientes === 0) {
      return;
    }
    if (yaRecordados[String(fila.expediente.matricula).trim().toLowerCase()]) {
      yaEnviados++;
      return;
    }
    pendientes.push({ estudiante: fila.estudiante, expediente: fila.expediente });
  });
  return { pendientes: pendientes, yaEnviados: yaEnviados };
}

function contarDestinatariosRecordatorio(campania) {
  const destinatarios = obtenerDestinatariosRecordatorio(campania);
  return { enviados: destinatarios.yaEnviados, faltan: destinatarios.pendientes.length };
}

/**
 * Alumnos con pendientes en un tramite (antes de la primera campana).
 */
function contarAlumnosConPendientes(idProceso) {
  return leerExpedientesParaRecordatorio(idProceso).filter(function (fila) {
    return fila.expediente.conteos.pendientes > 0;
  }).length;
}

function construirEtiquetaCampania(campania) {
  return 'Recordatorio ' + campania.id;
}

function construirRegistroRecordatorio(campania, estudiante, usuario) {
  return {
    id_registro: generarId(PREFIJOS_ID.HISTORIAL),
    fecha_hora: new Date(),
    usuario: usuario,
    matricula: String(estudiante.matricula),
    tipo_documento: TIPO_HISTORIAL_CORREO,
    estatus_anterior: '-',
    estatus_nuevo: ESTATUS_HISTORIAL_RECORDATORIO,
    observacion: construirEtiquetaCampania(campania)
  };
}

function guardarRegistrosRecordatorio(registros) {
  if (!registros.length) {
    return;
  }
  conBloqueoEscritura(function () {
    insertarRegistros(HOJAS.HISTORIAL, registros);
  });
}

/* ------------------------------------------------------------------ */
/* Campana y activadores                                               */
/* ------------------------------------------------------------------ */

function leerCampaniaRecordatorio() {
  const texto = PropertiesService.getScriptProperties().getProperty(PROPIEDAD_CAMPANIA_RECORDATORIO);
  return texto ? JSON.parse(texto) : null;
}

function guardarCampaniaRecordatorio(campania) {
  PropertiesService.getScriptProperties().setProperty(PROPIEDAD_CAMPANIA_RECORDATORIO, JSON.stringify(campania));
}

/**
 * Sin pendientes: la campana termina. Por cuota: manana. Por tiempo: en un minuto.
 */
function programarSiguienteRecordatorio(campania, faltan, pausa) {
  eliminarActivadoresRecordatorio();
  if (!faltan) {
    campania.terminada = true;
    campania.proximoEnvio = '';
    guardarCampaniaRecordatorio(campania);
    return;
  }
  const espera = pausa === 'tiempo' ? ESPERA_CONTINUAR_RECORDATORIO_MS : ESPERA_SIGUIENTE_DIA_MS;
  ScriptApp.newTrigger(FUNCION_CONTINUAR_RECORDATORIO).timeBased().after(espera).create();
  campania.proximoEnvio = new Date(Date.now() + espera).toISOString();
  guardarCampaniaRecordatorio(campania);
}

function eliminarActivadoresRecordatorio() {
  ScriptApp.getProjectTriggers().forEach(function (activador) {
    if (activador.getHandlerFunction() === FUNCION_CONTINUAR_RECORDATORIO) {
      ScriptApp.deleteTrigger(activador);
    }
  });
}
