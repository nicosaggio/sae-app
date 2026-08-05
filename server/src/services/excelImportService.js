const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const XLSX = require('xlsx');
const { db, transaction } = require('../db/connection');
const lotesService = require('./lotesService');
const productosService = require('./productosService');

const CARPETA =
  process.env.SAE_IMPORT_DIR ||
  '\\\\ARQ01\\ANSELMI Trabajos\\TRABAJOS 2026\\SAE\\PRESUPUESTOS EXCEL\\CONFIRMADO';

function formatFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Lee un presupuesto de expositor desde un .xlsm real (hojas PRESUPUESTO + PEDIDO). */
function leerArchivo(rutaCompleta) {
  let wb;
  try {
    wb = XLSX.readFile(rutaCompleta, { cellDates: true });
  } catch (err) {
    return { error: `No se pudo abrir: ${err.message}` };
  }

  const ps = wb.Sheets['PRESUPUESTO'];
  const pedido = wb.Sheets['PEDIDO'];
  if (!ps || !pedido) {
    return { error: 'Faltan las hojas PRESUPUESTO o PEDIDO' };
  }

  const val = (addr) => {
    const cell = ps[addr];
    return cell ? cell.v : null;
  };

  const evento_nombre = val('C12') ? String(val('C12')).trim() : null;
  const lote_codigoRaw = val('F13');
  const lote_codigo =
    lote_codigoRaw !== null && lote_codigoRaw !== undefined ? String(lote_codigoRaw).trim() : null;
  const lote_expositor = val('F12') ? String(val('F12')).trim() : null;
  const cliente_nombre = val('C15') ? String(val('C15')).trim() : null;
  const cliente_contacto = [val('C13'), val('C14')].filter(Boolean).map(String).join(' - ') || null;
  const numeroRaw = val('F6');
  const numero = numeroRaw !== null && numeroRaw !== undefined ? String(numeroRaw) : null;
  const fecha = formatFecha(val('F7'));
  const montoRaw = val('F45');
  const monto_total = typeof montoRaw === 'number' ? montoRaw : null;
  const condiciones_pago = val('B48') ? String(val('B48')).trim() : null;
  const notas = val('B47') ? String(val('B47')).trim() : null;

  if (!evento_nombre || !lote_codigo) {
    return { error: 'Faltan datos obligatorios (EXPO o N° STAND) en la hoja PRESUPUESTO' };
  }

  const lineas = [];
  if (pedido['!ref']) {
    const rango = XLSX.utils.decode_range(pedido['!ref']);
    // Fila 3 = encabezados, datos desde la fila 4 (índice 3, 0-based)
    for (let r = 3; r <= rango.e.r; r++) {
      const codCell = pedido[XLSX.utils.encode_cell({ r, c: 9 })]; // J = COD
      const cantCell = pedido[XLSX.utils.encode_cell({ r, c: 8 })]; // I = CANT
      const rubroCell = pedido[XLSX.utils.encode_cell({ r, c: 5 })]; // F = RUBRO
      const productoCell = pedido[XLSX.utils.encode_cell({ r, c: 6 })]; // G = PRODUCTO
      if (!codCell || codCell.v === null || codCell.v === undefined || String(codCell.v).trim() === '') continue;
      const codigo = String(codCell.v).trim();
      const cantidad = Number(cantCell ? cantCell.v : 0) || 0;
      if (cantidad <= 0) continue;
      lineas.push({
        codigo,
        cantidad,
        rubro: rubroCell && rubroCell.v ? String(rubroCell.v).trim() : null,
        nombre: productoCell && productoCell.v ? String(productoCell.v).trim() : codigo,
      });
    }
  }

  return {
    evento_nombre,
    lote_codigo,
    lote_expositor,
    cliente_nombre,
    cliente_contacto,
    numero,
    fecha,
    monto_total,
    condiciones_pago,
    notas,
    lineas,
  };
}

function upsertProducto({ codigo, nombre, rubro }) {
  const existente = db.prepare('SELECT * FROM productos WHERE codigo = ?').get(codigo);
  if (existente) {
    if (existente.nombre !== nombre || existente.rubro !== rubro) {
      productosService.actualizar(existente.id, { codigo, nombre, rubro, activo: existente.activo });
    }
    return existente.id;
  }
  return productosService.crear({ codigo, nombre, rubro }).id;
}

function encontrarOCrearLote(eventoId, codigo, expositor) {
  const existente = db
    .prepare('SELECT * FROM lotes WHERE evento_id = ? AND codigo = ? AND expositor IS ?')
    .get(eventoId, codigo, expositor);
  if (existente) return existente;
  return lotesService.crear({ eventoId, codigo, expositor, contacto: null });
}

/** Si el mismo código aparece en más de una fila del PEDIDO (pasa en archivos reales), suma las cantidades. */
function agruparLineasPorCodigo(lineas) {
  const mapa = new Map();
  for (const linea of lineas) {
    const existente = mapa.get(linea.codigo);
    if (existente) {
      existente.cantidad += linea.cantidad;
    } else {
      mapa.set(linea.codigo, { ...linea });
    }
  }
  return Array.from(mapa.values());
}

function guardarLineas(presupuestoId, lineas) {
  for (const linea of agruparLineasPorCodigo(lineas)) {
    const productoId = upsertProducto({ codigo: linea.codigo, nombre: linea.nombre, rubro: linea.rubro });
    db.prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad) VALUES (?, ?, ?)').run(
      presupuestoId,
      productoId,
      linea.cantidad
    );
  }
}

function crearPresupuestoDesdeArchivo(loteId, datos, rutaArchivo, stat) {
  return transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO presupuestos
          (lote_id, numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total, notas,
           confirmado, estado, origen, ruta_archivo, archivo_activo, archivo_mtime, archivo_size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pendiente_facturar', 'excel', ?, 1, ?, ?)`
      )
      .run(
        loteId,
        datos.numero,
        datos.fecha,
        datos.cliente_nombre,
        datos.cliente_contacto,
        datos.condiciones_pago,
        datos.monto_total,
        datos.notas,
        rutaArchivo,
        stat.mtime.toISOString(),
        stat.size
      );
    const presupuestoId = info.lastInsertRowid;
    guardarLineas(presupuestoId, datos.lineas);
    return presupuestoId;
  });
}

/** Re-sincroniza un presupuesto ya importado cuando su archivo cambió. Nunca toca `estado`. */
function actualizarPresupuestoDesdeArchivo(presupuestoExistente, datos, stat) {
  transaction(() => {
    db.prepare(
      `UPDATE presupuestos SET numero=?, fecha=?, cliente_nombre=?, cliente_contacto=?, condiciones_pago=?,
         monto_total=?, notas=?, archivo_mtime=?, archivo_size=?, archivo_activo=1, actualizado_en=datetime('now')
       WHERE id=?`
    ).run(
      datos.numero,
      datos.fecha,
      datos.cliente_nombre,
      datos.cliente_contacto,
      datos.condiciones_pago,
      datos.monto_total,
      datos.notas,
      stat.mtime.toISOString(),
      stat.size,
      presupuestoExistente.id
    );
    db.prepare('DELETE FROM presupuesto_lineas WHERE presupuesto_id = ?').run(presupuestoExistente.id);
    guardarLineas(presupuestoExistente.id, datos.lineas);
  });
}

function registrarPendienteEvento(rutaArchivo, datos) {
  const yaPendiente = db
    .prepare("SELECT id FROM import_pendientes WHERE tipo = 'evento_no_encontrado' AND ruta_archivo = ? AND resuelto = 0")
    .get(rutaArchivo);
  if (yaPendiente) return;
  db.prepare("INSERT INTO import_pendientes (tipo, ruta_archivo, datos_json) VALUES ('evento_no_encontrado', ?, ?)").run(
    rutaArchivo,
    JSON.stringify(datos)
  );
}

function registrarPendientePosibleReemplazo(rutaArchivo, loteId, huerfanoId, nuevoId) {
  const yaPendiente = db
    .prepare("SELECT id FROM import_pendientes WHERE tipo = 'posible_reemplazo' AND presupuesto_huerfano_id = ? AND resuelto = 0")
    .get(huerfanoId);
  if (yaPendiente) return;
  db.prepare(
    `INSERT INTO import_pendientes (tipo, ruta_archivo, lote_id, presupuesto_huerfano_id, presupuesto_nuevo_id)
     VALUES ('posible_reemplazo', ?, ?, ?, ?)`
  ).run(rutaArchivo, loteId, huerfanoId, nuevoId);
}

function escanear() {
  let archivos;
  try {
    archivos = fs
      .readdirSync(CARPETA)
      .filter((f) => /\.xlsm?$/i.test(f))
      .map((f) => path.join(CARPETA, f));
  } catch (err) {
    console.error(`[excelImportService] No se pudo leer la carpeta "${CARPETA}": ${err.message}`);
    return { ok: false, error: err.message };
  }

  const rutasEscaneadas = new Set(archivos);
  const resumen = { nuevos: 0, actualizados: 0, sinCambios: 0, pendientesEvento: 0, huerfanos: 0, errores: 0 };

  // 1) Marcar huérfanos ANTES de crear presupuestos nuevos, para poder emparejarlos
  //    con un reemplazo que aparezca en este mismo escaneo.
  const activos = db.prepare("SELECT * FROM presupuestos WHERE origen = 'excel' AND archivo_activo = 1").all();
  for (const p of activos) {
    if (!rutasEscaneadas.has(p.ruta_archivo)) {
      db.prepare("UPDATE presupuestos SET archivo_activo = 0, actualizado_en = datetime('now') WHERE id = ?").run(p.id);
      resumen.huerfanos++;
    }
  }

  // 1.5) Limpiar pendientes 'evento_no_encontrado' obsoletos: si el archivo ya tiene un
  //      presupuesto (creado en este escaneo, en uno anterior, o vinculado a mano), el
  //      pendiente ya no aplica, sin importar cuándo se haya resuelto la ambigüedad.
  db.prepare(
    `UPDATE import_pendientes SET resuelto = 1, resuelto_en = datetime('now')
     WHERE tipo = 'evento_no_encontrado' AND resuelto = 0
       AND ruta_archivo IN (SELECT ruta_archivo FROM presupuestos WHERE ruta_archivo IS NOT NULL)`
  ).run();

  for (const rutaArchivo of archivos) {
    let stat;
    try {
      stat = fs.statSync(rutaArchivo);
    } catch {
      continue;
    }

    const existente = db.prepare('SELECT * FROM presupuestos WHERE ruta_archivo = ?').get(rutaArchivo);

    if (existente) {
      const mtimeIso = stat.mtime.toISOString();
      if (existente.archivo_mtime === mtimeIso && existente.archivo_size === stat.size && existente.archivo_activo) {
        resumen.sinCambios++;
        continue;
      }
      const datos = leerArchivo(rutaArchivo);
      if (datos.error) {
        console.error(`[excelImportService] ${rutaArchivo}: ${datos.error}`);
        resumen.errores++;
        continue;
      }
      actualizarPresupuestoDesdeArchivo(existente, datos, stat);
      resumen.actualizados++;
      continue;
    }

    const datos = leerArchivo(rutaArchivo);
    if (datos.error) {
      console.error(`[excelImportService] ${rutaArchivo}: ${datos.error}`);
      resumen.errores++;
      continue;
    }

    const eventosCoincidentes = db.prepare('SELECT * FROM eventos WHERE nombre = ? COLLATE NOCASE').all(datos.evento_nombre);

    if (eventosCoincidentes.length !== 1) {
      registrarPendienteEvento(rutaArchivo, datos);
      resumen.pendientesEvento++;
      continue;
    }

    const evento = eventosCoincidentes[0];
    const lote = encontrarOCrearLote(evento.id, datos.lote_codigo, datos.lote_expositor);
    const presupuestoId = crearPresupuestoDesdeArchivo(lote.id, datos, rutaArchivo, stat);
    resumen.nuevos++;

    // Si este archivo tenía un pendiente 'evento_no_encontrado' de un escaneo anterior
    // (por ejemplo, la ambigüedad se resolvió renombrando un evento), queda obsoleto.
    db.prepare(
      "UPDATE import_pendientes SET resuelto = 1, resuelto_en = datetime('now') WHERE tipo = 'evento_no_encontrado' AND ruta_archivo = ? AND resuelto = 0"
    ).run(rutaArchivo);

    const huerfano = db
      .prepare('SELECT * FROM presupuestos WHERE lote_id = ? AND archivo_activo = 0 AND id != ? ORDER BY id DESC LIMIT 1')
      .get(lote.id, presupuestoId);
    if (huerfano) {
      registrarPendientePosibleReemplazo(rutaArchivo, lote.id, huerfano.id, presupuestoId);
    }
  }

  console.log('[excelImportService] Escaneo completo:', resumen);
  return { ok: true, resumen };
}

/** Materializa un pendiente de tipo 'evento_no_encontrado' contra un evento (existente o recién creado). */
function materializarPendiente(pendienteId, eventoId) {
  const pendiente = db.prepare('SELECT * FROM import_pendientes WHERE id = ?').get(pendienteId);
  if (!pendiente) {
    const err = new Error('Pendiente no encontrado');
    err.status = 404;
    throw err;
  }
  if (pendiente.tipo !== 'evento_no_encontrado') {
    const err = new Error('Este pendiente no es de tipo evento_no_encontrado');
    err.status = 400;
    throw err;
  }

  const datos = JSON.parse(pendiente.datos_json);
  let stat;
  try {
    stat = fs.statSync(pendiente.ruta_archivo);
  } catch {
    const err = new Error('El archivo ya no existe en la carpeta, no se puede vincular');
    err.status = 400;
    throw err;
  }

  const lote = encontrarOCrearLote(eventoId, datos.lote_codigo, datos.lote_expositor);
  const presupuestoId = crearPresupuestoDesdeArchivo(lote.id, datos, pendiente.ruta_archivo, stat);
  db.prepare("UPDATE import_pendientes SET resuelto = 1, resuelto_en = datetime('now') WHERE id = ?").run(pendienteId);
  return presupuestoId;
}

function iniciarProgramacion() {
  try {
    escanear();
  } catch (err) {
    console.error('[excelImportService] Error en el escaneo inicial:', err);
  }
  cron.schedule('*/10 * * * *', () => {
    try {
      escanear();
    } catch (err) {
      console.error('[excelImportService] Error en escaneo programado:', err);
    }
  });
}

module.exports = { escanear, iniciarProgramacion, leerArchivo, materializarPendiente, CARPETA };
